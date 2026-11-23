import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runtime } from './node-runtime.mjs';
try {
 const rt=await runtime(), {THREE:T,FBXLoader}=rt;
 const ct=await readFile(new URL('./rig-control.js',import.meta.url),'utf8');
 const cu='data:text/javascript;base64,'+Buffer.from(ct.replaceAll("from 'three'", "from '"+rt.threeURL+"'")).toString('base64');
 const C=await import(cu);
 const {RigSafety}=await rt.module((await readFile(new URL('./rig-safety.js',import.meta.url),'utf8')).replaceAll("from './rig-control.js'","from '"+cu+"'"));
 const report={schema:1,generatedAt:new Date().toISOString(),scope:'sampled fixed geometry; no continuous safety certification',moduleHashes:{},models:[]};
 for(const f of ['rig-control.js','rig-safety.js'])report.moduleHashes[f]=createHash('sha256').update(await readFile(new URL(f,import.meta.url))).digest('hex');
 for(const family of ['Destroyer','Light_cruiser'])for(let n=1;n<=5;n++){
  const file=family+'_'+String(n).padStart(2,'0')+'_rigged.fbx';
  const bytes=await readFile(new URL('../../ship assets/rigged/'+file,import.meta.url));
  const root=new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const box=new T.Box3().setFromObject(root),dims=box.getSize(new T.Vector3()),group=new T.Group();
  root.position.sub(box.getCenter(new T.Vector3()));group.scale.setScalar(10/Math.max(...dims.toArray()));group.add(root);group.updateMatrixWorld(true);
  const rig=C.discoverRig(root),weapons=C.initializeWeapons(root,rig),started=performance.now(),engine=new RigSafety(root,weapons);
  engine.confirmedNeutral=['Destroyer_01_rigged.fbx','Light_cruiser_01_rigged.fbx'].includes(file);
  if(engine.confirmedNeutral)engine.captureConfirmedNeutralContacts();
  const entry={file,sha256:createHash('sha256').update(bytes).digest('hex'),triangles:engine.parts.reduce((s,p)=>s+(p.geometry.index?.count??p.geometry.attributes.position.count)/3,0),meshes:engine.parts.length,engines:rig.engines.length,muzzles:rig.muzzleCount,topology:engine.parts.map(p=>({mesh:p.mesh.name,islands:p.topology.probes.length,boundaryEdges:p.topology.boundaryEdges,nonManifoldEdges:p.topology.nonManifoldEdges})),joints:engine.joints.map(j=>({pivot:j.pivot.name,parent:j.parentOwner?.name??'fixed',radius:j.radius,status:j.status})),neutralCollision:engine.poseCollision(),weapons:[]};
  for(const w of weapons){
   const result={key:w.key,barrels:w.barrels.length,muzzles:w.muzzleNodes.length,settings:w.settings,inference:w.inference,neutralFire:w.muzzleNodes.map(m=>({muzzle:m.name,blocked:engine.muzzleBlocked(m,{radius:.075,range:36})})),samples:[]};
   if(w.pivot){
    root.updateWorldMatrix(true,true);
    const muzzle=w.muzzleNodes[0],before=muzzle?.getWorldPosition(new T.Vector3());
    w.yaw=1;C.applyPose(w);root.updateWorldMatrix(true,true);const dy=muzzle?.getWorldPosition(new T.Vector3()).sub(before);
    w.yaw=0;w.pitch=1;C.applyPose(w);root.updateWorldMatrix(true,true);const dp=muzzle?.getWorldPosition(new T.Vector3()).sub(before);
    w.pitch=0;C.applyPose(w);root.updateWorldMatrix(true,true);
    result.probe={yawOneDegreeDelta:dy?.toArray(),pitchOneDegreeDelta:dp?.toArray(),worldYawAxis:new T.Vector3(w.settings.yawAxis==='x'?1:0,w.settings.yawAxis==='y'?1:0,w.settings.yawAxis==='z'?1:0).applyQuaternion(w.pivot.getWorldQuaternion(new T.Quaternion())).toArray()};

    const ys=[];for(let a=w.settings.yaw[0];a<=w.settings.yaw[1];a+=30)ys.push(a);ys.push(0,w.settings.yaw[1]);
    for(const yaw of [...new Set(ys)].sort((a,b)=>a-b))for(const pitch of [...new Set([0,...w.settings.pitch,(w.settings.pitch[0]+w.settings.pitch[1])/2])]){
     w.yaw=yaw;w.pitch=pitch;C.applyPose(w);
     const collision=engine.poseCollision(new Set([w.pivot,...w.barrels]),{fixedOnly:true});
     engine.allowInferredJoints=true; const draftBlocked=engine.poseCollision(new Set([w.pivot,...w.barrels]),{fixedOnly:true});engine.allowInferredJoints=false; result.samples.push({yaw:w.yaw,pitch:w.pitch,blocked:collision,draftBlocked});
    }
    w.yaw=0;w.pitch=0;C.applyPose(w);engine.update();
   }
   entry.weapons.push(result);
  }
  entry.elapsedMs=+(performance.now()-started).toFixed(2);report.models.push(entry);engine.dispose();
  console.log(JSON.stringify({file,weapons:weapons.length,muzzles:rig.muzzleCount,triangles:entry.triangles,blockedSamples:entry.weapons.reduce((s,w)=>s+w.samples.filter(p=>p.blocked).length,0),samples:entry.weapons.reduce((s,w)=>s+w.samples.length,0),neutralCollision:entry.neutralCollision,elapsedMs:entry.elapsedMs}));
 }
 await writeFile(new URL('./rig-analysis.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
}catch(e){console.error(e.message.slice(0,800));process.exitCode=1;}

