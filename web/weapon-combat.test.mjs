import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runtime} from '../rigging-test/node-runtime.mjs';
const rt=await runtime(),T=rt.THREE,url=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64'),read=name=>readFile(new URL('./'+name,import.meta.url),'utf8');
const spatial=url(await read('spatial-index.js')),hit=url(await read('hit-resolution.js')),economy=url(await read('economy.js'));
const scoring=url((await read('scoring.js')).replace("from 'three'","from '"+rt.threeURL+"'"));
const sim=url((await read('simulation.js')).replace("from 'three'","from '"+rt.threeURL+"'").replace('./spatial-index.js?v=refactor-20261127c',spatial).replace('./hit-resolution.js?v=refactor-20261127c',hit).replace('./economy.js?v=refactor-20261127c',economy).replace('./scoring.js?v=refactor-20261127c',scoring));
const rig=url((await readFile(new URL('../rigging-test/rig-control.js',import.meta.url),'utf8')).replace("from 'three'","from '"+rt.threeURL+"'"));
const weaponSource=(await read('weapon-combat.js')).replace("from 'three'","from '"+rt.threeURL+"'").replace('./simulation.js?v=tactics-20261128h',sim).replace('../rigging-test/rig-control.js',rig);
const {createBattleCombat}=await import(url(weaponSource));
const muzzle=new T.Object3D();muzzle.name='muzzle';const data={id:'weapon',yaw:0,pitch:0,cooldown:1,activeRays:new Map([[0,{endTick:12,nextTick:3,length:20}]])};
const w={combatState:data,muzzleChains:[{rootScale:new T.Vector3(1,1,1),parts:[]}],muzzleNodes:[muzzle],balance:{intervalTicks:3,damage:5,range:20},settings:{yaw:[-180,180],pitch:[0,45]},barrels:[],target:null};
const view=new T.Group();view.add(muzzle);const ship={id:'ship',fleetId:'A',alive:true,position:new T.Vector3(),rotation:new T.Quaternion()},rigs=new Map([['ship',{safe:true,view,weapons:[w],safety:{muzzleBlocked:()=>null}}]]);
const state={time:0,fleets:[{id:'A',team:'ALLY',ships:[ship],encounter:{}}]},run=createBattleCombat({rigs,balance:{maxRange:20},approximateMoveBatch:()=>{}}),index={query:()=>[]};let pulses=[];
for(let tick=0;tick<=12;tick++){state.time=tick/60;const shots=run(state,[ship],1/60,index);if(shots.length){pulses.push(tick);assert.equal(shots[0].isRayPulse,true);assert.equal(shots[0].damage,5);assert.equal(shots[0].validate(),true);}}
assert.deepEqual(pulses,[3,6,9]);assert.equal(data.activeRays.size,0);
console.log('PASS active ray emits at ticks 3, 6, 9 and stops at 12');

