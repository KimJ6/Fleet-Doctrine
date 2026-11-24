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
export const PATROL_MAX_POINTS=32;
export const ENCOUNTER_CONFIG=Object.freeze({enter:38,exit:48,grace:2,minRange:24,maxRange:32,scanTicks:12});
export function setCombatPolicy(f,policy){if(!['OPPORTUNISTIC_FIRE','STANDOFF','POINT_DEFENSE'].includes(policy))throw Error('교전 대응이 올바르지 않습니다.');if(f.tactics.policy!==policy){f.tactics.policy=policy;f.tactics.revision++;}}
export function setDefenseAnchor(f,point){if(point!==null)validPoint(point);const next=point?copyPoint(point):null;if(JSON.stringify(f.tactics.defenseAnchor)!==JSON.stringify(next)){f.tactics.defenseAnchor=next;f.tactics.anchorRevision++;}}
const copyPoint=p=>({ix:p.ix,iy:p.iy,iz:p.iz});
const pointKey=p=>p.ix+','+p.iy+','+p.iz;
function validPoint(point){const world=gridToWorld(point);if(!insideBattlefield(world))throw new Error('전장 경계 밖의 목표는 지정할 수 없습니다.');return world;}
function refreshMovementTarget(f){const order=f.movement,point=order.policy==='PATROL'?order.patrolPoints[order.activeIndex]:order.movePoint;if(!point)throw Error('이동 목표가 없습니다.');f.destinationIndex=copyPoint(point);f.destination.copy(validPoint(point));}
export function setDestination(f,point){validPoint(point);f.movement.movePoint=copyPoint(point);if(f.movement.policy==='MOVE'){refreshMovementTarget(f);f.arrived=false;}}
export function setMovementPolicy(f,policy){if(!['MOVE','PATROL'].includes(policy))throw Error('이동 명령이 올바르지 않습니다.');if(policy==='PATROL'&&new Set(f.movement.patrolPoints.map(pointKey)).size<2)throw Error('서로 다른 경유점 두 개 이상이 필요합니다.');if(f.movement.policy===policy)return;f.movement.policy=policy;refreshMovementTarget(f);f.arrived=false;}
export function setPatrolRoute(f,points){if(!Array.isArray(points)||points.length<2||points.length>PATROL_MAX_POINTS)throw Error('경유점은 2개 이상 32개 이하이어야 합니다.');const copy=points.map(p=>{validPoint(p);return copyPoint(p)});if(new Set(copy.map(pointKey)).size<2)throw Error('서로 다른 경유점 두 개 이상이 필요합니다.');const order=f.movement;if(JSON.stringify(order.patrolPoints)===JSON.stringify(copy))return false;order.patrolPoints=copy;order.revision++;order.activeIndex=0;if(order.policy==='PATROL'){refreshMovementTarget(f);f.arrived=false;}return true;}
function advancePatrol(f){const order=f.movement;if(order.policy!=='PATROL')return;const points=order.patrolPoints;if(points.length<2)return;let checked=0;while(checked<points.length&&f.anchor.distanceTo(f.destination)<=CONFIG.arrivalDistance&&f.velocity.length()<=CONFIG.arrivalSpeed){order.activeIndex=(order.activeIndex+1)%points.length;refreshMovementTarget(f);checked++;}if(checked)f.arrived=false;}

