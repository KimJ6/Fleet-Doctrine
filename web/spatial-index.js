// Spatial cells are independent of both the command grid and scoring zones.
// Register the entire collision bound, including cells at negative coordinates.
export class ShipSpatialIndex {
  constructor(ships, positions, cellSize=8, radius=1.1){
    this.cells=new Map();this.cellSize=cellSize;this.radius=radius;
    for(const ship of ships){const p=positions?.get(ship.id)||ship.position,r=ship.collisionRadius??radius;if(!Number.isFinite(r)||r<=0)throw new Error("함선 피격 반경이 올바르지 않습니다.");this.visit(p.x-r,p.y-r,p.z-r,p.x+r,p.y+r,p.z+r,key=>{
      let cell=this.cells.get(key);if(!cell)this.cells.set(key,cell=[]);cell.push(ship);
    });}
  }
  visit(minX,minY,minZ,maxX,maxY,maxZ,fn){const n=this.cellSize;
    for(let x=Math.floor(minX/n);x<=Math.floor(maxX/n);x++)for(let y=Math.floor(minY/n);y<=Math.floor(maxY/n);y++)for(let z=Math.floor(minZ/n);z<=Math.floor(maxZ/n);z++)fn(x+','+y+','+z);
  }
  query(min,max){const found=new Map();this.visit(min.x,min.y,min.z,max.x,max.y,max.z,key=>{for(const s of this.cells.get(key)||[])found.set(s.id,s);});return [...found.values()].sort((a,b)=>a.id.localeCompare(b.id));}
  near(p,distance){return this.query({x:p.x-distance,y:p.y-distance,z:p.z-distance},{x:p.x+distance,y:p.y+distance,z:p.z+distance});}
  segment(start,end,radius){return this.query({x:Math.min(start.x,end.x)-radius,y:Math.min(start.y,end.y)-radius,z:Math.min(start.z,end.z)-radius},{x:Math.max(start.x,end.x)+radius,y:Math.max(start.y,end.y)+radius,z:Math.max(start.z,end.z)+radius});}
  // A1 keeps the AABB candidate set but does not sort all candidates.
  segmentUnsorted(start,end,radius){const found=new Map();this.visit(Math.min(start.x,end.x)-radius,Math.min(start.y,end.y)-radius,Math.min(start.z,end.z)-radius,Math.max(start.x,end.x)+radius,Math.max(start.y,end.y)+radius,Math.max(start.z,end.z)+radius,key=>{for(const ship of this.cells.get(key)||[])found.set(ship.id,ship);});return [...found.values()];}
  // D-noearly: traverse centerline cells and a conservative radius halo.
  segmentDDA(start,end,radius){
    if(!Number.isFinite(radius)||radius<0||!start.toArray().every(Number.isFinite)||!end.toArray().every(Number.isFinite))return this.segmentUnsorted(start,end,radius);
    const h=this.cellSize,halo=Math.floor(radius/h)+1,origin=[start.x,start.y,start.z],delta=[end.x-start.x,end.y-start.y,end.z-start.z],cell=origin.map(v=>Math.floor(v/h)),last=[end.x,end.y,end.z].map(v=>Math.floor(v/h));
    const step=delta.map(v=>Math.sign(v)),next=delta.map((v,i)=>v===0?Infinity:((cell[i]+(v>0?1:0))*h-origin[i])/v),stride=delta.map(v=>v===0?Infinity:h/Math.abs(v)),seenCells=new Set(),found=new Map();
    const remaining=Math.abs(last[0]-cell[0])+Math.abs(last[1]-cell[1])+Math.abs(last[2]-cell[2])+4;
    for(let iteration=0;iteration<remaining;iteration++){
      for(let x=-halo;x<=halo;x++)for(let y=-halo;y<=halo;y++)for(let z=-halo;z<=halo;z++){
        const key=(cell[0]+x)+','+(cell[1]+y)+','+(cell[2]+z);if(seenCells.has(key))continue;seenCells.add(key);for(const ship of this.cells.get(key)||[])found.set(ship.id,ship);
      }
      if(cell.every((v,i)=>v===last[i]))break;
      const t=Math.min(...next);if(!Number.isFinite(t)||t>1+1e-12)break;
      for(let axis=0;axis<3;axis++)if(next[axis]<=t+1e-12){cell[axis]+=step[axis];next[axis]+=stride[axis];}
    }
    return [...found.values()];
  }
}
