// Earliest segment / sphere hit, including initial overlap. Relative motion handles moving targets.
export function segmentSphere(start,end,center,radius){const dx=end.x-start.x,dy=end.y-start.y,dz=end.z-start.z,mx=start.x-center.x,my=start.y-center.y,mz=start.z-center.z,c=mx*mx+my*my+mz*mz-radius*radius;if(c<=0)return 0;const a=dx*dx+dy*dy+dz*dz;if(a<1e-12)return null;const b=mx*dx+my*dy+mz*dz,disc=b*b-a*c;if(disc<0)return null;const t=(-b-Math.sqrt(disc))/a;return t>=0&&t<=1?t:null;}
// Compare-only A0/D are retained; A1 is the default. Sort actual hits by ID to preserve A0's tolerance rule.
export function findFirstContact(index,shot,end,algorithm,stats){
  const candidates=algorithm==='A0'?index.segment(shot.position,end,shot.radius):algorithm==='D'?index.segmentDDA(shot.position,end,shot.radius):index.segmentUnsorted(shot.position,end,shot.radius);
  let first=null;const hits=algorithm==='A0'?null:[];
  for(const receiver of candidates){
    stats.rayCandidates++;if(receiver.id===shot.ownerShipId)continue;
    const fraction=segmentSphere(shot.position,end,receiver.position,shot.radius+(receiver.collisionRadius??1.1));
    if(fraction===null)continue;
    const hit={fraction,ship:receiver};if(hits)hits.push(hit);else if(!first||fraction<first.fraction-1e-9||(Math.abs(fraction-first.fraction)<=1e-9&&receiver.id.localeCompare(first.ship.id)<0))first=hit;
  }
  if(hits){if(hits.length>1)hits.sort((a,b)=>a.ship.id.localeCompare(b.ship.id));for(const hit of hits)if(!first||hit.fraction<first.fraction-1e-9||(Math.abs(hit.fraction-first.fraction)<=1e-9&&hit.ship.id.localeCompare(first.ship.id)<0))first=hit;}
  return first;
}
