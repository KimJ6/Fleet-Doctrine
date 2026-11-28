import * as THREE from 'three';
import { RigSafety } from '../rigging-test/rig-safety.js';
import { applyPose } from '../rigging-test/rig-control.js';

// Enclose each rigid part for every turret and barrel rotation. Restrict this
// optimization to similarity transforms; unsupported hierarchies keep all pairs.
function motionBounds(root, weapons, parts) {
  const owners = new Map(), bounds = new Map();
  for (const w of weapons) if (w.pivot) {
    owners.set(w.pivot, w);
    for (const barrel of w.barrels) owners.set(barrel, w);
  }
  function similarity(object) {
    const e = object.matrixWorld.elements;
    const x = new THREE.Vector3(e[0], e[1], e[2]);
    const y = new THREE.Vector3(e[4], e[5], e[6]);
    const z = new THREE.Vector3(e[8], e[9], e[10]);
    const scale = Math.max(x.length(), y.length(), z.length());
    return Number.isFinite(scale) && scale > 1e-12 &&
      Math.abs(x.length() - y.length()) < scale * 1e-5 &&
      Math.abs(x.length() - z.length()) < scale * 1e-5 &&
      Math.abs(x.dot(y)) < scale * scale * 1e-5 &&
      Math.abs(x.dot(z)) < scale * scale * 1e-5 &&
      Math.abs(y.dot(z)) < scale * scale * 1e-5;
  }
  for (const part of parts) {
    const w = owners.get(part.owner);
    if (!w || !part.owner.matrixAutoUpdate || !w.pivot.matrixAutoUpdate) continue;
    let object = part.mesh, valid = true, foundOwner = false, foundTurret = false;
    while (object) {
      if (!similarity(object)) { valid = false; break; }
      if (object === part.owner) foundOwner = true;
      if (object === w.pivot) foundTurret = true;
      if (object === root) break;
      object = object.parent;
    }
    if (!valid || object !== root || !foundOwner || !foundTurret) continue;
    // Reject unexpected nested movable pivots, whose motion is not represented.
    for (let p = part.mesh.parent; p && p !== w.pivot; p = p.parent) {
      if (owners.has(p) && p !== part.owner) { valid = false; break; }
    }
    const box = part.geometry.boundingBox;
    if (!valid || !box || box.isEmpty()) continue;
    const center = w.pivot.getWorldPosition(new THREE.Vector3());
    const hinge = part.owner.getWorldPosition(new THREE.Vector3());
    let radius = 0;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const point = new THREE.Vector3(x, y, z).applyMatrix4(part.mesh.matrixWorld);
      radius = Math.max(radius, point.distanceTo(hinge));
    }
    radius += hinge.distanceTo(center);
    if (Number.isFinite(radius)) bounds.set(part, { weapon: w, center, radius });
  }
  return bounds;
}

// These are the exact part pairs observed at the user-confirmed LC01 zero pose.
// Each region remains a derived draft, not a separately approved joint or a
// reason to exempt the entire pair from collision or firing checks.
const LC01_NEUTRAL_CONTACT_POLICY = {
  assetHash:'67f5476437ffb212f1889dc7ba27210f79084d9320b9a3687917376c13b694f6',
  pairs:[
    ['Turret_Center','Barrel_Center_L','PIVOT_Barrel_LC01_W03_B01'],
    ['Turret_Center','Barrel_Center_R','PIVOT_Barrel_LC01_W03_B02'],
    ['Turret_Center','Hull','PIVOT_Turret_LC01_W03'],
    ['Turret_Side_L','Hull','PIVOT_Turret_LC01_W01'],
    ['Turret_Side_R','Hull','PIVOT_Turret_LC01_W02'],
    ['Barrel_Aft_R','Turret_Aft_R','PIVOT_Barrel_LC01_W05_B01'],
    ['Barrel_Aft_R','Hull','PIVOT_Barrel_LC01_W05_B01'],
    ['Turret_Aft_R','Hull','PIVOT_Turret_LC01_W05'],
    ['Turret_Aft_L','Barrel_Aft_L','PIVOT_Barrel_LC01_W04_B01'],
    ['Turret_Aft_L','Hull','PIVOT_Turret_LC01_W04'],
    ['Barrel_Aft_L','Hull','PIVOT_Barrel_LC01_W04_B01']
  ]
};

