import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG, COMMAND_GRID, BATTLEFIELD, ZONES, SCORE_CONFIG, zoneCounts, captureMuzzleChain, muzzlePoseFromData, gridToWorld, worldToNearestGrid, insideBattlefield, setDestination, setMovementPolicy, setPatrolRoute, setCombatPolicy, setDefenseAnchor, chooseCombatTarget, gridToWorld as patrolPointWorld, ECONOMY_CONFIG, configureBalance, createEmptyFleet, purchaseShip, assignReserve, deployReserves, prepareEnemyAI, checkRecovery, initialState, slots, grid, dimensions, validateSize, sizeForSpacing, step, start } from './simulation.js?v=maneuver-20261124-1';
import { discoverRig, initializeWeapons, applyPose, pitchRange } from '../rigging-test/rig-control.js';
import { RigSafety } from '../rigging-test/rig-safety.js';

// Game-only broad phase. The reference rigging tool and its hashed analysis remain unchanged.
class GameRigSafety extends RigSafety {
  constructor(root,weapons,options){
    super(root,weapons,options);
    this.fixedPairs=[];this.dynamicPairs=[];this.ownerIds=new Map();this.pairCache=new Map();
    for(const part of this.parts)if(!this.ownerIds.has(part.owner))this.ownerIds.set(part.owner,this.ownerIds.size);
    for(let i=0;i<this.parts.length;i++)for(let j=i+1;j<this.parts.length;j++){
      const a=this.parts[i],b=this.parts[j];if(a.owner===b.owner)continue;
      (a.owner&&b.owner?this.dynamicPairs:this.fixedPairs).push([a,b]);
    }
  }
  poseCollision(activeOwners=null,{fixedOnly=false,dynamicOnly=false}={}){
    this.update();
    if(this.confirmedNeutral&&this.weapons.every(w=>!w.pivot||(Math.abs(w.yaw)<1e-9&&Math.abs(w.pitch)<1e-9)))return null;
    const scanFixed=()=>{
      if(activeOwners&&this.precomputed){
        const w=this.weapons.find(w=>w.pivot&&activeOwners.size===w.barrels.length+1&&activeOwners.has(w.pivot)&&w.barrels.every(b=>activeOwners.has(b)));
        const saved=w&&this.precomputed.weapons.find(x=>x.key===w.key&&JSON.stringify(x.settings)===JSON.stringify(w.settings));
        const sample=saved?.samples.find(p=>p.yaw===w.yaw&&p.pitch===w.pitch);
        if(sample)return this.allowInferredJoints?sample.draftBlocked:sample.blocked;
      }
      if(dynamicOnly)return null;
      return scan(this.fixedPairs,'fixed');
    };
    const candidates=(pairs,kind)=>{
      if(!activeOwners)return pairs;
      const ids=[...activeOwners].filter(o=>this.ownerIds.has(o)).map(o=>this.ownerIds.get(o)).sort((a,b)=>a-b);
      const key=kind+':'+ids.join(',');let selected=this.pairCache.get(key);
      if(!selected){selected=pairs.filter(([a,b])=>activeOwners.has(a.owner)||activeOwners.has(b.owner));if(this.pairCache.size>=128)this.pairCache.delete(this.pairCache.keys().next().value);this.pairCache.set(key,selected);}
      return selected;
    };
    const scan=(pairs,kind)=>{for(const [a,b] of candidates(pairs,kind)){
      if(!a.box.intersectsBox(b.box))continue;
      const hit=this.pairCollision(a,b);if(hit)return hit;
    }return null;};
    if(fixedOnly)return scanFixed();
    if(dynamicOnly)return scan(this.dynamicPairs,'dynamic');
    return scanFixed()||scan(this.dynamicPairs,'dynamic');
  }
}

