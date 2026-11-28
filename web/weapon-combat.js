import * as THREE from 'three';
import { CONFIG, muzzlePoseFromData, chooseCombatTarget } from './simulation.js?v=movement-20261129a';
import { applyPose, pitchRange } from '../rigging-test/rig-control.js';

export function createBattleCombat({rigs,balance,approximateMoveBatch}){
// Weapon state belongs to the ship; the rig remains the adapter for visual and safety checks.
function teamForShip(state,ship){return state.fleets.find(f=>f.id===ship.fleetId)?.team;}
function battleCombat(state,ships,dt,index){
  const shots=[],tick=Math.round(state.time/CONFIG.dt);state.rayEffects=[];
  for(const ship of ships){const rig=rigs.get(ship.id);if(!rig?.safe)continue;for(const w of rig.weapons){const data=w.combatState,active=data.activeRays;if(!active)continue;for(const [muzzleIndex,ray] of active){if(tick>=ray.endTick){active.delete(muzzleIndex);continue;}const pose=muzzlePoseFromData(w.muzzleChains[muzzleIndex],w,ship.position,ship.rotation,data.yaw,data.pitch),end=pose.position.clone().addScaledVector(pose.direction,ray.displayLength??ray.length);const fx={id:data.id+':'+muzzleIndex,origin:pose.position.clone(),position:end};state.rayEffects.push(fx);if(tick===ray.nextTick){ray.nextTick+=w.balance.intervalTicks;rig.view.position.copy(ship.position);rig.view.quaternion.copy(ship.rotation);rig.view.updateWorldMatrix(true,true);const muzzle=w.muzzleNodes[muzzleIndex],range=ray.length;shots.push({ownerShipId:ship.id,muzzleId:muzzle.name,team:teamForShip(state,ship),position:pose.position.clone(),direction:pose.direction,range,radius:.1,damage:w.balance.damage,weapon:data,isRayPulse:true,validate:()=>{try{return !rig.safety.muzzleBlocked(muzzle,{radius:.1,range});}catch(e){rig.safe=false;rig.reason='포구 안전 검사 오류';console.error(e);return false;}},onResolved:hit=>{ray.displayLength=hit?pose.position.distanceTo(hit):ray.length;if(hit)fx.position.copy(hit);}});}}}}
  for(const ship of ships){const rig=rigs.get(ship.id);if(!rig)continue;for(const w of rig.weapons){const data=w.combatState;if(data.aimYaw===undefined)continue;const approach=(a,b,rate)=>a+THREE.MathUtils.clamp(b-a,-rate*dt,rate*dt);data.yaw=approach(data.yaw,data.aimYaw,w.settings.yawSpeed??35);data.pitch=THREE.MathUtils.clamp(approach(data.pitch,data.aimPitch,w.settings.pitchSpeed??35),...pitchRange({...w,yaw:data.yaw}));w.yaw=data.yaw;w.pitch=data.pitch;applyPose(w);}}
  // Invalid targets are cleared each fixed tick; full reassignment remains at 5 Hz.
  const aliveById=new Map(ships.map(ship=>[ship.id,ship])),teamLookup=new Map(state.fleets.map(f=>[f.id,f.team]));
  for(const ship of ships){const rig=rigs.get(ship.id);if(!rig)continue;for(const w of rig.weapons){const target=aliveById.get(w.combatState.targetId);if(w.combatState.targetId&&(!target||teamLookup.get(target.fleetId)===teamLookup.get(ship.fleetId)||ship.position.distanceToSquared(target.position)>(w.balance?.range??CONFIG.weaponRange)**2)){w.combatState.targetId=null;w.target=null;}}}
  if(Math.round(state.time/CONFIG.dt)%12!==0)return shots;
  for(const ship of ships){const rig=rigs.get(ship.id);if(!rig)continue;rig.view.position.copy(ship.position);rig.view.quaternion.copy(ship.rotation);}
  const aimDt=dt*12,teamByFleet=new Map(state.fleets.map(f=>[f.id,f.team])),fleetCandidates=new Map(),assignments=new Map();
  // Query once per fleet and share the conservative enemy set across its ships.
  for(const fleet of state.fleets){
    const alive=fleet.ships.filter(s=>s.alive);if(!alive.length)continue;
    const bounds=new THREE.Box3().setFromPoints(alive.map(s=>s.position)).expandByScalar(balance?.maxRange??CONFIG.weaponRange);
    fleetCandidates.set(fleet.id,index.query(bounds.min,bounds.max).filter(s=>teamByFleet.get(s.fleetId)!==fleet.team));
    assignments.set(fleet.id,new Map());
  }
  for(const ship of [...ships].sort((a,b)=>a.id.localeCompare(b.id))){const rig=rigs.get(ship.id);if(!rig?.safe)continue;const fleet=state.fleets.find(f=>f.id===ship.fleetId),nearest=[];
    for(const w of rig.weapons){w.yaw=w.combatState.yaw;w.pitch=w.combatState.pitch;}
    // Stable distance ordering; later candidates rotate through a bounded fallback window.
    for(const enemy of fleetCandidates.get(ship.fleetId)||[]){const distance=ship.position.distanceToSquared(enemy.position);if(distance>(balance?.maxRange??CONFIG.weaponRange)**2)continue;nearest.push({enemy,distance});}
    nearest.sort((a,b)=>a.distance-b.distance||a.enemy.id.localeCompare(b.enemy.id));
    const loads=assignments.get(ship.fleetId);
    for(const w of [...rig.weapons].sort((a,b)=>a.combatState.id.localeCompare(b.combatState.id))){const data=w.combatState;if(data.activeRays?.size){data.cooldown=Math.max(0,(data.cooldown||0)-aimDt);continue;}data.cooldown=Math.max(0,(data.cooldown||0)-aimDt);if(!w.muzzleChains.length){w.target=null;data.targetId=null;continue;}
      const poses=w.muzzleChains.map(chain=>muzzlePoseFromData(chain,w,ship.position,ship.rotation)),range=w.settings;let maxAngle=0;
      if(w.pivot){const yaw=Math.max(Math.abs(w.yaw-range.yaw[0]),Math.abs(w.yaw-range.yaw[1])),pitch=Math.max(Math.abs(w.pitch-range.pitch[0]),Math.abs(w.pitch-range.pitch[1]));maxAngle=THREE.MathUtils.degToRad(yaw+pitch)+.1;}
      const reachable=item=>item.distance<=(w.balance?.range??CONFIG.weaponRange)**2&&poses.some(pose=>{const toward=item.enemy.position.clone().sub(pose.position);if(toward.lengthSq()<1e-12)return false;const dot=pose.direction.dot(toward.normalize());return w.pivot?maxAngle>=Math.PI||dot>=Math.cos(maxAngle):dot>=.995;});
      const count=nearest.length,rotation=count>4?Math.floor(state.time/.2)%Math.ceil((count-4)/24):0,window=nearest.slice(0,4).concat(nearest.slice(4+rotation*24,4+(rotation+1)*24));
      const previous=nearest.find(item=>item.enemy.id===data.targetId);if(previous&&!window.includes(previous))window.push(previous);
      const candidates=[];if(previous&&reachable(previous))candidates.push(previous);for(const item of window){if(item!==previous&&reachable(item)){candidates.push(item);if(candidates.length>=4)break;}}
      const damage=data.cooldown<=1?(w.balance?.damage??20)*Math.max(1,w.muzzleNodes.length):0,choice=chooseCombatTarget((data.blockedSince!==undefined&&state.time-data.blockedSince>=1&&candidates.length>1?candidates.filter(item=>item.enemy.id!==data.targetId):candidates).map(item=>({...item,distance:item.distance*(item.enemy.fleetId===fleet.encounter.enemyId ? .9 : 1)})),data.targetId,loads,damage);
      if(choice?.id!==data.targetId)delete data.blockedSince;w.target=choice;data.targetId=choice?.id||null;data.blockReason=!choice?'OUT_OF_RANGE':data.cooldown>0?'RELOADING':'AIMING';if(choice)loads.set(choice.id,(loads.get(choice.id)||0)+damage);
    }
    const proposals=rig.weapons.filter(w=>w.pivot&&w.target&&w.muzzleNodes.length).map(w=>{
      const score=(yaw,pitch)=>{const pose=muzzlePoseFromData(w.muzzleChains[0],w,ship.position,ship.rotation,yaw,pitch),toward=w.target.position.clone().sub(pose.position);return toward.lengthSq()>1e-12?pose.direction.dot(toward.normalize()):-1;};
      let best=score(w.yaw,w.pitch),yaw=w.yaw,pitch=w.pitch;const oldYaw=yaw,oldPitch=pitch,delta=35*aimDt;
      for(const stepSize of [delta,delta/7,delta/70])for(const [dy,dp] of [[stepSize,0],[-stepSize,0],[0,stepSize],[0,-stepSize]]){
        const candidateYaw=THREE.MathUtils.clamp(yaw+dy,Math.max(w.settings.yaw[0],oldYaw-delta),Math.min(w.settings.yaw[1],oldYaw+delta));
        const candidatePitch=THREE.MathUtils.clamp(pitch+dp,...pitchRange({...w,yaw:candidateYaw})); if(Math.abs(candidatePitch-oldPitch)>delta+1e-9)continue;
        const value=score(candidateYaw,candidatePitch);if(value>best+1e-9){best=value;yaw=candidateYaw;pitch=candidatePitch;}
      }
      return {weapon:w,yaw,pitch};
    }).filter(p=>Math.abs(p.yaw-p.weapon.yaw)>1e-9||Math.abs(p.pitch-p.weapon.pitch)>1e-9);
    try{approximateMoveBatch(rig,proposals);for(const w of rig.weapons){w.combatState.aimYaw=w.yaw;w.combatState.aimPitch=w.pitch;w.yaw=w.combatState.yaw;w.pitch=w.combatState.pitch;applyPose(w);}rig.view.updateWorldMatrix(true,true);}catch(e){rig.safe=false;rig.reason='포탑 근사 검사 오류';console.error(e);continue;}
    for(const w of rig.weapons){if(!w.target||w.combatState.cooldown>0||w.combatState.activeRays?.size)continue;for(let muzzleIndex=0;muzzleIndex<w.muzzleNodes.length;muzzleIndex++){const muzzle=w.muzzleNodes[muzzleIndex],pose=muzzlePoseFromData(w.muzzleChains[muzzleIndex],w,ship.position,ship.rotation),origin=pose.position,dir=pose.direction,toward=w.target.position.clone().sub(origin),range=toward.length();if(range<1e-6||range>(w.balance?.range??CONFIG.weaponRange)||dir.dot(toward.normalize())<.995)continue;
      // Defer the expensive own-mesh safety check until the broad phase finds an enemy first hit.
      const validate=()=>{if(!rig.safe)return false;try{const clear=!rig.safety.muzzleBlocked(muzzle,{radius:.1,range});if(!clear){w.combatState.blockReason='OWN_BLOCK';w.combatState.blockedSince??=state.time;}return clear;}catch(e){rig.safe=false;rig.reason='포구 안전 검사 오류';console.error(e);return false;}};
      shots.push({ownerShipId:ship.id,muzzleId:muzzle.name,team:fleet.team,visualType:w.balance?.id,position:origin.clone(),direction:dir,range,radius:.1,damage:w.balance?.damage??20,weapon:w.combatState,validate,onHit:w.balance?.effect==='RAY'?()=>{const d=w.combatState;d.activeRays??=new Map();d.activeRays.set(muzzleIndex,{endTick:tick+w.balance.durationTicks,nextTick:tick+w.balance.intervalTicks,length:range});}:null});
    }}
  }return shots;
}
  return battleCombat;
}