const ship=(id,fleetId)=>({id,fleetId,position:vec(),velocity:vec(),rotation:new THREE.Quaternion(),hp:100,maxHp:100,alive:true,weapons:[]});
function fleet(id,team,anchor,destination,count){
  const ships=Array.from({length:count},(_,i)=>ship(`${id}-${i+1}`,id));
  const f={id,team,anchor:anchor.clone(),velocity:vec(),rotation:new THREE.Quaternion(),destination:vec(),destinationIndex:null,movement:{policy:'MOVE',movePoint:null,patrolPoints:[],revision:0,activeIndex:0},tactics:{policy:'OPPORTUNISTIC_FIRE',revision:0,defenseAnchor:null,anchorRevision:0},encounter:{active:false,enemyId:null,policy:null,revision:0,anchorRevision:0,outside:0,defensePoint:null,defenseSource:null,arrived:false,mode:'HOLD'},size:vec(8,8,8),spacingLevels:{x:'normal',y:'normal',z:'normal'},ships,arrived:false,lastHorizontal:vec(0,0,1),posture:'MOVING'};
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
  if(f.encounter.active){const n=f.ships.length;if(!n)return [];const offsets=[];if(f.encounter.policy==='STANDOFF'){const columns=Math.ceil(Math.sqrt(n)),rows=Math.ceil(n/columns),spacing=SPACING_LEVELS[f.spacingLevels.x];for(let i=0;i<n;i++)offsets.push(vec((i%columns-(columns-1)/2)*spacing,(Math.floor(i/columns)-(rows-1)/2)*spacing,0));}
    else if(n===1)offsets.push(vec());else {const spacing=Math.max(...Object.values(f.spacingLevels).map(x=>SPACING_LEVELS[x])),radius=Math.max(spacing,spacing*Math.sqrt(n)/2),golden=Math.PI*(3-Math.sqrt(5));for(let i=0;i<n;i++){const y=1-2*(i+.5)/n,r=Math.sqrt(1-y*y),a=i*golden;offsets.push(vec(Math.cos(a)*r,y,Math.sin(a)*r).multiplyScalar(radius));}}
    const points=offsets.map(p=>p.applyQuaternion(f.rotation).add(f.anchor)),bounds=new THREE.Box3().setFromPoints(points),shift=vec();
    for(const axis of axes){const width=bounds.max[axis]-bounds.min[axis],available=BATTLEFIELD.max[axis]-BATTLEFIELD.min[axis];if(width<=available){if(bounds.min[axis]<BATTLEFIELD.min[axis])shift[axis]=BATTLEFIELD.min[axis]-bounds.min[axis];else if(bounds.max[axis]>BATTLEFIELD.max[axis])shift[axis]=BATTLEFIELD.max[axis]-bounds.max[axis];}}
    return points.map(p=>p.add(shift).clamp(vec(BATTLEFIELD.min.x,BATTLEFIELD.min.y,BATTLEFIELD.min.z),vec(BATTLEFIELD.max.x,BATTLEFIELD.max.y,BATTLEFIELD.max.z)));}
  const key=[f.ships.length,f.size.x,f.size.y,f.size.z].join('|');
  if(f.slotTemplateKey!==key){f.slotTemplate=grid(f.ships.length,f.size);f.slotTemplateKey=key;}
  return f.slotTemplate.map(p=>p.clone().applyQuaternion(f.rotation).add(f.anchor));
}
export function initialState(){
  const fleets=[fleet('A','ALLY',vec(-8,0,46),vec(-8,0,0),4),fleet('B','ALLY',vec(8,0,46),vec(8,0,0),4),fleet('E','ENEMY',vec(0,0,-46),vec(0,0,0),8)];
  for(const f of fleets){const points=slots(f);f.ships.forEach((s,i)=>s.position.copy(points[i]));}return {phase:'PREPARATION',time:0,remaining:CONFIG.duration,fleets,shotEffects:[],attackEvents:[],nextAttackId:1,combatStats:{},scores:{ALLY:0,ENEMY:0},scoreTicks:0,result:null,combat:null,reserves:[],purchaseResults:{},nextShipId:1,nextFleetId:1,preparationId:0,aiPrepared:-1,assetsAvailable:true,stalledDeployments:0};
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
export const ECONOMY_CONFIG=Object.freeze({typeId:'light-cruiser-01',price:30,maxOwned:32,spawnSpacing:4,spawnDepth:4,spawnRadius:1.1});
export function purchaseShip(state,team,typeId=ECONOMY_CONFIG.typeId,requestId){
  if(typeof requestId!=='string'||!requestId)return {ok:false,reason:'구매 요청이 올바르지 않습니다.'};
  const key=team+':'+requestId;if(state.purchaseResults[key])return state.purchaseResults[key];
  let reason='';const price=ECONOMY_CONFIG.price;
  if(state.phase!=='PREPARATION'||state.result)reason='준비 단계에서만 구매할 수 있습니다.';
  else if(!['ALLY','ENEMY'].includes(team)||typeId!==ECONOMY_CONFIG.typeId||!Number.isSafeInteger(price)||price<=0)reason='구매 항목이 올바르지 않습니다.';
  else if(!state.assetsAvailable)reason='사용 가능한 함선 모델이 없습니다.';
  else if(!Number.isSafeInteger(state.scores[team])||state.scores[team]<price)reason='점수가 부족합니다.';
  else if(state.reserves.filter(r=>r.team===team&&(r.status==='OWNED'||r.status==='ASSIGNED')).length+state.fleets.filter(f=>f.team===team).flatMap(f=>f.ships).filter(s=>s.alive).length>=ECONOMY_CONFIG.maxOwned)reason='함선 보유 한도에 도달했습니다.';
  const result=reason?{ok:false,reason}:(()=>{const reserve={id:team+'-R'+state.nextShipId++,team,typeId,status:'OWNED',fleetId:null,reason:''};state.scores[team]-=price;state.reserves.push(reserve);state.stalledDeployments=0;return {ok:true,shipId:reserve.id};})();
  state.purchaseResults[key]=result;return result;
}
export function assignReserve(state,team,shipId,fleetId){
  if(state.phase!=='PREPARATION'||state.result)return {ok:false,reason:'준비 단계에서만 배정할 수 있습니다.'};
  const reserve=state.reserves.find(r=>r.id===shipId&&r.team===team&&(r.status==='OWNED'||r.status==='ASSIGNED'));if(!reserve)return {ok:false,reason:'예비 함선을 찾을 수 없습니다.'};
  if(fleetId!==null&&fleetId!=='NEW'&&!state.fleets.some(f=>f.id===fleetId&&f.team===team))return {ok:false,reason:'같은 진영의 함대를 선택하세요.'};
  reserve.fleetId=fleetId;reserve.status=fleetId===null?'OWNED':'ASSIGNED';reserve.reason='';state.stalledDeployments=0;return {ok:true};
}
function spawnLocation(state,team,radius){
  const occupied=state.fleets.flatMap(f=>f.ships).filter(s=>s.alive),index=new ShipSpatialIndex(occupied),z=team==='ALLY'?BATTLEFIELD.max.z-radius-ECONOMY_CONFIG.spawnDepth:BATTLEFIELD.min.z+radius+ECONOMY_CONFIG.spawnDepth;
  for(let ring=0;ring<=10;ring++)for(let x=-ring;x<=ring;x++)for(let y=-ring;y<=ring;y++){
    if(Math.max(Math.abs(x),Math.abs(y))!==ring)continue;const p=vec(x*ECONOMY_CONFIG.spawnSpacing,y*ECONOMY_CONFIG.spawnSpacing,z);
    if(!axes.every(axis=>p[axis]-radius>=BATTLEFIELD.min[axis]&&p[axis]+radius<=BATTLEFIELD.max[axis]))continue;
    if(index.near(p,radius).every(s=>p.distanceToSquared(s.position)>=Math.pow(radius+(s.collisionRadius??ECONOMY_CONFIG.spawnRadius),2)))return p;
  }return null;
}
// prepareView builds detached visual state and exposes commit/rollback; game state is changed only after success.
export function deployReserves(state,prepareView){
  if(state.phase!=='PREPARATION'||state.result)return {ok:false,reason:'준비 단계에서만 투입할 수 있습니다.'};
  let deployed=0,waiting=0;
  for(const reserve of state.reserves.filter(r=>r.status==='ASSIGNED').sort((a,b)=>a.id.localeCompare(b.id))){
    let target=reserve.fleetId==='NEW'?null:state.fleets.find(f=>f.id===reserve.fleetId&&f.team===reserve.team);
    if(!target&&reserve.fleetId!=='NEW'){reserve.reason='대상 함대를 찾을 수 없습니다.';waiting++;continue;}
    const position=spawnLocation(state,reserve.team,state.spawnRadius??ECONOMY_CONFIG.spawnRadius);if(!position){reserve.reason='시작 면에 배치 공간이 없습니다.';waiting++;continue;}
    const newId=reserve.fleetId==='NEW'?reserve.team+'-F'+state.nextFleetId:null;
    const nextFleet=target||fleet(newId,reserve.team,position,vec(0,0,0),0);
    const unit=ship(reserve.id,nextFleet.id);unit.position.copy(position);if(reserve.team==='ALLY')unit.rotation.setFromAxisAngle(vec(0,1,0),Math.PI);
    let view;try{view=prepareView(unit);if(!view||typeof view.commit!=='function'||typeof view.rollback!=='function')throw Error('모델을 준비할 수 없습니다.');view.commit();}
    catch(error){try{view?.rollback();}catch{}reserve.reason='모델 준비 실패: '+error.message;waiting++;continue;}
    if(!target){state.nextFleetId++;state.fleets.push(nextFleet);target=nextFleet;}
    target.ships.push(unit);target.size.copy(sizeForSpacing(target.ships.length,target.spacingLevels));reserve.status='ACTIVE';reserve.fleetId=target.id;reserve.reason='';deployed++;
  }
  const pending=state.reserves.filter(r=>r.status==='ASSIGNED');
  if(deployed)state.stalledDeployments=0;else if(waiting&&!state.fleets.some(f=>f.ships.some(s=>s.alive))&&pending.length&&pending.every(r=>r.reason==='시작 면에 배치 공간이 없습니다.'))state.stalledDeployments++;else state.stalledDeployments=0;
  return {ok:true,deployed,waiting};
}
export function prepareEnemyAI(state){
  if(state.phase!=='PREPARATION'||state.aiPrepared===state.preparationId)return;state.aiPrepared=state.preparationId;
  const fleet=state.fleets.find(f=>f.team==='ENEMY'&&f.ships.some(s=>s.alive));if(fleet){const ranked=ZONES.map(z=>{const c=zoneCounts(state,z),center=z.min.clone().add(z.max).multiplyScalar(.5);return {z,center,score:z.multiplier*3+(c.ALLY-c.ENEMY)-fleet.anchor.distanceTo(center)*.05};}).sort((a,b)=>b.score-a.score||a.z.id.localeCompare(b.z.id));if(ranked.length)setDestination(fleet,worldToNearestGrid(ranked[0].center));}
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
function moveAnchor(f,dt){
  const active=f.encounter.active;if(!active)advancePatrol(f);
  const target=active?f.encounter.target:f.destination;
  const delta=target.clone().sub(f.anchor),dist=delta.length(),speed=f.velocity.length();
  if(active){f.posture='ENGAGING';f.arrived=false;if(f.encounter.face)updateOrientation(f,f.encounter.face,dt);if(dist<=CONFIG.arrivalDistance&&speed<=CONFIG.arrivalSpeed){f.velocity.set(0,0,0);return;}}
  if(!active&&dist<=CONFIG.arrivalDistance && speed<=CONFIG.arrivalSpeed){f.velocity.set(0,0,0);if(f.movement.policy==='PATROL'){f.arrived=false;f.posture='MOVING';return;}f.arrived=true;f.posture='IDLE';const q=facing(f.lastHorizontal.clone(),vec(0,1,0));f.rotation.rotateTowards(q,CONFIG.turnRate*dt);return;}
  f.arrived=false;if(!active){f.posture='MOVING';if(dist>1e-8)updateOrientation(f,delta,dt);}
  const desired=dist>1e-8?delta.clone().multiplyScalar(Math.min(CONFIG.anchorSpeed,Math.sqrt(2*CONFIG.anchorAcceleration*dist))/dist):vec();
  f.velocity.add(desired.sub(f.velocity).clampLength(0,CONFIG.anchorAcceleration*dt));
  const travel=f.velocity.clone().multiplyScalar(dt);
  // Clamp only the final segment when it reaches the target; velocity still decelerates.
  if(dist>1e-8 && travel.dot(delta)>0 && travel.length()>=dist && travel.clone().cross(delta).length()<1e-7){f.anchor.copy(target);f.velocity.set(0,0,0);}else f.anchor.add(travel);
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
// Data-only target scoring; reserved damage is a per-fleet planning estimate, never HP mutation.
export function chooseCombatTarget(candidates,previousId,reservedDamage,shotDamage,range=45){
  let best=null,bestScore=Infinity;for(const item of candidates){const enemy=item.enemy;if(!enemy?.alive||!Number.isFinite(enemy.hp)||enemy.hp<=0||!Number.isFinite(item.distance))continue;
    const reserved=reservedDamage.get(enemy.id)||0,overkill=Math.max(0,(reserved+shotDamage-enemy.hp)/enemy.hp);
    const score=item.distance/(range*range)+overkill*.6-(enemy.id===previousId?.08:0);
    if(score<bestScore-1e-9||(Math.abs(score-bestScore)<=1e-9&&(!best||enemy.id.localeCompare(best.id)<0))){best=enemy;bestScore=score;}
  }return best;
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
function fleetBounds(f){const alive=f.ships.filter(s=>s.alive);if(!alive.length)return null;const box=new THREE.Box3().setFromPoints(alive.map(s=>s.position)),center=box.getCenter(vec());let radius=0;for(const s of alive)radius=Math.max(radius,center.distanceTo(s.position)+(s.collisionRadius??1.1));return {center,radius,box};}
function updateEncounters(state,dt){
  if(state.fleets.every(f=>!f.encounter.active&&f.tactics.policy==='OPPORTUNISTIC_FIRE'))return;
  const bounds=new Map(state.fleets.map(f=>[f.id,fleetBounds(f)])),byId=new Map(state.fleets.map(f=>[f.id,f]));
  const scan=Math.round(state.time/CONFIG.dt)%ENCOUNTER_CONFIG.scanTicks===0;
  const fleetIndex=scan&&state.fleets.some(f=>!f.encounter.active&&f.tactics.policy!=='OPPORTUNISTIC_FIRE')?new ShipSpatialIndex(state.fleets.filter(f=>bounds.get(f.id)).map(f=>({id:f.id,position:bounds.get(f.id).center,collisionRadius:bounds.get(f.id).radius}))):null;
  const distance=(a,b)=>Math.max(0,a.center.distanceTo(b.center)-a.radius-b.radius);
  for(const f of state.fleets){const e=f.encounter,own=bounds.get(f.id);if(!own){e.active=false;continue;}
    if(e.active&&e.revision!==f.tactics.revision){e.active=false;e.enemyId=null;continue;}
    if(!e.active){if(f.tactics.policy==='OPPORTUNISTIC_FIRE'||!fleetIndex)continue;
      const box=own.box.clone().expandByScalar(ENCOUNTER_CONFIG.enter+own.radius),ids=new Set(fleetIndex.query(box.min,box.max).map(item=>item.id));let choices=[...ids].map(id=>byId.get(id)).filter(other=>other&&other.team!==f.team&&bounds.get(other.id)).map(other=>({other,d:distance(own,bounds.get(other.id))})).filter(x=>x.d<=ENCOUNTER_CONFIG.enter).sort((a,b)=>a.d-b.d||a.other.id.localeCompare(b.other.id));if(!choices.length)continue;
      e.active=true;e.enemyId=choices[0].other.id;e.policy=f.tactics.policy;e.revision=f.tactics.revision;e.anchorRevision=f.tactics.anchorRevision;e.outside=0;e.arrived=false;e.mode='HOLD';if(e.policy==='POINT_DEFENSE'){const point=f.tactics.defenseAnchor||f.destinationIndex;e.defensePoint=point?validPoint(point):f.anchor.clone();e.defenseSource=f.tactics.defenseAnchor?'USER':point?'AUTO':'CURRENT';} }
    if(e.policy==='POINT_DEFENSE'&&e.anchorRevision!==f.tactics.anchorRevision){const point=f.tactics.defenseAnchor||f.destinationIndex;e.defensePoint=point?validPoint(point):f.anchor.clone();e.defenseSource=f.tactics.defenseAnchor?'USER':point?'AUTO':'CURRENT';e.anchorRevision=f.tactics.anchorRevision;e.arrived=false;}
    const enemy=bounds.get(e.enemyId),gone=!enemy;if(!gone&&distance(own,enemy)>ENCOUNTER_CONFIG.exit)e.outside+=dt;else if(!gone)e.outside=0;
    if(e.policy==='POINT_DEFENSE'){e.target=e.defensePoint.clone();e.face=enemy?enemy.center.clone().sub(f.anchor):null;e.arrived=e.arrived||(f.anchor.distanceTo(e.defensePoint)<=CONFIG.arrivalDistance&&f.velocity.length()<=CONFIG.arrivalSpeed);}
    if((gone||e.outside>=ENCOUNTER_CONFIG.grace)&&(e.policy!=='POINT_DEFENSE'||e.arrived)){e.active=false;e.enemyId=null;e.target=null;e.face=null;continue;}
    if(e.policy==='STANDOFF'&&enemy){const toward=enemy.center.clone().sub(f.anchor),d=toward.length();if(d>1e-9)toward.multiplyScalar(1/d);else toward.copy(f.lastHorizontal);if(e.mode==='APPROACH'&&d<=ENCOUNTER_CONFIG.maxRange-1)e.mode='HOLD';else if(e.mode==='RETREAT'&&d>=ENCOUNTER_CONFIG.minRange+1)e.mode='HOLD';else if(e.mode==='HOLD'&&d>ENCOUNTER_CONFIG.maxRange+1)e.mode='APPROACH';else if(e.mode==='HOLD'&&d<ENCOUNTER_CONFIG.minRange-1)e.mode='RETREAT';const amount=e.mode==='APPROACH'?Math.max(0,d-ENCOUNTER_CONFIG.maxRange):e.mode==='RETREAT'?-Math.max(0,ENCOUNTER_CONFIG.minRange-d):0;e.target=f.anchor.clone().addScaledVector(toward,amount).clamp(vec(BATTLEFIELD.min.x,BATTLEFIELD.min.y,BATTLEFIELD.min.z),vec(BATTLEFIELD.max.x,BATTLEFIELD.max.y,BATTLEFIELD.max.z));e.face=toward;}
  }
}
export function step(state,dt=CONFIG.dt){
  if(state.phase!=='RUNNING')return;
  const all=state.fleets.flatMap(f=>f.ships).filter(s=>s.alive),snapshot=new Map(all.map(s=>[s.id,s.position.clone()]));
  const movementIndex=new ShipSpatialIndex(all,snapshot);
  updateEncounters(state,dt);
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
  if(!state.result)checkRecovery(state);
  if(!state.result&&!state.fleets.some(f=>f.ships.some(s=>s.alive))){state.phase='PREPARATION';state.preparationId++;}
  state.time+=dt;state.remaining=Math.max(0,state.remaining-dt);if(state.phase==='RUNNING'&&state.remaining<=1e-9){state.remaining=0;state.phase='PREPARATION';state.preparationId++;}
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
  for(const [ship,value] of damage){ship.hp=Math.max(0,ship.hp-value);if(ship.hp===0){ship.alive=false;const record=state.reserves.find(r=>r.id===ship.id);if(record)record.status='DESTROYED';}}
  state.scoreTicks++;if(state.scoreTicks>=SCORE_CONFIG.tickCount){state.scoreTicks-=SCORE_CONFIG.tickCount;scoreZones(state);}
}