const $ = id => document.getElementById(id);
function parseBalanceCSV(text,file){const rows=[];let row=[],field='',quoted=false,closed=false;for(let i=0,input=text.replace(/^\uFEFF/,'');i<input.length;i++){const c=input[i];if(quoted){if(c==='"'){if(input[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}if(closed&&!(',\r\n'.includes(c)))throw Error(file+': 따옴표 오류');if(c==='"'){if(field||closed)throw Error(file+': 따옴표 오류');quoted=true;}else if(c===','){row.push(field);field='';closed=false;}else if(c==='\r'||c==='\n'){if(c==='\r'&&input[i+1]==='\n')i++;row.push(field);if(row.some(Boolean))rows.push(row);row=[];field='';closed=false;}else field+=c;}if(quoted)throw Error(file+': 따옴표 미종료');if(field||row.length){row.push(field);rows.push(row);}const header=rows.shift();if(!header||new Set(header).size!==header.length)throw Error(file+': 헤더 오류');return rows.map((r,i)=>{if(r.length!==header.length)throw Error(file+': '+(i+2)+'행 열 수 오류');return Object.fromEntries(header.map((h,j)=>[h,r[j]]));});}
async function loadBalance(){const tables={};await Promise.all(['ships','ship_weapons','weapon_types','game_rules'].map(async n=>{const r=await fetch('../data/balance/'+n+'.csv',{cache:'no-store'});if(!r.ok)throw Error(n+'.csv 로딩 실패');tables[n]=parseBalanceCSV(await r.text(),n);}));const all=Object.values(tables).flat(),gens=new Set(all.map(r=>r.schema_version+':'+r.generation_id));if(gens.size!==1||!String([...gens][0]).startsWith('1:')||all.some(r=>!r.generation_id))throw Error('CSV 버전 또는 생성 세대 불일치');const unique=(rows,key)=>{let ids=new Set();for(const r of rows){const id=key(r);if(!id||ids.has(id))throw Error('식별자 누락 또는 중복: '+id);ids.add(id);}return ids;};const ships=unique(tables.ships,r=>r.ship_id),typeids=unique(tables.weapon_types,r=>r.weapon_type_id);unique(tables.ship_weapons,r=>r.ship_id&&r.weapon_id?r.ship_id+':'+r.weapon_id:'');unique(tables.game_rules,r=>r.rule_id);const number=(r,k,zero=false,int=false)=>{const t=r[k],v=Number(t);if(t===undefined||t.trim()===''||!Number.isFinite(v)||(zero?v<0:v<=0)||(int&&!Number.isSafeInteger(v)))throw Error((r.ship_id||r.weapon_type_id||r.rule_id)+': '+k+' 값 오류');return v;};for(const r of tables.ships)if(!/^(D|LC)\d{2}$/.test(r.ship_id)||!['true','false'].includes(r.enabled)||!r.model_path||r.model_path.includes('..')||/[\\/:]/.test(r.model_path))throw Error('함선 설정 오류: '+r.ship_id);for(const r of tables.ship_weapons){if(!ships.has(r.ship_id)||!/^W\d{2}$/.test(r.weapon_id)||!['turret','fixed','barrel_only'].includes(r.mount_kind))throw Error('포 설정 오류: '+r.ship_id+'/'+r.weapon_id);number(r,'muzzle_count',false,true);if(r.weapon_type_id&&!typeids.has(r.weapon_type_id))throw Error('미등록 포 유형: '+r.weapon_type_id);}const types=new Map(tables.weapon_types.map(r=>{if(!/^[A-Z0-9_]+$/.test(r.weapon_type_id))throw Error('포 유형 ID 오류');return[r.weapon_type_id,Object.freeze({damage:number(r,'damage_per_round',false,true),cooldown:number(r,'cooldown_sec'),range:number(r,'range')})]}));const enabled=tables.ships.filter(r=>r.enabled==='true');if(!enabled.length)throw Error('활성 함선이 없습니다. CSV에서 함선 능력치와 포 유형을 지정하세요.');if(enabled.some(r=>r.ship_id!=='LC01'))throw Error('현재 모델 연결은 LC01만 지원합니다.');const r=enabled.find(r=>r.ship_id==='LC01');if(!r)throw Error('시작 함선 LC01이 비활성입니다.');const ship=Object.freeze({max_hp:number(r,'max_hp',false,true),max_shield:number(r,'max_shield',true,true),forward_speed:number(r,'forward_speed'),price:number(r,'price',false,true),model_path:r.model_path});const mounts=new Map();for(const m of tables.ship_weapons.filter(x=>x.ship_id==='LC01')){if(!m.weapon_type_id||!types.has(m.weapon_type_id))throw Error('LC01/'+m.weapon_id+': 포 유형을 지정하세요.');mounts.set(m.weapon_id,Object.freeze({type:types.get(m.weapon_type_id),kind:m.mount_kind,muzzles:number(m,'muzzle_count',false,true)}));}if(!mounts.size)throw Error('LC01 포가 없습니다.');const ruleRows=new Map(tables.game_rules.map(r=>[r.rule_id,r])),rules={};for(const k of ['score_interval_sec','score_base','score_advantage_cap','side_zone_multiplier','center_zone_multiplier','victory_score']){const r=ruleRows.get(k);if(!r)throw Error('득점 규칙 누락: '+k);rules[k]=number(r,'value',false,k!=='score_interval_sec');}if(Math.abs(rules.score_interval_sec/CONFIG.dt-Math.round(rules.score_interval_sec/CONFIG.dt))>1e-8)throw Error('득점 주기는 고정 틱의 정수 배여야 합니다.');return Object.freeze({ship,mounts,rules:Object.freeze(rules),maxRange:Math.max(...[...mounts.values()].map(m=>m.type.range))});}
const state=initialState();let balance=null,balanceError='';try{balance=await loadBalance();configureBalance(balance);for(const f of state.fleets)for(const ship of f.ships){ship.hp=ship.maxHp=balance.ship.max_hp;ship.shield=ship.maxShield=balance.ship.max_shield;ship.forwardSpeed=balance.ship.forward_speed;}}catch(e){balanceError=e.message;}
const friendly = state.fleets.filter(f => f.team === 'ALLY');
let prepareUnitView=null, purchaseCounter=0;
let selected = friendly[0];
let draft = null, patrolEdit = null;
let shipMode=null,manualPaused=false;
const tacticLabels={OPPORTUNISTIC_FIRE:'경로 대치',STANDOFF:'거리 유지',BREAKTHROUGH:'관통 공격',ENCIRCLE:'분산 포위',POINT_DEFENSE:'거점 방어'};
const tacticDescriptions={OPPORTUNISTIC_FIRE:'모든 함선의 사거리 안에 경로상 적이 들어오면 정지해 사격합니다.',STANDOFF:'적과 거리를 조절하며 교전합니다.',BREAKTHROUGH:'적 진형을 통과한 뒤 후방에서 싸웁니다.',ENCIRCLE:'여러 방향으로 나뉘어 적을 공격합니다.',POINT_DEFENSE:'조우 시 거점으로 모여 적을 추격하지 않습니다.'};
const viewport=$('viewport');
const viewportSize=()=>({width:Math.max(1,viewport.clientWidth),height:Math.max(1,viewport.clientHeight)});
let activeCamera;
let pickingCamera;
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.setSize(viewportSize().width,viewportSize().height); renderer.outputColorSpace=THREE.SRGBColorSpace;
viewport.prepend(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0x080e1b);
const camera=new THREE.PerspectiveCamera(45,viewportSize().width/viewportSize().height,0.1,1000);camera.position.set(48,40,65);
activeCamera=camera; pickingCamera=new THREE.OrthographicCamera(-75,75,75,-75,0.1,1000);
const orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=true;orbit.target.set(0,0,4);orbit.minDistance=4;orbit.maxDistance=160;
const cameraKeys = new Set();
const cameraKeyCodes = new Set(['KeyW','KeyA','KeyS','KeyD','KeyR','KeyF']);
const editable = element => element instanceof HTMLElement && (element.matches('input, textarea, select, button, summary') || element.isContentEditable);
window.addEventListener('keydown', event => {
  if ((draft && (event.code==='KeyR'||event.code==='KeyF')) || !cameraKeyCodes.has(event.code) || editable(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault(); cameraKeys.add(event.code);
});
window.addEventListener('keyup', event => cameraKeys.delete(event.code));
window.addEventListener('blur', () => cameraKeys.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden) cameraKeys.clear(); });
document.addEventListener('focusin', event => { if (editable(event.target)) cameraKeys.clear(); });
const cameraForward = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const cameraMove = new THREE.Vector3();
const worldUp = new THREE.Vector3(0,1,0);
function moveCamera(dt) {
  camera.getWorldDirection(cameraForward);
  cameraRight.setFromMatrixColumn(camera.matrix, 0).normalize();
  cameraMove.set(0,0,0);
  if (cameraKeys.has('KeyW')) cameraMove.add(cameraForward);
  if (cameraKeys.has('KeyS')) cameraMove.sub(cameraForward);
  if (cameraKeys.has('KeyD')) cameraMove.add(cameraRight);
  if (cameraKeys.has('KeyA')) cameraMove.sub(cameraRight);
  if (cameraKeys.has('KeyR')) cameraMove.add(worldUp);
  if (cameraKeys.has('KeyF')) cameraMove.sub(worldUp);
  if (cameraMove.lengthSq() > 0) {
    cameraMove.normalize().multiplyScalar(18 * dt);
    camera.position.add(cameraMove); orbit.target.add(cameraMove);
  }
}
scene.add(new THREE.HemisphereLight(0xddeaff,0x44536c,2));const light=new THREE.DirectionalLight(0xffffff,2.2);light.position.set(-20,40,30);scene.add(light);
const markerGeometry=new THREE.SphereGeometry(.24,12,8), markerMaterial=new THREE.MeshBasicMaterial({color:0x54dbff});
const targetMarker=new THREE.Mesh(new THREE.OctahedronGeometry(.7),new THREE.MeshBasicMaterial({color:0xffd46a,wireframe:true}));scene.add(targetMarker);
const defenseMarker=new THREE.Mesh(new THREE.OctahedronGeometry(1),new THREE.MeshBasicMaterial({color:0xb8ff91,wireframe:true,depthTest:false}));defenseMarker.renderOrder=3;scene.add(defenseMarker);
const tacticalGroup=new THREE.Group();scene.add(tacticalGroup);const tacticalGeometry=new THREE.OctahedronGeometry(.85),tacticalMaterial=new THREE.MeshBasicMaterial({color:0xff9af1,wireframe:true,depthTest:false});
const slotGroup=new THREE.Group();scene.add(slotGroup);
const waypointGroup=new THREE.Group();scene.add(waypointGroup);let waypointSignature='';
const lineMaterial=new THREE.LineBasicMaterial({color:0xffd46a});const lineGeometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]);const route=new THREE.Line(lineGeometry,lineMaterial);scene.add(route);
const views=new Map(), rigs=new Map(), moveSafetyCache=new Map();
const projectileViews=new Map(),shotMaterial=new THREE.LineBasicMaterial({color:0xffd87a,transparent:true,opacity:.9});
for(const zone of ZONES){const size=zone.max.clone().sub(zone.min),center=zone.min.clone().add(zone.max).multiplyScalar(.5);const box=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x,size.y,size.z)),new THREE.LineBasicMaterial({color:zone.multiplier===2?0xc69b51:0x3d7388,transparent:true,opacity:.36}));box.position.copy(center);scene.add(box);}
// Approximate visual movement guard. AABB overlap is not an exact collision test.
// Muzzle and projectile safety continue to use the separate mesh checks.
function boxOverlapFraction(a,b){
  const x=Math.max(0,Math.min(a.max.x,b.max.x)-Math.max(a.min.x,b.min.x));
  const y=Math.max(0,Math.min(a.max.y,b.max.y)-Math.max(a.min.y,b.min.y));
  const z=Math.max(0,Math.min(a.max.z,b.max.z)-Math.max(a.min.z,b.min.z));
  const volume=box=>Math.max(0,box.max.x-box.min.x)*Math.max(0,box.max.y-box.min.y)*Math.max(0,box.max.z-box.min.z);
  const smaller=Math.min(volume(a),volume(b));return smaller>1e-15?x*y*z/smaller:0;
}
function approximateMoveBatch(rig,proposals){
  const pending=new Set(proposals);while(pending.size){const component=[pending.values().next().value];pending.delete(component[0]);let changed=true;while(changed){changed=false;const owners=new Set(component.flatMap(p=>[p.weapon.pivot,...p.weapon.barrels]));for(const proposal of pending){const parts=new Set([proposal.weapon.pivot,...proposal.weapon.barrels]);if(rig.safety.dynamicPairs.some(([a,b])=>(owners.has(a.owner)&&parts.has(b.owner))||(owners.has(b.owner)&&parts.has(a.owner)))){component.push(proposal);pending.delete(proposal);changed=true;}}}applyMoveComponent(rig,component);}
}
function applyMoveComponent(rig,proposals){
  if(!proposals.length)return;
  const safety=rig.safety,active=new Set(proposals.flatMap(p=>[p.weapon.pivot,...p.weapon.barrels]));
  const pairs=[...safety.fixedPairs,...safety.dynamicPairs].filter(([a,b])=>active.has(a.owner)||active.has(b.owner));
  safety.update();const before=pairs.map(([a,b])=>boxOverlapFraction(a.box,b.box));
  const original=proposals.map(({weapon:w})=>({w,yaw:w.yaw,pitch:w.pitch}));
  try{
    for(const p of proposals){p.weapon.yaw=p.yaw;p.weapon.pitch=p.pitch;applyPose(p.weapon);}
    safety.update();
    // Permit the overlap already present in the current pose. Stop only a large new
    // overlap; legitimate contacts and thin geometry still need visual validation.
    const blocked=pairs.some(([a,b],i)=>{const next=boxOverlapFraction(a.box,b.box);return next>0.65&&next>before[i]+0.20;});
    if(blocked)for(const x of original){x.w.yaw=x.yaw;x.w.pitch=x.pitch;applyPose(x.w);}
  }catch(error){for(const x of original){x.w.yaw=x.yaw;x.w.pitch=x.pitch;applyPose(x.w);}throw error;}
}

