import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runtime} from './node-runtime.mjs';
try {
 const rt=await runtime(),T=rt.THREE;
 const text=await readFile(new URL('./rig-control.js',import.meta.url),'utf8');
 const url='data:text/javascript;base64,'+Buffer.from(text.replaceAll("from 'three'",`from '${rt.threeURL}'`)).toString('base64');
 const C=await import(url);
 const {RigSafety}=await rt.module((await readFile(new URL('./rig-safety.js',import.meta.url),'utf8')).replaceAll("from './rig-control.js'",`from '${url}'`));
 let count=0;const pass=label=>{count++;console.log('PASS',label);};
 const mesh=(g,parent,x=0,y=0,z=0)=>{const m=new T.Mesh(g);m.position.set(x,y,z);parent.add(m);return m;};
 // A muzzle exiting its own cap may launch; an inward muzzle may not.
 {
  const root=new T.Group();mesh(new T.BoxGeometry(1,1,1),root);root.updateMatrixWorld(true);
  const engine=new RigSafety(root,[]),m=new T.Object3D();root.add(m);m.position.set(.5,0,0);m.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(1,0,0));
  assert.equal(engine.muzzleBlocked(m,{radius:.05,range:3}),null);
  m.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(-1,0,0));assert.ok(engine.muzzleBlocked(m,{radius:.05,range:3}));
  pass('outgoing muzzle cap vs inward self fire');engine.dispose();
 }
 // A finite-width projectile can graze a triangle even when its center ray misses.
 {
  const root=new T.Group();mesh(new T.BoxGeometry(1,1,1),root);const engine=new RigSafety(root,[]);
  assert.equal(engine.segmentBlocked(new T.Vector3(-2,.6,0),new T.Vector3(2,.6,0),0),null);
  assert.ok(engine.segmentBlocked(new T.Vector3(-2,.6,0),new T.Vector3(2,.6,0),.2));
  assert.ok(engine.segmentBlocked(new T.Vector3(0,0,0),new T.Vector3(.1,0,0),.01));
  pass('thick sweep and contained spawn');engine.dispose();
 }
 // Both endpoints are clear but the angular path hits an obstacle.
 {
  const root=new T.Group(),pivot=new T.Group();pivot.name='PIVOT_Turret_Test';root.add(pivot);
  mesh(new T.BoxGeometry(.3,.3,.3),pivot,2,0,0);mesh(new T.BoxGeometry(.4,.4,.4),root,2,0,0);
  const w={key:'Test',pivot,barrels:[],muzzleNodes:[],yaw:-60,pitch:0,settings:{yaw:[-180,180],pitch:[0,45],yawAxis:'z',pitchAxis:'y',pitchSign:1},restTurret:new T.Quaternion(),restBarrels:[]};
  C.applyPose(w);const engine=new RigSafety(root,[w]);assert.equal(engine.poseCollision(),null);
  const r=engine.moveBatch([{weapon:w,yaw:60,pitch:0}]);assert.equal(r.allowed,false);assert.ok(r.fraction>0&&r.fraction<1);assert.ok(w.yaw<0);
  pass('connected safe angular path, no endpoint teleport');engine.dispose();
 }
 // A user-confirmed zero pose changes movement classification, never the fire check.
 {
  const root=new T.Group(),pivot=new T.Group();pivot.name='PIVOT_Turret_Neutral';root.add(pivot);mesh(new T.BoxGeometry(1,1,1),pivot,.2,.1,.1);mesh(new T.BoxGeometry(1,1,1),root);
  const w={pivot,barrels:[],yaw:0,pitch:0},engine=new RigSafety(root,[w]);
  assert.ok(engine.poseCollision());engine.confirmedNeutral=true;assert.equal(engine.poseCollision(),null);
  const muzzle=new T.Object3D();root.add(muzzle);muzzle.position.set(.5,0,0);muzzle.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(-1,0,0));
  assert.ok(engine.muzzleBlocked(muzzle,{radius:.05,range:3}));w.yaw=1;assert.ok(engine.poseCollision());
  pass('confirmed zero pose and independent fire restriction');engine.dispose();
 }
 // A bounded, verified joint permits contact only for the authorized pair and region.
 {
  const root=new T.Group(),pivot=new T.Group();pivot.name='PIVOT_Turret_Baseline';root.add(pivot);
  mesh(new T.BoxGeometry(1,1,1),pivot,.2,.1,.1);mesh(new T.BoxGeometry(1,1,1),root);
  const w={pivot,barrels:[],yaw:0,pitch:0},engine=new RigSafety(root,[w]);engine.confirmedNeutral=true;
  assert.ok(engine.captureConfirmedNeutralContacts()>0);
  const saved=[...engine.neutralContacts.values()][0];assert.ok(saved.radius>0);
  // A new non-joint obstacle must remain detectable after neutral capture.
  const other=new T.Group();other.name='PIVOT_Turret_Other';root.add(other);
  mesh(new T.BoxGeometry(1,1,1),other,.4,.3,.2).name='other-turret-mesh';root.updateMatrixWorld(true);
  const obstacle=new RigSafety(root,[w,{pivot:other,barrels:[],yaw:0,pitch:0}]);
  obstacle.confirmedNeutral=true;obstacle.captureConfirmedNeutralContacts();w.yaw=1;
  const hit=obstacle.poseCollision(null,{dynamicOnly:true});assert.ok(hit);assert.ok([hit.a,hit.b].includes('other-turret-mesh'));
  pass('confirmed neutral capture retains unrelated collisions');engine.dispose();obstacle.dispose();
 }
 // A bounded, verified joint permits contact only for the authorized pair and region.
 {
  const root=new T.Group(),t=new T.Group(),b=new T.Group();t.name='PIVOT_Turret_J';b.name='PIVOT_Barrel_J';root.add(t);t.add(b);
  const a=mesh(new T.BoxGeometry(1,1,1),t),m=mesh(new T.BoxGeometry(1,1,1),b,.4,.2,.1);
  const w={pivot:t,barrels:[b]},engine=new RigSafety(root,[w]);const pa=engine.parts.find(p=>p.mesh===a),pb=engine.parts.find(p=>p.mesh===m);
  engine.joints=[{pivot:b,parentOwner:t,radius:1,status:'verified'}];
  assert.equal(engine.allowedContact(pa,pb,[new T.Vector3(.1,0,0)]),true);
  assert.equal(engine.allowedContact(pa,pb,[new T.Vector3(2,0,0)]),false);
  engine.joints[0].status='candidate';assert.equal(engine.allowedContact(pa,pb,[new T.Vector3(.1,0,0)]),false);
  pass('joint pair and region, candidate fail closed');engine.dispose();
 }
 // Preserve both explicit reference ships' signed and conditional rules.
 {
  const cfg=C.settingsFor({key:'Center',pivot:{userData:{}},barrels:[]});assert.deepEqual(cfg.yaw,[-140,140]);
  const h=C.settingsFor({key:'D01_Hull_L',pivot:{userData:{}},barrels:[]});assert.deepEqual(h.yaw,[-30,90]);
  assert.deepEqual(C.pitchRange({key:'D01_Hull_L',yaw:-1,settings:h}),[-15,0]);
  assert.deepEqual(C.pitchRange({key:'D01_Hull_L',yaw:0,settings:h}),[-15,15]);
  pass('LC01 and D01 reference policy');
 }
 // Opposite movers are tested in the same proposed time slice, not against stale poses.
 {
  const root=new T.Group(),weapons=[];
  for(let i=0;i<2;i++){
   const pivot=new T.Group();pivot.name='PIVOT_Turret_Sim_'+i;root.add(pivot);mesh(new T.BoxGeometry(.25,.25,.25),pivot,2,0,0);
   const w={key:'Sim_'+i,pivot,barrels:[],yaw:i?180:0,pitch:0,settings:{yaw:[-180,180],pitch:[0,45],yawAxis:'z',pitchAxis:'y',pitchSign:1},restTurret:new T.Quaternion(),restBarrels:[]};C.applyPose(w);weapons.push(w);
  }
  const e=new RigSafety(root,weapons);assert.equal(e.poseCollision(),null);
  const result=e.moveBatch([{weapon:weapons[0],yaw:180,pitch:0},{weapon:weapons[1],yaw:0,pitch:0}]);
  assert.equal(result.allowed,false);assert.ok(result.fraction<.5);
  pass('simultaneous moving turrets cannot pass through each other');e.dispose();
 }
 // Check discontinuous conditional pitch limits do not skip a large pitch transition.
 {
  const root=new T.Group(),pivot=new T.Group();pivot.name='PIVOT_Turret_D01_Hull_L';root.add(pivot);
  const b=new T.Group();b.name='PIVOT_Barrel_Test';pivot.add(b);
  const w={key:'D01_Hull_L',pivot,barrels:[b],yaw:-2,pitch:0,settings:{yaw:[-30,90],pitch:[-15,15],yawAxis:'z',pitchAxis:'y',pitchSign:1},restTurret:new T.Quaternion(),restBarrels:[new T.Quaternion()]};C.applyPose(w);
  const e=new RigSafety(root,[w]);let previous=0,maxPitchDelta=0;
  e.poseCollision=()=>{maxPitchDelta=Math.max(maxPitchDelta,Math.abs(w.pitch-previous));previous=w.pitch;return null;};
  const r=e.moveBatch([{weapon:w,yaw:2,pitch:15}]);assert.equal(r.allowed,true);assert.ok(maxPitchDelta<=1.000001);
  pass('conditional pitch transition obeys angular resolution');e.dispose();
 }
 const report=JSON.parse(await readFile(new URL('./rig-analysis.json',import.meta.url),'utf8'));
 assert.equal(report.models.length,10);
 for(const m of report.models){assert.ok(m.sha256.length===64);assert.ok(m.weapons.length);assert.ok(m.weapons.every(w=>w.samples.every(s=>Object.hasOwn(s,'draftBlocked'))));}
 pass('all ten analysis records and draft/strict separation');
 console.log(`${count} test groups passed`);
}catch(e){console.error(e.message.slice(0,1000));process.exitCode=1;}
