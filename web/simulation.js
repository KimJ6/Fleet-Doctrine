import * as THREE from 'three';

// Prototype values: finite symmetric battlefield, command grid, and movement tuning.
export const CONFIG = Object.freeze({ dt: 1/60, duration: 30, maxFrame: 0.25, maxSteps: 12, spacing: 4, anchorSpeed: 3, anchorAcceleration: 3, arrivalDistance: 0.04, arrivalSpeed: 0.1, shipSpeed: 5, acceleration: 4, turnRate: 1.4 });
export const COMMAND_GRID = Object.freeze({ origin: Object.freeze({x:0,y:0,z:0}), spacing: 2 });
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
const ship=(id,fleetId)=>({id,fleetId,position:vec(),velocity:vec(),rotation:new THREE.Quaternion(),hp:100,maxHp:100,alive:true,weapons:[]});
function fleet(id,team,anchor,destination,count){
  const ships=Array.from({length:count},(_,i)=>ship(`${id}-${i+1}`,id));
  const f={id,team,anchor:anchor.clone(),velocity:vec(),rotation:new THREE.Quaternion(),destination:vec(),destinationIndex:null,size:vec(8,8,8),spacingLevels:{x:'normal',y:'normal',z:'normal'},ships,arrived:false,lastHorizontal:vec(0,0,1),posture:'MOVING'};
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
export const SPACING_LEVELS = Object.freeze({ tight:4, normal:8, wide:12 });
export function sizeForSpacing(n,levels){
  const counts=dimensions(n), size=vec();
  axes.forEach((axis,i)=>{const spacing=SPACING_LEVELS[levels[axis]];if(!Number.isFinite(spacing))throw new Error('함선 간격 단계가 올바르지 않습니다.');size[axis]=Math.max(0,counts[i]-1)*spacing;});
  return size;
}
export function validateSize(n,size){const counts=dimensions(n);return axes.every((axis,i)=>Number.isFinite(size[axis])&&size[axis]>=0&&(counts[i]<=1||size[axis]/(counts[i]-1)>=CONFIG.spacing));}
export function slots(f){
  const key=[f.ships.length,f.size.x,f.size.y,f.size.z].join('|');
  if(f.slotTemplateKey!==key){f.slotTemplate=grid(f.ships.length,f.size);f.slotTemplateKey=key;}
  return f.slotTemplate.map(p=>p.clone().applyQuaternion(f.rotation).add(f.anchor));
}
export function initialState(){
  const fleets=[fleet('A','ALLY',vec(-8,0,46),vec(-8,0,0),4),fleet('B','ALLY',vec(8,0,46),vec(8,0,0),4),fleet('E','ENEMY',vec(0,0,-46),vec(0,0,0),8)];
  for(const f of fleets){const points=slots(f);f.ships.forEach((s,i)=>s.position.copy(points[i]));}return {phase:'PREPARATION',time:0,remaining:CONFIG.duration,fleets,shotEffects:[],attackEvents:[],nextAttackId:1,combatStats:{},scores:{ALLY:0,ENEMY:0},scoreTicks:0,result:null,combat:null};
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
// Capture immutable local transforms once; candidate aim evaluation never changes scene nodes.
export function captureMuzzleChain(root,weapon,muzzle){
  const nodes=[];for(let node=muzzle;node&&node!==root;node=node.parent)nodes.push(node);
  if(!nodes.length||nodes[nodes.length-1].parent!==root)throw new Error('포구가 함선 계층에 속하지 않습니다.');
  return {rootScale:root.scale.clone(),parts:nodes.reverse().map(node=>({
    position:node.position.clone(),scale:node.scale.clone(),rotation:(node===weapon.pivot?weapon.restTurret:weapon.barrels.includes(node)?weapon.restBarrels[weapon.barrels.indexOf(node)]:node.quaternion).clone(),
    rotationKind:node===weapon.pivot?'yaw':weapon.barrels.includes(node)?'pitch':null
  }))};
}
export function muzzlePoseFromData(chain,weapon,shipPosition,shipRotation,yaw=weapon.yaw,pitch=weapon.pitch){
  const axis=name=>new THREE.Vector3(name==='x'?1:0,name==='y'?1:0,name==='z'?1:0);
  const matrix=new THREE.Matrix4().compose(shipPosition,shipRotation,chain.rootScale), local=new THREE.Matrix4();
  for(const part of chain.parts){const rotation=part.rotation.clone();
    if(part.rotationKind==='yaw')rotation.multiply(new THREE.Quaternion().setFromAxisAngle(axis(weapon.settings.yawAxis),THREE.MathUtils.degToRad(yaw*(weapon.key==='D01_Hull_L'?-1:1))));
    if(part.rotationKind==='pitch')rotation.multiply(new THREE.Quaternion().setFromAxisAngle(axis(weapon.settings.pitchAxis),THREE.MathUtils.degToRad(pitch*weapon.settings.pitchSign)));
    matrix.multiply(local.compose(part.position,rotation,part.scale));
  }
  const position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();matrix.decompose(position,rotation,scale);
  return {position,direction:new THREE.Vector3(0,0,1).applyQuaternion(rotation).normalize()};
}
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
}
export function step(state,dt=CONFIG.dt){
  if(state.phase!=='RUNNING')return;
  const all=state.fleets.flatMap(f=>f.ships).filter(s=>s.alive),snapshot=new Map(all.map(s=>[s.id,s.position.clone()]));
  const movementIndex=new ShipSpatialIndex(all,snapshot);
  for(const f of state.fleets){moveAnchor(f,dt);const points=slots(f);
    f.ships.forEach((s,i)=>{
      if(!s.alive)return;
      const desired=points[i].clone().sub(snapshot.get(s.id)).multiplyScalar(1.5).clampLength(0,CONFIG.shipSpeed),avoid=vec();
      for(const other of movementIndex.near(snapshot.get(s.id),CONFIG.spacing)){if(other===s)continue;const diff=snapshot.get(s.id).clone().sub(snapshot.get(other.id)),dist=diff.length();if(dist>1e-5&&dist<CONFIG.spacing)avoid.addScaledVector(diff,(CONFIG.spacing-dist)/dist);else if(dist<=1e-5){const sign=s.id.localeCompare(other.id)<0?-1:1;avoid.x+=sign*CONFIG.spacing;}}
      desired.add(avoid.multiplyScalar(1.3)).clampLength(0,CONFIG.shipSpeed);s.velocity.add(desired.sub(s.velocity).clampLength(0,CONFIG.acceleration*dt));s.position.addScaledVector(s.velocity,dt);
      s.position.clamp(vec(BATTLEFIELD.min.x,BATTLEFIELD.min.y,BATTLEFIELD.min.z),vec(BATTLEFIELD.max.x,BATTLEFIELD.max.y,BATTLEFIELD.max.z));s.rotation.rotateTowards(f.rotation,CONFIG.turnRate*dt);
    });
  }
  combatTick(state,all,dt);
  state.time+=dt;state.remaining=Math.max(0,state.remaining-dt);if(state.phase==='RUNNING'&&state.remaining<=1e-9){state.remaining=0;state.phase='PREPARATION';}
}
export function start(state){if(state.phase!=='PREPARATION')return;if(state.remaining<=0)state.remaining=CONFIG.duration;state.phase='RUNNING';}

// Nine independent scoring volumes, separate from navigation and collision search.
export const ZONES=Object.freeze([-32,0,32].flatMap((z,row)=>[-32,0,32].map((x,col)=>({id:`Z${row*3+col+1}`,min:vec(x-12,-12,z-12),max:vec(x+12,12,z+12),multiplier:row===1?2:1}))));
export const SCORE_CONFIG=Object.freeze({tickCount:60,base:1,cap:3,victory:120});
export function zoneCounts(state,zone){const counts={ALLY:0,ENEMY:0};for(const f of state.fleets)for(const s of f.ships)if(s.alive&&s.position.x>=zone.min.x&&s.position.x<=zone.max.x&&s.position.y>=zone.min.y&&s.position.y<=zone.max.y&&s.position.z>=zone.min.z&&s.position.z<=zone.max.z)counts[f.team]++;return counts;}
export function scoreZones(state){const gains={ALLY:0,ENEMY:0};for(const zone of ZONES){const n=zoneCounts(state,zone),d=THREE.MathUtils.clamp(n.ALLY-n.ENEMY,-SCORE_CONFIG.cap,SCORE_CONFIG.cap),v=SCORE_CONFIG.base*zone.multiplier;gains.ALLY+=Math.max(d,0)*v;gains.ENEMY+=Math.max(-d,0)*v;}state.scores.ALLY+=gains.ALLY;state.scores.ENEMY+=gains.ENEMY;const a=state.scores.ALLY>=SCORE_CONFIG.victory,e=state.scores.ENEMY>=SCORE_CONFIG.victory;if(a||e){state.result=a&&e?(state.scores.ALLY===state.scores.ENEMY?'DRAW':state.scores.ALLY>state.scores.ENEMY?'ALLY':'ENEMY'):a?'ALLY':'ENEMY';state.phase='RESULT';}return gains;}
// Earliest segment / sphere hit, including initial overlap. Relative motion handles moving targets.
export function segmentSphere(start,end,center,radius){const d=end.clone().sub(start),m=start.clone().sub(center),c=m.lengthSq()-radius*radius;if(c<=0)return 0;const a=d.lengthSq();if(a<1e-12)return null;const b=m.dot(d),disc=b*b-a*c;if(disc<0)return null;const t=(-b-Math.sqrt(disc))/a;return t>=0&&t<=1?t:null;}
// HITSCAN_SNAPSHOT prototype: the rendered flash is not an authoritative projectile.
function combatTick(state,ships,dt){
  const index=new ShipSpatialIndex(ships),shots=state.combat?.(state,ships,dt,index)||[],damage=new Map();
  const teamByFleet=new Map(state.fleets.map(f=>[f.id,f.team]));
  state.shotEffects=state.shotEffects.filter(p=>(p.life-=dt)>0);
  state.attackEvents=[];
  const stats={shotCandidates:shots.length,rayCandidates:0,ownSafetyChecks:0,attackEvents:0};
  for(const shot of shots){
    if(!shot.position?.toArray().every(Number.isFinite)||!shot.direction?.toArray().every(Number.isFinite)||!Number.isFinite(shot.range)||shot.range<=0||Math.abs(shot.direction.lengthSq()-1)>1e-4)continue;
    const end=shot.position.clone().addScaledVector(shot.direction,shot.range);let first=null;
    for(const receiver of index.segment(shot.position,end,shot.radius)){
      stats.rayCandidates++;
      if(receiver.id===shot.ownerShipId)continue;
      const fraction=segmentSphere(shot.position,end,receiver.position,shot.radius+(receiver.collisionRadius??1.1));
      if(fraction!==null&&(!first||fraction<first.fraction-1e-9||(Math.abs(fraction-first.fraction)<=1e-9&&receiver.id.localeCompare(first.ship.id)<0)))first={fraction,ship:receiver};
    }
    // Friendly first contact vetoes the entire shot. No cooldown or flash is consumed.
    if(!first||teamByFleet.get(first.ship.fleetId)===shot.team)continue;
    if(shot.validate){stats.ownSafetyChecks++;if(!shot.validate())continue;}
    damage.set(first.ship,(damage.get(first.ship)||0)+shot.damage);
    shot.weapon.cooldown=2;
    const position=shot.position.clone().lerp(end,first.fraction),id=state.nextAttackId++;
    state.attackEvents.push({id,tickTime:state.time,ownerShipId:shot.ownerShipId,weaponId:shot.weapon.id,muzzleId:shot.muzzleId,receiverShipId:first.ship.id,origin:shot.position.clone(),impact:position.clone(),damage:shot.damage});
    state.shotEffects.push({id,origin:shot.position.clone(),position,life:.12});stats.attackEvents++;
  }
  state.combatStats=stats;
  // Apply after every shot has been resolved against the same live-ship snapshot.
  for(const [ship,value] of damage){ship.hp=Math.max(0,ship.hp-value);if(ship.hp===0)ship.alive=false;}
  state.scoreTicks++;if(state.scoreTicks>=SCORE_CONFIG.tickCount){state.scoreTicks-=SCORE_CONFIG.tickCount;scoreZones(state);}
}