// Weapon state belongs to the ship; the rig remains the adapter for visual and safety checks.
function battleCombat(state,ships,dt,index){
  const shots=[];
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
    for(const w of [...rig.weapons].sort((a,b)=>a.combatState.id.localeCompare(b.combatState.id))){const data=w.combatState;data.cooldown=Math.max(0,(data.cooldown||0)-aimDt);if(!w.muzzleChains.length){w.target=null;data.targetId=null;continue;}
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
    for(const w of rig.weapons){if(!w.target||w.combatState.cooldown>0)continue;for(let muzzleIndex=0;muzzleIndex<w.muzzleNodes.length;muzzleIndex++){const muzzle=w.muzzleNodes[muzzleIndex],pose=muzzlePoseFromData(w.muzzleChains[muzzleIndex],w,ship.position,ship.rotation),origin=pose.position,dir=pose.direction,toward=w.target.position.clone().sub(origin),range=toward.length();if(range<1e-6||range>(w.balance?.range??CONFIG.weaponRange)||dir.dot(toward.normalize())<.995)continue;
      // Defer the expensive own-mesh safety check until the broad phase finds an enemy first hit.
      const validate=()=>{if(!rig.safe)return false;try{const clear=!rig.safety.muzzleBlocked(muzzle,{radius:.1,range});if(!clear){w.combatState.blockReason='OWN_BLOCK';w.combatState.blockedSince??=state.time;}return clear;}catch(e){rig.safe=false;rig.reason='포구 안전 검사 오류';console.error(e);return false;}};
      shots.push({ownerShipId:ship.id,muzzleId:muzzle.name,team:fleet.team,position:origin.clone(),direction:dir,range,radius:.1,damage:w.balance?.damage??20,weapon:w.combatState,validate});
    }}
  }return shots;
}
const manager=new THREE.LoadingManager();const assetRoot='../../ship%20assets/rigged/';
manager.setURLModifier(url=>/\.(png|jpe?g)(\?.*)?$/i.test(url)?`${assetRoot}Texture/${url.split('/').pop().split('\\').pop()}`:url);
const setError=text=>{$('error').textContent=text};
const battleSize = new THREE.Vector3(BATTLEFIELD.max.x-BATTLEFIELD.min.x, BATTLEFIELD.max.y-BATTLEFIELD.min.y, BATTLEFIELD.max.z-BATTLEFIELD.min.z);
const battleBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...battleSize.toArray())),new THREE.LineBasicMaterial({color:0x304c65,transparent:true,opacity:0.55}));
battleBox.position.set((BATTLEFIELD.min.x+BATTLEFIELD.max.x)/2,(BATTLEFIELD.min.y+BATTLEFIELD.max.y)/2,(BATTLEFIELD.min.z+BATTLEFIELD.max.z)/2);scene.add(battleBox);
const pickGrid = new THREE.GridHelper(120,120 / COMMAND_GRID.spacing,0x527b91,0x263d50);pickGrid.visible=false;scene.add(pickGrid);
const pickMarker = new THREE.Mesh(new THREE.OctahedronGeometry(.65),new THREE.MeshBasicMaterial({color:0xffe08a,wireframe:true,depthTest:false}));pickMarker.visible=false;pickMarker.renderOrder=3;scene.add(pickMarker);
const pickGuide = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineBasicMaterial({color:0xffd46a,depthTest:false}));pickGuide.visible=false;pickGuide.renderOrder=3;scene.add(pickGuide);
const pickRay = new THREE.Raycaster(),pickNdc = new THREE.Vector2(),pickPlane = new THREE.Plane(),pickWorld = new THREE.Vector3();
function resizePickingCamera(){
  const aspect=viewportSize().width/viewportSize().height,half=75;pickingCamera.left=-half*aspect;pickingCamera.right=half*aspect;pickingCamera.top=half;pickingCamera.bottom=-half;pickingCamera.updateProjectionMatrix();
}
function setPickingView(){
  if(!draft)return;resizePickingCamera();
  if(draft.phase==='PICK_XZ'){
    const a=selected.anchor,c=draft.xzCenter||{x:a.x,z:a.z};pickingCamera.position.set(c.x,a.y+300,c.z);pickingCamera.up.set(0,0,-1);pickingCamera.lookAt(c.x,a.y,c.z);
    pickGrid.rotation.set(0,0,0);pickGrid.position.set(0,a.y,0);pickGuide.visible=false;$('pick-title').textContent=selected.id+' 함대 · '+({MOVE:'목적지',PATROL:'경유점 추가',DEFENSE:'방어 거점'}[draft.kind])+' · ① 수평 위치';
  }else{
    const x=COMMAND_GRID.origin.x+draft.ix*COMMAND_GRID.spacing,z=COMMAND_GRID.origin.z+draft.iz*COMMAND_GRID.spacing,y=selected.anchor.y;
    pickingCamera.position.set(x-300,y,z);pickingCamera.up.set(0,1,0);pickingCamera.lookAt(x,y,z);
    pickGrid.rotation.set(0,0,Math.PI/2);pickGrid.position.set(x,0,0);pickGuide.geometry.setFromPoints([new THREE.Vector3(x,BATTLEFIELD.min.y,z),new THREE.Vector3(x,BATTLEFIELD.max.y,z)]);pickGuide.visible=true;$('pick-title').textContent=selected.id+' 함대 · '+({MOVE:'목적지',PATROL:'경유점 추가',DEFENSE:'방어 거점'}[draft.kind])+' · ② 높이';
  }
  pickingCamera.updateMatrixWorld(true);$('pick-back').disabled=draft.phase==='PICK_XZ';
  $('pick-info').textContent=draft.phase==='PICK_XZ'?'수평 위치를 클릭하세요. WASD·드래그로 이동할 수 있습니다.':'높이를 클릭하면 위치가 확정됩니다.';
}
function startPicking(kind='MOVE'){
  if(state.phase!=='PREPARATION'||draft||(kind==='PATROL'&&!patrolEdit)||(kind!=='PATROL'&&patrolEdit))return;
  // Match the perspective view's visible height at its orbit target. The two
  // projections differ away from that plane, so this is an approximate match.
  const viewDistance=camera.position.distanceTo(orbit.target);
  const visibleHeight=2*Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV())/2)*viewDistance;
  pickingCamera.zoom=THREE.MathUtils.clamp(150/Math.max(visibleHeight,1e-6),1.25,8);
  document.body.classList.add('picking');resizeViewport();
  draft={kind,phase:'PICK_XZ',fleetId:selected.id,ix:null,iz:null,hover:null,snapshot:{position:camera.position.clone(),quaternion:camera.quaternion.clone(),zoom:camera.zoom,target:orbit.target.clone(),enabled:orbit.enabled}};
  cameraKeys.clear();if(document.activeElement instanceof HTMLElement)document.activeElement.blur();orbit.enabled=false;activeCamera=pickingCamera;pickGrid.visible=true;pickMarker.visible=false;$('pick-panel').hidden=false;
  setPickingView();syncUI();setError('');
}
function endPicking(){
  if(!draft)return;const snap=draft.snapshot;draft=null;activeCamera=camera;document.body.classList.remove('picking');resizeViewport();
  camera.position.copy(snap.position);camera.quaternion.copy(snap.quaternion);camera.zoom=snap.zoom;camera.updateProjectionMatrix();orbit.target.copy(snap.target);orbit.enabled=snap.enabled;orbit.update();
  cameraKeys.clear();if(document.activeElement instanceof HTMLElement)document.activeElement.blur();pickGrid.visible=false;pickMarker.visible=false;pickGuide.visible=false;$('pick-panel').hidden=true;syncUI();
}
function samplePick(event){
  if(!draft)return null;const rect=renderer.domElement.getBoundingClientRect();if(rect.width<=0||rect.height<=0)return null;
  pickNdc.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);pickRay.setFromCamera(pickNdc,pickingCamera);
  if(draft.phase==='PICK_XZ')pickPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0,1,0),new THREE.Vector3(0,selected.anchor.y,0));
  else pickPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(1,0,0),new THREE.Vector3(COMMAND_GRID.origin.x+draft.ix*COMMAND_GRID.spacing,0,0));
  if(!pickRay.ray.intersectPlane(pickPlane,pickWorld))return null;
  const snapped=worldToNearestGrid(pickWorld);
  const point=draft.phase==='PICK_XZ'?{ix:snapped.ix,iy:worldToNearestGrid(selected.anchor).iy,iz:snapped.iz}:{ix:draft.ix,iy:snapped.iy,iz:draft.iz};
  const world=gridToWorld(point);if(!insideBattlefield(world))return null;
  return {point,world};
}
function showPick(event){
  if(!draft)return;let sample;try{sample=samplePick(event);}catch{sample=null;}
  draft.hover=sample;pickMarker.visible=!!sample;if(!sample){$('pick-info').textContent='전장 안의 격자 교차점을 선택하세요.';return;}
  pickMarker.position.copy(sample.world);if(draft.phase==='PICK_XZ'){pickMarker.position.y=selected.anchor.y;$('pick-info').textContent='수평 위치 선택 · 다음은 높이를 지정합니다.';}
  else $('pick-info').textContent='높이를 클릭해 위치 지정을 마칩니다.';
}
function commitPick(event){
  if(!draft)return;let sample;try{sample=samplePick(event);}catch{sample=null;}
  if(!sample){setError('전장 안의 유효한 격자 교차점을 선택하세요.');return;}
  if(draft.phase==='PICK_XZ'){draft.xzCenter={x:pickingCamera.position.x,z:pickingCamera.position.z};draft.ix=sample.point.ix;draft.iz=sample.point.iz;draft.phase='PICK_Y';draft.hover=null;pickMarker.visible=false;setPickingView();setError('');return;}
  if(state.phase!=='PREPARATION'||selected.id!==draft.fleetId){setError('선택 함대 또는 준비 단계가 변경되어 목표를 지정할 수 없습니다.');return;}
  try{if(draft.kind==='PATROL'){if(!patrolEdit||patrolEdit.fleetId!==selected.id)throw Error('순찰 편집 상태가 변경되었습니다.');patrolEdit.points.push({...sample.point});}else if(draft.kind==='DEFENSE')setDefenseAnchor(selected,sample.point);else setDestination(selected,sample.point);setError('');endPicking();refreshInputs();refreshPatrolEditor();updatePreview();}catch(e){setError(e.message);}
}
$('pick-position').addEventListener('click',()=>selected.movement.policy==='PATROL'?beginPatrolEdit():startPicking('MOVE'));
$('pick-defense').addEventListener('click',()=>{if(selected.tactics.policy==='POINT_DEFENSE')startPicking('DEFENSE');});
$('defense-auto').addEventListener('click',()=>{if(state.phase!=='PREPARATION'||draft||patrolEdit)return;setDefenseAnchor(selected,null);syncUI();updatePreview();});
for(const button of document.querySelectorAll('[data-tactic]'))button.addEventListener('click',()=>{if(state.phase!=='PREPARATION'||draft||patrolEdit)return;try{setCombatPolicy(selected,button.dataset.tactic);setError('');syncUI();updatePreview();}catch(e){setError(e.message);}});
$('pick-cancel').addEventListener('click',()=>{endPicking();setError('');});
$('pick-back').addEventListener('click',()=>{if(draft?.phase==='PICK_Y'){draft.phase='PICK_XZ';draft.ix=null;draft.iz=null;draft.hover=null;pickMarker.visible=false;setPickingView();setError('');}});
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&draft){event.preventDefault();endPicking();setError('');}else if(event.key==='Escape'&&patrolEdit){event.preventDefault();cancelPatrolEdit();}});
renderer.domElement.addEventListener('pointermove',showPick);
renderer.domElement.addEventListener('wheel',event=>{if(!draft)return;event.preventDefault();pickingCamera.zoom=THREE.MathUtils.clamp(pickingCamera.zoom*Math.exp(-event.deltaY*0.001),1.25,8);pickingCamera.updateProjectionMatrix();},{passive:false});

