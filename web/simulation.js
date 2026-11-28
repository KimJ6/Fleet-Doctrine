import * as THREE from 'three';
import { ShipSpatialIndex } from './spatial-index.js?v=refactor-20261127c';
export { ShipSpatialIndex };
import { segmentSphere, findFirstContact } from './hit-resolution.js?v=refactor-20261127c';
export { segmentSphere };
import { ZONES, SCORE_CONFIG, zoneCounts, scoreZones } from './scoring.js?v=refactor-20261127c';
export { ZONES, SCORE_CONFIG, zoneCounts, scoreZones };
import { createEconomy } from './economy.js?v=refactor-20261127c';

// Prototype values: finite symmetric battlefield, command grid, and movement tuning.
export const CONFIG = Object.freeze({ dt: 1/60, duration: 30, maxFrame: 0.25, maxSteps: 12, spacing: 4, weaponRange: 45, arrivalDistance: 0.04, arrivalSpeed: 0.1, shipSpeed: 5, acceleration: 4, turnRate: 1.4 });
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
export const PATROL_MAX_POINTS=32;
export const ENCOUNTER_CONFIG=Object.freeze({enter:38,exit:48,grace:2,minRange:24,maxRange:24,scanTicks:12});
function resetEncounter(f,{reason='',retryAt=0}={}){
  const e=f.encounter;Object.assign(e,{active:false,enemyId:null,policy:null,revision:f.tactics.revision,anchorRevision:f.tactics.anchorRevision,outside:0,defensePoint:null,defenseSource:null,defenseRotation:null,arrived:false,mode:'HOLD',target:null,face:null,breakthrough:null,lineEngaged:false,lineOffsets:null,contactLost:false,threatEntered:false,defenseBestError:Infinity,defenseBestHeadingError:Infinity,defenseStallTime:0,defenseReadyTime:0,defenseRosterKey:null,reason,retryAt});
  f.safetyStop=false;f.pathBlockId=null;
}
function resetColumnRoute(f){f.columnGoal=null;f.columnGoalKey=null;f.columnMode=null;}
export function setCombatPolicy(f,policy){
  if(!['COLUMN','LINE','POINT_DEFENSE','BREAKTHROUGH'].includes(policy))throw Error('교전 대응이 올바르지 않습니다.');
  if(f.tactics.policy!==policy){f.tactics.policy=policy;f.tactics.revision++;f.size.copy(sizeForSpacing(f.ships.length,f.spacingLevels,policy));resetEncounter(f);resetColumnRoute(f);f.columnPath=null;}
}
export function setDefenseAnchor(f,point){if(point!==null)validPoint(point);const next=point?copyPoint(point):null;if(JSON.stringify(f.tactics.defenseAnchor)!==JSON.stringify(next)){f.tactics.defenseAnchor=next;f.tactics.anchorRevision++;}}
const copyPoint=p=>({ix:p.ix,iy:p.iy,iz:p.iz});
const pointKey=p=>p.ix+','+p.iy+','+p.iz;
function validPoint(point){const world=gridToWorld(point);if(!insideBattlefield(world))throw new Error('전장 경계 밖의 목표는 지정할 수 없습니다.');return world;}
function refreshMovementTarget(f){const order=f.movement,point=order.policy==='PATROL'?order.patrolPoints[order.activeIndex]:order.movePoint;if(!point)throw Error('이동 목표가 없습니다.');f.destinationIndex=copyPoint(point);f.destination.copy(validPoint(point));}
export function setDestination(f,point){validPoint(point);f.movement.movePoint=copyPoint(point);if(f.movement.policy==='MOVE'){refreshMovementTarget(f);f.arrived=false;resetColumnRoute(f);}}
export function setMovementPolicy(f,policy){if(!['MOVE','PATROL'].includes(policy))throw Error('이동 명령이 올바르지 않습니다.');if(policy==='PATROL'&&new Set(f.movement.patrolPoints.map(pointKey)).size<2)throw Error('서로 다른 경유점 두 개 이상이 필요합니다.');if(f.movement.policy===policy)return;f.movement.policy=policy;refreshMovementTarget(f);f.arrived=false;resetColumnRoute(f);}
export function setPatrolRoute(f,points){if(!Array.isArray(points)||points.length<2||points.length>PATROL_MAX_POINTS)throw Error('경유점은 2개 이상 32개 이하이어야 합니다.');const copy=points.map(p=>{validPoint(p);return copyPoint(p)});if(new Set(copy.map(pointKey)).size<2)throw Error('서로 다른 경유점 두 개 이상이 필요합니다.');const order=f.movement;if(JSON.stringify(order.patrolPoints)===JSON.stringify(copy))return false;order.patrolPoints=copy;order.revision++;order.activeIndex=0;if(order.policy==='PATROL'){refreshMovementTarget(f);f.arrived=false;resetColumnRoute(f);}return true;}
function advancePatrol(f){const order=f.movement;if(order.policy!=='PATROL')return;const points=order.patrolPoints;if(points.length<2)return;const tolerance=f.tactics.policy==='COLUMN'?.8:CONFIG.arrivalDistance;let checked=0;while(checked<points.length&&(f.anchor.distanceTo(f.destination)<=tolerance||(f.previousAnchor&&new THREE.Line3(f.previousAnchor,f.anchor).closestPointToPoint(f.destination,true,vec()).distanceTo(f.destination)<=tolerance))){order.activeIndex=(order.activeIndex+1)%points.length;refreshMovementTarget(f);checked++;}if(checked){f.arrived=false;resetColumnRoute(f);}}

