import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { applyPose, pitchRange } from './rig-control.js';

const ancestor = (o, p) => { for (; o; o = o.parent) if (o === p) return true; return false; };
const nearest = o => { for (let p = o.parent; p; p = p.parent) if (/^PIVOT_(Barrel|Turret)_/.test(p.name)) return p; return null; };
const world = o => o.getWorldPosition(new THREE.Vector3());

// This engine uses actual triangle surfaces, BVHs and island containment probes.
// Open meshes and sampled angular paths remain explicitly unverified, not certified solids/CCD.
export class RigSafety {
  constructor(root, weapons, { allowInferredJoints = false, stepDegrees = 1, maxSteps = 720 } = {}) {
    this.root = root; this.weapons = weapons; this.allowInferredJoints = allowInferredJoints;
    this.stepDegrees = stepDegrees; this.maxSteps = maxSteps; this.parts = []; this.joints = []; this.revision = 0;
    // User-confirmed neutral pose is opt-in for the exact inspected assets only.
    this.confirmedNeutral = false;
    this.neutralContacts = new Map();
    root.updateWorldMatrix(true, true);
    this.size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).length();
    this.epsilon = this.size * 1e-7;
    root.traverse(mesh => {
      if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
      const geometry = mesh.geometry.clone();
      geometry.clearGroups();
      const bvh = new MeshBVH(geometry, { maxLeafTris: 8, indirect: true });
      const topology = islandProbes(geometry);
      this.parts.push({ mesh, owner: nearest(mesh), geometry, bvh, topology, box: new THREE.Box3(), inverse: new THREE.Matrix4() });
    });
    this.update();
    for (const w of weapons.filter(w => w.pivot)) {
      const pairs = [[w.pivot, null], ...w.barrels.map(b => [b, w.pivot])];
      for (const [pivot, parentOwner] of pairs) {
        const moving = this.parts.filter(p => p.owner === pivot);
        if (!moving.length) continue;
        const bounds = new THREE.Box3(); moving.forEach(p => bounds.union(p.box));
        const dims = bounds.getSize(new THREE.Vector3()).toArray().sort((a,b) => a-b);
        const radius = Math.min(dims[2] * .5, Math.max(dims[0], dims[1]) * 1.1);
        if (radius > this.epsilon) this.joints.push({ pivot, parentOwner, radius, status: 'candidate', source: 'bounded pivot region; requires visual validation' });
        if (parentOwner && radius > this.epsilon) this.joints.push({ pivot, parentOwner: null, radius, status:'candidate', source:'barrel-to-fixed-mount candidate; requires visual validation' });
      }
    }
  }
  update() {
    this.root.updateWorldMatrix(true, true);
    for (const p of this.parts) {
      p.box.copy(p.geometry.boundingBox).applyMatrix4(p.mesh.matrixWorld);
      p.inverse.copy(p.mesh.matrixWorld).invert();
    }
    const signature=this.parts.filter(p=>!p.owner).map(p=>p.mesh.matrixWorld.elements.join(',')).join(';');
    if(this.fixedSignature && signature!==this.fixedSignature)this.precomputed=null;
    this.fixedSignature=signature;
  }
  jointFor(a, b) {
    return this.joints.find(j => (a.owner === j.pivot && b.owner === j.parentOwner) || (b.owner === j.pivot && a.owner === j.parentOwner));
  }
  captureConfirmedNeutralContacts() {
    if (!this.confirmedNeutral || this.weapons.some(w=>w.pivot && (Math.abs(w.yaw)>1e-9 || Math.abs(w.pitch)>1e-9))) throw Error('confirmed neutral required');
    this.update();this.neutralContacts.clear();this.precomputed=null;
    for(let i=0;i<this.parts.length;i++)for(let k=i+1;k<this.parts.length;k++){
      const a=this.parts[i],b=this.parts[k],j=this.jointFor(a,b);
      if(!j || a.owner===b.owner || !a.box.intersectsBox(b.box))continue;
      const transform=new THREE.Matrix4().multiplyMatrices(a.inverse,b.mesh.matrixWorld),contacts=[];
      a.bvh.bvhcast(b.bvh,transform,{intersectsTriangles:(ta,tb,ia,ib)=>{
        const line=new THREE.Line3();if(!ta.intersectsTriangle(tb,line))return false;
        // Record only triangles participating in the user-confirmed neutral contact.
        const center=world(j.pivot);
        contacts.push([ia,ib,Math.max(line.start.clone().applyMatrix4(a.mesh.matrixWorld).distanceTo(center),line.end.clone().applyMatrix4(a.mesh.matrixWorld).distanceTo(center))]);return false;
      }});
      if(contacts.length)this.neutralContacts.set(a.mesh.uuid+'|'+b.mesh.uuid,{a:new Set(contacts.map(x=>x[0])),b:new Set(contacts.map(x=>x[1])),pivot:j.pivot,radius:Math.max(...contacts.map(x=>x[2]))+this.size*.005});
    }
    return this.neutralContacts.size;
  }
  allowedContact(a, b, points) {
    const j = this.jointFor(a, b);
    if (!j || !(j.status === 'verified' || this.allowInferredJoints)) return false;
    const center = world(j.pivot);
    return points.every(p => p.distanceTo(center) <= j.radius);
  }
  contains(part, point) {
    // Containment is not asserted for an open/non-manifold triangle island soup.
    if (part.topology.boundaryEdges || part.topology.nonManifoldEdges) return false;
    if (!part.box.containsPoint(point)) return false;
    const origin = point.clone().applyMatrix4(part.inverse);
    const directions = [new THREE.Vector3(.937,.271,.221), new THREE.Vector3(.193,.911,.365)];
    return directions.every(d => {
      const hits = part.bvh.raycast(new THREE.Ray(origin, d.normalize()), THREE.DoubleSide).map(h => h.distance).sort((a,b) => a-b);
      let n = 0, last = -Infinity;
      for (const t of hits) if (t > 1e-7 && t-last > 1e-6) { n++; last=t; }
      return n % 2 === 1;
    });
  }
  pairCollision(a, b) {
    if (!a.box.intersectsBox(b.box)) return null;
    const transform = new THREE.Matrix4().multiplyMatrices(a.inverse, b.mesh.matrixWorld);
    let blocked = null;
    a.bvh.bvhcast(b.bvh, transform, { intersectsTriangles: (ta, tb, ia, ib) => {
      const line = new THREE.Line3();
      // Pure coplanar/tangential contact is not volume penetration.
      const pa = ta.getPlane(new THREE.Plane()), pb = tb.getPlane(new THREE.Plane());
      const da = [tb.a,tb.b,tb.c].map(v => pa.distanceToPoint(v));
      const db = [ta.a,ta.b,ta.c].map(v => pb.distanceToPoint(v));
      const crossing = ds => Math.min(...ds)<-1e-7 && Math.max(...ds)>1e-7;
      if (!crossing(da) && !crossing(db)) return false;
      if (!ta.intersectsTriangle(tb, line)) return false;
      const points = [line.start.clone().applyMatrix4(a.mesh.matrixWorld), line.end.clone().applyMatrix4(a.mesh.matrixWorld)];
      const baseline=this.neutralContacts.get(a.mesh.uuid+'|'+b.mesh.uuid);
      if(baseline){
        // Faces may slide across the confirmed pair's joint, but only inside
        // its measured neutral contact region; other part pairs stay active.
        if(points.every(p=>p.distanceTo(world(baseline.pivot))<=baseline.radius))return false;
      }
      if (this.allowedContact(a,b,points)) return false;
      blocked = { type: this.jointFor(a,b) ? 'joint-or-body' : 'surface', a: a.mesh.name, b: b.mesh.name, point: points[0].toArray() };
      return true;
    } });
    if (blocked) return blocked;
    for (const [source,target] of [[a,b],[b,a]]) {
      for (const local of source.topology.probes) {
        const p = local.clone().applyMatrix4(source.mesh.matrixWorld);
        if (this.contains(target,p) && !this.allowedContact(a,b,[p])) return { type:'contained', a:a.mesh.name,b:b.mesh.name,point:p.toArray() };
      }
    }
    return null;
  }
  poseCollision(activeOwners = null, { fixedOnly = false, dynamicOnly = false } = {}) {
    this.update();
    if (this.confirmedNeutral && this.weapons.every(w => !w.pivot || (Math.abs(w.yaw) < 1e-9 && Math.abs(w.pitch) < 1e-9))) return null;
    if (!fixedOnly && !dynamicOnly) {
      const fixed=this.poseCollision(activeOwners,{fixedOnly:true});
      if(fixed)return fixed;
      return this.poseCollision(activeOwners,{dynamicOnly:true});
    }
    if(fixedOnly && activeOwners && this.precomputed){
      const w=this.weapons.find(w=>w.pivot && activeOwners.size===w.barrels.length+1 && activeOwners.has(w.pivot) && w.barrels.every(b=>activeOwners.has(b)));
      const saved=w && this.precomputed.weapons.find(x=>x.key===w.key && JSON.stringify(x.settings)===JSON.stringify(w.settings));
      const sample=saved?.samples.find(p=>p.yaw===w.yaw && p.pitch===w.pitch);
      if(sample)return this.allowInferredJoints?sample.draftBlocked:sample.blocked;
    }
    for (let i=0;i<this.parts.length;i++) for(let k=i+1;k<this.parts.length;k++) {
      const a=this.parts[i], b=this.parts[k];
      if (a.owner===b.owner) continue; // same rigid assembly, including all fixed hull meshes
      if (fixedOnly && a.owner && b.owner) continue;
      if (dynamicOnly && (!a.owner || !b.owner)) continue;
      if (activeOwners && !activeOwners.has(a.owner) && !activeOwners.has(b.owner)) continue;
      const hit=this.pairCollision(a,b); if(hit) return hit;
    }
    return null;
  }
  moveBatch(targets) {
    targets=targets.map(({weapon:w,yaw=w.yaw,pitch=w.pitch})=>{
      yaw=THREE.MathUtils.clamp(yaw,...w.settings.yaw);
      pitch=THREE.MathUtils.clamp(pitch,...pitchRange({...w,yaw}));
      return {weapon:w,yaw,pitch};
    });
    const originals=targets.map(({weapon:w})=>({w,yaw:w.yaw,pitch:w.pitch}));
    const active=new Set();
    targets.forEach(({weapon:w})=>{if(w.pivot)active.add(w.pivot);w.barrels.forEach(b=>active.add(b));});
    const maxDelta=Math.max(0,...targets.flatMap(({weapon:w,yaw=w.yaw,pitch=w.pitch},i)=>[Math.abs(yaw-originals[i].yaw),Math.abs(pitch-originals[i].pitch)]));
    const steps=Math.max(1,Math.ceil(maxDelta/this.stepDegrees));
    if(steps>this.maxSteps)return {allowed:false,reason:{type:'resolution-budget'},fraction:0};
    let fraction=0,reason=null,visited=0;
    let lastSafe=originals.map(o=>({yaw:o.yaw,pitch:o.pitch}));
    for(let step=1;step<=steps;step++) {
      const f=step/steps;
      const candidate=targets.map(({weapon:w,yaw,pitch},i)=>{
        const y=THREE.MathUtils.lerp(originals[i].yaw,yaw,f);
        return {yaw:y,pitch:THREE.MathUtils.clamp(THREE.MathUtils.lerp(originals[i].pitch,pitch,f),...pitchRange({...w,yaw:y}))};
      });
      // Conditional limits can change at yaw=0. Subdivide that actual pitch change too.
      const intermediate=candidate.map((p,i)=>{
        if(!/^D01_Hull_[LR]$/.test(targets[i].weapon.key))return p;
        const from=lastSafe[i];
        if(from.yaw<0 && p.yaw>=0 && p.pitch>0)return {yaw:p.yaw,pitch:Math.min(0,from.pitch)};
        if(from.yaw>=0 && p.yaw<0 && from.pitch>0)return {yaw:from.yaw,pitch:0};
        return p;
      });
      const stages=intermediate.some((p,i)=>p.yaw!==candidate[i].yaw||p.pitch!==candidate[i].pitch)?[intermediate,candidate]:[candidate];
      for(const stage of stages){
       const from=lastSafe.map(x=>({...x}));
       const substeps=Math.max(1,Math.ceil(Math.max(...stage.flatMap((p,i)=>[Math.abs(p.yaw-from[i].yaw),Math.abs(p.pitch-from[i].pitch)]))/this.stepDegrees));
       for(let sub=1;sub<=substeps;sub++){
        if(++visited>this.maxSteps){reason={type:'resolution-budget'};break;}
        targets.forEach(({weapon:w},i)=>{w.yaw=THREE.MathUtils.lerp(from[i].yaw,stage[i].yaw,sub/substeps);w.pitch=THREE.MathUtils.lerp(from[i].pitch,stage[i].pitch,sub/substeps);applyPose(w);});
        reason=this.poseCollision(active);if(reason)break;
        lastSafe=targets.map(({weapon:w})=>({yaw:w.yaw,pitch:w.pitch}));
        fraction=(step-1+sub/substeps)/steps;
       }
       if(reason)break;
      }
      if(reason)break;
    }
    // Restore to the last connected safe sample; never jump over a blocked interval.
    targets.forEach(({weapon:w},i)=>{
      w.yaw=lastSafe[i].yaw;w.pitch=lastSafe[i].pitch;applyPose(w);
    });
    this.update();this.revision++;
    return {allowed:!reason,reason,fraction,resolutionDegrees:this.stepDegrees};
  }
  // Exact capsule-to-triangle surface distance for the finite projectile sweep.
  segmentBlocked(start,end,radius=0) {
    this.update();
    const pathBox=new THREE.Box3().setFromPoints([start,end]).expandByScalar(radius+this.epsilon);
    for(const p of this.parts) {
      if(!p.box.intersectsBox(pathBox))continue;
      if(this.contains(p,start))return {type:'spawn-inside',part:p.mesh.name};
      const a=start.clone().applyMatrix4(p.inverse),b=end.clone().applyMatrix4(p.inverse);
      const segment=new THREE.Line3(a,b);
      const ray=new THREE.Ray(a,b.clone().sub(a).normalize()),hitPoint=new THREE.Vector3();
      const length=a.distanceTo(b);
      // Minimum singular value bound via inverse Frobenius norm: conservatively enlarge under nonuniform scale.
      const e=p.inverse.elements;
      const columns=[new THREE.Vector3(e[0],e[1],e[2]),new THREE.Vector3(e[4],e[5],e[6]),new THREE.Vector3(e[8],e[9],e[10])];
      const orthogonal=Math.abs(columns[0].dot(columns[1]))+Math.abs(columns[0].dot(columns[2]))+Math.abs(columns[1].dot(columns[2]))<1e-6;
      const localRadius=radius*(orthogonal?p.inverse.getMaxScaleOnAxis():Math.sqrt(columns.reduce((s,c)=>s+c.lengthSq(),0)));
      const box=new THREE.Box3().setFromPoints([a,b]).expandByScalar(localRadius+1e-7);
      const blocked=p.bvh.shapecast({intersectsBounds:x=>x.intersectsBox(box),intersectsTriangle:tri=>{
        const hit=ray.intersectTriangle(tri.a,tri.b,tri.c,false,hitPoint);
        return !!(hit && hit.distanceTo(a)<=length+1e-7) || (radius>0 && tri.closestPointToSegment(segment)<localRadius-1e-7);
      }});
      if(blocked)return {type:'fire-path',part:p.mesh.name};
    }
    return null;
  }
  muzzleBlocked(node,{radius=0,range=this.size*2}={}) {
    this.root.updateWorldMatrix(true,true);
    const start=world(node),direction=new THREE.Vector3(0,0,1).applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const end=start.clone().addScaledVector(direction,range);
    // The rendered sphere's rear touches the muzzle; its center is one radius forward.
    // Before using that center, verify the complete exit centerline from the actual muzzle.
    this.update();
    for(const p of this.parts){
      const ray=new THREE.Ray(start.clone().applyMatrix4(p.inverse),direction.clone().transformDirection(p.inverse));
      const hits=p.bvh.raycast(ray,THREE.DoubleSide);
      for(const h of hits){
        const wp=h.point.clone().applyMatrix4(p.mesh.matrixWorld),distance=wp.distanceTo(start);
        if(distance>this.epsilon && distance<=range)return {type:'muzzle-exit',part:p.mesh.name};
        if(distance<=this.epsilon){
          const normal=h.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(p.mesh.matrixWorld)).normalize();
          if(normal.dot(direction)<-1e-5)return {type:'muzzle-facing-inward',part:p.mesh.name};
        }
      }
    }
    return this.segmentBlocked(start.clone().addScaledVector(direction,radius+this.epsilon*2),end,radius);
  }
  dispose(){this.parts.forEach(p=>p.geometry.dispose());}
}