const indicatorPoints = Array.from({ length: 48 }, (_, i) => { const a = i * Math.PI * 2 / 48; return new THREE.Vector3(Math.cos(a) * 1.3, Math.sin(a) * 1.3, 0); });
const selectedIndicator = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(indicatorPoints), new THREE.LineBasicMaterial({ color: 0x74dcff, depthTest: false }));
selectedIndicator.renderOrder = 2; scene.add(selectedIndicator);
const mapCanvas = $('minimap');
const mapContext = mapCanvas.getContext('2d');
let mapPlane = 'XZ';
let mapHitTargets = [];
const planeDefinitions = {
  XY: { horizontal: 'x', vertical: 'y', sign: 1, direction: [0, 0, 1], label: '오른쪽 +X · 위 +Y · 깊이 Z' },
  YZ: { horizontal: 'z', vertical: 'y', sign: 1, direction: [-1, 0, 0], label: '오른쪽 +Z · 위 +Y · 깊이 X' },
  XZ: { horizontal: 'x', vertical: 'z', sign: -1, direction: [0, 1, 0], label: '오른쪽 +X · 위 -Z · 높이 Y' },
};
function selectFleet(fleet) {
  if (draft || patrolEdit || !fleet || fleet.team !== 'ALLY') return;
  selected = fleet;
  chosenShip=null;shipMode=null; setError('');syncUI();$('fleet-tabs').querySelector('[data-fleet-id="'+CSS.escape(selected.id)+'"]')?.scrollIntoView({block:'nearest',inline:'nearest'});updatePreview();
  $('fleet-info').textContent=`아군 ${selected.id} 함대 · 생존 ${selected.ships.filter(s=>s.alive).length}/${selected.ships.length}척 · ${selected.encounter.active?'교전 중 · '+selected.encounter.enemyId+(selected.encounter.breakthrough?' · '+({APPROACH:'진입',TRANSIT:'관통',REAR_ENGAGE:'후방 교전'}[selected.encounter.breakthrough.phase]||''):selected.encounter.groups?' · '+selected.encounter.groups.length+'방향':''):(selected.encounter.reason||'이동 중')} · 점수 ${state.scores.ALLY} : ${state.scores.ENEMY}`;
  drawMinimap();
}
function alignCamera(plane) {
  const target = selected ? selected.anchor : orbit.target;
  const distance = Math.max(camera.position.distanceTo(orbit.target), 12);
  const direction = new THREE.Vector3(...planeDefinitions[plane].direction);
  // OrbitControls uses +Y up; a tiny offset avoids its polar singularity.
  if (plane === 'XZ') direction.z = 0.001;
  direction.normalize(); orbit.target.copy(target); camera.position.copy(target).addScaledVector(direction, distance);
  camera.up.set(0,1,0); camera.lookAt(orbit.target); orbit.update();
}
for (const button of document.querySelectorAll('[data-camera-plane]'))
  button.addEventListener('click', () => { alignCamera(button.dataset.cameraPlane); button.blur(); });