let balanceConfig=null;
export function configureBalance(balance){balanceConfig=balance;Object.assign(SCORE_CONFIG,{tickCount:balance.rules.score_interval_sec/CONFIG.dt,base:balance.rules.score_base,cap:balance.rules.score_advantage_cap,victory:balance.rules.victory_score});Object.assign(ECONOMY_CONFIG,{price:balance.ship.price});for(const z of ZONES)z.multiplier=z.id.startsWith('Z4')||z.id==='Z5'||z.id==='Z6'?balance.rules.center_zone_multiplier:balance.rules.side_zone_multiplier;}
export const ship=(id,fleetId,shipType='LC01')=>{const spec=balanceConfig?.shipSpecs?.get(shipType)??(shipType==='LC01'?balanceConfig?.ship:null);if(balanceConfig&&!spec)throw Error('함선 기동 설정을 찾을 수 없습니다: '+shipType);return {id,fleetId,shipType,position:vec(),velocity:vec(),rotation:new THREE.Quaternion(),hp:spec?.max_hp??1000,maxHp:spec?.max_hp??1000,shield:spec?.max_shield??0,maxShield:spec?.max_shield??0,forwardSpeed:spec?.forward_speed??CONFIG.shipSpeed,maneuver:spec?.maneuver??null,propulsionForward:0,propulsionVertical:0,alive:true,weapons:[]};};
function fleet(id,team,anchor,destination,count){
  const ships=Array.from({length:count},(_,i)=>ship(`${id}-${i+1}`,id));
  const f={id,team,anchor:anchor.clone(),velocity:vec(),rotation:new THREE.Quaternion(),destination:vec(),destinationIndex:null,movement:{policy:'MOVE',movePoint:null,patrolPoints:[],revision:0,activeIndex:0},tactics:{policy:'COLUMN',revision:0,defenseAnchor:null,anchorRevision:0},encounter:{active:false,enemyId:null,policy:null,revision:0,anchorRevision:0,outside:0,defensePoint:null,defenseSource:null,arrived:false,mode:'HOLD'},size:vec(8,8,8),spacingLevels:{x:'normal',y:'normal',z:'normal'},ships,arrived:false,lastHorizontal:vec(0,0,1),posture:'MOVING',pathBlockId:null};
  f.size.copy(sizeForSpacing(count,f.spacingLevels,'COLUMN'));setDestination(f,worldToNearestGrid(destination));return f;
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
export const FORMATION_CONFIG=Object.freeze({compactRatio:.7,minColumnRanks:4,minAspect:2.5});
export function effectiveSpacing(level,policy){const value=SPACING_LEVELS[level];if(!Number.isFinite(value))throw Error('함선 간격 단계가 올바르지 않습니다.');return value*(['BREAKTHROUGH','POINT_DEFENSE'].includes(policy)?FORMATION_CONFIG.compactRatio:1);}
export function columnDimensions(n,levels){const gx=SPACING_LEVELS[levels.x],gy=SPACING_LEVELS[levels.y],gz=SPACING_LEVELS[levels.z];let x=1,y=1,best=[1,1];while(true){if(x===y)y++;else x++;const c=x*y;if(c>Math.floor(n/FORMATION_CONFIG.minColumnRanks))break;const ranks=Math.floor(n/c),width=(x-1)*gx,height=(y-1)*gy,length=(ranks-1)*gz;if(length>=FORMATION_CONFIG.minAspect*Math.max(width,height))best=[x,y];}return best;}
function columnLayout(f){
  const key=[f.tactics.revision,f.spacingLevels.x,f.spacingLevels.y,f.spacingLevels.z,...f.ships.map(s=>s.id+':'+(s.collisionRadius??1.1))].join('|');
  if(f.columnLayout?.key!==key){
    const alive=f.ships.filter(s=>s.alive),[x,y]=columnDimensions(alive.length,f.spacingLevels),cells=[];
    for(let iy=0;iy<y;iy++)for(let ix=0;ix<x;ix++)cells.push({ix,iy,x:(ix-(x-1)/2)*SPACING_LEVELS[f.spacingLevels.x],y:(iy-(y-1)/2)*SPACING_LEVELS[f.spacingLevels.y]});
    cells.sort((a,b)=>(a.x*a.x+a.y*a.y)-(b.x*b.x+b.y*b.y)||a.iy-b.iy||a.ix-b.ix);
    const maxRank=Math.max(0,Math.ceil(alive.length/cells.length)-1),candidates=[],byId=new Map(),used=new Set();
    for(let i=0;i<alive.length;i++){const cell=cells[i%cells.length],rank=Math.floor(i/cells.length),target=vec(cell.x,cell.y,(maxRank/2-rank)*SPACING_LEVELS[f.spacingLevels.z]).applyQuaternion(f.rotation).add(f.anchor);for(const ship of alive)candidates.push({ship,i,cell,rank,cost:ship.position.distanceToSquared(target)});}
    candidates.sort((a,b)=>a.cost-b.cost||a.ship.id.localeCompare(b.ship.id)||a.i-b.i);
    for(const c of candidates)if(!byId.has(c.ship.id)&&!used.has(c.i)){byId.set(c.ship.id,{...c.cell,rank:c.rank});used.add(c.i);}
    f.columnLayout={key,x,y,cells,byId,maxRank};f.columnLeaderId=null;f.slotVelocityHistory=null;
  }
  const counts=new Map();for(const ship of f.ships)if(ship.alive){const slot=f.columnLayout.byId.get(ship.id);if(slot){const k=slot.ix+','+slot.iy;counts.set(k,(counts.get(k)||0)+1);}}
  for(const cell of f.columnLayout.cells){const members=f.ships.filter(s=>s.alive&&f.columnLayout.byId.get(s.id)?.ix===cell.ix&&f.columnLayout.byId.get(s.id)?.iy===cell.iy).sort((a,b)=>f.columnLayout.byId.get(a.id).rank-f.columnLayout.byId.get(b.id).rank||a.id.localeCompare(b.id));members.forEach((ship,rank)=>{f.columnLayout.byId.get(ship.id).rank=rank;});}
  f.columnLayout.maxRank=Math.max(0,...[...counts.values()].map(n=>n-1));
  const scaleKey=f.ships.map(s=>s.id+':'+s.alive+':'+(s.collisionRadius??1.1)+':'+(f.columnLayout.byId.get(s.id)?.rank??'')).join('|');
  if(f.columnLayout.scaleKey!==scaleKey){
    let scale=1;const alive=f.ships.filter(s=>s.alive&&f.columnLayout.byId.has(s.id)),gap=SPACING_LEVELS[f.spacingLevels.z];
    for(let i=0;i<alive.length;i++)for(let j=0;j<i;j++){const a=f.columnLayout.byId.get(alive[i].id),b=f.columnLayout.byId.get(alive[j].id),distance=Math.hypot(a.x-b.x,a.y-b.y,(a.rank-b.rank)*gap),needed=(alive[i].collisionRadius??1.1)+(alive[j].collisionRadius??1.1);if(distance>1e-9)scale=Math.max(scale,needed/distance);}
    f.columnLayout.scale=scale;f.columnLayout.scaleKey=scaleKey;const [x,y]=[f.columnLayout.x,f.columnLayout.y];f.size.set((x-1)*SPACING_LEVELS[f.spacingLevels.x]*scale,(y-1)*SPACING_LEVELS[f.spacingLevels.y]*scale,f.columnLayout.maxRank*gap*scale);f.slotVelocityHistory=null;
  }
  if(!f.ships.some(s=>s.alive&&s.id===f.columnLeaderId)){const candidates=f.ships.filter(s=>s.alive&&f.columnLayout.byId.has(s.id));candidates.sort((a,b)=>{const x=f.columnLayout.byId.get(a.id),y=f.columnLayout.byId.get(b.id);return x.rank-y.rank||(x.x*x.x+x.y*x.y)-(y.x*y.x+y.y*y.y)||a.id.localeCompare(b.id);});f.columnLeaderId=candidates[0]?.id??null;}
  return f.columnLayout;
}
function columnLeader(f){columnLayout(f);return f.ships.find(s=>s.alive&&s.id===f.columnLeaderId);}
export function sizeForSpacing(n,levels,policy=null){
  if(policy==='COLUMN'){const [x,y]=columnDimensions(n,levels),ranks=Math.ceil(n/(x*y));return vec((x-1)*SPACING_LEVELS[levels.x],(y-1)*SPACING_LEVELS[levels.y],Math.max(0,ranks-1)*SPACING_LEVELS[levels.z]);}
  if(!n)return vec();
  if(['LINE','BREAKTHROUGH','POINT_DEFENSE'].includes(policy)){
    const fake={ships:Array.from({length:n},(_,i)=>({id:String(i),alive:true})),tactics:{policy},spacingLevels:levels,encounter:{active:false},rotation:new THREE.Quaternion(),anchor:vec(),size:vec()};
    return new THREE.Box3().setFromPoints(rawSlotsInOrder(fake)).getSize(vec());
  }
  const counts=dimensions(n),size=vec();axes.forEach((axis,i)=>{size[axis]=Math.max(0,counts[i]-1)*effectiveSpacing(levels[axis],policy);});return size;
}
export function validateSize(n,size,policy=null){const counts=dimensions(n);return axes.every((axis,i)=>Number.isFinite(size[axis])&&size[axis]>=0&&(policy!=null||counts[i]<=1||size[axis]/(counts[i]-1)>=CONFIG.spacing));}
// Local XY is transverse to the bow; local YZ is the longitudinal plane.
function planarSlots(f,longitudinal){const n=f.ships.length;if(!n)return [];const columns=Math.ceil(Math.sqrt(n)),rows=Math.ceil(n/columns),horizontal=SPACING_LEVELS[f.spacingLevels[longitudinal?'z':'x']],vertical=SPACING_LEVELS[f.spacingLevels.y],points=[];for(let i=0;i<n;i++){const a=(i%columns-(columns-1)/2)*horizontal,b=(Math.floor(i/columns)-(rows-1)/2)*vertical;points.push(longitudinal?vec(0,b,a):vec(a,b,0));}const center=new THREE.Box3().setFromPoints(points).getCenter(vec());return points.map(p=>p.sub(center));}
// Formation geometry is available before contact. Existing positions are never teleported.
function rawSlotsInOrder(f){
  const n=f.ships.length;if(!n)return [];
  const policy=f.tactics.policy, spacing=effectiveSpacing(f.spacingLevels.x,policy), offsets=[];
  if(policy==='COLUMN'){
    const layout=columnLayout(f),gap=SPACING_LEVELS[f.spacingLevels.z]*layout.scale;
    for(let i=0;i<n;i++){const s=layout.byId.get(f.ships[i].id);offsets.push(s?vec(s.x*layout.scale,s.y*layout.scale,(layout.maxRank/2-s.rank)*gap):vec());}
  }else if(policy==='LINE'){
    return planarSlots(f,false).map(p=>p.applyQuaternion(f.rotation).add(f.anchor));
  }else if(policy==='BREAKTHROUGH'){
    for(let i=0;i<n;i++){
      const layer=Math.floor((Math.sqrt(8*i+1)-1)/2),first=layer*(layer+1)/2,k=i-first;
      const count=layer+1,angle=k/count*Math.PI*2+Math.PI/4;
      offsets.push(layer===0?vec():vec(Math.cos(angle)*layer*spacing,Math.sin(angle)*layer*spacing,-layer*spacing));
    }
  }else if(policy==='POINT_DEFENSE'){
    if(n===1)offsets.push(vec());
    else{
      const key=n+'|'+spacing;
      if(f.sphereTemplateKey!==key){
        const golden=Math.PI*(3-Math.sqrt(5)),unit=[];
        for(let i=0;i<n;i++){
          const y=1-2*(i+.5)/n,r=Math.sqrt(1-y*y),a=i*golden;
          unit.push(vec(Math.cos(a)*r,y,Math.sin(a)*r));
        }
        let radius=spacing;
        for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)radius=Math.max(radius,spacing/unit[i].distanceTo(unit[j]));
        f.sphereTemplateKey=key;f.sphereTemplate=unit.map(p=>p.multiplyScalar(radius));
      }
      offsets.push(...f.sphereTemplate.map(p=>p.clone()));
    }
  }else return grid(n,f.size).map(p=>p.applyQuaternion(f.rotation).add(f.anchor));
  const rotation=policy==='POINT_DEFENSE'&&f.encounter.active?(f.encounter.defenseRotation||f.rotation):f.rotation;
  return offsets.map(p=>p.applyQuaternion(rotation).add(f.anchor));
}
// Formation identity remains stable until the roster, policy or spacing changes.
function assignSlots(f,points){
  const key=[f.tactics.revision,f.spacingLevels.x,f.spacingLevels.y,f.spacingLevels.z,...f.ships.map(s=>s.id)].join('|');
  if(f.formationAssignment?.key!==key){
    const candidates=[];for(const ship of f.ships)if(ship.alive)for(let i=0;i<points.length;i++)candidates.push({ship,i,cost:ship.position.distanceToSquared(points[i])});
    candidates.sort((a,b)=>a.cost-b.cost||a.ship.id.localeCompare(b.ship.id)||a.i-b.i);
    const byId=new Map(),used=new Set();for(const candidate of candidates)if(!byId.has(candidate.ship.id)&&!used.has(candidate.i)){byId.set(candidate.ship.id,candidate.i);used.add(candidate.i);}
    let scale=1;const alive=f.ships.filter(ship=>ship.alive&&byId.has(ship.id));for(let i=0;i<alive.length;i++)for(let j=0;j<i;j++){const distance=points[byId.get(alive[i].id)].distanceTo(points[byId.get(alive[j].id)]),needed=(alive[i].collisionRadius??1.1)+(alive[j].collisionRadius??1.1);if(distance>1e-9)scale=Math.max(scale,needed/distance);}
    f.formationAssignment={key,byId,scale};if(points.length){const local=points.map(p=>p.clone().sub(f.anchor).multiplyScalar(scale));f.size.copy(new THREE.Box3().setFromPoints(local).getSize(vec()));}f.slotVelocityHistory=null;
  }
  return f.ships.map((ship,i)=>{const index=f.formationAssignment.byId.get(ship.id);const point=index===undefined?ship.position.clone():points[index].clone().sub(f.anchor).multiplyScalar(f.formationAssignment.scale).add(f.anchor);if(f.tactics.policy==='LINE'&&f.encounter.active)point.add(f.encounter.lineOffsets?.get(ship.id)||vec());return point;});
}
function rawSlots(f){const points=rawSlotsInOrder(f);return f.tactics.policy==='COLUMN'?points:assignSlots(f,points);}
// Preserve the chosen center; try a bounded set of sphere orientations without clamping slots.
function chooseDefenseRotation(f,center){
  const e=f.encounter,initial=e.defenseRotation.clone(),angles=[0,Math.PI/2,Math.PI,3*Math.PI/2];
  for(const tilt of [0,Math.PI/2,-Math.PI/2])for(const yaw of angles){
    const rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt,yaw,0,'YXZ')).multiply(initial);
    e.defenseRotation.copy(rotation);const points=rawSlots(f).map(point=>point.sub(f.anchor).add(center));let valid=true;
    for(let i=0;i<f.ships.length&&valid;i++){
      const ship=f.ships[i];if(!ship.alive)continue;const radius=ship.collisionRadius??1.1,p=points[i];
      if(axes.some(axis=>p[axis]-radius<BATTLEFIELD.min[axis]||p[axis]+radius>BATTLEFIELD.max[axis])){valid=false;break;}
      for(let j=0;j<i;j++){const other=f.ships[j];if(other.alive&&p.distanceTo(points[j])<radius+(other.collisionRadius??1.1)){valid=false;break;}}
    }
    if(valid)return true;
  }
  e.defenseRotation.copy(initial);return false;
}
// The frame follows resolved travel, never the leader's stationary attitude.
function updateColumnPath(f){
  if(f.tactics.policy!=='COLUMN'){f.columnPath=null;return;}
  const layout=columnLayout(f),gap=SPACING_LEVELS[f.spacingLevels.z]*layout.scale,leader=columnLeader(f);if(!leader){f.columnPath=null;return;}
  const offset=layout.byId.get(leader.id);if(!offset)return;
  if(!f.columnPath){const frame=f.rotation.clone(),forward=vec(0,0,1).applyQuaternion(frame),forming=f.anchor.distanceTo(f.destination)<.8&&layout.maxRank>0,center=forming?f.anchor.clone().addScaledVector(forward,layout.maxRank*gap/2):leader.position.clone().sub(vec(offset.x*layout.scale,offset.y*layout.scale,0).applyQuaternion(frame)),points=[],frames=[];for(let i=0;i<Math.max(2,layout.maxRank+3);i++){points.push(center.clone().addScaledVector(forward,-gap*i));frames.push(frame.clone());}f.columnPath={points,frames,leaderId:leader.id,lastLeader:leader.position.clone(),frame,forming,previousRanks:new Map([...layout.byId].map(([id,slot])=>[id,slot.rank]))};if(forming){f.columnGoal=center.clone().add(vec(offset.x*layout.scale,offset.y*layout.scale,0).applyQuaternion(frame));f.columnGoalFinal=true;f.columnGoalBlocked=!insideBattlefield(f.columnGoal);}return;}
  const path=f.columnPath;
  if(path.leaderId!==leader.id){
    const expected=(path.previousRanks?.get(leader.id)??offset.rank)*gap,lo=Math.max(0,expected-gap),hi=expected+gap;let travelled=0,best=Infinity,bestIndex=0,bestPoint=path.points[0].clone(),bestFrame=path.frames[0].clone();
    for(let i=1;i<path.points.length;i++){
      const segment=new THREE.Line3(path.points[i-1],path.points[i]),length=segment.distance();if(travelled+length<lo){travelled+=length;continue;}if(travelled>hi)break;
      const candidate=leader.position.clone().sub(vec(offset.x*layout.scale,offset.y*layout.scale,0).applyQuaternion(path.frames[i-1])),min=length?THREE.MathUtils.clamp((lo-travelled)/length,0,1):0,max=length?THREE.MathUtils.clamp((hi-travelled)/length,0,1):1,t=THREE.MathUtils.clamp(segment.closestPointToPointParameter(candidate,true),min,max),point=segment.at(t,vec()),distance=point.distanceToSquared(candidate);
      if(distance<best){best=distance;bestIndex=i;bestPoint=point;bestFrame=path.frames[i-1].clone().slerp(path.frames[i],t);}travelled+=length;
    }
    if(bestIndex){path.points=[bestPoint,...path.points.slice(bestIndex)];path.frames=[bestFrame,...path.frames.slice(bestIndex)];path.frame.copy(bestFrame);}path.leaderId=leader.id;path.lastLeader.copy(leader.position);path.previousRanks=new Map([...layout.byId].map(([id,slot])=>[id,slot.rank]));f.slotVelocityHistory=null;resetColumnRoute(f);return;
  }
  path.previousRanks=new Map([...layout.byId].map(([id,slot])=>[id,slot.rank]));
  if(path.forming){path.lastLeader.copy(leader.position);if(leader.position.distanceTo(f.columnGoal)<.3)path.forming=false;return;}
  if(leader.yieldState){path.yielding=true;path.lastLeader.copy(leader.position);return;}
  if(path.yielding){const center=leader.position.clone().sub(vec(offset.x*layout.scale,offset.y*layout.scale,0).applyQuaternion(path.frame));if(center.distanceToSquared(path.points[0])>1e-8){path.points.unshift(center);path.frames.unshift(path.frame.clone());}path.yielding=false;path.lastLeader.copy(leader.position);f.slotVelocityHistory=null;return;}
  const delta=leader.position.clone().sub(path.lastLeader);if(delta.lengthSq()<1e-10)return;
  const oldFrame=path.frame.clone(),oldForward=vec(0,0,1).applyQuaternion(oldFrame),nextForward=delta.clone().normalize(),angle=oldForward.angleTo(nextForward);
  // Only limit a bend when its estimated inner offset would reverse.
  const width=Math.max(0,...layout.cells.map(cell=>Math.hypot(cell.x,cell.y)*layout.scale)),limit=width>0?Math.min(Math.PI,delta.length()/width):Math.PI;
  const rotation=new THREE.Quaternion().setFromUnitVectors(oldForward,nextForward);path.frame.premultiply(new THREE.Quaternion().identity().slerp(rotation,angle>limit?limit/angle:1)).normalize();
  const oldOffset=vec(offset.x*layout.scale,offset.y*layout.scale,0).applyQuaternion(oldFrame),newOffset=vec(offset.x*layout.scale,offset.y*layout.scale,0).applyQuaternion(path.frame),center=path.points[0].clone().add(delta).add(oldOffset).sub(newOffset);path.lastLeader.copy(leader.position);
  if(path.points[0].distanceToSquared(center)>.0025){path.points.unshift(center);path.frames.unshift(path.frame.clone());}else{path.points[0].copy(center);path.frames[0].copy(path.frame);}
  let length=0;for(let i=1;i<path.points.length;i++){length+=path.points[i-1].distanceTo(path.points[i]);if(length>(layout.maxRank+3)*gap){path.points.splice(i+1);path.frames.splice(i+1);break;}}
}
function sampleColumnPath(path,distance){
  let remaining=distance;for(let i=1;i<path.points.length;i++){const a=path.points[i-1],b=path.points[i],length=a.distanceTo(b);if(length>1e-9&&remaining<=length)return {position:a.clone().lerp(b,remaining/length),frame:path.frames[i-1].clone().slerp(path.frames[i],remaining/length)};remaining-=length;}
  const last=path.points.length-1,frame=path.frames[last].clone(),back=vec(0,0,-1).applyQuaternion(frame);return {position:path.points[last].clone().addScaledVector(back,Math.max(0,remaining)),frame};
}
function columnPathSlots(f){
  const path=f.columnPath;if(!path?.points.length)return null;const layout=columnLayout(f),gap=SPACING_LEVELS[f.spacingLevels.z]*layout.scale,leader=columnLeader(f),rows=new Map();
  let segment=1,traversed=0;for(let rank=0;rank<=layout.maxRank;rank++){
    const distance=rank*gap;while(segment<path.points.length){const length=path.points[segment-1].distanceTo(path.points[segment]);if(traversed+length>=distance&&length>1e-9)break;traversed+=length;segment++;}
    if(segment<path.points.length){const length=path.points[segment-1].distanceTo(path.points[segment]),t=length>0?(distance-traversed)/length:0;rows.set(rank,{position:path.points[segment-1].clone().lerp(path.points[segment],t),frame:path.frames[segment-1].clone().slerp(path.frames[segment],t)});}
    else {const last=path.points.length-1,frame=path.frames[last].clone();rows.set(rank,{position:path.points[last].clone().addScaledVector(vec(0,0,-1).applyQuaternion(frame),Math.max(0,distance-traversed)),frame});}
  }
  // A folded offset lane is temporarily held; the actual leader remains free to turn.
  const proposed=new Map(),folded=new Set(),alive=f.ships.filter(ship=>ship.alive&&layout.byId.has(ship.id));
  for(const ship of alive){const slot=layout.byId.get(ship.id),row=rows.get(slot.rank);proposed.set(ship.id,row.position.clone().add(vec(slot.x*layout.scale,slot.y*layout.scale,0).applyQuaternion(row.frame)));}
  for(let i=0;i<alive.length;i++)for(let j=0;j<i;j++){
    const a=alive[i],b=alive[j],sa=layout.byId.get(a.id),sb=layout.byId.get(b.id),pa=proposed.get(a.id),pb=proposed.get(b.id),same=sa.ix===sb.ix&&sa.iy===sb.iy,front=sa.rank<sb.rank?a:b,back=front===a?b:a,sf=layout.byId.get(front.id),distance=pa.distanceTo(pb),required=(a.collisionRadius??1.1)+(b.collisionRadius??1.1);
    let reverse=false;if(same&&sa.rank!==sb.rank){const direction=vec(0,0,1).applyQuaternion(rows.get(sf.rank).frame);reverse=proposed.get(front.id).clone().sub(proposed.get(back.id)).dot(direction)<=0;}
    if(reverse||distance<required-1e-7){const hold=back===leader?front:back;if(hold!==leader)folded.add(hold.id);}
  }
  const key=[...folded].sort().join('|');if(key!==(f.columnFoldKey??'')){f.columnFoldKey=key;f.slotVelocityHistory=null;}f.columnFoldedIds=folded;
  return f.ships.map(ship=>{const slot=layout.byId.get(ship.id);if(!slot)return ship.position.clone();if(ship===leader)return f.columnGoal?.clone()??ship.position.clone();return folded.has(ship.id)?ship.position.clone():proposed.get(ship.id);});
}
// Goals are available immediately; movement, not interpolation of goals, forms the fleet.
export function slots(f){return f.tactics.policy==='COLUMN'?(columnPathSlots(f)||rawSlots(f)):rawSlots(f);}
// Consecutive slots of the same formation are differentiated; revisions must
// never turn reassignment into an artificial high-speed goal.
export function formationSlotVelocities(f,points,dt){
  const revision=[f.tactics.revision,f.movement.revision,f.movement.policy,f.destinationIndex&&pointKey(f.destinationIndex),f.spacingLevels.x,f.spacingLevels.y,f.spacingLevels.z,f.columnGoalFinal,f.columnPath?.leaderId,...f.ships.map(s=>s.id+':'+s.alive+':'+(s.evasion?.threatId??''))].join('|');
  const previous=f.slotVelocityHistory,continuous=previous?.revision===revision;
  const velocities=points.map((point,i)=>continuous&&previous.points[i]?point.clone().sub(previous.points[i]).divideScalar(dt):f.velocity.clone());
  f.slotVelocityHistory={revision,points:points.map(point=>point.clone())};return velocities;
}
// During constrained movement, history describes the last resolved positions. Only
// the leader's virtual goal may change before the next collision resolution.
function constrainedColumnSlots(f){if(!f.columnPath)updateColumnPath(f);return slots(f);}
// TRACK follows a moving reference; STOP brakes against a fixed destination.
export const NAVIGATION_CONFIG=Object.freeze({positionGain:1,verticalGain:1,arrival:.15,reverseEnterDistance:2,reverseExitDistance:2.4,reverseEnterDot:-.6,reverseExitDot:-.3,turnLimit:Math.PI*.48});
const wrapAngle=a=>Math.atan2(Math.sin(a),Math.cos(a));
const approach=(a,b,step)=>a+THREE.MathUtils.clamp(b-a,-step,step);
export function navigateShip(ship,target,{mode='STOP',targetVelocity=null,face=null,aimRotation=null,speedLimit=ship.forwardSpeed,compositeLimit=ship.forwardSpeed,accelerationLimit=Infinity,brakeLimit=Infinity}={}){
  const c=ship.maneuver;if(!c)throw new Error('함선 기동 설정이 없습니다: '+ship.id);
  if(mode==='BRAKE'){const e=new THREE.Euler().setFromQuaternion(ship.rotation,'YXZ');return {mode,forward:0,verticalReference:0,yaw:e.y,pitch:e.x,roll:e.z};}
  if(mode==='HOLD')mode='STOP';if(mode!=='TRACK'&&mode!=='STOP')throw new Error('항법 목표 모드가 올바르지 않습니다.');
  const delta=target.clone().sub(ship.position),distance=delta.length(),forward=vec(0,0,1).applyQuaternion(ship.rotation),e=new THREE.Euler().setFromQuaternion(ship.rotation,'YXZ');
  const navigation=ship.navigationState||(ship.navigationState={reverse:false}),rearDot=distance>1e-9?delta.dot(forward)/distance:0;
  const reverse=mode==='STOP'&&(navigation.reverse?distance<NAVIGATION_CONFIG.reverseExitDistance&&rearDot<NAVIGATION_CONFIG.reverseExitDot:distance<NAVIGATION_CONFIG.reverseEnterDistance&&rearDot<NAVIGATION_CONFIG.reverseEnterDot);navigation.reverse=reverse;
  const reference=delta.clone().multiplyScalar(NAVIGATION_CONFIG.positionGain);if(mode==='TRACK'&&targetVelocity)reference.add(targetVelocity);reference.clampLength(0,speedLimit);
  const horizontal=Math.hypot(reference.x,reference.z);let yaw=e.y,pitch=0,roll=0;
  if((mode==='TRACK'?reference.lengthSq()>1e-8:distance>NAVIGATION_CONFIG.arrival)&&!reverse){if(horizontal>1e-6){yaw=Math.atan2(reference.x,reference.z);pitch=THREE.MathUtils.clamp(-Math.atan2(reference.y,Math.max(horizontal,.001)),-THREE.MathUtils.degToRad(c.max_pitch_angle),THREE.MathUtils.degToRad(c.max_pitch_angle));}}
  else if(aimRotation||face){const desired=aimRotation?new THREE.Euler().setFromQuaternion(aimRotation,'YXZ'):new THREE.Euler().setFromQuaternion(facing(face.clone().normalize(),vec(0,1,0)),'YXZ');yaw=desired.y;pitch=THREE.MathUtils.clamp(desired.x,-THREE.MathUtils.degToRad(c.max_pitch_angle),THREE.MathUtils.degToRad(c.max_pitch_angle));roll=THREE.MathUtils.clamp(desired.z,-THREE.MathUtils.degToRad(c.max_roll_angle),THREE.MathUtils.degToRad(c.max_roll_angle));}
  const yawError=wrapAngle(yaw-e.y),along=delta.dot(forward),braking=Math.sqrt(Math.max(0,2*Math.min(c.brake_deceleration,brakeLimit)*Math.max(0,Math.abs(along)-NAVIGATION_CONFIG.arrival)));
  let request=mode==='TRACK'?THREE.MathUtils.clamp(reference.dot(forward),0,speedLimit):distance<NAVIGATION_CONFIG.arrival?0:reverse?-Math.min(c.max_reverse_speed,braking):Math.min(speedLimit,braking,speedLimit*Math.max(0,Math.cos(yawError))**2);
  if(!reverse&&(Math.abs(yawError)>NAVIGATION_CONFIG.turnLimit||horizontal<.01))request=0;
  return {mode,forward:request,verticalReference:reference.y,yaw,pitch,roll,accelerationLimit,brakeLimit,speedLimit,compositeLimit};
}
export function integrateManeuver(ship,command,dt){
  const c=ship.maneuver,e=new THREE.Euler().setFromQuaternion(ship.rotation,'YXZ'),speedLimit=ship.forwardSpeed;
  e.y+=THREE.MathUtils.clamp(wrapAngle(command.yaw-e.y),-c.max_yaw_rate*dt,c.max_yaw_rate*dt);
  e.x=approach(e.x,command.pitch,(Math.abs(command.pitch)<1e-7?Math.min(c.max_pitch_rate,c.attitude_recovery_rate):c.max_pitch_rate)*dt);
  e.z=approach(e.z,command.roll,(Math.abs(command.roll)<1e-7?Math.min(c.max_roll_rate,c.attitude_recovery_rate):c.max_roll_rate)*dt);
  e.x=THREE.MathUtils.clamp(e.x,-THREE.MathUtils.degToRad(c.max_pitch_angle),THREE.MathUtils.degToRad(c.max_pitch_angle));e.z=THREE.MathUtils.clamp(e.z,-THREE.MathUtils.degToRad(c.max_roll_angle),THREE.MathUtils.degToRad(c.max_roll_angle));ship.rotation.setFromEuler(e);
  const forward=vec(0,0,1).applyQuaternion(ship.rotation),previousForward=ship.propulsionForward||0,previousVertical=ship.propulsionVertical||0;let requested=command.forward,current=previousForward;if(current*requested<0)requested=0;
  let rate=Math.abs(requested)<Math.abs(current)?c.brake_deceleration:requested<0?c.reverse_acceleration:c.forward_acceleration;if(command.mode!=='BRAKE'&&requested>=0)rate=Math.min(rate,Math.abs(requested)<Math.abs(current)?command.brakeLimit??Infinity:command.accelerationLimit??Infinity);current=approach(current,requested,rate*dt);ship.propulsionForward=THREE.MathUtils.clamp(current,-c.max_reverse_speed,speedLimit);
  let vertical=command.mode==='BRAKE'?0:THREE.MathUtils.clamp(command.verticalReference-forward.y*ship.propulsionForward,-c.max_vertical_speed,c.max_vertical_speed);const currentVertical=ship.propulsionVertical||0;if(currentVertical*vertical<0)vertical=0;const verticalBraking=Math.abs(vertical)<Math.abs(currentVertical),verticalRate=command.mode==='BRAKE'?c.brake_deceleration:Math.min(verticalBraking?c.brake_deceleration:c.vertical_acceleration,verticalBraking?command.brakeLimit??Infinity:command.accelerationLimit??Infinity);ship.propulsionVertical=approach(currentVertical,vertical,verticalRate*dt);if(command.mode!=='BRAKE'){const df=ship.propulsionForward-previousForward,dv=ship.propulsionVertical-previousVertical,change=Math.hypot(df,dv),slowing=Math.hypot(ship.propulsionForward,ship.propulsionVertical)<Math.hypot(previousForward,previousVertical),limit=(slowing?command.brakeLimit??Infinity:command.accelerationLimit??Infinity)*dt;if(change>limit){ship.propulsionForward=previousForward+df*limit/change;ship.propulsionVertical=previousVertical+dv*limit/change;}}
  ship.velocity.copy(forward).multiplyScalar(ship.propulsionForward);ship.velocity.y+=ship.propulsionVertical;const cap=Math.min(speedLimit,command.compositeLimit??speedLimit),length=ship.velocity.length();if(length>cap&&length>0){const scale=cap/length;ship.propulsionForward*=scale;ship.propulsionVertical*=scale;ship.velocity.multiplyScalar(scale);}let fraction=1;for(const axis of axes){const delta=ship.velocity[axis]*dt;if(delta>0)fraction=Math.min(fraction,Math.max(0,(BATTLEFIELD.max[axis]-ship.position[axis])/delta));else if(delta<0)fraction=Math.min(fraction,Math.max(0,(BATTLEFIELD.min[axis]-ship.position[axis])/delta));}ship.position.addScaledVector(ship.velocity,dt*fraction);if(fraction<1){ship.velocity.multiplyScalar(fraction);ship.propulsionForward*=fraction;ship.propulsionVertical*=fraction;}ship.boundaryLimited=fraction<1;
  const diagnostic=ship.maneuverCommand||(ship.maneuverCommand={});Object.assign(diagnostic,{mode:command.mode,forward:requested,vertical,yaw:command.yaw,pitch:command.pitch,roll:command.roll});
}
export function steerShip(ship,target,dt,options={}){
  integrateManeuver(ship,navigateShip(ship,target,options),dt);
}
// Planning uses the same step on an isolated state. The original ship and command remain unchanged.
export function cloneManeuverState(ship){
  return {id:ship.id,position:ship.position.clone(),velocity:ship.velocity.clone(),rotation:ship.rotation.clone(),forwardSpeed:ship.forwardSpeed,maneuver:ship.maneuver,propulsionForward:ship.propulsionForward||0,propulsionVertical:ship.propulsionVertical||0,navigationState:ship.navigationState?{...ship.navigationState}:undefined};
}
export function predictManeuver(ship,target,ticks,options={}){
  if(!Number.isSafeInteger(ticks)||ticks<0)throw new Error('예측 틱이 올바르지 않습니다.');
  const predicted=cloneManeuverState(ship);for(let i=0;i<ticks;i++)steerShip(predicted,target,CONFIG.dt,options);return predicted;
}
export function initialState(){
  const fleets=[fleet('A','ALLY',vec(-8,0,46),vec(-8,0,0),4),fleet('B','ALLY',vec(8,0,46),vec(8,0,0),4),fleet('E','ENEMY',vec(-8,0,-46),vec(-8,0,0),4),fleet('F','ENEMY',vec(8,0,-46),vec(8,0,0),4)];
  for(const f of fleets){const forward=vec(0,0,f.team==='ALLY'?-1:1);f.rotation.copy(facing(forward,vec(0,1,0)));f.lastHorizontal.copy(vec(forward.x,0,forward.z).normalize());const points=slots(f);f.ships.forEach((s,i)=>{s.position.copy(points[i]);s.rotation.copy(f.rotation);});}return {phase:'PREPARATION',time:0,remaining:CONFIG.duration,fleets,shotEffects:[],fxRequests:[],attackEvents:[],nextAttackId:1,combatStats:{},scores:{ALLY:0,ENEMY:0},scoreTicks:0,result:null,combat:null,reserves:[],purchaseResults:{},nextShipId:1,nextFleetId:1,preparationId:0,aiPrepared:-1,assetsAvailable:true,stalledDeployments:0};
}
// User-created empty fleets are drafts until a ship or reserve is assigned.
export function createEmptyFleet(state,sourceId){
  if(state.phase!=='PREPARATION'||state.result)return {ok:false,reason:'준비 단계에서만 함대를 추가할 수 있습니다.'};
  const source=state.fleets.find(f=>f.id===sourceId&&f.team==='ALLY');if(!source)return {ok:false,reason:'선택한 함대를 찾을 수 없습니다.'};
  if(state.fleets.some(f=>f.team==='ALLY'&&f.emptyDraft&&f.ships.length===0))return {ok:false,reason:'먼저 빈 함대에 함선을 배치하세요.'};
  let id;do{id='ALLY-F'+state.nextFleetId++;}while(state.fleets.some(f=>f.id===id));
  const created=fleet(id,'ALLY',source.anchor,source.destination,0);created.emptyDraft=true;created.rotation.copy(source.rotation);created.lastHorizontal.copy(source.lastHorizontal);created.spacingLevels={...source.spacingLevels};created.size.copy(sizeForSpacing(0,created.spacingLevels));state.fleets.push(created);return {ok:true,fleet:created};
}
// Phase 3 prototype: values are tuning settings, not final game balance.
export const ECONOMY_CONFIG={typeId:'light-cruiser-01',price:30,maxOwned:32,spawnSpacing:4,spawnDepth:4,spawnRadius:1.1};
const {purchaseShip,assignReserve,deployReserves}=createEconomy({ECONOMY_CONFIG,BATTLEFIELD,ShipSpatialIndex,axes,vec,ship,fleet,sizeForSpacing});
export {purchaseShip,assignReserve,deployReserves};
export function prepareEnemyAI(state){
  if(state.phase!=='PREPARATION'||state.aiPrepared===state.preparationId)return;state.aiPrepared=state.preparationId;
  const enemyFleets=state.fleets.filter(f=>f.team==='ENEMY'&&f.ships.some(s=>s.alive)),fleet=enemyFleets[0];for(const current of enemyFleets){const ranked=ZONES.map(z=>{const c=zoneCounts(state,z),center=z.min.clone().add(z.max).multiplyScalar(.5);return {z,center,score:z.multiplier*3+(c.ALLY-c.ENEMY)-current.anchor.distanceTo(center)*.05};}).sort((a,b)=>b.score-a.score||a.z.id.localeCompare(b.z.id));if(ranked.length)setDestination(current,worldToNearestGrid(ranked[0].center));}
  const pending=state.reserves.filter(r=>r.team==='ENEMY'&&(r.status==='OWNED'||r.status==='ASSIGNED'));
  if(!pending.length&&state.scores.ENEMY>=ECONOMY_CONFIG.price&&state.scores.ENEMY+ECONOMY_CONFIG.price<SCORE_CONFIG.victory){const p=purchaseShip(state,'ENEMY',ECONOMY_CONFIG.typeId,'ai-'+state.preparationId);if(p.ok)assignReserve(state,'ENEMY',p.shipId,fleet?.id??'NEW');}
}
export function checkRecovery(state){
  if(state.result)return;if(state.stalledDeployments>=3){state.result='DRAW';state.phase='RESULT';return;}const can=team=>state.fleets.some(f=>f.team===team&&f.ships.some(s=>s.alive))||state.reserves.some(r=>r.team===team&&(r.status==='OWNED'||r.status==='ASSIGNED'))||state.scores[team]>=ECONOMY_CONFIG.price;
  const ally=can('ALLY'),enemy=can('ENEMY');if(!ally||!enemy){state.result=!ally&&!enemy?'DRAW':ally?'ALLY':'ENEMY';state.phase='RESULT';}
}
function facing(forward,up){const right=up.clone().cross(forward).normalize();return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,forward.clone().cross(right).normalize(),forward));}
function updateOrientation(f,direction,dt){
  if(direction.lengthSq()<1e-10)return;const forward=direction.clone().normalize(),flat=vec(forward.x,0,forward.z);
  if(flat.lengthSq()>1e-8)f.lastHorizontal.copy(flat.normalize());
  let up=vec(0,1,0).applyQuaternion(f.rotation);up.addScaledVector(forward,-up.dot(forward));
  if(up.lengthSq()<1e-8){up=f.lastHorizontal.clone();up.addScaledVector(forward,-up.dot(forward));if(up.lengthSq()<1e-8){up=vec(1,0,0);up.addScaledVector(forward,-up.dot(forward));}}
  f.rotation.rotateTowards(facing(forward,up.normalize()),CONFIG.turnRate*dt);
}
export function fleetManeuverLimits(f){const alive=f.ships.filter(s=>s.alive);if(!alive.length)return null;return {cruise:.8*Math.min(...alive.map(s=>s.forwardSpeed)),acceleration:.8*Math.min(...alive.map(s=>s.maneuver.forward_acceleration)),brake:Math.min(...alive.map(s=>s.maneuver.brake_deceleration))};}
function moveAnchor(f,dt){
  const alive=f.ships.filter(s=>s.alive),limits=fleetManeuverLimits(f);f.motionLimits=limits;if(!limits){f.velocity.set(0,0,0);f.referenceArrived=false;return;}
  const e=f.encounter,active=e.active;if(!active)advancePatrol(f);f.previousAnchor=f.anchor.clone();
  const lag=f.motionSlotError??0,gap=SPACING_LEVELS[f.spacingLevels.z]*(f.tactics.policy==='COLUMN'?columnLayout(f).scale:1),requestedFeedback=lag>gap*2?THREE.MathUtils.clamp(gap*2/lag,.5,1):1;f.motionProgressFactor=approach(f.motionProgressFactor??1,requestedFeedback,dt);const feedback=f.motionProgressFactor;
  if(f.tactics.policy==='COLUMN'){
    const layout=columnLayout(f),leader=columnLeader(f),offset=layout.byId.get(leader.id),frame=f.columnPath?.frame??f.rotation,key=[pointKey(f.destinationIndex),f.movement.policy,layout.key].join(':');
    if(!f.columnGoal||f.columnGoalKey!==key){f.columnGoal=f.destination.clone().add(vec(offset.x*layout.scale,offset.y*layout.scale,0).applyQuaternion(frame));f.columnGoalKey=key;f.columnGoalFinal=layout.maxRank===0;f.columnGoalBlocked=false;}
    if(!f.columnGoalFinal&&leader.position.distanceTo(f.columnGoal)<1.2){const direction=vec(0,0,1).applyQuaternion(frame).normalize();f.columnGoal.addScaledVector(direction,layout.maxRank*gap/2);f.columnGoalFinal=true;f.columnGoalBlocked=!insideBattlefield(f.columnGoal);}
    const desired=f.safetyStop||f.columnGoalBlocked?0:limits.cruise*feedback;f.columnSpeed=approach(f.columnSpeed??0,desired,(desired<(f.columnSpeed??0)?limits.brake:limits.acceleration)*dt);f.referenceArrived=f.columnGoalFinal&&leader.position.distanceTo(f.columnGoal)<.3&&leader.velocity.length()<.5;f.posture=f.safetyStop?'ENGAGING':'MOVING';return;
  }
  const target=active?e.target:f.destination,delta=target.clone().sub(f.anchor),distance=delta.length(),direction=distance>1e-8?delta.clone().normalize():vec();
  let speed=f.safetyStop?0:Math.min(limits.cruise*feedback,Math.sqrt(2*limits.brake*distance));if(Math.abs(direction.y)>1e-6){const vertical=Math.min(...alive.map(s=>s.forwardSpeed*Math.sin(THREE.MathUtils.degToRad(s.maneuver.max_pitch_angle))+s.maneuver.max_vertical_speed));speed=Math.min(speed,vertical/Math.abs(direction.y));}
  const desired=direction.multiplyScalar(speed),rate=desired.lengthSq()<f.velocity.lengthSq()?limits.brake:limits.acceleration,change=desired.clone().sub(f.velocity);f.velocity.add(change.clampLength(0,rate*dt));f.anchor.addScaledVector(f.velocity,dt);
  const face=active&&e.face?e.face:delta;if(face.lengthSq()>1e-8){const turn=alive[0].maneuver.max_yaw_rate;let up=vec(0,1,0);const forward=face.clone().normalize();if(Math.abs(forward.dot(up))>.999)up=vec(1,0,0);f.rotation.rotateTowards(facing(forward,up),turn*dt);}
  f.referenceArrived=!active&&f.anchor.distanceTo(f.destination)<=CONFIG.arrivalDistance&&f.velocity.length()<=CONFIG.arrivalSpeed;f.posture=active?'ENGAGING':f.referenceArrived?'IDLE':'MOVING';
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
    if(part.rotationKind==='yaw')rotation.multiply(new THREE.Quaternion().setFromAxisAngle(axis(weapon.settings.yawAxis),THREE.MathUtils.degToRad(yaw*((weapon.key==='D01_Hull_L'||weapon.key==='D01_W01')?-1:1))));
    if(part.rotationKind==='pitch')rotation.multiply(new THREE.Quaternion().setFromAxisAngle(axis(weapon.settings.pitchAxis),THREE.MathUtils.degToRad(pitch*weapon.settings.pitchSign)));
    matrix.multiply(local.compose(part.position,rotation,part.scale));
  }
  const position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();matrix.decompose(position,rotation,scale);
  return {position,direction:new THREE.Vector3(0,0,1).applyQuaternion(rotation).normalize()};
}
// Cache coarse rig-local firing directions; exact firing and collision checks remain separate.
export function buildWeaponAimSamples(weapon,pitchLimits=()=>weapon.settings.pitch){
  const sampleRange=(lo,hi,step)=>{const values=[lo,hi];if(lo<=0&&hi>=0)values.push(0);for(let v=Math.ceil(lo/step)*step;v<hi;v+=step)values.push(v);return [...new Set(values)].sort((a,b)=>a-b);};
  const yawValues=weapon.pivot?sampleRange(weapon.settings.yaw[0],weapon.settings.yaw[1],45):[0],directions=[];
  for(const yaw of yawValues){
    const [lo,hi]=pitchLimits(yaw),pitchValues=weapon.pivot?sampleRange(lo,hi,15):[0];
    for(const pitch of pitchValues)for(const chain of weapon.muzzleChains){
      const direction=muzzlePoseFromData(chain,weapon,vec(),new THREE.Quaternion(),yaw,pitch).direction;
      directions.push(direction.x,direction.y,direction.z);
    }
  }
  return new Float32Array(directions);
}