// Weld by position only for topology analysis; render geometry, normals and UVs stay untouched.
function islandProbes(g) {
  const pos=g.attributes.position, idx=g.index;
  const map=new Map(),weld=[],positions=[];
  const bounds=g.boundingBox.getSize(new THREE.Vector3()).length(),eps=Math.max(bounds*1e-7,1e-7);
  for(let i=0;i<pos.count;i++){
    const p=new THREE.Vector3().fromBufferAttribute(pos,i),key=p.toArray().map(v=>Math.round(v/eps)).join(',');
    if(!map.has(key)){map.set(key,positions.length);positions.push(p);}weld[i]=map.get(key);
  }
  const parents=positions.map((_,i)=>i),edges=new Map();
  const find=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
  for(let i=0;i<(idx?.count??pos.count);i+=3){
    const t=[0,1,2].map(j=>weld[idx?idx.getX(i+j):i+j]);
    t.forEach((a,j)=>{const b=t[(j+1)%3];parents[find(a)]=find(b);const key=a<b?`${a},${b}`:`${b},${a}`;edges.set(key,(edges.get(key)||0)+1);});
  }
  const probes=new Map();positions.forEach((p,i)=>{if(!probes.has(find(i)))probes.set(find(i),p);});
  return {probes:[...probes.values()],boundaryEdges:[...edges.values()].filter(n=>n===1).length,nonManifoldEdges:[...edges.values()].filter(n=>n>2).length};
}