// Game-only broad phase. The reference rigging tool and its hashed analysis remain unchanged.
export class GameRigSafety extends RigSafety {
  constructor(root,weapons,options){
    super(root,weapons,options);
    this.assetHash=options?.assetHash ?? null;
    this.neutralJointData=[];
    this.fixedPairs=[];this.dynamicPairs=[];this.ownerIds=new Map();this.pairCache=new Map();
    for(const part of this.parts)if(!this.ownerIds.has(part.owner))this.ownerIds.set(part.owner,this.ownerIds.size);
    const bounds = options?.filterMotionCandidates ? motionBounds(root, weapons, this.parts) : new Map();
    this.motionExcludedPairs = 0;
    this.allDynamicPairs = [];
    for(let i=0;i<this.parts.length;i++)for(let j=i+1;j<this.parts.length;j++){
      const a=this.parts[i],b=this.parts[j];if(a.owner===b.owner)continue;
      if (a.owner && b.owner) this.allDynamicPairs.push([a,b]);
      const x = bounds.get(a), y = bounds.get(b);
      // sqrt(3) also guarantees world-axis AABBs cannot overlap under any
      // ship rotation, preserving the game's existing AABB-based guard.
      if (x && y && x.weapon !== y.weapon &&
          x.center.distanceTo(y.center) > Math.sqrt(3) * (x.radius + y.radius) + this.size * 1e-5) {
        this.motionExcludedPairs++; continue;
      }
      (a.owner&&b.owner?this.dynamicPairs:this.fixedPairs).push([a,b]);
    }
    // Node topology and non-animated transforms define the proof. If any of
    // them change, restore all candidates instead of reusing stale bounds.
    const movable = new Set(weapons.flatMap(w => [w.pivot, ...w.barrels]).filter(Boolean));
    const nodes = new Set();
    for (const part of this.parts) for (let o=part.mesh; o; o=o.parent) { nodes.add(o); if (o===root) break; }
    this.motionInvariant = this.motionExcludedPairs ? [...nodes].map(o => ({
      node:o, parent:o===root ? null : o.parent, position:o===root ? null : o.position.toArray(),
      scale:o.scale.toArray(), quaternion:o===root || movable.has(o) ? null : o.quaternion.toArray(),
      matrixAutoUpdate:o.matrixAutoUpdate,
      matrix:o.matrixAutoUpdate || o===root || movable.has(o) ? null : o.matrix.elements.slice(),
      geometry:o.isMesh ? o.geometry : null,
      positionVersion:o.isMesh ? o.geometry?.attributes.position?.version : null,
      indexVersion:o.isMesh ? o.geometry?.index?.version : null
    })) : null;
  }
  captureConfirmedNeutralContacts() {
    const count=super.captureConfirmedNeutralContacts();
    this.neutralJointData=[];
    if(this.assetHash!==LC01_NEUTRAL_CONTACT_POLICY.assetHash)return count;
    const byId=new Map(this.parts.map(part=>[part.mesh.uuid,part]));
    for(const [key,contact] of this.neutralContacts){
      const [a,b]=key.split('|').map(id=>byId.get(id));
      if(!a||!b)continue;
      const definition=LC01_NEUTRAL_CONTACT_POLICY.pairs.find(([first,second,pivot])=>
        pivot===contact.pivot.name&&((a.mesh.name===first&&b.mesh.name===second)||(a.mesh.name===second&&b.mesh.name===first)));
      if(!definition)continue;
      const weapon=this.weapons.find(w=>w.pivot===contact.pivot||w.barrels.includes(contact.pivot));
      this.neutralJointData.push({
        assetHash:this.assetHash, parts:[a.mesh.name,b.mesh.name], pivot:contact.pivot.name,
        region:{kind:'pivot-sphere',radius:contact.radius,units:'scene-world-at-capture'},
        poseConfirmed:'all-joints-zero', status:'derived-candidate', individualReview:'pending',
        treatment:'existing-neutral-contact-draft',
        movement:weapon?{weapon:weapon.key,yaw:[...weapon.settings.yaw],pitch:[...weapon.settings.pitch],
          yawAxis:weapon.settings.yawAxis,pitchAxis:weapon.settings.pitchAxis,pitchSign:weapon.settings.pitchSign}:null
      });
    }
    return count;
  }
  ensureMotionCandidates() {
    if (!this.motionInvariant) return;
    this.root.updateWorldMatrix(true,false);
    const e=this.root.matrixWorld.elements;
    const lx=Math.hypot(e[0],e[1],e[2]),ly=Math.hypot(e[4],e[5],e[6]),lz=Math.hypot(e[8],e[9],e[10]),scale=Math.max(lx,ly,lz);
    let valid=Number.isFinite(scale)&&scale>1e-12&&Math.abs(lx-ly)<scale*1e-5&&Math.abs(lx-lz)<scale*1e-5&&
      Math.abs(e[0]*e[4]+e[1]*e[5]+e[2]*e[6])+Math.abs(e[0]*e[8]+e[1]*e[9]+e[2]*e[10])+Math.abs(e[4]*e[8]+e[5]*e[9]+e[6]*e[10])<scale*scale*1e-5;
    for(const v of this.motionInvariant) {
      const o=v.node,p=o.position,q=o.quaternion,t=o.scale,m=o.matrix.elements;
      if ((o!==this.root&&o.parent!==v.parent)||
        (v.position&&(p.x!==v.position[0]||p.y!==v.position[1]||p.z!==v.position[2]))||
        t.x!==v.scale[0]||t.y!==v.scale[1]||t.z!==v.scale[2]||
        (v.quaternion&&(q.x!==v.quaternion[0]||q.y!==v.quaternion[1]||q.z!==v.quaternion[2]||q.w!==v.quaternion[3]))||
        o.matrixAutoUpdate!==v.matrixAutoUpdate||
        (v.matrix&&v.matrix.some((value,i)=>m[i]!==value))||
        (v.geometry&&(o.geometry!==v.geometry||o.geometry.attributes.position?.version!==v.positionVersion||o.geometry.index?.version!==v.indexVersion))) {valid=false;break;}
    }
    if(!valid){this.dynamicPairs=this.allDynamicPairs;this.motionExcludedPairs=0;this.motionInvariant=null;this.pairCache.clear();this.precomputed=null;}
  }
  poseCollision(activeOwners=null,{fixedOnly=false,dynamicOnly=false}={}){
    this.ensureMotionCandidates();
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

// Approximate visual movement guard. AABB overlap is not an exact collision test.
// Muzzle and projectile safety continue to use the separate mesh checks.
function boxOverlapFraction(a,b){
  const x=Math.max(0,Math.min(a.max.x,b.max.x)-Math.max(a.min.x,b.min.x));
  const y=Math.max(0,Math.min(a.max.y,b.max.y)-Math.max(a.min.y,b.min.y));
  const z=Math.max(0,Math.min(a.max.z,b.max.z)-Math.max(a.min.z,b.min.z));
  const volume=box=>Math.max(0,box.max.x-box.min.x)*Math.max(0,box.max.y-box.min.y)*Math.max(0,box.max.z-box.min.z);
  const smaller=Math.min(volume(a),volume(b));return smaller>1e-15?x*y*z/smaller:0;
}
export function approximateMoveBatch(rig,proposals){
  if(!proposals.length)return;
  const safety=rig.safety;safety.ensureMotionCandidates();
  if(!safety.motionInvariant)return legacyApproximateMoveBatch(rig,proposals);
  const pending=new Set(proposals),components=[];
  while(pending.size){
    const component=[pending.values().next().value];pending.delete(component[0]);let changed=true;
    while(changed){changed=false;const owners=new Set(component.flatMap(p=>[p.weapon.pivot,...p.weapon.barrels]));
      for(const proposal of pending){const parts=new Set([proposal.weapon.pivot,...proposal.weapon.barrels]);
        if(safety.dynamicPairs.some(([a,b])=>(owners.has(a.owner)&&parts.has(b.owner))||(owners.has(b.owner)&&parts.has(a.owner)))){
          component.push(proposal);pending.delete(proposal);changed=true;
        }
      }
    }
    const active=new Set(component.flatMap(p=>[p.weapon.pivot,...p.weapon.barrels]));
    components.push({proposals:component,pairs:[...safety.fixedPairs,...safety.dynamicPairs].filter(([a,b])=>active.has(a.owner)||active.has(b.owner))});
  }
  const original=proposals.map(({weapon:w})=>({w,yaw:w.yaw,pitch:w.pitch}));
  safety.update();
  for(const component of components)component.before=component.pairs.map(([a,b])=>boxOverlapFraction(a.box,b.box));
  try{
    for(const p of proposals){p.weapon.yaw=p.yaw;p.weapon.pitch=p.pitch;applyPose(p.weapon);}
    safety.update();
    for(const component of components){
      const blocked=component.pairs.some(([a,b],i)=>{const next=boxOverlapFraction(a.box,b.box);return next>0.65&&next>component.before[i]+0.20;});
      if(blocked)for(const proposal of component.proposals){const old=original.find(x=>x.w===proposal.weapon);old.w.yaw=old.yaw;old.w.pitch=old.pitch;applyPose(old.w);}
    }
  }catch(error){for(const x of original){x.w.yaw=x.yaw;x.w.pitch=x.pitch;applyPose(x.w);}throw error;}
}

// Original game behavior remains the default until performance is demonstrated.
function legacyApproximateMoveBatch(rig,proposals){
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