// Exercise the shipped LC01 rig, not a synthetic hierarchy, with game normalization.
{
  const {createHash}=await import('node:crypto'),asset=await readFile(new URL('../../ship assets/rigged/Light_cruiser_01_rigged.fbx',import.meta.url));
  const report=JSON.parse(await readFile(new URL('../rigging-test/rig-analysis.json',import.meta.url),'utf8'));
  const digest=createHash('sha256').update(asset).digest('hex');assert(report.models.some(m=>m.file==='Light_cruiser_01_rigged.fbx'&&m.sha256===digest),'neutral confirmation must match actual asset hash');
  const model=new rt.FBXLoader().parse(asset.buffer.slice(asset.byteOffset,asset.byteOffset+asset.byteLength),'');
  const box=new T.Box3().setFromObject(model),dimensions=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3());model.position.sub(center);
  const corrected=new T.Group();corrected.add(model);corrected.scale.setScalar(2.2/Math.max(...dimensions.toArray()));corrected.rotation.y=Math.PI/2;
  const shipView=new T.Group();shipView.add(corrected);shipView.updateWorldMatrix(true,true);
  const C=await import(rig),S=await import(sim),discovered=C.discoverRig(shipView),weapons=C.initializeWeapons(shipView,discovered);
  assert.equal(weapons.length,5);assert.equal(discovered.muzzleCount,6);
  for(const weapon of weapons){
    weapon.muzzleChains=weapon.muzzleNodes.map(node=>S.captureMuzzleChain(shipView,weapon,node));
    const samples=S.buildWeaponAimSamples(weapon,yaw=>C.pitchRange({...weapon,yaw}));assert(samples.length>=3);
    const pose=S.muzzlePoseFromData(weapon.muzzleChains[0],weapon,new T.Vector3(),new T.Quaternion(),0,0),d=pose.direction;let best=-1;
    for(let i=0;i<samples.length;i+=3)best=Math.max(best,samples[i]*d.x+samples[i+1]*d.y+samples[i+2]*d.z);
    assert(best>1-1e-6,weapon.key+' neutral pose appears in rig samples');
  }
  const limited={position:new T.Vector3(),velocity:new T.Vector3(),rotation:new T.Quaternion(),weapons:[{range:48,damage:100,cooldownSec:1,aimCone:Math.PI,aimSamples:new Float32Array([0,0,1]),aimTolerance:.1}],aimTargetPosition:new T.Vector3(-20,0,0),aimRevision:1};
  const chosen=S.aimFromBase(limited,new T.Quaternion(),limited.position),bow=new T.Vector3(0,0,1).applyQuaternion(chosen);
  assert(bow.x<-.95,'sampled restricted firing direction must affect the chosen hull orientation');
  let comparisons=0;
  for(const [rotation,yaw,pitch] of [[new T.Quaternion(),0,0],[new T.Quaternion().setFromEuler(new T.Euler(.25,.7,-.3,'YXZ')),15,10],[new T.Quaternion().setFromEuler(new T.Euler(-.4,-.9,.2,'YXZ')),-15,15]]){
    shipView.position.set(3,-4,6);shipView.quaternion.copy(rotation);
    for(const weapon of weapons){weapon.yaw=yaw;weapon.pitch=pitch;C.applyPose(weapon);}shipView.updateWorldMatrix(true,true);
    for(const weapon of weapons)for(let i=0;i<weapon.muzzleNodes.length;i++){
      const node=weapon.muzzleNodes[i],computed=S.muzzlePoseFromData(weapon.muzzleChains[i],weapon,shipView.position,shipView.quaternion,weapon.yaw,weapon.pitch),actualPosition=node.getWorldPosition(new T.Vector3()),actualDirection=new T.Vector3(0,0,1).applyQuaternion(node.getWorldQuaternion(new T.Quaternion())).normalize();
      assert(computed.position.distanceTo(actualPosition)<1e-5,weapon.key+' muzzle position');assert(computed.direction.dot(actualDirection)>1-1e-7,weapon.key+' muzzle direction');comparisons++;
    }
  }
  assert.equal(comparisons,18);
  for(const weapon of weapons){weapon.yaw=0;weapon.pitch=0;C.applyPose(weapon);}shipView.position.set(0,0,0);shipView.quaternion.identity();shipView.updateWorldMatrix(true,true);
  globalThis.__fleetDoctrineBVH=rt.BVH;
  const bvh=url('export const MeshBVH=globalThis.__fleetDoctrineBVH.MeshBVH;');
  const safetyText=(await readFile(new URL('../rigging-test/rig-safety.js',import.meta.url),'utf8')).replace("from 'three'","from '"+rt.threeURL+"'").replace("from 'three-mesh-bvh'","from '"+bvh+"'").replace("from './rig-control.js'","from '"+rig+"'");
  const safetyModule=url(safetyText),adapterText=(await read('ship-rig-adapter.js')).replace("from 'three'","from '"+rt.threeURL+"'").replace("from '../rigging-test/rig-safety.js'","from '"+safetyModule+"'").replace("from '../rigging-test/rig-control.js'","from '"+rig+"'");
  const {GameRigSafety,approximateMoveBatch}=await import(url(adapterText)),safety=new GameRigSafety(shipView,weapons,{assetHash:digest});safety.confirmedNeutral=true;safety.captureConfirmedNeutralContacts();
  assert.equal(safety.neutralJointData.length,11);
  for(const joint of safety.neutralJointData){assert.equal(joint.assetHash,digest);assert.equal(joint.status,'derived-candidate');assert.equal(joint.individualReview,'pending');assert.equal(joint.poseConfirmed,'all-joints-zero');assert.equal(joint.parts.length,2);assert(joint.region.radius>0);assert(joint.movement?.yaw&&joint.movement?.pitch);}
  const unknown=new GameRigSafety(shipView,weapons,{assetHash:'unrecognized'});unknown.confirmedNeutral=true;unknown.captureConfirmedNeutralContacts();assert.equal(unknown.neutralJointData.length,0);assert.equal(unknown.neutralContacts.size,safety.neutralContacts.size);
  // Explicit provenance must not change existing neutral-contact movement decisions.
  for(const weapon of weapons)for(const [yaw,pitch] of [[5,0],[-5,0],[0,5]]){
    const reset=()=>{for(const item of weapons){item.yaw=0;item.pitch=0;C.applyPose(item);}shipView.updateWorldMatrix(true,true);};
    reset();const before=unknown.moveBatch([{weapon,yaw,pitch}]);
    reset();const after=safety.moveBatch([{weapon,yaw,pitch}]);
    assert.deepEqual({allowed:after.allowed,reason:after.reason,fraction:after.fraction},{allowed:before.allowed,reason:before.reason,fraction:before.fraction});
  }
  for(const weapon of weapons){weapon.yaw=0;weapon.pitch=0;C.applyPose(weapon);}shipView.updateWorldMatrix(true,true);
  unknown.dispose();
  console.log('PASS LC01 neutral contact provenance, hash scope and movement parity');
  // The filtered real-asset pairs must remain separated for changing ship and
  // joint rotations; the shared firing geometry must stay intact.
  const filtered=new GameRigSafety(shipView,weapons,{filterMotionCandidates:true});
  assert(filtered.motionExcludedPairs>0,'LC01 should have provably separated candidates');
  assert.equal(filtered.parts.length,safety.parts.length);
  const keys=pair=>pair.map(p=>p.mesh.name).sort().join('|');
  const retained=new Set(filtered.dynamicPairs.map(keys));
  const removed=safety.dynamicPairs.filter(pair=>!retained.has(keys(pair)));
  assert.equal(removed.length,filtered.motionExcludedPairs);
  let seed=42;const random=()=>((seed=(1664525*seed+1013904223)>>>0)/2**32);
  for(let i=0;i<150;i++){
    shipView.rotation.set(random()*6-3,random()*6-3,random()*6-3);
    for(const weapon of weapons){weapon.yaw=weapon.settings.yaw[0]+random()*(weapon.settings.yaw[1]-weapon.settings.yaw[0]);weapon.pitch=random()*45;C.applyPose(weapon);}
    safety.update();
    for(const [a,b] of removed)assert(!a.box.intersectsBox(b.box),'removed pair overlaps at sampled pose: '+keys([a,b]));
  }
  shipView.rotation.set(0,0,0);for(const weapon of weapons){weapon.yaw=0;weapon.pitch=0;C.applyPose(weapon);}shipView.updateWorldMatrix(true,true);
  for(const weapon of weapons)for(const node of weapon.muzzleNodes)assert.deepEqual(filtered.muzzleBlocked(node,{radius:.1,range:30}),safety.muzzleBlocked(node,{radius:.1,range:30}));
  const changed=weapons[0].pivot, prior=changed.scale.x;changed.scale.x=prior*1.1;filtered.ensureMotionCandidates();
  assert.equal(filtered.motionExcludedPairs,0,'changed scale invalidates filtering');
  assert.equal(filtered.dynamicPairs.length,safety.dynamicPairs.length,'all candidates restored');
  changed.scale.x=prior;filtered.dispose();
  console.log('PASS LC01 conservative candidate filtering, invalidation and muzzle safety');
  const results=[];for(const weapon of weapons)for(const node of weapon.muzzleNodes)results.push({weapon,node,blocked:safety.muzzleBlocked(node,{radius:.1,range:30})});
  assert.equal(results.length,6);
  let selected=null;
  for(const item of results){
    const weapon=item.weapon;
    for(const yaw of [-120,-90,-60,-30,0,30,60,90,120]){
      if(yaw<weapon.settings.yaw[0]||yaw>weapon.settings.yaw[1])continue;
      for(const pitch of [0,15,30,45]){
        if(pitch<weapon.settings.pitch[0]||pitch>weapon.settings.pitch[1])continue;
        weapon.yaw=yaw;weapon.pitch=pitch;C.applyPose(weapon);shipView.updateWorldMatrix(true,true);
        if(!safety.muzzleBlocked(item.node,{radius:.1,range:30})){selected={...item,yaw,pitch};break;}
      }
      if(selected)break;
    }
    if(selected)break;
    weapon.yaw=0;weapon.pitch=0;C.applyPose(weapon);
  }
  assert(selected,'at least one sampled real muzzle pose must have an unobstructed firing path');
  const weapon=selected.weapon,pose=S.muzzlePoseFromData(weapon.muzzleChains[weapon.muzzleNodes.indexOf(selected.node)],weapon,new T.Vector3(),new T.Quaternion(),selected.yaw,selected.pitch);
  const realData={id:'real-weapon',yaw:selected.yaw,pitch:selected.pitch,cooldown:0,cooldownSec:1};weapon.combatState=realData;weapon.balance={range:32,damage:5,effect:'BOLT',id:'BOLT02'};
  const source={id:'real-source',fleetId:'R',alive:true,position:new T.Vector3(),rotation:new T.Quaternion(),hp:100,shield:0},target={id:'real-target',fleetId:'Q',alive:true,position:pose.position.clone().addScaledVector(pose.direction,15),rotation:new T.Quaternion(),hp:100,shield:0};
  const world={time:0,fleets:[{id:'R',team:'ALLY',ships:[source],encounter:{}},{id:'Q',team:'ENEMY',ships:[target],encounter:{}}]},realRigs=new Map([[source.id,{view:shipView,weapons:[weapon],safety,safe:true}]]),Spatial=await import(spatial),index=new Spatial.ShipSpatialIndex([source,target]);
  const fire=createBattleCombat({rigs:realRigs,balance:{maxRange:32},approximateMoveBatch}),shots=fire(world,[source,target],1/60,index);
  const clearShot=shots.find(shot=>shot.muzzleId===selected.node.name);assert(clearShot,'aligned actual muzzle produces shot candidate');assert(clearShot.validate(),'actual own-mesh safety permits a verified clear muzzle');
  const hitResolver=await import(hit),end=clearShot.position.clone().addScaledVector(clearShot.direction,clearShot.range),stats={rayCandidates:0};
  const firstEnemy=hitResolver.findFirstContact(index,clearShot,end,'A1',stats);assert.equal(firstEnemy?.ship.id,target.id,'real muzzle ray reaches the intended enemy first');
  const ally={id:'friendly-blocker',fleetId:'R',alive:true,position:clearShot.position.clone().addScaledVector(clearShot.direction,7),collisionRadius:1.1},blockedIndex=new Spatial.ShipSpatialIndex([source,ally,target]);
  assert.equal(hitResolver.findFirstContact(blockedIndex,clearShot,end,'A1',{rayCandidates:0})?.ship.id,ally.id,'friendly ship blocks the real muzzle ray');
  for(const part of weapons){part.yaw=0;part.pitch=0;C.applyPose(part);}shipView.updateWorldMatrix(true,true);
  const blocked=results.find(item=>item.blocked);assert(blocked,'representative neutral muzzle must have an actual blocked path');
  const blockedWeapon=blocked.weapon,blockedData={id:'blocked-real-weapon',yaw:0,pitch:0,cooldown:0,cooldownSec:1};blockedWeapon.combatState=blockedData;blockedWeapon.balance={range:32,damage:5,effect:'BOLT',id:'BOLT02'};
  const blockedPose=S.muzzlePoseFromData(blockedWeapon.muzzleChains[blockedWeapon.muzzleNodes.indexOf(blocked.node)],blockedWeapon,source.position,source.rotation,0,0);
  target.position.copy(blockedPose.position).addScaledVector(blockedPose.direction,15);const blockedRig=new Map([[source.id,{view:shipView,weapons:[blockedWeapon],safety,safe:true}]]),blockedFire=createBattleCombat({rigs:blockedRig,balance:{maxRange:32},approximateMoveBatch});
  const blockedShots=blockedFire(world,[source,target],1/60,new Spatial.ShipSpatialIndex([source,target])),selfShot=blockedShots.find(shot=>shot.muzzleId===blocked.node.name);
  assert(selfShot,'blocked muzzle still produces a broad-phase candidate');assert.equal(selfShot.validate(),false,'actual hull obstruction vetoes the shot');
  safety.dispose();delete globalThis.__fleetDoctrineBVH;
  console.log('PASS actual LC01 rig samples, muzzle transforms, own-mesh safety and friendly blocking');
}