// Data-only target scoring; reserved damage is a per-fleet planning estimate, never HP mutation.
export function chooseCombatTarget(candidates,previousId,reservedDamage,shotDamage,range=45){
  let best=null,bestScore=Infinity;for(const item of candidates){const enemy=item.enemy;if(!enemy?.alive||!Number.isFinite(enemy.hp)||enemy.hp<=0||!Number.isFinite(item.distance))continue;
    const reserved=reservedDamage.get(enemy.id)||0,overkill=Math.max(0,(reserved+shotDamage-enemy.hp)/enemy.hp);
    const score=item.distance/(range*range)+overkill*.6-(enemy.id===previousId?.08:0);
    if(score<bestScore-1e-9||(Math.abs(score-bestScore)<=1e-9&&(!best||enemy.id.localeCompare(best.id)<0))){best=enemy;bestScore=score;}
  }return best;
}
// Spatial index implementation is shared with combat queries.

function fleetBounds(f){const alive=f.ships.filter(s=>s.alive);if(!alive.length)return null;const box=new THREE.Box3().setFromPoints(alive.map(s=>s.position)),center=box.getCenter(vec());let radius=0;for(const s of alive)radius=Math.max(radius,center.distanceTo(s.position)+(s.collisionRadius??1.1));return {center,radius,box};}
const TACTICAL_CONFIG=Object.freeze({rearDot:.5,rearSamples:3,rearDelay:1,routeTimeout:45,exitMargin:3,groupRadius:18});
function segmentBoxInterval(a,b,box){let lo=0,hi=1;for(const axis of axes){const d=b[axis]-a[axis];if(Math.abs(d)<1e-12){if(a[axis]<box.min[axis]||a[axis]>box.max[axis])return null;continue;}let t1=(box.min[axis]-a[axis])/d,t2=(box.max[axis]-a[axis])/d;if(t1>t2)[t1,t2]=[t2,t1];lo=Math.max(lo,t1);hi=Math.min(hi,t2);if(lo>hi)return null;}return [lo,hi];}
function segmentIntersectsBox(a,b,box){return segmentBoxInterval(a,b,box)!==null;}
// Select a bounded local group ahead of the fleet; enemy hull orientation is irrelevant.
export function makeBreakthroughPlan(f,enemy){
  const e=f.encounter,forward=vec(0,0,1).applyQuaternion(f.rotation).normalize(),spacing=effectiveSpacing(f.spacingLevels.x,'BREAKTHROUGH');
  const candidates=enemy.ships.filter(ship=>ship.alive).map(ship=>({ship,delta:ship.position.clone().sub(f.anchor)}))
    .filter(item=>item.delta.lengthSq()>1e-10&&item.delta.dot(forward)>=0)
    .sort((a,b)=>a.delta.lengthSq()-b.delta.lengthSq()||a.ship.id.localeCompare(b.ship.id));
  if(!candidates.length){e.reason='전방에서 돌파 대상을 찾지 못했습니다.';return false;}
  const groupRadius=Math.max(12,spacing*1.5);let lastReason='전장 안에 돌파 경로가 없습니다.';
  for(const {ship:seed} of candidates){
    const members=candidates.filter(item=>item.ship.position.distanceToSquared(seed.position)<=groupRadius*groupRadius).map(item=>item.ship);
    const regionMargin=Math.max(1.1,spacing*.5),box=new THREE.Box3().setFromPoints(members.map(ship=>ship.position)).expandByScalar(regionMargin),center=box.getCenter(vec()),axis=center.clone().sub(f.anchor);
    if(axis.lengthSq()<1e-10){lastReason='돌파 방향을 정할 수 없습니다.';continue;}axis.normalize();
    if(axis.dot(forward)<-1e-9){lastReason='전방에 유효한 돌파 방향이 없습니다.';continue;}
    const half=box.getSize(vec()).multiplyScalar(.5),extent=Math.abs(axis.x)*half.x+Math.abs(axis.y)*half.y+Math.abs(axis.z)*half.z;
    const entry=center.clone().addScaledVector(axis,-extent),layers=Math.floor((Math.sqrt(8*Math.max(0,f.ships.length-1)+1)-1)/2),tail=Math.max(4,layers*spacing),exit=center.clone().addScaledVector(axis,extent+tail+3);
    if(!insideBattlefield(exit)||!segmentIntersectsBox(f.anchor,exit,box)){lastReason='전장 안에 돌파 경로가 없습니다.';continue;}
    // At the exit every allocated slot must fit; never clamp individual slots.
    let up=vec(0,1,0);if(Math.abs(axis.dot(up))>.999)up=vec(1,0,0);
    const targetRotation=facing(axis,up),inverse=f.rotation.clone().invert(),current=rawSlots(f);let fits=true;
    for(let i=0;i<f.ships.length;i++){
      if(!f.ships[i].alive)continue;const point=current[i].clone().sub(f.anchor).applyQuaternion(inverse).applyQuaternion(targetRotation).add(exit),radius=f.ships[i].collisionRadius??1.1;
      if(axes.some(a=>point[a]-radius<BATTLEFIELD.min[a]||point[a]+radius>BATTLEFIELD.max[a])){fits=false;break;}
    }
    if(!fits){lastReason='전장 안에 진형이 통과할 공간이 없습니다.';continue;}
    const timeLimit=Math.max(20,8+1.5*f.anchor.distanceTo(exit)/Math.max(.1,(fleetManeuverLimits(f)?.cruise??CONFIG.shipSpeed)*.5));
    e.breakthrough={phase:'FORMATION',axis,entry,exit,box,targetIds:members.map(ship=>ship.id),groupRadius,regionMargin,previous:f.anchor.clone(),entered:false,time:0,timeLimit,readyTime:0,targetOrigin:center.clone(),targetMissTime:0,shipPrevious:new Map(),shipStart:new Map(),traversed:new Set()};
    return true;
  }
  e.reason=lastReason;return false;
}
function localBreakthroughBounds(enemy,plan,fallback){
  if(!plan.targetIds)return fallback;
  const ids=new Set(plan.targetIds),members=enemy.ships.filter(ship=>ship.alive&&ids.has(ship.id));
  if(!members.length)return null;
  return {box:new THREE.Box3().setFromPoints(members.map(ship=>ship.position))};
}
export function updateBreakthrough(f,enemy,enemyBounds,dt,scan,constrained=false){
  const e=f.encounter,b=e.breakthrough;b.time+=dt;
  const localBounds=localBreakthroughBounds(enemy,b,enemyBounds);if(!localBounds){e.reason='돌파 대상이 소멸했습니다.';return false;}enemyBounds=localBounds;
  if(b.time>b.timeLimit){e.reason='돌파 준비 또는 이동이 지연되었습니다.';return false;}
  if(b.phase==='FORMATION'){
    e.target=f.anchor.clone();e.face=b.axis;
    const aligned=vec(0,0,1).applyQuaternion(f.rotation).dot(b.axis)>=Math.cos(THREE.MathUtils.degToRad(5))&&(!constrained||f.ships.filter(s=>s.alive).every(s=>vec(0,0,1).applyQuaternion(s.rotation).dot(b.axis)>=Math.cos(THREE.MathUtils.degToRad(10))));
    b.readyTime=f.formationRatio>=1&&aligned?b.readyTime+dt:0;
    if(b.readyTime>=.3){b.phase='CHARGE';b.previous.copy(f.anchor);for(const ship of f.ships)if(ship.alive){b.shipPrevious.set(ship.id,ship.position.clone());b.shipStart.set(ship.id,ship.position.clone());}}
  }
  if(b.phase==='CHARGE'||b.phase==='TRANSIT'){
    e.target=b.exit;e.face=b.axis;
    if(scan&&!b.entered){
      const targetCenter=enemyBounds.box.getCenter(vec()),origin=b.targetOrigin||b.box.getCenter(vec()),shift=targetCenter.sub(origin);
      shift.addScaledVector(b.axis,-shift.dot(b.axis));
      const half=b.box.getSize(vec()).multiplyScalar(.5),threshold=Math.max(10,half.length());
      b.targetMissTime=shift.length()>threshold?(b.targetMissTime||0)+dt*ENCOUNTER_CONFIG.scanTicks:0;
      if(b.targetMissTime>=1){e.reason='적이 돌파 경로에서 이탈했습니다.';return false;}
    }
    b.previous.copy(f.anchor);
    const alive=f.ships.filter(s=>s.alive),liveBox=enemyBounds.box.clone().expandByScalar(2*(b.regionMargin??1.1));
    const targetNow=enemyBounds.box.getCenter(vec()),targetOrigin=b.targetOrigin||b.box.getCenter(vec()),halfOriginal=b.box.getSize(vec()).multiplyScalar(.5);
    const axialExtent=Math.abs(b.axis.x)*halfOriginal.x+Math.abs(b.axis.y)*halfOriginal.y+Math.abs(b.axis.z)*halfOriginal.z;
    // A planned region is useful for small evasive motion, but cannot prove passage once
    // the target has moved far along the charge axis; then only its live region counts.
    const targetShift=targetNow.sub(targetOrigin),axialShift=targetShift.dot(b.axis),lateralShift=targetShift.clone().addScaledVector(b.axis,-axialShift).length();
    const plannedRegionValid=Math.abs(axialShift)<=Math.max(6,axialExtent+2)&&lateralShift<=Math.max(10,halfOriginal.length());
    for(const ship of alive){
      const previous=b.shipPrevious.get(ship.id)||ship.position,start=b.shipStart.get(ship.id)||ship.position;
      if(!b.shipStart.has(ship.id))b.shipStart.set(ship.id,start.clone());
      const progress=ship.position.clone().sub(start).dot(b.axis),step=ship.position.clone().sub(previous).dot(b.axis);
      if(progress>=.5&&step>1e-8&&((plannedRegionValid&&segmentIntersectsBox(previous,ship.position,b.box))||segmentIntersectsBox(previous,ship.position,liveBox)))b.traversed.add(ship.id);
      b.shipPrevious.set(ship.id,ship.position.clone());
    }
    b.entered=alive.some(ship=>b.traversed.has(ship.id));if(b.entered)b.phase='TRANSIT';
    const center=b.box.getCenter(vec()),half=b.box.getSize(vec()).multiplyScalar(.5),extent=Math.abs(b.axis.x)*half.x+Math.abs(b.axis.y)*half.y+Math.abs(b.axis.z)*half.z;
    if(b.entered&&alive.length&&alive.every(ship=>ship.position.clone().sub(center).dot(b.axis)>extent&&ship.position.clone().sub(b.shipStart.get(ship.id)).dot(b.axis)>=.5)){e.reason='돌파 완료';return false;}
    if(f.anchor.distanceTo(b.exit)<.2&&f.velocity.length()<.2){e.reason=b.entered?'돌파 완료 조건을 충족하지 못했습니다.':'적 영역에 진입하지 못했습니다.';return false;}
  }
  return true;
}
function shipWeaponRange(ship){
  if(ship.weapons?.length){let maximum=0;for(const weapon of ship.weapons){const range=weapon.range??weapon.balance?.range;if(Number.isFinite(range)&&range>maximum)maximum=range;}return maximum;}
  return balanceConfig?.maxRange??CONFIG.weaponRange;
}
function recognitionRange(f){const duration=Math.max(4,f.size.length()/(CONFIG.shipSpeed*.5)),t=duration+.2+CONFIG.dt;return (balanceConfig?.maxRange??CONFIG.weaponRange)+2*(fleetManeuverLimits(f)?.cruise??0)*t+4;}
function updateEncounters(state,dt,movementIndex){
  if(state.fleets.every(f=>!f.encounter.active&&f.tactics.policy==='COLUMN'))return;
  const bounds=new Map(state.fleets.map(f=>[f.id,fleetBounds(f)])),byId=new Map(state.fleets.map(f=>[f.id,f]));
  const scan=Math.round(state.time/CONFIG.dt)%ENCOUNTER_CONFIG.scanTicks===0;
  const fleetIndex=scan&&state.fleets.some(f=>!f.encounter.active&&f.tactics.policy!=='COLUMN')?new ShipSpatialIndex(state.fleets.filter(f=>bounds.get(f.id)).map(f=>({id:f.id,position:bounds.get(f.id).center,collisionRadius:bounds.get(f.id).radius}))):null;
  const distance=(a,b)=>Math.max(0,a.center.distanceTo(b.center)-a.radius-b.radius);
  for(const f of state.fleets){const e=f.encounter,own=bounds.get(f.id);if(!own){if(e.active)resetEncounter(f);continue;}
    if(e.active&&e.revision!==f.tactics.revision){resetEncounter(f);continue;}
    if(!e.active){if(state.time<(e.retryAt||0))continue;if(f.tactics.policy==='COLUMN'||!fleetIndex)continue;
      const recognition=recognitionRange(f),box=own.box.clone().expandByScalar(recognition+own.radius),ids=new Set(fleetIndex.query(box.min,box.max).map(item=>item.id));let choices=[...ids].map(id=>byId.get(id)).filter(other=>other&&other.team!==f.team&&bounds.get(other.id)).map(other=>({other,d:distance(own,bounds.get(other.id))})).filter(x=>x.d<=recognition).filter(x=>f.tactics.policy!=='BREAKTHROUGH'||x.other.ships.some(ship=>ship.alive&&ship.position.clone().sub(own.center).dot(vec(0,0,1).applyQuaternion(f.rotation))>=0)).sort((a,b)=>a.d-b.d||a.other.id.localeCompare(b.other.id));if(!choices.length)continue;
      e.active=true;e.enemyId=choices[0].other.id;e.policy=f.tactics.policy;e.revision=f.tactics.revision;e.anchorRevision=f.tactics.anchorRevision;e.outside=0;e.arrived=false;e.mode='HOLD';e.reason='';e.retryAt=0;e.breakthrough=null;e.lineEngaged=false;e.lineOffsets=null;e.contactLost=false;e.recognizedAt=state.time;e.recognizedRange=recognition;e.entryRadii=own.radius+bounds.get(e.enemyId).radius;e.threatEntered=false;e.defenseRotation=f.rotation.clone();if(e.policy==='POINT_DEFENSE'){const point=f.tactics.defenseAnchor||f.destinationIndex;e.defensePoint=point?validPoint(point):f.anchor.clone();e.defenseSource=f.tactics.defenseAnchor?'USER':point?'AUTO':'CURRENT';if(!chooseDefenseRotation(f,e.defensePoint)){resetEncounter(f,{reason:'현재 배치 후보로는 선택한 거점에 원형 진형을 배치할 수 없습니다.',retryAt:state.time+2});continue;}} }
    if(e.policy==='POINT_DEFENSE'&&e.anchorRevision!==f.tactics.anchorRevision){const point=f.tactics.defenseAnchor||f.destinationIndex;e.defensePoint=point?validPoint(point):f.anchor.clone();e.defenseSource=f.tactics.defenseAnchor?'USER':point?'AUTO':'CURRENT';e.anchorRevision=f.tactics.anchorRevision;e.arrived=false;e.defenseReadyTime=0;e.defenseBestError=Infinity;e.defenseBestHeadingError=Infinity;e.defenseStallTime=0;e.defenseRosterKey=null;if(!chooseDefenseRotation(f,e.defensePoint)){resetEncounter(f,{reason:'현재 배치 후보로는 선택한 거점에 원형 진형을 배치할 수 없습니다.',retryAt:state.time+2});continue;}}
    let enemy=bounds.get(e.enemyId),enemyFleet=byId.get(e.enemyId),gone=!enemy;if(!gone&&scan){let nearestSq=Infinity;const searchRadius=(balanceConfig?.maxRange??CONFIG.weaponRange)+10,searchBox=own.box.clone().expandByScalar(searchRadius);
      const candidates=movementIndex.query(searchBox.min,searchBox.max).filter(candidate=>candidate.alive&&candidate.fleetId===enemyFleet.id);
      for(const ship of f.ships)if(ship.alive)for(const candidate of candidates)nearestSq=Math.min(nearestSq,ship.position.distanceToSquared(candidate.position));
      const nearest=Math.sqrt(nearestSq);if(nearest<=(balanceConfig?.maxRange??CONFIG.weaponRange)&&!e.threatEntered){e.threatEntered=true;e.outside=0;}e.contactLost=e.threatEntered?nearest>(balanceConfig?.maxRange??CONFIG.weaponRange)+10:own.center.distanceTo(enemy.center)-e.entryRadii>e.recognizedRange+10;}if(!gone&&e.contactLost)e.outside+=dt;else if(!gone)e.outside=0;
    if(e.policy==='POINT_DEFENSE'){
      e.target=e.defensePoint.clone();e.face=null;
      if(!e.arrived){
        const goals=slots(f),living=f.ships.map((ship,i)=>({ship,i})).filter(x=>x.ship.alive);
        const headingError=Math.max(0,...living.map(({ship,i})=>{const radial=goals[i].clone().sub(f.anchor);radial.y=0;if(radial.lengthSq()<1e-8)return 0;const bow=vec(0,0,1).applyQuaternion(ship.rotation);bow.y=0;return bow.lengthSq()<1e-8?Math.PI:bow.angleTo(radial);}));
        const positionReady=f.anchor.distanceTo(e.defensePoint)<=CONFIG.arrivalDistance&&f.velocity.length()<=CONFIG.arrivalSpeed&&living.length>0&&living.every(({ship,i})=>ship.position.distanceTo(goals[i])<=.8&&ship.velocity.length()<=.5);
        {const ready=positionReady&&headingError<=Math.acos(.9);e.defenseReadyTime=ready?(e.defenseReadyTime||0)+dt:0;e.arrived=ready&&e.defenseReadyTime>=.3;}
        if(!e.arrived&&living.length){
          const key=living.map(({ship})=>ship.id).join('|');
          const error=f.anchor.distanceTo(e.defensePoint)+living.reduce((sum,{ship,i})=>sum+ship.position.distanceTo(goals[i]),0)/living.length;
          if(e.defenseRosterKey!==key){e.defenseRosterKey=key;e.defenseBestError=Infinity;e.defenseBestHeadingError=Infinity;e.defenseStallTime=0;}
          if(error<(e.defenseBestError??Infinity)-1e-4||headingError<(e.defenseBestHeadingError??Infinity)-1e-4){e.defenseBestError=Math.min(e.defenseBestError??Infinity,error);e.defenseBestHeadingError=Math.min(e.defenseBestHeadingError??Infinity,headingError);e.defenseStallTime=0;}
          else e.defenseStallTime=(e.defenseStallTime||0)+dt;
          if(e.defenseStallTime>=15){resetEncounter(f,{reason:'방어 거점 구축이 장시간 정체되었습니다.',retryAt:state.time+2});continue;}
        }
      }
    }
    if(e.policy==='POINT_DEFENSE'&&(gone||e.outside>=ENCOUNTER_CONFIG.grace)){
      // A single target disappearing must not release a defended point while another threat remains.
      const radius=(balanceConfig?.maxRange??CONFIG.weaponRange)+10,center=e.defensePoint;
      const alternatives=movementIndex.near(center,radius).filter(ship=>ship.alive&&byId.get(ship.fleetId)?.team!==f.team&&ship.position.distanceToSquared(center)<=radius*radius)
        .sort((a,b)=>a.position.distanceToSquared(center)-b.position.distanceToSquared(center)||a.id.localeCompare(b.id));
      if(alternatives.length){const chosen=alternatives[0];e.enemyId=chosen.fleetId;enemy=bounds.get(e.enemyId);enemyFleet=byId.get(e.enemyId);gone=!enemy;e.contactLost=false;e.outside=0;e.threatEntered=true;}
    }
    if((gone||e.outside>=ENCOUNTER_CONFIG.grace)&&(e.policy!=='POINT_DEFENSE'||e.arrived)){resetEncounter(f,{reason:gone?'조우 대상 소멸':'조우 종료'});continue;}
    if(e.policy==='BREAKTHROUGH'&&enemy){if(!e.breakthrough&&!makeBreakthroughPlan(f,enemyFleet)){resetEncounter(f,{reason:e.reason,retryAt:state.time+2});continue;}if(!updateBreakthrough(f,enemyFleet,enemy,dt,scan,true)){resetEncounter(f,{reason:e.reason,retryAt:state.time+2});continue;}}
    if(e.policy==='LINE'&&enemy){
      const toward=enemy.center.clone().sub(f.anchor);if(toward.lengthSq()>1e-9)toward.normalize();else toward.copy(f.lastHorizontal);
      if(f.safetyStop)e.lineEngaged=true;
      if(e.lineEngaged&&scan){const any=f.ships.some(ship=>{const range=shipWeaponRange(ship);return ship.alive&&range>0&&enemyFleet.ships.some(other=>other.alive&&ship.position.distanceTo(other.position)<=range+2);});if(!any){e.lineEngaged=false;e.lineOffsets=null;}}
      e.target=e.lineEngaged?f.anchor.clone():enemy.center.clone();e.face=toward;e.mode=e.lineEngaged?'ENGAGE':'APPROACH';
    }
  }
}
// Proximity uses the shared pre-movement snapshot and actual ship positions.
const SAFETY_SEARCH=36;
// A local braking envelope is a tactical approximation, not a future safety proof.
export const COLUMN_STOP_CONFIG=Object.freeze({distance:12,releaseMargin:.5,resumeScans:3});
function updateColumnStop(f,index,snapshot,teams,scan){
  const alive=f.ships.filter(s=>s.alive&&snapshot.has(s.id));
  if(!alive.length){f.safetyStop=false;f.columnMode='TRAVEL';f.pathBlockId=null;return;}
  const reaction=ENCOUNTER_CONFIG.scanTicks*CONFIG.dt, maxEnemy=index.columnMaxSpeed??CONFIG.shipSpeed,maxOwn=Math.max(...alive.map(s=>Math.max(s.velocity.length(),(s.forwardSpeed??CONFIG.shipSpeed))));
  const cruise=f.motionLimits?.cruise??Math.min(...alive.map(s=>s.forwardSpeed))*.8,maxTime=Math.max(...alive.map(s=>Math.max(s.velocity.length(),cruise)/Math.max(.001,s.maneuver?.brake_deceleration??CONFIG.acceleration)))+reaction;
  const bounds=new THREE.Box3().setFromPoints(alive.map(s=>snapshot.get(s.id))).expandByScalar(COLUMN_STOP_CONFIG.distance+COLUMN_STOP_CONFIG.releaseMargin+(maxEnemy+maxOwn)*maxTime+2);
  const enemies=index.query(bounds.min,bounds.max).filter(s=>s.alive&&teams.get(s.fleetId)!==f.team);
  const route=f.destination.clone().sub(f.anchor),hasRoute=route.lengthSq()>CONFIG.arrivalDistance**2;if(hasRoute)route.normalize();
  let blocker=null;const goals=slots(f);
  for(const ship of alive){
    const origin=snapshot.get(ship.id),speed=ship.velocity.length(),brake=Math.max(.001,ship.maneuver?.brake_deceleration??CONFIG.acceleration),time=reaction+Math.max(speed,cruise)/brake;
    const shipIndex=f.ships.indexOf(ship),target=goals[shipIndex],intended=target.clone().sub(origin);if(ship.id===f.columnLeaderId){if(intended.lengthSq()>1e-6)intended.normalize().multiplyScalar(f.columnSpeed??cruise);else if(hasRoute)intended.copy(route).multiplyScalar(cruise);}else{const slotVelocity=f.slotReferenceVelocities?.[shipIndex];if(slotVelocity)intended.add(slotVelocity);intended.clampLength(0,ship.forwardSpeed??cruise);}
    for(const enemy of enemies){const other=snapshot.get(enemy.id);if(!other)continue;const relative=other.clone().sub(origin),distance=relative.length();if(distance<1e-8){blocker=enemy.id;break;}
      const toward=relative.clone().multiplyScalar(1/distance),actualClosing=ship.velocity.clone().sub(enemy.velocity).dot(toward),intentClosing=intended.clone().sub(enemy.velocity).dot(toward),closing=Math.max(actualClosing,intentClosing),limit=COLUMN_STOP_CONFIG.distance+(f.safetyStop?COLUMN_STOP_CONFIG.releaseMargin:0);
      const brakingClosing=enemy.velocity.clone().negate().dot(toward);if(closing<=.01||(intended.dot(toward)<0&&intentClosing<=brakingClosing))continue;
      const relativeVelocity=enemy.velocity.clone().sub(intended),denom=relativeVelocity.lengthSq(),closest=denom>1e-9?THREE.MathUtils.clamp(-relative.dot(relativeVelocity)/denom,0,time):0;
      const corridor=relative.clone().addScaledVector(relativeVelocity,closest).length();
      const ownToward=Math.max(0,ship.velocity.dot(toward)),enemyToward=Math.max(0,-enemy.velocity.dot(toward)),brakingTime=speed/brake,margin=ownToward*brakingTime*.5+enemyToward*brakingTime+(ownToward+enemyToward)*reaction;
      if((distance<=limit+margin||corridor<=limit)&&closest<=time){blocker=enemy.id;break;}
    }
    if(blocker)break;
  }
  if(blocker){f.safetyStop=true;f.pathBlockId=blocker;f.columnSafetyReason='BLOCKED';f.columnClearScans=0;if(f.columnMode!=='HOLD')f.columnMode='BRAKE';}
  else if(f.safetyStop){if(scan)f.columnClearScans=(f.columnClearScans||0)+1;if(f.columnClearScans>=COLUMN_STOP_CONFIG.resumeScans){f.safetyStop=false;f.pathBlockId=null;f.columnSafetyReason='CLEAR';f.columnMode='TRAVEL';}}
  else{f.pathBlockId=null;f.columnSafetyReason='CLEAR';f.columnMode='TRAVEL';}
}
function updateSafety(state,index,snapshot,dt){
  const teams=new Map(state.fleets.map(f=>[f.id,f.team]));
  const scan=Math.round(state.time/CONFIG.dt)%ENCOUNTER_CONFIG.scanTicks===0;
  for(const f of state.fleets){if(f.tactics.policy==='COLUMN'){updateColumnStop(f,index,snapshot,teams,scan);continue;}if(f.tactics.policy!=='LINE'){f.safetyStop=false;f.pathBlockId=null;continue;}if(f.encounter.active&&f.encounter.lineEngaged){f.safetyStop=true;continue;}const separation=24;const target=f.encounter.active?f.encounter.target:f.destination,dir=target?target.clone().sub(f.anchor):vec();if(dir.lengthSq()>1e-9)dir.normalize();let stop=false,blocking=null;
    for(const ship of f.ships){if(!ship.alive)continue;if(!ship.safetyCandidates||Math.round(state.time/CONFIG.dt)%ENCOUNTER_CONFIG.scanTicks===0)ship.safetyCandidates=index.near(snapshot.get(ship.id),SAFETY_SEARCH);for(const enemy of ship.safetyCandidates){if(!enemy.alive||!snapshot.has(enemy.id))continue;
      if(teams.get(enemy.fleetId)===f.team)continue;const delta=snapshot.get(enemy.id).clone().sub(snapshot.get(ship.id)),distance=delta.length();if(distance<1e-8)continue;const toward=delta.multiplyScalar(1/distance),approach=dir.dot(toward);if(approach<=0.02)continue;
      const ownClose=Math.max(0,ship.velocity.dot(toward)),enemyClose=Math.max(0,-enemy.velocity.dot(toward)),deceleration=ship.maneuver?.brake_deceleration??CONFIG.acceleration,brakingTime=ownClose/Math.max(.001,deceleration),brake=ownClose*ownClose/(2*deceleration)+enemyClose*brakingTime+(ownClose+enemyClose)*ENCOUNTER_CONFIG.scanTicks*CONFIG.dt;const limit=separation+(f.safetyStop?1:0)+brake;if(distance<=limit){stop=true;blocking=enemy.id;break;}
    }if(stop)break;}f.safetyStop=stop;f.pathBlockId=f.tactics.policy==='COLUMN'&&stop?blocking:null;
  }return teams;
}
// Aim is planned at scan cadence in the slot frame; actual angular speed remains limited.
function updateAimTargets(state,index,snapshot){
  const tick=Math.round(state.time/CONFIG.dt),teams=new Map(state.fleets.map(f=>[f.id,f.team])),range=balanceConfig?.maxRange??CONFIG.weaponRange;
  const stableHash=id=>{let hash=0;for(let i=0;i<id.length;i++)hash=(Math.imul(hash,31)+id.charCodeAt(i))>>>0;return hash;};
  const activeShips=state.fleets.flatMap(f=>f.ships).filter(ship=>ship.alive),rosterKey=activeShips.map(ship=>ship.id+':'+ship.fleetId).sort().join('|'),maxSpeed=Math.max(CONFIG.shipSpeed,...activeShips.map(ship=>ship.forwardSpeed??CONFIG.shipSpeed));
  for(const f of state.fleets){
    const alive=f.ships.filter(ship=>ship.alive&&snapshot.has(ship.id));if(!alive.length)continue;
    if(!f.aimCandidates||f.aimRosterKey!==rosterKey||tick%ENCOUNTER_CONFIG.scanTicks===stableHash(f.id)%ENCOUNTER_CONFIG.scanTicks){
      const bounds=new THREE.Box3().setFromPoints(alive.map(ship=>snapshot.get(ship.id))),margin=range+2*maxSpeed*ENCOUNTER_CONFIG.scanTicks*CONFIG.dt;
      bounds.expandByScalar(margin);f.aimCandidates=index.query(bounds.min,bounds.max).filter(other=>other.alive&&teams.get(other.fleetId)!==f.team);f.aimRosterKey=rosterKey;
    }
    for(const ship of alive){
      if(ship.aimRevision!==undefined&&tick%ENCOUNTER_CONFIG.scanTicks!==stableHash(ship.id)%ENCOUNTER_CONFIG.scanTicks)continue;
      const origin=snapshot.get(ship.id);let best=null,bestScore=Infinity;
      for(const other of f.aimCandidates){
        if(!other.alive||!snapshot.has(other.id)||teams.get(other.fleetId)===f.team)continue;
        const distance=origin.distanceToSquared(snapshot.get(other.id));if(distance>range*range)continue;
        const score=distance-(ship.aimTargetId===other.id?range*range*.05:0);
        if(score<bestScore||(score===bestScore&&other.id.localeCompare(best.id)<0)){best=other;bestScore=score;}
      }
      ship.aimTargetId=best?.id??null;ship.aimTargetPosition=best?snapshot.get(best.id).clone():null;ship.aimRevision=(ship.aimRevision||0)+1;
    }
  }
}
function clampManeuverAttitude(rotation,settings){const e=new THREE.Euler().setFromQuaternion(rotation,'YXZ');e.x=THREE.MathUtils.clamp(e.x,-THREE.MathUtils.degToRad(settings.max_pitch_angle),THREE.MathUtils.degToRad(settings.max_pitch_angle));e.z=THREE.MathUtils.clamp(e.z,-THREE.MathUtils.degToRad(settings.max_roll_angle),THREE.MathUtils.degToRad(settings.max_roll_angle));return rotation.setFromEuler(e);}
export function aimFromBase(ship,base,position,constrained=false,allowedAngle=Math.PI/2){
  if(!ship.aimTargetPosition)return null;
  if(ship.aimPlannedRevision===ship.aimRevision&&ship.aimConstrained===constrained&&ship.aimAllowedAngle===allowedAngle&&ship.aimRelative){const q=base.clone().multiply(ship.aimRelative);if(constrained)clampManeuverAttitude(q,ship.maneuver);if(base.angleTo(q)<=allowedAngle)return q;}
  const world=ship.aimTargetPosition.clone().sub(position),distance=world.length();if(distance<1e-8)return null;
  const target=world.clone().multiplyScalar(1/distance),local=target.clone().applyQuaternion(base.clone().invert()),limit=Math.PI/2;
  const targetYaw=THREE.MathUtils.clamp(Math.atan2(local.x,local.z),-limit,limit),targetPitch=THREE.MathUtils.clamp(-Math.atan2(local.y,Math.hypot(local.x,local.z)),-limit,limit);
  const yaws=[0,targetYaw,THREE.MathUtils.clamp(targetYaw-Math.PI/2,-limit,limit),THREE.MathUtils.clamp(targetYaw+Math.PI/2,-limit,limit)],pitches=[0,targetPitch],rolls=[0,-Math.PI/4,Math.PI/4,-limit,limit];
  const weapons=ship.weapons.length?ship.weapons:[{range:balanceConfig?.maxRange??CONFIG.weaponRange,damage:1,cooldownSec:1}],candidates=[];
  for(const yaw of yaws)for(const pitch of pitches)for(const roll of rolls){
    const q=base.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch,yaw,roll,'YXZ')));if(constrained)clampManeuverAttitude(q,ship.maneuver);if(base.angleTo(q)>allowedAngle)continue;const targetLocal=target.clone().applyQuaternion(q.clone().invert());let fire=0;
    for(const weapon of weapons){
      if(distance>(weapon.range??CONFIG.weaponRange))continue;
      const samples=weapon.aimSamples;let reachable=false;
      if(samples?.length){const threshold=Math.cos(weapon.aimTolerance??Math.PI/6);for(let i=0;i<samples.length;i+=3){if(samples[i]*targetLocal.x+samples[i+1]*targetLocal.y+samples[i+2]*targetLocal.z>=threshold){reachable=true;break;}}}
      else {const direction=weapon.aimDirection||vec(0,0,1);reachable=direction.dot(targetLocal)>=Math.cos(weapon.aimCone??.1);}
      if(reachable)fire+=(weapon.damage??1)/Math.max(.1,weapon.cooldownSec??1);
    }
    // Stability and propulsion compatibility break equal-fire ties.
    const stability=ship.rotation.angleTo(q),turnCost=(Math.abs(yaw)+Math.abs(pitch)+Math.abs(roll))*.025;
    const bow=vec(0,0,1).applyQuaternion(q),movement=ship.velocity.lengthSq()>1e-5?ship.velocity.clone().normalize():vec(0,0,1).applyQuaternion(base);
    const score=fire-.08*stability-turnCost-.05*(1-bow.dot(movement));
    candidates.push({q,score,angles:new THREE.Vector3(pitch,yaw,roll)});
  }
  candidates.sort((a,b)=>b.score-a.score);const chosen=candidates[0]?.q||null;
  ship.aimPlannedRevision=ship.aimRevision;ship.aimConstrained=constrained;ship.aimAllowedAngle=allowedAngle;ship.aimRelative=chosen?base.clone().invert().multiply(chosen):null;ship.aimDesiredAngles=candidates[0]?.angles||null;return chosen;
}

