import * as THREE from 'three';

// Prototype values: finite symmetric battlefield, command grid, and movement tuning.
export const CONFIG = Object.freeze({ dt: 1/60, duration: 30, maxFrame: 0.25, maxSteps: 12, spacing: 4, anchorSpeed: 3, anchorAcceleration: 3, arrivalDistance: 0.04, arrivalSpeed: 0.1, shipSpeed: 5, acceleration: 4, turnRate: 1.4 });
export const COMMAND_GRID = Object.freeze({ origin: Object.freeze({x:0,y:0,z:0}), spacing: 1 });
export const BATTLEFIELD = Object.freeze({ min: Object.freeze({x:-60,y:-60,z:-60}), max: Object.freeze({x:60,y:60,z:60}) });
const vec=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const axes=['x','y','z'];
export function gridToWorld(point, grid=COMMAND_GRID){
  if(!grid || !Number.isFinite(grid.spacing) || grid.spacing<=0 || !axes.every(a=>Number.isFinite(grid.origin[a])))throw new Error('격자 설정이 올바르지 않습니다.');
  if(!point || !['ix','iy','iz'].every(k=>Number.isSafeInteger(point[k])))throw new Error('격자 좌표는 안전한 정수여야 합니다.');
  const p=vec(grid.origin.x+point.ix*grid.spacing,grid.origin.y+point.iy*grid.spacing,grid.origin.z+point.iz*grid.spacing);
  if(!p.toArray().every(Number.isFinite))throw new Error('월드 좌표가 유효하지 않습니다.');return p;
}
export function worldToNearestGrid(position,grid=COMMAND_GRID){
  if(!position || !axes.every(a=>Number.isFinite(position[a])) || !grid || !Number.isFinite(grid.spacing) || grid.spacing<=0 || !axes.every(a=>Number.isFinite(grid.origin[a])))throw new Error('좌표 또는 격자 설정이 유효하지 않습니다.');
  const round=value=>Math.sign(value)*Math.floor(Math.abs(value)+0.5);
  const point={ix:round((position.x-grid.origin.x)/grid.spacing),iy:round((position.y-grid.origin.y)/grid.spacing),iz:round((position.z-grid.origin.z)/grid.spacing)};
  gridToWorld(point,grid);return point;
}
export function insideBattlefield(p,bounds=BATTLEFIELD){return !!p && axes.every(a=>Number.isFinite(p[a]) && Number.isFinite(bounds.min[a]) && Number.isFinite(bounds.max[a]) && bounds.min[a]<=bounds.max[a] && p[a]>=bounds.min[a] && p[a]<=bounds.max[a]);}
export function setDestination(f,point){const world=gridToWorld(point);if(!insideBattlefield(world))throw new Error('전장 경계 밖의 목표는 지정할 수 없습니다.');f.destinationIndex={...point};f.destination.copy(world);f.arrived=false;}
const ship=(id,fleetId)=>({id,fleetId,position:vec(),velocity:vec(),rotation:new THREE.Quaternion()});
function fleet(id,team,anchor,destination,count){
  const ships=Array.from({length:count},(_,i)=>ship(`${id}-${i+1}`,id));
  const f={id,team,anchor:anchor.clone(),velocity:vec(),rotation:new THREE.Quaternion(),destination:vec(),destinationIndex:null,size:vec(8,8,8),ships,arrived:false,lastHorizontal:vec(0,0,1),posture:'MOVING'};
  setDestination(f,worldToNearestGrid(destination));return f;
}
export function dimensions(n){
  if(n<1)return [0,0,0];let best,score=Infinity;
  for(let x=1;x<=n;x++)for(let y=1;y<=n;y++)for(let z=1;z<=n;z++){
    if(x*y*z<n)continue;const value=(x*y*z-n)*4+(Math.max(x,y,z)-Math.min(x,y,z))*2+(x<y?0.01:0)+(y<z?0.01:0);if(value<score){score=value;best=[x,y,z];}
  }return best;
}
export function grid(n,size){
  const [nx,ny,nz]=dimensions(n);if(!nx)return [];const offsets=[];
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const coord=(i,count,extent)=>count===1?0:(i/(count-1)-0.5)*extent;
    offsets.push(vec(coord(x,nx,size.x),coord(y,ny,size.y),coord(z,nz,size.z)));
  }
  const chosen=offsets.slice(0,n);const box=new THREE.Box3().setFromPoints(chosen);const center=box.getCenter(vec());return chosen.map(p=>p.sub(center));
}
export function validateSize(n,size){const counts=dimensions(n);return axes.every((axis,i)=>Number.isFinite(size[axis])&&size[axis]>=0&&(counts[i]<=1||size[axis]/(counts[i]-1)>=CONFIG.spacing));}
export function slots(f){return grid(f.ships.length,f.size).map(p=>p.applyQuaternion(f.rotation).add(f.anchor));}
export function initialState(){
  const fleets=[fleet('A','ALLY',vec(-15,0,-4),vec(10,8,8),8),fleet('B','ALLY',vec(-15,0,15),vec(10,-5,22),8),fleet('E','ENEMY',vec(20,0,0),vec(20,0,0),4)];
  for(const f of fleets){const points=slots(f);f.ships.forEach((s,i)=>s.position.copy(points[i]));}return {phase:'PREPARATION',time:0,remaining:CONFIG.duration,fleets};
}
function facing(forward,up){const right=up.clone().cross(forward).normalize();return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,forward.clone().cross(right).normalize(),forward));}
function updateOrientation(f,direction,dt){
  if(direction.lengthSq()<1e-10)return;const forward=direction.clone().normalize(),flat=vec(forward.x,0,forward.z);
  if(flat.lengthSq()>1e-8)f.lastHorizontal.copy(flat.normalize());
  let up=vec(0,1,0).applyQuaternion(f.rotation);up.addScaledVector(forward,-up.dot(forward));
  if(up.lengthSq()<1e-8){up=f.lastHorizontal.clone();up.addScaledVector(forward,-up.dot(forward));if(up.lengthSq()<1e-8){up=vec(1,0,0);up.addScaledVector(forward,-up.dot(forward));}}
  f.rotation.rotateTowards(facing(forward,up.normalize()),CONFIG.turnRate*dt);
}
function moveAnchor(f,dt){
  const delta=f.destination.clone().sub(f.anchor),dist=delta.length(),speed=f.velocity.length();
  if(dist<=CONFIG.arrivalDistance && speed<=CONFIG.arrivalSpeed){f.velocity.set(0,0,0);f.arrived=true;f.posture='IDLE';const q=facing(f.lastHorizontal.clone(),vec(0,1,0));f.rotation.rotateTowards(q,CONFIG.turnRate*dt);return;}
  f.arrived=false;f.posture='MOVING';if(dist>1e-8)updateOrientation(f,delta,dt);
  const desired=dist>1e-8?delta.clone().multiplyScalar(Math.min(CONFIG.anchorSpeed,Math.sqrt(2*CONFIG.anchorAcceleration*dist))/dist):vec();
  f.velocity.add(desired.sub(f.velocity).clampLength(0,CONFIG.anchorAcceleration*dt));
  const travel=f.velocity.clone().multiplyScalar(dt);
  // Clamp only the final segment when it reaches the target; velocity still decelerates.
  if(dist>1e-8 && travel.dot(delta)>0 && travel.length()>=dist && travel.clone().cross(delta).length()<1e-7){f.anchor.copy(f.destination);f.velocity.set(0,0,0);}else f.anchor.add(travel);
  f.anchor.clamp(vec(BATTLEFIELD.min.x,BATTLEFIELD.min.y,BATTLEFIELD.min.z),vec(BATTLEFIELD.max.x,BATTLEFIELD.max.y,BATTLEFIELD.max.z));
}
export function step(state,dt=CONFIG.dt){
  if(state.phase!=='RUNNING')return;
  const all=state.fleets.flatMap(f=>f.ships),snapshot=new Map(all.map(s=>[s.id,s.position.clone()]));
  for(const f of state.fleets){moveAnchor(f,dt);const points=slots(f);
    f.ships.forEach((s,i)=>{
      const desired=points[i].clone().sub(snapshot.get(s.id)).multiplyScalar(1.5).clampLength(0,CONFIG.shipSpeed),avoid=vec();
      for(const other of all){if(other===s)continue;const diff=snapshot.get(s.id).clone().sub(snapshot.get(other.id)),dist=diff.length();if(dist>1e-5&&dist<CONFIG.spacing)avoid.addScaledVector(diff,(CONFIG.spacing-dist)/dist);else if(dist<=1e-5){const sign=s.id.localeCompare(other.id)<0?-1:1;avoid.x+=sign*CONFIG.spacing;}}
      desired.add(avoid.multiplyScalar(1.3)).clampLength(0,CONFIG.shipSpeed);s.velocity.add(desired.sub(s.velocity).clampLength(0,CONFIG.acceleration*dt));s.position.addScaledVector(s.velocity,dt);
      s.position.clamp(vec(BATTLEFIELD.min.x,BATTLEFIELD.min.y,BATTLEFIELD.min.z),vec(BATTLEFIELD.max.x,BATTLEFIELD.max.y,BATTLEFIELD.max.z));s.rotation.rotateTowards(f.rotation,CONFIG.turnRate*dt);
    });
  }
  state.time+=dt;state.remaining=Math.max(0,state.remaining-dt);if(state.remaining<=1e-9){state.remaining=0;state.phase='PREPARATION';}
}
export function start(state){if(state.phase!=='PREPARATION')return;state.remaining=CONFIG.duration;state.phase='RUNNING';}
