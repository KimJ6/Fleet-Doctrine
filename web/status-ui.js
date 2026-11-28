export function createStatusUI({$,state,SCORE_CONFIG,ECONOMY_CONFIG,tacticLabels,getSlots,getContext}){
let diagnosticFleet=null,diagnosticAt=-Infinity,diagnosticText='';
function formationDiagnostic(f){
  const e=f.encounter,b=e.breakthrough;if(!e.active||(!b&&e.policy!=='POINT_DEFENSE'))return '';
  const now=performance.now();if(diagnosticFleet===f&&now-diagnosticAt<500)return diagnosticText;
  diagnosticFleet=f;diagnosticAt=now;const points=getSlots(f);let maxError=0,maxRelativeSpeed=0;
  for(let i=0;i<f.ships.length;i++){const s=f.ships[i];if(!s.alive||!points[i])continue;maxError=Math.max(maxError,s.position.distanceTo(points[i]));maxRelativeSpeed=Math.max(maxRelativeSpeed,s.velocity.clone().sub(f.slotReferenceVelocities?.[i]??f.velocity).length());}
  const common=' 준비도='+Math.round((f.formationRatio??0)*100)+'% 최대슬롯오차='+maxError.toFixed(2)+' 최대상대속도='+maxRelativeSpeed.toFixed(2);
  if(b){const direction=b.axis.clone().normalize(),forward=direction.clone().set(0,0,1).applyQuaternion(f.rotation),angle=Math.acos(Math.max(-1,Math.min(1,forward.dot(direction))))*180/Math.PI;diagnosticText=' · 돌파진단 단계='+b.phase+' 경과/제한='+b.time.toFixed(1)+'/'+b.timeLimit.toFixed(1)+'초 정렬각='+angle.toFixed(1)+'°'+common;}
  else diagnosticText=' · 거점진단 거리='+(e.defensePoint?f.anchor.distanceTo(e.defensePoint).toFixed(2):'--')+' 정체시간='+(e.defenseStallTime??0).toFixed(1)+'초'+common;
  return diagnosticText;
}
function updateEconomySummary(){
  $('economy-balance').textContent='보유 '+state.scores.ALLY+'점 / 승리 목표 '+SCORE_CONFIG.victory+'점';$('purchase-info').textContent='가격 '+ECONOMY_CONFIG.price+'점 · 구매 후 '+Math.max(0,state.scores.ALLY-ECONOMY_CONFIG.price)+'점';
}
function updateStatus(){
  const {selected,draft,patrolEdit,manualPaused}=getContext();
  updateEconomySummary();
  $('ally-score').textContent=state.scores.ALLY;$('enemy-score').textContent=state.scores.ENEMY;$('victory-score').textContent=SCORE_CONFIG.victory;
  $('hud').textContent=state.phase==='RESULT'?(state.result==='DRAW'?'무승부':state.result==='ALLY'?'아군 승리':'적군 승리'):state.phase==='RUNNING'?'전투 중 · '+state.remaining.toFixed(1)+'초':draft?'위치 지정 중':patrolEdit?'순찰 경로 편집 중':state.time===0?'전투 준비':manualPaused?'일시정지':'다음 전투 준비';
  $('fleet-title').textContent=selected.id+' 함대 · '+selected.ships.filter(s=>s.alive).length+'척';const levels=Object.values(selected.spacingLevels),spacing=levels.every(x=>x===levels[0])?({tight:'좁게',normal:'보통',wide:'넓게'}[levels[0]]):'개별';$('command-summary').textContent=(selected.movement.policy==='PATROL'?'순찰':'목적지 이동')+' · '+tacticLabels[selected.tactics.policy]+' · '+spacing+' 간격';
  const e=selected.encounter;let activity=selected.columnGoalBlocked?'전장 경계로 진형 배치 불가':selected.pathBlockId?'대치 사격 중':selected.movement.policy==='PATROL'?'순찰 중':'이동 중';if(e.active){activity=e.breakthrough?({FORMATION:'돌파 준비 중',CHARGE:'돌파 진입 중',TRANSIT:'돌파 중'}[e.breakthrough.phase]||'돌파 중'):e.policy==='LINE'?(selected.safetyStop?'대치 사격 중':'적 함대 접근 중'):e.arrived?'거점 방어 중':'거점 이동 중';activity+=' · 적 '+e.enemyId+' 함대';}else if(e.reason)activity=e.reason;else if(selected.arrived)activity='목적지 도착';if(state.phase==='PREPARATION')activity=state.time===0?'준비 중':(manualPaused?'일시정지 · ':'준비 중 · ')+activity;$('fleet-info').textContent=activity;$('fleet-info').hidden=state.phase==='PREPARATION'&&!e.active&&!e.reason&&!selected.columnGoalBlocked;
  if($('debug-menu').open){const p=state.profile,frame=p?.frameSummary;const metrics=p?' · PROFILE ticks='+p.ticks+' shots='+p.shots+' frames='+p.frames+' wall='+p.wallMs.toFixed(0)+'ms capped='+p.cappedMs.toFixed(1)+'ms dropped='+p.droppedStepMs.toFixed(1)+'ms'+(frame?' frame-p50/p95/p99='+[frame.p50,frame.p95,frame.p99].map(v=>v.toFixed(1)).join('/')+'ms samples='+frame.samples:'')+' '+Object.entries(p.ms).map(([k,v])=>k+'='+v.toFixed(1)+'ms').join(' '):'';$('debug-target').textContent='이동 목표 '+selected.destination.toArray().map(x=>x.toFixed(1)).join(', ')+' · '+(e.policy||'MOVEMENT')+(p?formationDiagnostic(selected):'')+metrics;}
}
return {updateEconomySummary,updateStatus};
}