function updateLineOffsets(f,state,index,snapshot){
  const e=f.encounter;if(!e.active||e.policy!=='LINE'||!e.lineEngaged)return;
  if(Math.round(state.time/CONFIG.dt)%ENCOUNTER_CONFIG.scanTicks!==0)return;
  const enemy=state.fleets.find(x=>x.id===e.enemyId);if(!enemy)return;
  e.lineOffsets??=new Map();
  const forward=vec(0,0,1).applyQuaternion(f.rotation).normalize(),base=planarSlots(f,false).map(p=>p.applyQuaternion(f.rotation).add(f.anchor));
  const ranges=balanceConfig?.mounts?[...balanceConfig.mounts.values()].map(m=>m.type.range):[];
  const fallbackRange=ranges.length?Math.max(...ranges):(balanceConfig?.maxRange??CONFIG.weaponRange);
  const pathClear=(ship,candidate)=>{
    const from=snapshot.get(ship.id),duration=Math.min(4,from.distanceTo(candidate)/Math.max(.1,(ship.forwardSpeed??CONFIG.shipSpeed)*.5));
    for(const other of index.segment(from,candidate,CONFIG.spacing)){
      if(other.id===ship.id||!other.alive||!snapshot.has(other.id))continue;
      const relative=from.clone().sub(snapshot.get(other.id)),end=candidate.clone().sub(snapshot.get(other.id)).addScaledVector(other.velocity,-duration),radius=(ship.collisionRadius??1.1)+(other.collisionRadius??1.1)+.2;
      if(relative.lengthSq()<radius*radius){if(relative.dot(end.clone().sub(relative))<0)return false;}
      else if(segmentSphere(relative,end,vec(),radius)!==null)return false;
    }
    return true;
  };
  f.ships.forEach((ship,i)=>{
    if(!ship.alive)return;
    const shipRanges=ship.weapons.map(w=>w.range??w.balance?.range).filter(Number.isFinite),range=shipRanges.length?Math.max(...shipRanges):fallbackRange;
    let current=e.lineOffsets.get(ship.id)||vec();const actual=ship.position;
    if(current.lengthSq()>1e-10&&!pathClear(ship,base[i].clone().add(current))){current=actual.clone().sub(base[i]);e.lineOffsets.set(ship.id,current);}
    if(enemy.ships.some(o=>o.alive&&actual.distanceTo(o.position)<=range))return;
    const inward=f.anchor.clone().sub(base[i]);inward.addScaledVector(forward,-inward.dot(forward));if(inward.lengthSq()>1e-8)inward.normalize();
    let best=null,bestCost=Infinity;
    for(const other of enemy.ships){if(!other.alive)continue;
      for(const shift of [0,SPACING_LEVELS[f.spacingLevels.x]*.25,SPACING_LEVELS[f.spacingLevels.x]*.5]){
        const lateral=inward.clone().multiplyScalar(shift),v=other.position.clone().sub(base[i]).sub(lateral),along=v.dot(forward),side=v.clone().addScaledVector(forward,-along),sideSq=side.lengthSq();
        if(along<=0||sideSq>=range*range)continue;
        const advance=Math.max(0,along-Math.sqrt(range*range-sideSq)+.25);
        if(advance>10)continue;
        const offset=lateral.addScaledVector(forward,advance),candidate=base[i].clone().add(offset);
        if(!insideBattlefield(candidate))continue;
        let valid=true;const inverse=f.rotation.clone().invert(),localBase=base[i].clone().sub(f.anchor).applyQuaternion(inverse),localCandidate=candidate.clone().sub(f.anchor).applyQuaternion(inverse);
        for(let j=0;j<f.ships.length;j++){
          if(i===j||!f.ships[j].alive)continue;
          const neighbor=base[j].clone().add(e.lineOffsets.get(f.ships[j].id)||vec()),neighborBase=base[j].clone().sub(f.anchor).applyQuaternion(inverse),neighborLocal=neighbor.clone().sub(f.anchor).applyQuaternion(inverse);
          if(candidate.distanceTo(neighbor)<CONFIG.spacing){valid=false;break;}
          for(const axis of ['x','y']){const delta=localBase[axis]-neighborBase[axis];if(Math.abs(delta)>1e-5&&(localCandidate[axis]-neighborLocal[axis])*delta<0){valid=false;break;}}
          if(!valid)break;
        }
        if(!valid)continue;
        if(!pathClear(ship,candidate))continue;
        const cost=offset.lengthSq()+offset.distanceToSquared(current)*.1;if(cost<bestCost){bestCost=cost;best=offset;}
      }
    }
    if(best)e.lineOffsets.set(ship.id,best);
  });
}

