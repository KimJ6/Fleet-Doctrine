import { RigSafety } from '../rigging-test/rig-safety.js';
import { applyPose } from '../rigging-test/rig-control.js';

// Game-only broad phase. The reference rigging tool and its hashed analysis remain unchanged.
export class GameRigSafety extends RigSafety {
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