for (const button of document.querySelectorAll('[data-map-plane]')) button.addEventListener('click', () => {
  mapPlane = button.dataset.mapPlane;
  for (const other of document.querySelectorAll('[data-map-plane]')) other.setAttribute('aria-pressed', String(other === button));
  drawMinimap();
});
function drawMinimap() {
  const width = mapCanvas.clientWidth, height = mapCanvas.clientHeight;
  if (!width || !height) return;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  if (mapCanvas.width !== Math.round(width * ratio) || mapCanvas.height !== Math.round(height * ratio)) {
    mapCanvas.width = Math.round(width * ratio); mapCanvas.height = Math.round(height * ratio);
  }
  const ctx = mapContext; ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = '#091523'; ctx.fillRect(0, 0, width, height);
  const def = planeDefinitions[mapPlane];
  const coords = pos => [pos[def.horizontal], pos[def.vertical] * def.sign];
  const samples = state.fleets.map(f => coords(f.anchor)); samples.push(coords(selected.destination),coords(BATTLEFIELD.min),coords(BATTLEFIELD.max));
  const xs = samples.map(p => p[0]), ys = samples.map(p => p[1]);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2, centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const spanX = Math.max(30, Math.max(...xs) - Math.min(...xs) + 16), spanY = Math.max(30, Math.max(...ys) - Math.min(...ys) + 16);
  const scale = Math.min((width - 30) / spanX, (height - 30) / spanY);
  const project = pos => { const [x,y] = coords(pos); return [width / 2 + (x - centerX) * scale, height / 2 - (y - centerY) * scale]; };
  ctx.strokeStyle = '#2c4054'; ctx.lineWidth = 1;
  const [ox,oy] = project(new THREE.Vector3());
  ctx.beginPath(); if (ox >= 0 && ox <= width) {ctx.moveTo(ox,0);ctx.lineTo(ox,height);} if (oy >= 0 && oy <= height) {ctx.moveTo(0,oy);ctx.lineTo(width,oy);} ctx.stroke();
  for(const zone of ZONES){const a=project(zone.min),b=project(zone.max);ctx.strokeStyle=zone.multiplier===2?'#bda064':'#41677a';ctx.strokeRect(Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]));}
  const defense=selected.encounter.active&&selected.encounter.policy==='POINT_DEFENSE'?selected.encounter.defensePoint:selected.tactics.policy==='POINT_DEFENSE'?(selected.tactics.defenseAnchor?gridToWorld(selected.tactics.defenseAnchor):selected.destination):null;
  if(defense){const [dx,dy]=project(defense);ctx.strokeStyle='#b8ff91';ctx.lineWidth=2;ctx.strokeRect(dx-5,dy-5,10,10);}
  const tactical=selected.encounter.active?(selected.encounter.groups?selected.encounter.groups.map(g=>g.target):selected.encounter.breakthrough?[selected.encounter.breakthrough.entry,selected.encounter.breakthrough.exit]:[]):[];for(const point of tactical){const [x,y]=project(point);ctx.strokeStyle='#ff9af1';ctx.beginPath();ctx.moveTo(x,y-5);ctx.lineTo(x+5,y);ctx.lineTo(x,y+5);ctx.lineTo(x-5,y);ctx.closePath();ctx.stroke();}
  const [ax,ay] = project(selected.anchor), [tx,ty] = project(selected.destination);
  ctx.strokeStyle = '#ffd46a';ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(ax,ay);const path=patrolEdit?.fleetId===selected.id?patrolEdit.points:selected.movement.policy==='PATROL'?selected.movement.patrolPoints:[];const active=patrolEdit?0:selected.movement.activeIndex,ordered=path.length?[...path.slice(active),...path.slice(0,active)]:[];for(const point of ordered){const [x,y]=project(patrolPointWorld(point));ctx.lineTo(x,y);}if(ordered.length){const [x,y]=project(patrolPointWorld(ordered[0]));ctx.lineTo(x,y);}else ctx.lineTo(tx,ty);ctx.stroke();ctx.setLineDash([]);path.forEach((point,i)=>{const [x,y]=project(patrolPointWorld(point));ctx.fillStyle=i===active&&!patrolEdit?'#ffd46a':'#88d9ff';ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fill();ctx.fillStyle='#101c2b';ctx.font='bold 9px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),x,y);});ctx.textAlign='start';ctx.textBaseline='alphabetic';
  ctx.beginPath();ctx.moveTo(tx-5,ty-5);ctx.lineTo(tx+5,ty+5);ctx.moveTo(tx+5,ty-5);ctx.lineTo(tx-5,ty+5);ctx.stroke();
  mapHitTargets = [];
  for(const f of state.fleets){
    if(f.emptyDraft&&!f.ships.some(s=>s.alive))continue;
    const [x,y] = project(f.anchor); const ally = f.team === 'ALLY';
    ctx.fillStyle=ally?'#59c8ff':'#ff7777';ctx.strokeStyle=f===selected?'#ffffff':'#0c1a27';ctx.lineWidth=f===selected?2.5:1;
    ctx.beginPath();if(ally)ctx.arc(x,y,5,0,Math.PI*2);else {ctx.moveTo(x,y-6);ctx.lineTo(x+6,y);ctx.lineTo(x,y+6);ctx.lineTo(x-6,y);ctx.closePath();}ctx.fill();ctx.stroke();
    ctx.fillStyle='#e8f4ff';ctx.font='11px system-ui';ctx.fillText(f.id,x+8,y-5);
    if(ally)mapHitTargets.push({fleet:f,x,y});
  }
  $('map-info').textContent = mapPlane+' 평면 · '+selected.id+' 함대 선택';
}
mapCanvas.addEventListener('click', event => {
  const rect = mapCanvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
  const hits=mapHitTargets.map(hit=>({...hit,d:Math.hypot(x-hit.x,y-hit.y)})).filter(hit=>hit.d<12).sort((a,b)=>a.d-b.d||a.fleet.id.localeCompare(b.fleet.id));
  if(hits.length&&!draft){const cluster=hits.filter(hit=>hit.d<=hits[0].d+2),current=cluster.findIndex(hit=>hit.fleet===selected);selectFleet(cluster[(current+1)%cluster.length].fleet);}
});
const picker = new THREE.Raycaster(), pointer = new THREE.Vector2();
let pointerStart=null;
function panPicking(dx,dy){if(!draft)return;const scale=150/(Math.max(1,renderer.domElement.clientHeight)*pickingCamera.zoom);if(draft.phase==='PICK_XZ'){pickingCamera.position.x=THREE.MathUtils.clamp(pickingCamera.position.x-dx*scale,BATTLEFIELD.min.x,BATTLEFIELD.max.x);pickingCamera.position.z=THREE.MathUtils.clamp(pickingCamera.position.z-dy*scale,BATTLEFIELD.min.z,BATTLEFIELD.max.z);}else{pickingCamera.position.z=THREE.MathUtils.clamp(pickingCamera.position.z-dx*scale,BATTLEFIELD.min.z,BATTLEFIELD.max.z);pickingCamera.position.y=THREE.MathUtils.clamp(pickingCamera.position.y+dy*scale,BATTLEFIELD.min.y,BATTLEFIELD.max.y);}pickingCamera.updateMatrixWorld(true);pickMarker.visible=false;}
function movePicking(dt){if(!draft)return;const dx=(cameraKeys.has('KeyD')?1:0)-(cameraKeys.has('KeyA')?1:0),dy=(cameraKeys.has('KeyW')?1:0)-(cameraKeys.has('KeyS')?1:0);if(dx||dy){const speed=18*dt,scale=150/(Math.max(1,renderer.domElement.clientHeight)*pickingCamera.zoom);panPicking(-dx*speed/scale,dy*speed/scale);}}
renderer.domElement.addEventListener('pointerdown',event=>{if(event.button!==0)return;pointerStart={x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,dragged:false};if(draft)renderer.domElement.setPointerCapture(event.pointerId);});
renderer.domElement.addEventListener('pointermove',event=>{if(!draft||!pointerStart)return;const distance=Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y);if(distance>4)pointerStart.dragged=true;if(pointerStart.dragged){panPicking(event.clientX-pointerStart.lastX,event.clientY-pointerStart.lastY);pointerStart.lastX=event.clientX;pointerStart.lastY=event.clientY;}});
renderer.domElement.addEventListener('pointerup',event=>{
  if(!pointerStart||pointerStart.dragged||Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>4){pointerStart=null;return;}
  pointerStart=null;if(draft){commitPick(event);return;}
  const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);picker.setFromCamera(pointer,camera);
  const hit=picker.intersectObjects([...views.values()],true)[0];if(!hit)return;let object=hit.object;while(object&&!object.userData.shipId)object=object.parent;if(object){const fleet=state.fleets.find(f=>f.ships.some(ship=>ship.id===object.userData.shipId));selectFleet(fleet);}
});
renderer.domElement.addEventListener('pointercancel',()=>{pointerStart=null;});
function updatePreview(){
  const showGuides=$('show-guides').checked;slotGroup.visible=showGuides;waypointGroup.visible=showGuides;tacticalGroup.visible=showGuides;route.visible=showGuides;targetMarker.visible=showGuides;
  const positions=slots(selected);
  while(slotGroup.children.length>positions.length)slotGroup.remove(slotGroup.children[slotGroup.children.length-1]);
  while(slotGroup.children.length<positions.length)slotGroup.add(new THREE.Mesh(markerGeometry,markerMaterial));
  positions.forEach((p,i)=>slotGroup.children[i].position.copy(p));
  targetMarker.position.copy(selected.destination);
  const tactical=selected.encounter.active?(selected.encounter.groups?selected.encounter.groups.map(g=>g.target):selected.encounter.breakthrough?[selected.encounter.breakthrough.entry,selected.encounter.breakthrough.exit]:[]):[];while(tacticalGroup.children.length>tactical.length)tacticalGroup.remove(tacticalGroup.children.at(-1));while(tacticalGroup.children.length<tactical.length){const marker=new THREE.Mesh(tacticalGeometry,tacticalMaterial);marker.renderOrder=4;tacticalGroup.add(marker);}tactical.forEach((p,i)=>tacticalGroup.children[i].position.copy(p));
  const defense=selected.encounter.active&&selected.encounter.policy==='POINT_DEFENSE'?selected.encounter.defensePoint:selected.tactics.policy==='POINT_DEFENSE'?(selected.tactics.defenseAnchor?gridToWorld(selected.tactics.defenseAnchor):selected.destination):null;defenseMarker.visible=!!defense&&showGuides;if(defense)defenseMarker.position.copy(defense);
  const path=patrolEdit?.fleetId===selected.id?patrolEdit.points:selected.movement.policy==='PATROL'?selected.movement.patrolPoints:[];
  const points=path.map(p=>patrolPointWorld(p)),active=patrolEdit?0:selected.movement.activeIndex,ordered=points.length?[...points.slice(active),...points.slice(0,active)]:[];lineGeometry.setFromPoints(ordered.length?[selected.anchor,...ordered,ordered[0]]:[selected.anchor,selected.destination]);
  const signature=selected.id+'|'+active+'|'+!!patrolEdit+'|'+JSON.stringify(path);if(signature!==waypointSignature){waypointSignature=signature;while(waypointGroup.children.length){const old=waypointGroup.children[0];waypointGroup.remove(old);old.material.map.dispose();old.material.dispose();}
    points.forEach((position,index)=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const ctx=canvas.getContext('2d');ctx.fillStyle=index===active&&!patrolEdit?'#ffd46a':'#88d9ff';ctx.beginPath();ctx.arc(32,32,27,0,Math.PI*2);ctx.fill();ctx.fillStyle='#101c2b';ctx.font='bold 32px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(index+1),32,33);const texture=new THREE.CanvasTexture(canvas);const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false}));sprite.position.copy(position);sprite.scale.set(1.7,1.7,1);sprite.renderOrder=4;waypointGroup.add(sprite);});
  }
}
function refreshInputs(){
  $('destination-info').textContent=selected.movement.policy==='PATROL'?'경유점 '+selected.movement.patrolPoints.length+'개':'';
  $('pick-position').textContent=selected.movement.policy==='PATROL'?'경로 편집':'위치 변경';
  const levels=Object.values(selected.spacingLevels),common=levels.every(x=>x===levels[0])?levels[0]:null;$('spacing-label').textContent=common?({tight:'좁게',normal:'보통',wide:'넓게'}[common]):'개별 설정';
  for(const button of document.querySelectorAll('[data-spacing]')){const checked=button.dataset.spacing===common;button.setAttribute('aria-checked',String(checked));button.tabIndex=checked||(!common&&button.dataset.spacing==='normal')?0:-1;button.disabled=state.phase!=='PREPARATION'||!!draft||!!patrolEdit||selected.ships.length<=1;}
  const counts=dimensions(selected.ships.length);

  for(const [i,axis] of ['x','y','z'].entries()) {
    const field=$(`spacing-${axis}`);field.disabled=state.phase!=='PREPARATION'||!!draft||!!patrolEdit||counts[i]<=1;
    field.title=counts[i]<=1?'이 방향은 한 층이므로 간격이 적용되지 않습니다.':'';
    for(const radio of field.querySelectorAll('input'))radio.checked=radio.value===selected.spacingLevels[axis];
  }
}
let draggedShip=null,draggedReserve=null,chosenShip=null;
function refreshFleetTabs(){
  const tabs=$('fleet-tabs'),focusedFleet=document.activeElement?.dataset?.fleetId,scroll= tabs.scrollTop;tabs.replaceChildren();
  for(const fleet of friendly){const button=document.createElement('button');button.type='button';button.dataset.fleetId=fleet.id;button.textContent=fleet.id+' · '+fleet.ships.filter(s=>s.alive).length;button.title=fleet.id+' 함대 · '+fleet.ships.filter(s=>s.alive).length+'/'+fleet.ships.length;button.setAttribute('aria-label',button.title);button.setAttribute('role','tab');button.setAttribute('aria-selected',String(fleet===selected));button.setAttribute('aria-pressed',String(fleet===selected));button.disabled=!!draft||!!patrolEdit;
    button.addEventListener('click',()=>{if(shipMode==='transfer'&&chosenShip&&fleet!==selected){transfer(chosenShip,fleet);shipMode=null;chosenShip=null;syncUI();}else if(shipMode==='transfer'){setError('이동할 다른 함대를 선택하세요.');}else selectFleet(fleet);});
    button.addEventListener('dragover',e=>{if((draggedReserve||(draggedShip&&fleet!==selected))&&state.phase==='PREPARATION'&&!draft){e.preventDefault();button.classList.add('drop-target');}});
    button.addEventListener('dragleave',()=>button.classList.remove('drop-target'));
    button.addEventListener('drop',e=>{e.preventDefault();button.classList.remove('drop-target');if(draggedReserve){const result=assignReserve(state,'ALLY',draggedReserve,fleet.id);setError(result.ok?'':result.reason);refreshEconomy();}else if(draggedShip&&fleet!==selected)transfer(draggedShip.id,fleet);draggedShip=null;draggedReserve=null;});tabs.append(button);
  }
  const add=document.createElement('button');add.type='button';add.className='fleet-add';add.textContent='+';add.title='새 함대 추가';add.setAttribute('aria-label','새 함대 추가');add.disabled=state.phase!=='PREPARATION'||!!draft||!!patrolEdit;add.addEventListener('click',()=>{const result=createEmptyFleet(state,selected.id);if(!result.ok){setError(result.reason);return;}friendly.push(result.fleet);selectFleet(result.fleet);});$('fleet-add-slot').replaceChildren(add);tabs.scrollTop=scroll;if(focusedFleet)tabs.querySelector('[data-fleet-id="'+CSS.escape(focusedFleet)+'"]')?.focus({preventScroll:true});
}
function swapShips(a,b){if(state.phase!=='PREPARATION'||draft||patrolEdit||a===b)return;const from=selected.ships.findIndex(s=>s.id===a),to=selected.ships.findIndex(s=>s.id===b);if(from<0||to<0)return;[selected.ships[from],selected.ships[to]]=[selected.ships[to],selected.ships[from]];chosenShip=null;shipMode=null;refreshShips();updatePreview();}
function refreshShips(){
  const list=$('ships'),focused=document.activeElement?.dataset?.shipId,scroll=list.scrollTop;list.replaceChildren();const offsets=grid(selected.ships.length,selected.size),layers=new Map();offsets.forEach((p,i)=>{const key=p.y.toFixed(6);if(!layers.has(key))layers.set(key,[]);layers.get(key).push(selected.ships[i]);});
  const ordered=[...layers.entries()].sort((a,b)=>Number(b[0])-Number(a[0]));ordered.forEach(([,entries],layer)=>{const line=document.createElement('div');line.className='ship-layer';const label=document.createElement('span');label.className='layer-label';label.textContent=ordered.length===1?'중층':layer===0?'상층':layer===ordered.length-1?'하층':'중층';line.append(label);const cards=document.createElement('div');cards.className='layer-cards';line.append(cards);
    for(const ship of entries){const card=document.createElement('button');card.type='button';card.className='ship'+(ship.alive?'':' dead')+(chosenShip===ship.id?' selected':'');card.dataset.shipId=ship.id;card.draggable=state.phase==='PREPARATION'&&!draft&&!patrolEdit&&ship.alive;card.setAttribute('aria-pressed',String(chosenShip===ship.id));card.setAttribute('aria-label',ship.id+' · '+(ship.alive?'체력 '+ship.hp+'/'+ship.maxHp:'격침'));const name=document.createElement('span');name.className='ship-name';name.textContent=ship.id;const hp=document.createElement('span');hp.className='hp-value';hp.textContent=ship.alive?ship.hp:'격침';card.append(name,hp);const health=document.createElement('span');health.className='ship-health';const fill=document.createElement('i');fill.style.width=Math.max(0,ship.hp/ship.maxHp*100)+'%';health.append(fill);card.append(health);
      card.addEventListener('click',()=>{if(draft||patrolEdit)return;if(shipMode==='reorder'&&chosenShip&&chosenShip!==ship.id){swapShips(chosenShip,ship.id);return;}chosenShip=chosenShip===ship.id?null:ship.id;shipMode=null;refreshShips();});
      card.addEventListener('dragstart',e=>{draggedShip={id:ship.id,fleetId:selected.id};shipMode=null;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',ship.id);});card.addEventListener('dragover',e=>{if(draggedShip&&draggedShip.id!==ship.id){e.preventDefault();card.classList.add('drop-target');}});card.addEventListener('dragleave',()=>card.classList.remove('drop-target'));card.addEventListener('drop',e=>{e.preventDefault();if(draggedShip&&draggedShip.fleetId===selected.id)swapShips(draggedShip.id,ship.id);draggedShip=null;});card.addEventListener('dragend',()=>{draggedShip=null;document.querySelectorAll('.drop-target').forEach(n=>n.classList.remove('drop-target'));});cards.append(card);
    }list.append(line);
  });const ship=selected.ships.find(s=>s.id===chosenShip);$('ship-details').hidden=!ship;if(ship){$('ship-detail-text').textContent=shipMode==='reorder'?'교환할 배치 카드를 선택하세요.':shipMode==='transfer'?'위의 함대 목록에서 이동할 함대를 선택하세요.':ship.id+' · 경순양함 · '+(ship.alive?'체력 '+ship.hp+' / '+ship.maxHp+' · 실드 '+(ship.shield??0)+' / '+(ship.maxShield??0):'격침');const editable=state.phase==='PREPARATION'&&!draft&&!patrolEdit&&ship.alive;$('reorder-ship').disabled=!editable;$('move-ship').disabled=!editable;}$('ship-actions').hidden=state.phase!=='PREPARATION';list.scrollTop=scroll;if(focused)list.querySelector('[data-ship-id="'+CSS.escape(focused)+'"]')?.focus({preventScroll:true});
}
function removeEmptyFleet(fleet){
  if(fleet.ships.some(s=>s.alive))return false;
  for(const unit of fleet.ships){const rig=rigs.get(unit.id),view=views.get(unit.id);if(view)scene.remove(view);rig?.safety.dispose();rigs.delete(unit.id);views.delete(unit.id);}
  for(const reserve of state.reserves)if(reserve.status==='ASSIGNED'&&reserve.fleetId===fleet.id){reserve.status='OWNED';reserve.fleetId=null;reserve.reason='함대가 삭제되어 배정이 해제되었습니다.';}
  const i=state.fleets.indexOf(fleet);if(i>=0)state.fleets.splice(i,1);const j=friendly.indexOf(fleet);if(j>=0)friendly.splice(j,1);return true;
}
function transfer(id,other){
  if(state.phase!=='PREPARATION'||draft||patrolEdit||!other||other===selected)return;const source=selected,unit=source.ships.find(s=>s.id===id);if(!unit?.alive)return;
  const otherSize=sizeForSpacing(other.ships.length+1,other.spacingLevels);if(!validateSize(other.ships.length+1,otherSize)){setError('대상 함대의 간격을 확인하세요.');return;}
  source.ships.splice(source.ships.indexOf(unit),1);other.ships.push(unit);unit.fleetId=other.id;other.emptyDraft=false;source.size.copy(sizeForSpacing(source.ships.length,source.spacingLevels));other.size.copy(otherSize);chosenShip=null;
  if(!source.ships.some(s=>s.alive)){removeEmptyFleet(source);selected=other;}
  shipMode=null;setError('');syncUI();updatePreview();
}
function beginPatrolEdit(){if(state.phase!=='PREPARATION'||draft||patrolEdit)return;patrolEdit={fleetId:selected.id,baseRevision:selected.movement.revision,points:selected.movement.patrolPoints.map(p=>({...p})),dragIndex:null,selectedIndex:null};syncUI();updatePreview();}
function cancelPatrolEdit(){if(!patrolEdit)return;patrolEdit=null;setError('');syncUI();updatePreview();}
function refreshPatrolEditor(){const editor=$('patrol-editor');editor.hidden=!patrolEdit;if(!patrolEdit)return;const list=$('patrol-points');list.replaceChildren();patrolEdit.points.forEach((point,index)=>{const card=document.createElement('div');card.className='waypoint'+(patrolEdit.selectedIndex===index?' selected':'');card.draggable=!draft;const btn=document.createElement('button');btn.type='button';btn.textContent='경유점 '+(index+1);btn.title='순서를 바꾸려면 두 경유점을 차례로 선택하세요.';btn.disabled=!!draft;btn.addEventListener('click',()=>{if(patrolEdit.selectedIndex===null)patrolEdit.selectedIndex=index;else{const from=patrolEdit.selectedIndex;const [item]=patrolEdit.points.splice(from,1);patrolEdit.points.splice(index,0,item);patrolEdit.selectedIndex=null;}refreshPatrolEditor();updatePreview();});const del=document.createElement('button');del.type='button';del.textContent='×';del.title='경유점 삭제';del.disabled=!!draft;del.addEventListener('click',()=>{patrolEdit.points.splice(index,1);patrolEdit.selectedIndex=null;refreshPatrolEditor();updatePreview();});card.append(btn,del);card.addEventListener('dragstart',e=>{patrolEdit.dragIndex=index;e.dataTransfer.setData('text/plain',String(index));});card.addEventListener('dragover',e=>e.preventDefault());card.addEventListener('drop',e=>{e.preventDefault();const from=patrolEdit.dragIndex;if(from===null)return;const [item]=patrolEdit.points.splice(from,1);patrolEdit.points.splice(index,0,item);patrolEdit.dragIndex=null;patrolEdit.selectedIndex=null;refreshPatrolEditor();updatePreview();});list.append(card);});$('patrol-add').disabled=!!draft||patrolEdit.points.length>=32;$('patrol-save').disabled=!!draft;$('patrol-cancel').disabled=!!draft;}
$('policy-move').addEventListener('click',()=>{if(state.phase!=='PREPARATION'||draft||patrolEdit)return;try{setMovementPolicy(selected,'MOVE');syncUI();updatePreview();}catch(e){setError(e.message);}});
$('policy-patrol').addEventListener('click',()=>beginPatrolEdit());
$('patrol-add').addEventListener('click',()=>startPicking('PATROL'));
$('patrol-cancel').addEventListener('click',cancelPatrolEdit);
$('patrol-save').addEventListener('click',()=>{if(!patrolEdit||draft)return;try{if(selected.id!==patrolEdit.fleetId||selected.movement.revision!==patrolEdit.baseRevision)throw Error('함대 명령이 변경되어 다시 편집해야 합니다.');setPatrolRoute(selected,patrolEdit.points);setMovementPolicy(selected,'PATROL');patrolEdit=null;setError('');syncUI();updatePreview();}catch(e){setError(e.message);}});
function setEconomy(open){if(draft||patrolEdit)return;$('economy-menu').hidden=!open;document.body.classList.toggle('shop-open',open);$('toggle-economy').setAttribute('aria-expanded',String(open));if(open&&innerWidth<900){document.body.classList.remove('fleet-open');$('toggle-fleet').setAttribute('aria-expanded','false');}resizeViewport();}
function setFleetPanel(open){if(draft||patrolEdit)return;document.body.classList.toggle('fleet-open',open);$('toggle-fleet').setAttribute('aria-expanded',String(open));if(open&&innerWidth<900)setEconomy(false);resizeViewport();}
$('toggle-economy').addEventListener('click',()=>setEconomy($('economy-menu').hidden));$('close-economy').addEventListener('click',()=>{setEconomy(false);$('toggle-economy').focus();});$('toggle-fleet').addEventListener('click',()=>setFleetPanel(!document.body.classList.contains('fleet-open')));$('close-fleet').addEventListener('click',()=>{setFleetPanel(false);$('toggle-fleet').focus();});
$('reorder-ship').addEventListener('click',()=>{if(state.phase!=='PREPARATION'||draft||patrolEdit||!chosenShip)return;shipMode='reorder';refreshShips();});$('move-ship').addEventListener('click',()=>{if(state.phase!=='PREPARATION'||draft||patrolEdit||!chosenShip)return;shipMode='transfer';refreshShips();});$('cancel-ship').addEventListener('click',()=>{chosenShip=null;shipMode=null;refreshShips();});
for(const button of document.querySelectorAll('[data-spacing]'))button.addEventListener('click',()=>{if(state.phase!=='PREPARATION'||draft||patrolEdit)return;const levels={x:button.dataset.spacing,y:button.dataset.spacing,z:button.dataset.spacing},size=sizeForSpacing(selected.ships.length,levels);if(!validateSize(selected.ships.length,size)){setError('이 간격은 현재 편성에 적용할 수 없습니다.');return;}selected.spacingLevels=levels;selected.size.copy(size);setError('');refreshInputs();updatePreview();updateStatus();});
for(const group of document.querySelectorAll('[role=radiogroup]'))group.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)||!event.target.matches('[role=radio]'))return;event.preventDefault();const buttons=[...group.querySelectorAll('[role=radio]')].filter(b=>!b.disabled),index=buttons.indexOf(event.target);if(!buttons.length)return;const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+buttons.length)%buttons.length;buttons[next].focus();buttons[next].click();});
window.addEventListener('keydown',event=>{if(event.defaultPrevented||event.key!=='Escape'||draft||patrolEdit)return;if(chosenShip){chosenShip=null;shipMode=null;refreshShips();}else if(!$('economy-menu').hidden)setEconomy(false);else if(innerWidth<900)setFleetPanel(false);});
for(const axis of ['x','y','z'])$(`spacing-${axis}`).addEventListener('change',event=>{
  if(state.phase!=='PREPARATION'||draft||patrolEdit){refreshInputs();return;}
  if(!event.target.matches('input[type=radio]'))return;const levels={...selected.spacingLevels,[axis]:event.target.value};
  const size=sizeForSpacing(selected.ships.length,levels);
  if(!validateSize(selected.ships.length,size)){setError('이 간격은 현재 대형에 적용할 수 없습니다.');refreshInputs();return;}
  selected.spacingLevels=levels;selected.size.copy(size);setError('');refreshInputs();updatePreview();
});
function syncUI(){
  const prep=state.phase==='PREPARATION',editing=!!draft||!!patrolEdit;document.body.classList.toggle('running',state.phase==='RUNNING');refreshFleetTabs();
  $('pick-position').disabled=!prep||editing;for(const [id,policy] of [['policy-move','MOVE'],['policy-patrol','PATROL']]){const button=$(id),checked=selected.movement.policy===policy;button.disabled=!prep||editing;button.setAttribute('aria-checked',String(checked));button.tabIndex=checked?0:-1;}
  for(const button of document.querySelectorAll('[data-tactic]')){const insufficient=button.dataset.tactic==='ENCIRCLE'&&selected.ships.filter(s=>s.alive).length<2,checked=button.dataset.tactic===selected.tactics.policy;button.disabled=!prep||editing||insufficient;button.title=insufficient?'생존 함선 2척 이상 필요':tacticDescriptions[button.dataset.tactic];button.setAttribute('aria-checked',String(checked));button.tabIndex=checked?0:-1;}
  $('tactic-description').textContent=tacticDescriptions[selected.tactics.policy];$('tactic-info').textContent=selected.tactics.policy==='ENCIRCLE'&&selected.ships.filter(s=>s.alive).length<2?'생존 함선 2척 이상 필요':'';
  for(const group of document.querySelectorAll('[role=radiogroup]'))if(!group.querySelector('[role=radio]:not(:disabled)[tabindex="0"]')){const first=group.querySelector('[role=radio]:not(:disabled)');if(first)first.tabIndex=0;}
  $('defense-controls').hidden=selected.tactics.policy!=='POINT_DEFENSE';$('pick-defense').disabled=!prep||editing;$('defense-auto').disabled=!prep||editing||!selected.tactics.defenseAnchor;$('defense-info').textContent=selected.tactics.defenseAnchor?'사용자 지정 거점':'자동 지정 · 현재 이동 목표';
  for(const button of document.querySelectorAll('[data-camera-plane]'))button.disabled=editing;
  $('toggle-economy').disabled=editing;$('toggle-fleet').disabled=editing;$('start').disabled=!prep||editing||!prepareUnitView||!state.assetsAvailable||!!state.result||!!balanceError;$('start').title=balanceError?'밸런스 데이터: '+balanceError:!prepareUnitView?'함선 모델을 불러오는 중입니다.':!state.assetsAvailable?'사용 가능한 함선 모델을 확인하세요.':'';$('pause').disabled=state.phase!=='RUNNING';$('start').hidden=state.phase==='RUNNING';$('pause').hidden=state.phase!=='RUNNING';$('start').textContent=editing?'편집 중':state.time===0?'전투 시작':state.remaining<=0?'다음 전투':'전투 재개';
  refreshInputs();refreshShips();refreshEconomy();refreshPatrolEditor();updateStatus();
}
function updateStatus(){
  $('economy-balance').textContent='보유 '+state.scores.ALLY+'점 / 승리 목표 '+SCORE_CONFIG.victory+'점';$('purchase-info').textContent='가격 '+ECONOMY_CONFIG.price+'점 · 구매 후 '+Math.max(0,state.scores.ALLY-ECONOMY_CONFIG.price)+'점';
  $('ally-score').textContent=state.scores.ALLY;$('enemy-score').textContent=state.scores.ENEMY;$('victory-score').textContent=SCORE_CONFIG.victory;
  $('hud').textContent=state.phase==='RESULT'?(state.result==='DRAW'?'무승부':state.result==='ALLY'?'아군 승리':'적군 승리'):state.phase==='RUNNING'?'전투 중 · '+state.remaining.toFixed(1)+'초':draft?'위치 지정 중':patrolEdit?'순찰 경로 편집 중':state.time===0?'전투 준비':manualPaused?'일시정지':'다음 전투 준비';
  $('fleet-title').textContent=selected.id+' 함대 · '+selected.ships.filter(s=>s.alive).length+'척';const levels=Object.values(selected.spacingLevels),spacing=levels.every(x=>x===levels[0])?({tight:'좁게',normal:'보통',wide:'넓게'}[levels[0]]):'개별';$('command-summary').textContent=(selected.movement.policy==='PATROL'?'순찰':'목적지 이동')+' · '+tacticLabels[selected.tactics.policy]+' · '+spacing+' 간격';
  const e=selected.encounter;let activity=selected.pathBlockId?'대치 사격 중':selected.movement.policy==='PATROL'?'순찰 중':'이동 중';if(e.active){activity=e.breakthrough?({APPROACH:'관통 진입 중',TRANSIT:'관통 중',REAR_ENGAGE:'후방 교전 중'}[e.breakthrough.phase]):e.groups?'포위 전개 중 · '+e.groups.length+'방향':e.policy==='STANDOFF'?'거리 조절 중':e.arrived?'거점 방어 중':'거점 이동 중';activity+=' · 적 '+e.enemyId+' 함대';}else if(e.reason)activity=e.reason;else if(selected.arrived)activity='목적지 도착';if(state.phase==='PREPARATION')activity=state.time===0?'준비 중':(manualPaused?'일시정지 · ':'준비 중 · ')+activity;$('fleet-info').textContent=activity;$('fleet-info').hidden=state.phase==='PREPARATION'&&!e.active&&!e.reason;
  if($('debug-menu').open)$('debug-target').textContent='이동 목표 '+selected.destination.toArray().map(x=>x.toFixed(1)).join(', ')+' · '+(e.policy||'MOVEMENT');
}
function refreshEconomy(){
  const prep=state.phase==='PREPARATION'&&!draft&&!patrolEdit;$('buy-ship').disabled=!prep||state.scores.ALLY<ECONOMY_CONFIG.price||!prepareUnitView||!state.assetsAvailable;
  $('buy-ship').title=!state.assetsAvailable?'사용 가능한 함선 모델이 없습니다.':state.scores.ALLY<ECONOMY_CONFIG.price?'점수가 부족합니다.':'';
  $('economy-balance').textContent='보유 '+state.scores.ALLY+'점 / 승리 목표 '+SCORE_CONFIG.victory+'점';$('purchase-info').textContent='가격 '+ECONOMY_CONFIG.price+'점 · 구매 후 '+Math.max(0,state.scores.ALLY-ECONOMY_CONFIG.price)+'점';
  const owned=state.reserves.filter(r=>r.team==='ALLY'&&(r.status==='OWNED'||r.status==='ASSIGNED')),unassigned=owned.filter(r=>r.status==='OWNED').length,waiting=owned.length-unassigned;$('reserve-count').textContent=owned.length?'· '+owned.length:'';$('reserve-status').textContent=owned.length?'미배정 '+unassigned+'척 · 투입 대기 '+waiting+'척':'보유한 예비 함선이 없습니다.';
  const list=$('reserves');list.replaceChildren();for(const reserve of owned){const item=document.createElement('div');item.className='reserve-item';item.draggable=prep;item.addEventListener('dragstart',e=>{draggedReserve=reserve.id;e.dataTransfer.setData('text/plain',reserve.id);});item.addEventListener('dragend',()=>draggedReserve=null);const label=document.createElement('span');label.textContent=reserve.id+' · '+(reserve.status==='OWNED'?'미배정 · 투입되지 않음':reserve.fleetId==='NEW'?'새 함대 · 투입 대기':reserve.fleetId+' 함대 · 투입 대기')+(reserve.reason?' · '+reserve.reason:'');item.append(label);const assignments=document.createElement('div');assignments.className='assignments';item.append(assignments);
    const bind=(text,target)=>{const button=document.createElement('button');button.textContent=text;button.disabled=!prep;button.setAttribute('aria-pressed',String(reserve.fleetId===target&&reserve.status==='ASSIGNED'));button.addEventListener('click',()=>{const result=assignReserve(state,'ALLY',reserve.id,target);setError(result.ok?'':result.reason);refreshEconomy();});assignments.append(button);};for(const f of friendly)bind(f.id+' 함대',f.id);bind('새 함대','NEW');if(reserve.status==='ASSIGNED')bind('배정 취소',null);list.append(item);
  }
}
$('buy-ship').addEventListener('click',()=>{const result=purchaseShip(state,'ALLY',ECONOMY_CONFIG.typeId,'ui-'+(++purchaseCounter));setError(result.ok?'':result.reason);refreshEconomy();syncUI();});
$('start').addEventListener('click',()=>{
  if(state.phase!=='PREPARATION'||draft||patrolEdit||!prepareUnitView||balanceError)return;
  for(const fleet of [...friendly])if(fleet.emptyDraft&&!fleet.ships.length&&!state.reserves.some(r=>r.status==='ASSIGNED'&&r.fleetId===fleet.id)){removeEmptyFleet(fleet);if(selected===fleet)selected=friendly[0];}
  manualPaused=false;chosenShip=null;shipMode=null;prepareEnemyAI(state);const result=deployReserves(state,prepareUnitView);friendly.splice(0,friendly.length,...state.fleets.filter(f=>f.team==='ALLY'));checkRecovery(state);if(!state.result)start(state);
  const failed=state.reserves.filter(r=>r.status==='ASSIGNED'&&r.reason);setError(failed.length?'일부 증원 투입 대기: '+failed.map(r=>r.reason).join('；'):[...rigs.values()].some(r=>!r.safe)?'검증되지 않은 무장의 사격이 보류되었습니다.':'');refreshEconomy();syncUI();
});
$('pause').addEventListener('click',()=>{if(state.phase==='RUNNING'){manualPaused=true;state.phase='PREPARATION';state.preparationId++;}refreshEconomy();syncUI();});
function resizeViewport(){const {width,height}=viewportSize();camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height);resizePickingCamera();}
new ResizeObserver(resizeViewport).observe(viewport);window.addEventListener('resize',resizeViewport);resizeViewport();
try{
  const assetUrl=`${assetRoot}${encodeURIComponent(balance?.ship.model_path||'Light_cruiser_01_rigged.fbx')}`;const model=await new FBXLoader(manager).loadAsync(assetUrl);
  const [report,assetBytes]=await Promise.all([fetch('../rigging-test/rig-analysis.json').then(r=>{if(!r.ok)throw Error('리깅 분석 자료 없음');return r.json();}),fetch(assetUrl).then(r=>{if(!r.ok)throw Error('FBX 해시 확인 실패');return r.arrayBuffer();})]);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',assetBytes)),x=>x.toString(16).padStart(2,'0')).join('');
  const neutralConfirmed=report.models.some(m=>m.file==='Light_cruiser_01_rigged.fbx'&&m.sha256===digest);
  const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3()),max=Math.max(size.x,size.y,size.z);
  if(!Number.isFinite(max)||max<=0)throw new Error('FBX의 크기가 올바르지 않습니다.');
  model.position.sub(center);
  const corrected=new THREE.Group();corrected.add(model);corrected.scale.setScalar(2.2/max);corrected.rotation.y=Math.PI/2;
  const blueTexture=await new THREE.TextureLoader().loadAsync(assetRoot+'Texture/T_Spase_blue.png');blueTexture.colorSpace=THREE.SRGBColorSpace;const blueMaterials=new Map();
  function allyMaterial(material){if(blueMaterials.has(material))return blueMaterials.get(material);const copy=material.clone();if(material.map){const map=blueTexture.clone();for(const key of ['wrapS','wrapT','flipY','channel','rotation'])map[key]=material.map[key];map.offset.copy(material.map.offset);map.repeat.copy(material.map.repeat);map.center.copy(material.map.center);map.needsUpdate=true;copy.map=map;}copy.needsUpdate=true;blueMaterials.set(material,copy);return copy;}
  state.spawnRadius=size.length()/max*1.1;
  prepareUnitView=(s,options={})=>{
    s.collisionRadius=state.spawnRadius;const view=new THREE.Group();view.userData.shipId=s.id;view.add(corrected.clone(true));if((state.fleets.find(f=>f.id===s.fleetId)?.team||state.reserves.find(r=>r.id===s.id)?.team)==='ALLY')view.traverse(node=>{if(node.isMesh&&node.material)node.material=Array.isArray(node.material)?node.material.map(allyMaterial):allyMaterial(node.material);});view.position.copy(s.position);view.quaternion.copy(s.rotation);view.updateWorldMatrix(true,true);
    const rig=discoverRig(view),weapons=initializeWeapons(view,rig);if(balance){const found=new Set();for(const weapon of weapons){const m=/^LC01_(W\d{2})$/.exec(weapon.key),mount=m&&balance.mounts.get(m[1]);if(!mount||found.has(m[1])||mount.muzzles!==weapon.muzzleNodes.length||(weapon.pivot?'turret':'fixed')!==mount.kind)throw Error('LC01 모델과 CSV의 포 불일치: '+weapon.key);found.add(m[1]);weapon.balance=mount.type;}if(found.size!==balance.mounts.size)throw Error('LC01 CSV 포 누락');}s.weapons=weapons.map((weapon,i)=>({id:s.id+':'+i,shipId:s.id,yaw:weapon.yaw,pitch:weapon.pitch,cooldown:0,cooldownSec:weapon.balance?.cooldown,range:weapon.balance?.range,targetId:null}));for(let i=0;i<weapons.length;i++){const weapon=weapons[i];weapon.combatState=s.weapons[i];weapon.muzzleChains=weapon.muzzleNodes.map(muzzle=>captureMuzzleChain(view,weapon,muzzle));}
    const safety=new GameRigSafety(view,weapons);safety.confirmedNeutral=neutralConfirmed;if(neutralConfirmed)safety.captureConfirmedNeutralContacts();const entry={view,weapons,safety,assetHash:digest,safe:neutralConfirmed&&rig.muzzleCount>0,reason:neutralConfirmed?'':'모델 해시가 일치하지 않아 사격 보류'};
    if(!entry.safe&&!options.allowUnsafe){safety.dispose();throw Error('검증된 리깅 모델이 아닙니다.');}
    return {commit(){scene.add(view);views.set(s.id,view);rigs.set(s.id,entry);},rollback(){scene.remove(view);views.delete(s.id);rigs.delete(s.id);safety.dispose();}};
  };
  for(const f of state.fleets)for(const s of f.ships)prepareUnitView(s,{allowUnsafe:true}).commit();
  state.assetsAvailable=neutralConfirmed&&[...rigs.values()].every(r=>r.safe)&&!balanceError;if(balanceError)setError('밸런스 데이터: '+balanceError);
  state.combat=battleCombat;if(!neutralConfirmed)setError('검증된 리깅 모델과 일치하지 않아 사격을 보류합니다.');
  refreshInputs();syncUI();updatePreview();
}catch(e){state.assetsAvailable=false;setError('함선 준비 오류: '+e.message);console.error(e);}
let last=null,acc=0,lastPhase=state.phase,lastFleetStatus='';
const renderSize=new THREE.Vector2();
renderer.setAnimationLoop(ms=>{
  const viewSize=viewportSize();renderer.getSize(renderSize);if(renderSize.x!==viewSize.width||renderSize.y!==viewSize.height)resizeViewport();
  if(last===null)last=ms;const elapsed=Math.min((ms-last)/1000,CONFIG.maxFrame);last=ms;
  if(state.phase==='RUNNING'){
    acc+=elapsed;let steps=0;while(acc>=CONFIG.dt&&steps<CONFIG.maxSteps&&state.phase==='RUNNING'){step(state);acc-=CONFIG.dt;steps++;}
    if(steps===CONFIG.maxSteps&&acc>=CONFIG.dt)acc=0;
  }else acc=0;
  if(lastPhase!==state.phase){lastPhase=state.phase;syncUI();}
  const fleetStatus=friendly.flatMap(f=>f.ships.map(s=>s.id+':'+s.hp+':'+s.alive)).join('|');if(fleetStatus!==lastFleetStatus&&!draggedShip&&!shipMode){lastFleetStatus=fleetStatus;refreshFleetTabs();refreshShips();}
  updateStatus();
  for(const f of state.fleets)for(const s of f.ships){const view=views.get(s.id);if(view){view.position.copy(s.position);view.quaternion.copy(s.rotation);view.visible=s.alive;}}
  const activeShots=new Set(state.shotEffects.map(p=>p.id));for(const [id,view] of projectileViews)if(!activeShots.has(id)){scene.remove(view);view.geometry.dispose();projectileViews.delete(id);}for(const p of state.shotEffects){if(!projectileViews.has(p.id)){const geometry=new THREE.BufferGeometry().setFromPoints([p.origin,p.position]);const view=new THREE.Line(geometry,shotMaterial);scene.add(view);projectileViews.set(p.id,view);}}
  updatePreview();
  selectedIndicator.position.copy(selected.anchor);
  selectedIndicator.quaternion.copy(activeCamera.quaternion);
  // Status text is updated without replacing interactive controls.
  if(draft)movePicking(elapsed);else{orbit.update();moveCamera(elapsed);}$('zoom-debug').textContent=draft?'입력 줌 '+pickingCamera.zoom.toFixed(2)+'×':'카메라 거리 '+camera.position.distanceTo(orbit.target).toFixed(1);renderer.render(scene,activeCamera);drawMinimap();
});