// Predict intrusion into a charging ship's forward corridor from one shared snapshot.
// The offset is temporary: it never mutates formation slots or player commands.
export function updateBreakthroughEvasion(state,index,snapshot){
  const fleetById=new Map(state.fleets.map(f=>[f.id,f]));
  const scan=Math.round(state.time/CONFIG.dt)%ENCOUNTER_CONFIG.scanTicks===0;
  if(!scan)return;
  if(!state.fleets.some(f=>f.encounter.active&&['CHARGE','TRANSIT'].includes(f.encounter.breakthrough?.phase))){
    for(const f of state.fleets)for(const ship of f.ships)ship.evasion=null;
    return;
  }
  const horizon=24,clearance=5;
  for(const fleet of state.fleets)for(const ship of fleet.ships){
    if(!ship.alive||!snapshot.has(ship.id))continue;
    const p=snapshot.get(ship.id),threats=[];
    for(const other of index.near(p,horizon)){
      const source=fleetById.get(other.fleetId),otherCharge=source?.encounter?.breakthrough,ownCharge=fleet.encounter.breakthrough;
      if(!other.alive||!source||source.team===fleet.team)continue;
      const otherCharging=source.encounter.active&&otherCharge&&['CHARGE','TRANSIT'].includes(otherCharge.phase);
      const ownCharging=fleet.encounter.active&&ownCharge&&['CHARGE','TRANSIT'].includes(ownCharge.phase);
      if(!otherCharging&&!ownCharging)continue;
      const origin=snapshot.get(other.id);if(!origin)continue;
      const axis=otherCharging?otherCharge.axis:ownCharge.axis;
      const relative=otherCharging?p.clone().sub(origin):origin.clone().sub(p);
      const along=relative.dot(axis),lateral=p.clone().sub(origin).addScaledVector(axis,-p.clone().sub(origin).dot(axis));
      if(along<-4||along>horizon)continue;
      const relativeVelocity=otherCharging?ship.velocity.clone().sub(axis.clone().multiplyScalar(fleetManeuverLimits(source)?.cruise??0)):other.velocity.clone().sub(axis.clone().multiplyScalar(fleetManeuverLimits(fleet)?.cruise??0));
      const speedSq=relativeVelocity.lengthSq(),time=speedSq>1e-8?THREE.MathUtils.clamp(-relative.dot(relativeVelocity)/speedSq,0,8):0;
      const closest=relative.clone().addScaledVector(relativeVelocity,time);
      const alreadyAvoiding=ship.evasion?.threatId===other.id;
      if(!alreadyAvoiding&&closest.length()>clearance+(other.collisionRadius??1.1))continue;
      threats.push({other,axis,along,lateral});
    }
    threats.sort((a,b)=>a.along-b.along||a.other.id.localeCompare(b.other.id));
    const threat=threats[0];
    if(!threat){ship.evasion=null;continue;}
    let direction=ship.evasion?.threatId===threat.other.id?ship.evasion.direction.clone():null;
    if(!direction){
      direction=threat.lateral.clone();
      if(direction.lengthSq()<.04){
        const canonical=threat.axis.clone();
        const first=[canonical.x,canonical.y,canonical.z].find(v=>Math.abs(v)>1e-8)||1;
        if(first<0)canonical.negate();
        direction=vec(0,1,0).cross(canonical);
        if(direction.lengthSq()<1e-8)direction=vec(1,0,0).cross(canonical);
        if(ship.id.localeCompare(threat.other.id)<0)direction.negate();
      }
      direction.addScaledVector(threat.axis,-direction.dot(threat.axis)).normalize();
      const cross=threat.axis.clone().cross(direction).normalize();
      const options=[direction,cross,direction.clone().negate(),cross.clone().negate()];
      let best=null,bestScore=-Infinity;
      for(let i=0;i<options.length;i++){
        const candidate=options[i],sample=p.clone().addScaledVector(candidate,clearance+1);
        if(!insideBattlefield(sample))continue;
        let safe=true,nearest=Infinity;
        for(const neighbor of index.near(sample,4)){
          if(neighbor.id===ship.id||!neighbor.alive||!snapshot.has(neighbor.id))continue;
          const distance=sample.distanceTo(snapshot.get(neighbor.id));
          if(distance<(ship.collisionRadius??1.1)+(neighbor.collisionRadius??1.1)+.2){safe=false;break;}
          nearest=Math.min(nearest,distance);
        }
        if(!safe)continue;
        const score=candidate.dot(direction)*2+Math.min(nearest,12)*.05-i*1e-4;
        if(score>bestScore){bestScore=score;best=candidate;}
      }
      if(!best){ship.evasion=null;continue;}
      direction=best.clone();
    }
    const ownCharge=fleet.encounter.active&&['CHARGE','TRANSIT'].includes(fleet.encounter.breakthrough?.phase);
    const amount=ownCharge?3:6;
    ship.evasion={threatId:threat.other.id,direction,offset:direction.clone().multiplyScalar(amount)};
  }
}

