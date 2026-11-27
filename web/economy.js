export function createEconomy({ECONOMY_CONFIG,BATTLEFIELD,ShipSpatialIndex,axes,vec,ship,fleet,sizeForSpacing}){
function purchaseShip(state,team,typeId=ECONOMY_CONFIG.typeId,requestId){
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
function assignReserve(state,team,shipId,fleetId){
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
function deployReserves(state,prepareView){
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
return {purchaseShip,assignReserve,deployReserves};
}