// Resolve both ships against the same pre-movement snapshot, independent of fleet/team.
// Candidate pairs are shared and use actual proposed displacement as a conservative halo.
export function resolveShipCollisions(ships,index,snapshot,priority=null){
  const sorted=ships.filter(s=>s.alive&&snapshot.has(s.id)).slice().sort((a,b)=>a.id.localeCompare(b.id));
  const proposed=new Map(sorted.map(s=>[s.id,s.position.clone().sub(snapshot.get(s.id))]));
  const maxMove=Math.max(0,...sorted.map(s=>proposed.get(s.id).length()));
  const maxRadius=Math.max(0,...sorted.map(s=>s.collisionRadius??1.1));
  const pairs=[];
  for(const a of sorted){
    const p=snapshot.get(a.id),radius=(a.collisionRadius??1.1)+maxRadius+proposed.get(a.id).length()+maxMove;
    for(const b of index.near(p,radius))if(a.id.localeCompare(b.id)<0&&b.alive&&snapshot.has(b.id))pairs.push([a,b]);
  }
  const fractions=new Map(sorted.map(s=>[s.id,1]));for(const ship of sorted)ship.blockedBy=null;let converged=false;
  // Stopping one participant may create a new conflict with a third; repeat conservatively.
  for(let iteration=0;iteration<Math.max(2,pairs.length+1);iteration++){
    let changed=false;
    for(const [a,b] of pairs){
      const start=snapshot.get(a.id).clone().sub(snapshot.get(b.id)),
        da=proposed.get(a.id).clone().multiplyScalar(fractions.get(a.id)),
        db=proposed.get(b.id).clone().multiplyScalar(fractions.get(b.id)),
        relative=da.clone().sub(db),radius=(a.collisionRadius??1.1)+(b.collisionRadius??1.1),
        distanceSq=start.lengthSq();
      let hit=null;
      if(distanceSq<=radius*radius+1e-9){if(start.dot(relative)<-1e-10)hit=0;}
      else if(relative.lengthSq()>1e-16)hit=segmentSphere(start,start.clone().add(relative),vec(),radius);
      if(hit!==null&&hit<1){
        if(!a.blockedBy)a.blockedBy=b.id;if(!b.blockedBy)b.blockedBy=a.id;
        const yielding=a.yieldState?.otherId===b.id?a:b.yieldState?.otherId===a.id?b:null;if(yielding&&yielding.yieldState.phase==='MOVE'){const waiting=yielding===a?b:a,relativeStart=snapshot.get(yielding.id).clone().sub(snapshot.get(waiting.id)),move=proposed.get(yielding.id).clone().multiplyScalar(fractions.get(yielding.id)),r=(yielding.collisionRadius??1.1)+(waiting.collisionRadius??1.1),safe=relativeStart.lengthSq()<=r*r+1e-9?relativeStart.dot(move)>=-1e-10:segmentSphere(relativeStart,relativeStart.clone().add(move),vec(),r)===null;if(safe&&fractions.get(waiting.id)>0){fractions.set(waiting.id,0);changed=true;continue;}}
        if(priority&&a.fleetId===b.fleetId&&priority.has(a.id)&&priority.has(b.id)&&priority.get(a.id).group===priority.get(b.id).group&&priority.get(a.id).rank!==priority.get(b.id).rank){
          const leader=priority.get(a.id).rank<priority.get(b.id).rank?a:b,follower=leader===a?b:a,startLeader=snapshot.get(leader.id).clone().sub(snapshot.get(follower.id)),leaderMove=proposed.get(leader.id).clone().multiplyScalar(fractions.get(leader.id)),r=(leader.collisionRadius??1.1)+(follower.collisionRadius??1.1);
          const safe=startLeader.lengthSq()<=r*r+1e-9?startLeader.dot(leaderMove)>=-1e-10:segmentSphere(startLeader,startLeader.clone().add(leaderMove),vec(),r)===null;
          if(safe&&fractions.get(follower.id)>0){fractions.set(follower.id,0);changed=true;continue;}
        }
        const factor=Math.max(0,hit-1e-6),fa=fractions.get(a.id)*factor,fb=fractions.get(b.id)*factor;
        if(fa<fractions.get(a.id)-1e-10||fb<fractions.get(b.id)-1e-10){fractions.set(a.id,fa);fractions.set(b.id,fb);changed=true;}
      }
    }
    if(!changed){converged=true;break;}
  }
  // No speculative move is safer than accepting a conflicting, unconverged chain.
  if(!converged)for(const [a,b] of pairs){fractions.set(a.id,0);fractions.set(b.id,0);}
  for(const ship of sorted){const fraction=fractions.get(ship.id);ship.collisionLimited=fraction<1;ship.position.copy(snapshot.get(ship.id)).addScaledVector(proposed.get(ship.id),fraction);if(fraction<1){ship.velocity.multiplyScalar(fraction);if(Number.isFinite(ship.propulsionForward))ship.propulsionForward*=fraction;if(Number.isFinite(ship.propulsionVertical))ship.propulsionVertical*=fraction;}}
  return {pairs:pairs.length,converged};
}
// A yield remains associated with the same right-of-way while its target is retried.
const COOPERATION=Object.freeze({delay:.4,clearance:.8,release:.4,retry:1});
function chooseYieldTarget(ship,other,index,snapshot,failed){
  const origin=snapshot.get(ship.id),otherOrigin=snapshot.get(other.id);if(!origin||!otherOrigin)return null;
  const distance=(ship.collisionRadius??1.1)+(other.collisionRadius??1.1)+COOPERATION.clearance,up=vec(0,1,0),forward=vec(0,0,1).applyQuaternion(ship.rotation),side=vec(forward.z,0,-forward.x).normalize(),away=origin.clone().sub(otherOrigin).normalize(),directions=[up,up.clone().negate(),side,side.clone().negate(),away];
  for(let i=0;i<directions.length;i++){
    const direction=directions[i];if(failed.has(i)||direction.lengthSq()<1e-8)continue;
    const target=origin.clone().addScaledVector(direction,distance),radius=ship.collisionRadius??1.1;if(axes.some(a=>target[a]-radius<BATTLEFIELD.min[a]||target[a]+radius>BATTLEFIELD.max[a]))continue;
    let clear=true;for(const nearby of index.near(origin,distance*2+radius)){if(nearby===ship||!nearby.alive)continue;const point=snapshot.get(nearby.id);if(!point)continue;const required=radius+(nearby.collisionRadius??1.1)+.1;if(target.distanceTo(point)<required){clear=false;break;}const start=origin.distanceTo(point);if(start<=required&&target.distanceTo(point)>start)continue;if(segmentSphere(origin,target,point,required)!==null){clear=false;break;}}
    if(clear)return {target,index:i};
  }return null;
}
function retryYield(ship,other,index,snapshot,y){
  const selected=chooseYieldTarget(ship,other,index,snapshot,y.failed);
  if(selected){y.phase='MOVE';y.target=selected.target;y.candidate=selected.index;y.bestDistance=ship.position.distanceTo(y.target);y.stalled=0;}
  else{y.phase='RETRY';y.hold=ship.position.clone();y.retryTime=0;if(y.failed.size>=5)y.failed.clear();}
}
export function updateCooperation(state,index,snapshot,dt){
  const teams=new Map(state.fleets.map(f=>[f.id,f.team])),ships=new Map(state.fleets.flatMap(f=>f.ships).filter(s=>s.alive).map(s=>[s.id,s]));
  for(const ship of ships.values()){
    const y=ship.yieldState;if(!y)continue;const other=ships.get(y.otherId);
    if(!other||teams.get(ship.fleetId)!==teams.get(other.fleetId)){ship.yieldState=null;continue;}
    if(y.phase==='MOVE'){
      const distance=ship.position.distanceTo(y.target);
      if(distance<.5){y.phase='WAIT';y.hold=ship.position.clone();y.clearTime=0;}
      else{if(distance<y.bestDistance-.05){y.bestDistance=distance;y.stalled=0;}else y.stalled+=dt;
        if(y.stalled>=COOPERATION.retry&&(ship.collisionLimited||ship.boundaryLimited)){y.failed.add(y.candidate);retryYield(ship,other,index,snapshot,y);}}
    }
    if(y.phase==='RETRY'){y.retryTime+=dt;if(y.retryTime>=COOPERATION.retry){if(y.failed.size)y.failed.clear();retryYield(ship,other,index,snapshot,y);}}
    if(y.phase==='WAIT'){
      const distance=ship.position.distanceTo(other.position),clear=(ship.collisionRadius??1.1)+(other.collisionRadius??1.1)+COOPERATION.clearance;
      const away=other.position.clone().sub(y.otherStart);if(distance>clear&&away.length()>clear*.5)y.clearTime+=dt;else y.clearTime=0;
      if(y.clearTime>=COOPERATION.release){ship.yieldState=null;ship.blockedTime=0;}
    }
  }
  const ordered=[...ships.values()].sort((a,b)=>a.id.localeCompare(b.id));
  for(const ship of ordered){
    const other=ships.get(ship.blockedBy);if(!other||teams.get(ship.fleetId)!==teams.get(other.fleetId)){ship.blockedTime=0;ship.blockedPartner=null;continue;}
    if(ship.blockedPartner!==other.id){ship.blockedPartner=other.id;ship.blockedTime=0;}ship.blockedTime=(ship.blockedTime||0)+dt;
    if(ship.blockedTime<COOPERATION.delay||ship.yieldState||other.yieldState)continue;
    const fleet=state.fleets.find(f=>f.id===ship.fleetId),otherFleet=state.fleets.find(f=>f.id===other.fleetId);
    const shipLeader=fleet?.tactics.policy==='COLUMN'&&fleet.columnLeaderId===ship.id,otherLeader=otherFleet?.tactics.policy==='COLUMN'&&otherFleet.columnLeaderId===other.id;
    const yielder=shipLeader!==otherLeader?(shipLeader?other:ship):(ship.velocity.length()<.1&&other.velocity.length()>.1?ship:other.velocity.length()<.1&&ship.velocity.length()>.1?other:ship.id.localeCompare(other.id)>0?ship:other);
    const priority=yielder===ship?other:ship;if(yielder.yieldState||priority.yieldState)continue;
    const y={otherId:priority.id,otherStart:priority.position.clone(),failed:new Set(),phase:'RETRY',hold:yielder.position.clone(),retryTime:0};yielder.yieldState=y;yielder.blockedTime=0;retryYield(yielder,priority,index,snapshot,y);
  }
}
function addProfile(state,key,start){if(start!==null)state.profile.ms[key]=(state.profile.ms[key]||0)+(performance.now()-start);}
export function step(state,dt=CONFIG.dt){
  if(state.phase!=='RUNNING')return;
  const all=state.fleets.flatMap(f=>f.ships).filter(s=>s.alive),snapshot=new Map(all.map(s=>[s.id,s.position.clone()]));
  const profileStart=state.profile?performance.now():null;
  const movementIndex=new ShipSpatialIndex(all,snapshot);movementIndex.columnMaxSpeed=Math.max(CONFIG.shipSpeed,...all.map(s=>Math.max(s.velocity.length(),(s.forwardSpeed??CONFIG.shipSpeed)+(s.maneuver?.max_vertical_speed??0))));addProfile(state,'movementIndex',profileStart);
  const encounterStart=state.profile?performance.now():null;updateEncounters(state,dt,movementIndex);addProfile(state,'encounters',encounterStart);
  const evasionStart=state.profile?performance.now():null;updateBreakthroughEvasion(state,movementIndex,snapshot);addProfile(state,'evasion',evasionStart);
  const aimSearchStart=state.profile?performance.now():null;updateAimTargets(state,movementIndex,snapshot);addProfile(state,'aimSearch',aimSearchStart);
  const safetyStart=state.profile?performance.now():null;updateSafety(state,movementIndex,snapshot,dt);addProfile(state,'safety',safetyStart);updateCooperation(state,movementIndex,snapshot,dt);
  for(const f of state.fleets){f.motionTime=(f.motionTime||0)+dt;moveAnchor(f,dt);if(!f.motionLimits)continue;if(f.tactics.policy!=='COLUMN')updateColumnPath(f,false);const lineStart=state.profile?performance.now():null;updateLineOffsets(f,state,movementIndex,snapshot);addProfile(state,'lineOffsets',lineStart);const points=f.tactics.policy==='COLUMN'?constrainedColumnSlots(f):slots(f);const aliveIndices=f.ships.map((ship,i)=>ship.alive?i:-1).filter(i=>i>=0);f.motionSlotError=Math.max(0,...aliveIndices.filter(i=>f.tactics.policy!=='COLUMN'||f.ships[i].id!==f.columnLeaderId).map(i=>f.ships[i].position.distanceTo(points[i])));
    const slotVelocities=formationSlotVelocities(f,points,dt);f.slotReferenceVelocities=slotVelocities;
    if(slotVelocities){f.formationRatio=aliveIndices.length?aliveIndices.filter(i=>f.ships[i].position.distanceTo(points[i])<=.8&&f.ships[i].velocity.distanceTo(slotVelocities[i])<=.5).length/aliveIndices.length:1;}
    f.ships.forEach((s,i)=>{
      if(!s.alive)return;
      const target=points[i].clone();
      if(s.evasion&&f.tactics.policy!=='COLUMN')target.add(s.evasion.offset);
      const separating=!!s.yieldState&&!(f.tactics.policy==='COLUMN'&&f.safetyStop);if(separating)target.copy(s.yieldState.phase==='MOVE'?s.yieldState.target:s.yieldState.hold);
      let face=vec(0,0,1).applyQuaternion(f.rotation);
      if(f.tactics.policy==='POINT_DEFENSE'){
        const radial=points[i].clone().sub(f.anchor);radial.y=0;
        if(radial.lengthSq()>1e-8)face=radial.normalize();
      }
      let up=vec(0,1,0);if(Math.abs(face.clone().normalize().dot(up))>.999)up=vec(1,0,0);
      const base=facing(face.clone().normalize(),up),aimStart=state.profile?performance.now():null,stable=(f.tactics.policy==='COLUMN'&&f.columnMode==='HOLD'||s.position.distanceTo(target)<=.8)&&s.velocity.length()<=.1,allowAim=stable&&(f.tactics.policy==='COLUMN'?(f.columnMode==='HOLD'||f.arrived):f.tactics.policy==='LINE'?f.encounter.lineEngaged:f.tactics.policy==='POINT_DEFENSE'?f.encounter.arrived:false),aimLimit=f.tactics.policy==='POINT_DEFENSE'?Math.acos(.9):f.tactics.policy==='LINE'?Math.PI/6:Math.PI/2,aimRotation=allowAim?aimFromBase(s,base,snapshot.get(s.id),true,aimLimit):null;addProfile(state,'aimPlan',aimStart);
    const slotVelocity=slotVelocities[i],column=f.tactics.policy==='COLUMN',leader=column&&s.id===f.columnLeaderId,braking=column&&(f.safetyStop||f.columnGoalBlocked)&&f.columnMode!=='HOLD',referenceSettled=f.safetyStop||f.encounter.target&&f.anchor.distanceTo(f.encounter.target)<.1,align=!separating&&!column&&f.encounter.active&&referenceSettled&&s.position.distanceTo(target)<=.8&&s.velocity.length()<=.5&&f.velocity.length()<=.1,track=!separating&&!align&&!leader&&(!column||!f.safetyStop&&!f.columnFoldedIds?.has(s.id))&&(column||!f.referenceArrived);steerShip(s,braking||column&&f.safetyStop||align?snapshot.get(s.id):target,dt,{mode:braking?'BRAKE':track?'TRACK':'STOP',targetVelocity:track?slotVelocity:null,face:align||stable?face:null,aimRotation:separating?null:aimRotation,speedLimit:leader?f.columnSpeed:s.forwardSpeed,compositeLimit:leader?f.motionLimits.cruise:s.forwardSpeed,accelerationLimit:leader?f.motionLimits.acceleration:Infinity,brakeLimit:leader?f.motionLimits.brake:Infinity});
      s.position.clamp(vec(BATTLEFIELD.min.x,BATTLEFIELD.min.y,BATTLEFIELD.min.z),vec(BATTLEFIELD.max.x,BATTLEFIELD.max.y,BATTLEFIELD.max.z));
    });
  }
  const collisionStart=state.profile?performance.now():null,priority=new Map(state.fleets.flatMap(f=>f.ships.map((s,i)=>{const slot=f.tactics.policy==='COLUMN'?columnLayout(f).byId.get(s.id):null;return [s.id,{group:slot?slot.ix+','+slot.iy:s.id,rank:slot?slot.rank:i}];})));resolveShipCollisions(all,movementIndex,snapshot,priority);addProfile(state,'movementCollision',collisionStart);
  for(const f of state.fleets){
    if(f.tactics.policy==='COLUMN'){updateColumnPath(f);const path=f.columnPath,leader=columnLeader(f);if(path?.points.length&&leader){const layout=columnLayout(f),sample=sampleColumnPath(path,layout.maxRank*SPACING_LEVELS[f.spacingLevels.z]*layout.scale/2),previous=f.anchor.clone();f.anchor.copy(sample.position);f.velocity.copy(f.anchor).sub(previous).divideScalar(dt);f.rotation.copy(sample.frame);f.referenceArrived=!!f.columnGoal&&leader.position.distanceTo(f.columnGoal)<.3&&leader.velocity.length()<.5&&f.anchor.distanceTo(f.destination)<.8;}}
    if(f.tactics.policy==='COLUMN'&&f.safetyStop&&f.columnMode==='BRAKE'&&f.velocity.length()<=.1&&f.ships.filter(s=>s.alive).every(s=>s.velocity.length()<=.1))f.columnMode='HOLD';
    const goals=slots(f),alive=f.ships.map((s,i)=>({s,i})).filter(({s})=>s.alive),settled=f.referenceArrived&&f.movement.policy==='MOVE'&&alive.length>0&&alive.every(({s,i})=>s.position.distanceTo(goals[i])<=.8&&s.velocity.length()<=.5);
    f.formationSettleTime=settled?(f.formationSettleTime||0)+dt:0;f.arrived=settled&&f.formationSettleTime>=.5;
  }
  const combatStart=state.profile?performance.now():null;combatTick(state,all,dt);addProfile(state,'combatTotal',combatStart);if(state.profile)state.profile.ticks++;
  if(!state.result)checkRecovery(state);
  if(!state.result&&!state.fleets.some(f=>f.ships.some(s=>s.alive))){state.phase='PREPARATION';state.preparationId++;}
  state.time+=dt;state.remaining=Math.max(0,state.remaining-dt);if(state.phase==='RUNNING'&&state.remaining<=1e-9){state.remaining=0;state.phase='PREPARATION';state.preparationId++;}
}
export function start(state){if(state.phase!=='PREPARATION')return;if(state.remaining<=0)state.remaining=CONFIG.duration;for(const f of state.fleets)f.aimCandidates=null;state.phase='RUNNING';}

function applyCombatDamage(state,damage){
  for(const [ship,value] of damage){const absorbed=Math.min(ship.shield??0,value);ship.shield=(ship.shield??0)-absorbed;ship.hp=Math.max(0,ship.hp-(value-absorbed));if(ship.hp===0){ship.alive=false;const record=state.reserves.find(r=>r.id===ship.id);if(record)record.status='DESTROYED';}}
}
// HITSCAN_SNAPSHOT prototype: the rendered flash is not an authoritative projectile.
function combatTick(state,ships,dt){
  const indexStart=state.profile?performance.now():null,index=new ShipSpatialIndex(ships);addProfile(state,'combatIndex',indexStart);
  const weaponStart=state.profile?performance.now():null,shots=state.combat?.(state,ships,dt,index)||[],damage=new Map();addProfile(state,'weapons',weaponStart);if(state.profile)state.profile.shots+=shots.length;
  const teamByFleet=new Map(state.fleets.map(f=>[f.id,f.team]));
  state.shotEffects=state.shotEffects.filter(p=>(p.life-=dt)>0);
  state.attackEvents=[];
  const stats={shotCandidates:shots.length,rayCandidates:0,ownSafetyChecks:0,attackEvents:0};
  for(const shot of shots){
    if(!shot.position?.toArray().every(Number.isFinite)||!shot.direction?.toArray().every(Number.isFinite)||!Number.isFinite(shot.range)||shot.range<=0||Math.abs(shot.direction.lengthSq()-1)>1e-4)continue;
    const end=shot.position.clone().addScaledVector(shot.direction,shot.range);let first=null;
    const contactStart=state.profile?performance.now():null;first=findFirstContact(index,shot,end,state.hitSearchAlgorithm,stats);addProfile(state,'contact',contactStart);
    // Friendly first contact vetoes the entire shot. No cooldown or flash is consumed.
    if(!first||teamByFleet.get(first.ship.fleetId)===shot.team){shot.onResolved?.(first?shot.position.clone().lerp(end,first.fraction):null);shot.weapon.blockReason=first?'FRIENDLY_BLOCK':'NO_HIT';shot.weapon.blockedSince??=state.time;continue;}
    if(shot.validate){stats.ownSafetyChecks++;const safeStart=state.profile?performance.now():null,safe=shot.validate();addProfile(state,'ownSafety',safeStart);if(!safe){shot.onResolved?.(shot.position);continue;}}
    damage.set(first.ship,(damage.get(first.ship)||0)+shot.damage);
    if(!shot.isRayPulse){shot.weapon.cooldown=shot.weapon.cooldownSec??2;shot.onHit?.();}shot.weapon.blockReason='RELOADING';delete shot.weapon.blockedSince;
    const position=shot.position.clone().lerp(end,first.fraction),id=state.nextAttackId++;shot.onResolved?.(position);
    state.attackEvents.push({id,tickTime:state.time,ownerShipId:shot.ownerShipId,weaponId:shot.weapon.id,muzzleId:shot.muzzleId,receiverShipId:first.ship.id,origin:shot.position.clone(),impact:position.clone(),damage:shot.damage});
    if(!shot.isRayPulse&&!shot.onHit){state.shotEffects.push({id,origin:shot.position.clone(),position,life:({BOLT01:.65,BOLT02:.85,BOLT03:1.10,BOLT04:1.40}[shot.visualType]??.65)});state.fxRequests??=[];state.fxRequests.push({id,tickTime:state.time,type:shot.visualType,team:shot.team,origin:shot.position.clone(),impact:position.clone()});}stats.attackEvents++;
  }
  state.combatStats=stats;
  // Apply after every shot has been resolved against the same live-ship snapshot.
  applyCombatDamage(state,damage);
  state.scoreTicks++;if(state.scoreTicks>=SCORE_CONFIG.tickCount){state.scoreTicks-=SCORE_CONFIG.tickCount;scoreZones(state);}
}
