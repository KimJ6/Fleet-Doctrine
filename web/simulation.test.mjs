import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runtime} from '../rigging-test/node-runtime.mjs';
const rt=await runtime(),T=rt.THREE;
let count=0;const pass=label=>{count++;console.log('PASS',label);};
 // Game-level regression checks share the pinned Three.js runtime.
 {
  const spatial=await readFile(new URL('./spatial-index.js',import.meta.url),'utf8');
  const spatialURL='data:text/javascript;base64,'+Buffer.from(spatial).toString('base64');
  const hit=await readFile(new URL('./hit-resolution.js',import.meta.url),'utf8');
  const hitURL='data:text/javascript;base64,'+Buffer.from(hit).toString('base64');
  const score=(await readFile(new URL('./scoring.js',import.meta.url),'utf8')).replace("from 'three'","from '"+rt.threeURL+"'");
  const scoreURL='data:text/javascript;base64,'+Buffer.from(score).toString('base64');
  const economy=await readFile(new URL('./economy.js',import.meta.url),'utf8');
  const economyURL='data:text/javascript;base64,'+Buffer.from(economy).toString('base64');
  const game=await rt.module((await readFile(new URL('./simulation.js',import.meta.url),'utf8')).replace('./spatial-index.js?v=refactor-20261127c',spatialURL).replace('./hit-resolution.js?v=refactor-20261127c',hitURL).replace('./scoring.js?v=refactor-20261127c',scoreURL).replace('./economy.js?v=refactor-20261127c',economyURL));
  const balance={ship:{max_hp:123,max_shield:45,forward_speed:6,price:30,maneuver:{max_reverse_speed:.9,max_vertical_speed:.6,forward_acceleration:4,reverse_acceleration:1.5,brake_deceleration:4,vertical_acceleration:1,max_yaw_rate:.8,max_pitch_rate:.5,max_roll_rate:.5,max_pitch_angle:25,max_roll_angle:15,attitude_recovery_rate:.5,stationary_turn_ratio:.3}},rules:{score_interval_sec:1,score_base:1,score_advantage_cap:3,victory_score:1000,center_zone_multiplier:2,side_zone_multiplier:1},maxRange:48};
  game.configureBalance(balance);const state=game.initialState();
  const nav=state.fleets[0].ships[0],origin=new T.Vector3();nav.position.copy(origin);nav.rotation.identity();nav.velocity.set(0,0,0);
  for(let i=0;i<180;i++){game.steerShip(nav,new T.Vector3(0,0,30),game.CONFIG.dt);const forward=new T.Vector3(0,0,1).applyQuaternion(nav.rotation),expected=forward.multiplyScalar(nav.propulsionForward);expected.y+=nav.propulsionVertical;assert(nav.velocity.distanceTo(expected)<1e-8,'propulsion uses forward and world-up only');assert(Math.abs(nav.propulsionVertical)<=balance.ship.maneuver.max_vertical_speed+1e-9);assert(nav.propulsionForward<=nav.forwardSpeed+1e-9);}
  assert(nav.position.z>0);const previous=nav.position.clone();nav.propulsionForward=0;nav.propulsionVertical=0;nav.rotation.identity();game.steerShip(nav,new T.Vector3(30,0,previous.z),game.CONFIG.dt);assert(Math.abs(nav.position.x-previous.x)<1e-8,'side target cannot cause a lateral impulse');
  const rear=state.fleets[0].ships[1];rear.position.set(0,0,0);rear.rotation.identity();game.steerShip(rear,new T.Vector3(0,0,-30),game.CONFIG.dt);assert(rear.propulsionForward>=0,'distant rear target does not command reverse');
  const reverse=state.fleets[0].ships[2];reverse.position.set(0,0,0);reverse.rotation.identity();let prior=0;for(let i=0;i<60;i++){game.steerShip(reverse,new T.Vector3(0,0,-1),game.CONFIG.dt);assert(reverse.propulsionForward>=-balance.ship.maneuver.max_reverse_speed-1e-9);assert(Math.abs(reverse.propulsionForward-prior)<=balance.ship.maneuver.reverse_acceleration*game.CONFIG.dt+1e-9);prior=reverse.propulsionForward;}assert(reverse.propulsionForward<0,'near rear target permits limited reverse');
  const vertical=state.fleets[0].ships[3];vertical.position.set(0,0,0);vertical.rotation.identity();for(let i=0;i<180;i++){game.steerShip(vertical,new T.Vector3(0,30,0),game.CONFIG.dt);const a=new T.Euler().setFromQuaternion(vertical.rotation,'YXZ');assert(Math.abs(a.x)<=25*Math.PI/180+1e-9);assert(Math.abs(a.z)<=15*Math.PI/180+1e-9);assert(Math.abs(vertical.propulsionVertical)<=balance.ship.maneuver.max_vertical_speed+1e-9);}
  pass('constrained navigation uses bow and world-up propulsion');
  const predictedShip=state.fleets[1].ships[0],predictionStart=predictedShip.position.clone(),predictionRotation=predictedShip.rotation.clone(),predictionGoal=predictionStart.clone().add(new T.Vector3(12,5,-15));
  const estimate=game.predictManeuver(predictedShip,predictionGoal,120);assert(predictedShip.position.distanceTo(predictionStart)<1e-10);assert(predictedShip.rotation.angleTo(predictionRotation)<1e-8);
  const actual=game.cloneManeuverState(predictedShip);for(let i=0;i<120;i++)game.steerShip(actual,predictionGoal,game.CONFIG.dt);
  assert(actual.position.distanceTo(estimate.position)<1e-9);assert(actual.rotation.angleTo(estimate.rotation)<1e-7);assert(Math.abs(actual.propulsionForward-estimate.propulsionForward)<1e-9);
  const sequential=game.predictManeuver(game.predictManeuver(predictedShip,predictionGoal,60),predictionGoal,60);assert(sequential.position.distanceTo(estimate.position)<1e-9);
  assert.throws(()=>game.predictManeuver(predictedShip,predictionGoal,-1));
  pass('maneuver prediction shares fixed-tick execution and preserves source state');
  {const tracked=game.cloneManeuverState(predictedShip);tracked.position.set(0,0,0);tracked.rotation.identity();tracked.propulsionForward=0;tracked.propulsionVertical=0;const target=new T.Vector3(),velocity=new T.Vector3(0,0,2);
  for(let i=0;i<300;i++){game.steerShip(tracked,target,game.CONFIG.dt,{mode:'TRACK',targetVelocity:velocity});target.addScaledVector(velocity,game.CONFIG.dt);}
  assert(tracked.propulsionForward>1.8&&tracked.propulsionForward<2.2,'moving slot retains forward speed');assert(tracked.position.distanceTo(target)<.2,'moving slot tracking converges');
  const stationaryTarget=tracked.position.clone().add(new T.Vector3(0,0,3));for(let i=0;i<480;i++)game.steerShip(tracked,stationaryTarget,game.CONFIG.dt,{mode:'STOP'});
  assert(tracked.position.distanceTo(stationaryTarget)<.3&&Math.abs(tracked.propulsionForward)<.1,'STOP settles at destination');
  const movingStart=game.cloneManeuverState(predictedShip),fixedGoal=movingStart.position.clone().add(new T.Vector3(0,0,5)),options={mode:'TRACK',targetVelocity:new T.Vector3(0,0,1)},estimated=game.predictManeuver(movingStart,fixedGoal,60,options),actualTrack=game.cloneManeuverState(movingStart);
  for(let i=0;i<60;i++)game.steerShip(actualTrack,fixedGoal,game.CONFIG.dt,options);assert(actualTrack.position.distanceTo(estimated.position)<1e-9&&actualTrack.rotation.angleTo(estimated.rotation)<1e-7,'TRACK prediction matches execution');
  pass('moving slot maintains speed while STOP brakes and settles');}
  {const aimed=state.fleets[0].ships[0];aimed.position.set(0,0,0);aimed.rotation.identity();aimed.aimTargetPosition=new T.Vector3(5,20,5);aimed.aimRevision=1;const tilted=new T.Quaternion().setFromEuler(new T.Euler(.7,0,.6,'YXZ'));
  for(const base of [tilted,new T.Quaternion().setFromEuler(new T.Euler(-.6,.3,-.7,'YXZ'))]){const result=game.aimFromBase(aimed,base,aimed.position,true),e=new T.Euler().setFromQuaternion(result,'YXZ');assert(Math.abs(e.x)<=25*Math.PI/180+1e-8&&Math.abs(e.z)<=15*Math.PI/180+1e-8,'aim candidate respects world attitude limits even when base changes');}
  pass('experimental aim respects world pitch and roll limits');}
  {const formation=game.initialState().fleets[0];game.advanceColumnFormation(formation,true);
  const savedPath=formation.columnPath.points.map(p=>p.clone()),shadow=game.cloneColumnFormation(formation),control=game.cloneColumnFormation(formation);
  shadow.anchor.x+=3;control.anchor.x+=3;shadow.ships[0].position.z+=2;control.ships[0].position.z+=2;
  const shadowSlots=game.advanceColumnFormation(shadow,true),controlSlots=game.advanceColumnFormation(control,true);
  assert(shadowSlots.every((point,i)=>point.distanceTo(controlSlots[i])<1e-10));
  assert(formation.columnPath.points.every((point,i)=>point.distanceTo(savedPath[i])<1e-10),'formation prediction must not mutate live history');
  shadow.columnPath.points[0].x+=10;assert(control.columnPath.points[0].distanceTo(shadow.columnPath.points[0])>1,'prediction histories do not share vectors');
  pass('column formation snapshots isolate path history and use the same update');}
  {const fleet=game.initialState().fleets[0];fleet.velocity.set(0,0,2);const first=game.slots(fleet),initial=game.formationSlotVelocities(fleet,first,game.CONFIG.dt);assert(initial.every(v=>v.distanceTo(fleet.velocity)<1e-9));
  const moved=first.map((p,i)=>p.clone().add(new T.Vector3(i*.01,0,2*game.CONFIG.dt))),speeds=game.formationSlotVelocities(fleet,moved,game.CONFIG.dt);assert(speeds[0].distanceTo(speeds[1])>.1,'different slot paths have different velocities');
  fleet.tactics.revision++;const changed=moved.map(p=>p.clone().add(new T.Vector3(20,0,0))),reset=game.formationSlotVelocities(fleet,changed,game.CONFIG.dt);assert(reset.every(v=>v.distanceTo(fleet.velocity)<1e-9),'reassigned slots do not produce a velocity spike');pass('slot velocities track continuous movement and reset safely on revision');}
  {const ship=game.initialState().fleets[0].ships[0];ship.position.set(0,0,0);ship.rotation.identity();const before=ship.position.clone(),goals=new Map([[ship.id,new T.Vector3(0,0,30)]]);
  assert.equal(game.predictColumnRecovery([ship],goals,[],1).status,'UNKNOWN');assert(ship.position.equals(before),'recovery prediction preserves the live ship');
  const threat={id:'opponent',fleetId:'opponent',alive:true,position:new T.Vector3(0,0,10),velocity:new T.Vector3(),enemy:true};
  assert.equal(game.predictColumnRecovery([ship],goals,[threat],1).reason,'TACTICAL_DISTANCE');assert(threat.position.equals(new T.Vector3(0,0,10)));
  threat.enemy=false;threat.position.set(0,0,1);assert.equal(game.predictColumnRecovery([ship],goals,[threat],1).reason,'PHYSICAL_CONTACT');
  assert.equal(game.predictColumnRecovery([ship],new Map([[ship.id,before.clone()]]),[],1).status,'CLEAR_IN_MODEL');
  pass('recovery prediction isolates state and distinguishes unknown and conflicts');}
  {const scene=game.initialState(),fleet=scene.fleets[0];scene.experimentalManeuver=true;game.start(scene);
  for(let tick=0;tick<120;tick++){game.step(scene);const leader=fleet.ships.find(s=>s.alive);assert(fleet.columnPath.points[0].distanceTo(leader.position)<1e-9,'column history records the post-collision leader');}
  pass('experimental column path records resolved leader position');}
  {const scene=game.initialState(),fleet=scene.fleets[0],enemy=scene.fleets[2];scene.experimentalManeuver=true;scene.fleets=[fleet,enemy];fleet.anchor.set(0,0,-30);fleet.rotation.identity();const points=game.slots(fleet);fleet.ships.forEach((s,i)=>{s.position.copy(points[i]);s.rotation.identity();});enemy.ships=enemy.ships.slice(0,1);enemy.anchor.set(-55,0,-55);enemy.ships[0].position.copy(enemy.anchor);game.setDestination(enemy,{ix:-27,iy:0,iz:-27});game.setDestination(fleet,{ix:0,iy:0,iz:10});game.start(scene);let minimum=Infinity;for(let t=0;t<600;t++){game.step(scene);for(let i=0;i<fleet.ships.length;i++)for(let j=i+1;j<fleet.ships.length;j++)minimum=Math.min(minimum,fleet.ships[i].position.distanceTo(fleet.ships[j].position));}assert(fleet.anchor.z>-28,'fleet advances');assert(minimum>=2.2-1e-6,'column ships avoid physical overlap');const before=fleet.rotation.clone();game.setDestination(fleet,{ix:15,iy:0,iz:10});for(let t=0;t<180;t++)game.step(scene);assert(fleet.rotation.angleTo(before)>.01,'fleet rotates toward changed destination');assert(fleet.ships.every(s=>s.position.toArray().every(Number.isFinite)),'fleet positions remain finite while turning');pass('experimental fleet advances and turns without overlap');}
  {const scene=game.initialState(),fleet=scene.fleets[0],enemy=scene.fleets[2];scene.experimentalManeuver=true;scene.fleets=[fleet,enemy];fleet.anchor.set(0,0,-25);fleet.rotation.identity();const initial=game.slots(fleet);fleet.ships.forEach((s,i)=>{s.position.copy(initial[i]);s.rotation.identity();});enemy.ships=enemy.ships.slice(0,1);enemy.anchor.set(-55,0,-55);enemy.ships[0].position.copy(enemy.anchor);game.setDestination(enemy,{ix:-27,iy:0,iz:-27});game.setDestination(fleet,{ix:0,iy:0,iz:5});game.start(scene);
  let min=Infinity;for(let t=0;t<3600;t++){if(scene.phase==='PREPARATION')game.start(scene);game.step(scene);for(let i=0;i<fleet.ships.length;i++)for(let j=i+1;j<fleet.ships.length;j++)min=Math.min(min,fleet.ships[i].position.distanceTo(fleet.ships[j].position));}
  const goals=game.slots(fleet),errors=fleet.ships.map((s,i)=>s.position.distanceTo(goals[i])),speed=fleet.ships.map(s=>s.velocity.length());console.log('FORMATION_ARRIVAL',JSON.stringify({anchor:fleet.anchor.toArray(),destination:fleet.destination.toArray(),errors,speed,min,regroup:fleet.columnRegroup}));
  assert(fleet.anchor.distanceTo(fleet.destination)<1&&Math.max(...errors)<.8&&Math.max(...speed)<.5&&min>=2.2-1e-6&&fleet.arrived,'formation must arrive and settle');pass('experimental column reaches destination and settles');}
  {const scene=game.initialState(),fleet=scene.fleets[0],enemy=scene.fleets[2];scene.experimentalManeuver=true;scene.fleets=[fleet,enemy];fleet.anchor.set(0,0,-25);fleet.rotation.identity();const initial=game.slots(fleet);fleet.ships.forEach((s,i)=>{s.position.copy(initial[i]);s.rotation.identity();});enemy.ships=enemy.ships.slice(0,1);enemy.anchor.set(-55,0,-55);enemy.ships[0].position.copy(enemy.anchor);game.setDestination(enemy,{ix:-27,iy:0,iz:-27});game.setDestination(fleet,{ix:0,iy:0,iz:10});game.start(scene);for(let t=0;t<480;t++)game.step(scene);game.setDestination(fleet,{ix:12,iy:0,iz:10});let min=Infinity;for(let t=0;t<4800;t++){if(scene.phase==='PREPARATION')game.start(scene);game.step(scene);for(let i=0;i<fleet.ships.length;i++)for(let j=i+1;j<fleet.ships.length;j++)min=Math.min(min,fleet.ships[i].position.distanceTo(fleet.ships[j].position));}const goals=game.slots(fleet),errors=fleet.ships.map((s,i)=>s.position.distanceTo(goals[i])),speed=fleet.ships.map(s=>s.velocity.length());console.log('FORMATION_TURN',JSON.stringify({anchor:fleet.anchor.toArray(),destination:fleet.destination.toArray(),positions:fleet.ships.map(s=>s.position.toArray()),errors,speed,min,regroup:fleet.columnRegroup}));assert(fleet.anchor.distanceTo(fleet.destination)<1&&Math.max(...errors)<.8&&Math.max(...speed)<.5&&min>=2.2-1e-6&&fleet.arrived,'formation must turn and settle');pass('experimental column turns and settles after destination change');}
  const turn=game.cloneManeuverState(predictedShip);turn.position.set(0,0,0);turn.rotation.identity();turn.propulsionForward=0;turn.propulsionVertical=0;
  const turnBefore=turn.rotation.clone();game.steerShip(turn,new T.Vector3(30,0,0),game.CONFIG.dt);const turnAngle=turn.rotation.angleTo(turnBefore);
  assert(turnAngle>0&&turnAngle<=balance.ship.maneuver.max_yaw_rate*balance.ship.maneuver.stationary_turn_ratio*game.CONFIG.dt+1e-8,'stationary yaw uses configured rate');
  const recovery=game.cloneManeuverState(turn);recovery.position.set(0,0,0);recovery.rotation.setFromEuler(new T.Euler(.2,0,.2,'YXZ'));recovery.propulsionForward=0;recovery.propulsionVertical=0;
  const oldAttitude=new T.Euler().setFromQuaternion(recovery.rotation,'YXZ');game.steerShip(recovery,recovery.position.clone(),game.CONFIG.dt);const newAttitude=new T.Euler().setFromQuaternion(recovery.rotation,'YXZ');
  assert(newAttitude.x<oldAttitude.x&&newAttitude.z<oldAttitude.z,'pitch and roll recover when no attitude requested');assert(oldAttitude.x-newAttitude.x<=balance.ship.maneuver.attitude_recovery_rate*game.CONFIG.dt+1e-8);assert(oldAttitude.z-newAttitude.z<=balance.ship.maneuver.attitude_recovery_rate*game.CONFIG.dt+1e-8);
  const braking=game.cloneManeuverState(turn);braking.position.set(0,0,0);braking.rotation.identity();braking.propulsionForward=.5;let seenZero=false,seenReverse=false;
  for(let i=0;i<180;i++){const previousSpeed=braking.propulsionForward;game.steerShip(braking,new T.Vector3(0,0,-1),game.CONFIG.dt);if(braking.propulsionForward===0)seenZero=true;if(braking.propulsionForward<0){seenReverse=true;assert(seenZero,'forward-to-reverse must pass through zero');break;}assert(previousSpeed-braking.propulsionForward<=balance.ship.maneuver.brake_deceleration*game.CONFIG.dt+1e-9);}
  assert(seenReverse,'near reverse starts after braking');
  pass('stationary turning, attitude recovery and forward-to-reverse braking');
  if(process.env.FLEET_NAV_ONLY==='1'){console.log(count+' navigation regression groups passed');process.exit(0);}
  if(process.env.FLEET_TRANSITION_ONLY==='1'){
    const world=game.initialState(),fleet=world.fleets[0],enemy=world.fleets[2];world.experimentalManeuver=true;world.fleets=[fleet,enemy];fleet.anchor.set(0,0,-25);fleet.rotation.identity();const initial=game.slots(fleet);fleet.ships.forEach((s,i)=>{s.position.copy(initial[i]);s.rotation.identity();});game.setDestination(fleet,{ix:0,iy:0,iz:15});enemy.ships=enemy.ships.slice(0,1);enemy.anchor.set(-55,0,-55);enemy.ships[0].position.copy(enemy.anchor);game.setDestination(enemy,{ix:-27,iy:0,iz:-27});game.start(world);for(let t=0;t<480;t++)game.step(world);
    const survivors=fleet.ships.slice(1),before=survivors.map(s=>s.position.clone());fleet.ships[0].alive=false;game.setDestination(fleet,{ix:8,iy:4,iz:12});game.step(world);assert(survivors.every((s,i)=>s.position.distanceTo(before[i])<.2),'leader loss or new goal must not teleport');let minimum=Infinity;for(let t=0;t<4800&&!fleet.arrived;t++){if(world.phase==='PREPARATION')game.start(world);game.step(world);for(let i=0;i<survivors.length;i++)for(let j=i+1;j<survivors.length;j++)minimum=Math.min(minimum,survivors[i].position.distanceTo(survivors[j].position));}
    const goals=game.slots(fleet),errors=survivors.map(s=>s.position.distanceTo(goals[fleet.ships.indexOf(s)]));console.log('TRANSITION_3D',JSON.stringify({arrived:fleet.arrived,referenceArrived:fleet.referenceArrived,anchor:fleet.anchor.toArray(),destination:fleet.destination.toArray(),positions:survivors.map(s=>s.position.toArray()),errors,minimum,regroup:fleet.columnRegroup}));assert(fleet.arrived&&minimum>=2.2-1e-5,'leader replacement and 3D goal must settle safely');
    const budgetScene=game.initialState(),column=budgetScene.fleets[0],obstacle=budgetScene.fleets[2];budgetScene.experimentalManeuver=true;budgetScene.columnBudgetLimits={maxFleetSteps:0};budgetScene.fleets=[column,obstacle];column.ships=column.ships.slice(0,1);obstacle.ships=obstacle.ships.slice(0,1);column.anchor.set(0,0,-20);column.rotation.identity();column.ships[0].position.copy(column.anchor);column.ships[0].rotation.identity();game.setDestination(column,{ix:0,iy:0,iz:20});obstacle.anchor.set(0,0,10);obstacle.ships[0].position.copy(obstacle.anchor);game.setDestination(obstacle,{ix:0,iy:0,iz:5});game.start(budgetScene);game.step(budgetScene);assert(column.safetyStop&&column.columnSafetyReason==='UNKNOWN_BUDGET','budget exhaustion must brake, not approve');budgetScene.columnBudgetLimits=null;obstacle.anchor.set(50,0,10);obstacle.ships[0].position.copy(obstacle.anchor);game.setDestination(obstacle,{ix:25,iy:0,iz:5});for(let t=0;t<60;t++)game.step(budgetScene);assert(!column.safetyStop&&column.columnMode==='TRAVEL','column must retry after budget and threat clear');column.columnPlanUntil=budgetScene.time-1;game.step(budgetScene);assert(column.safetyStop&&column.columnSafetyReason==='UNKNOWN_EXPIRED','expired route must brake before next assessment');console.log('PASS experimental leader replacement, 3D goal and budget recovery');process.exit(0);
  }
  if(process.env.FLEET_MATRIX_ONLY==='1'){
    const policies=['COLUMN','LINE','BREAKTHROUGH','POINT_DEFENSE'];let minimum=Infinity,pairs=0;
    for(const ownPolicy of policies)for(const otherPolicy of policies){const battle=game.initialState(),a=battle.fleets[0],b=battle.fleets[2];battle.experimentalManeuver=true;battle.fleets=[a,b];a.ships=a.ships.slice(0,2);b.ships=b.ships.slice(0,2);a.anchor.set(0,0,-18);a.rotation.identity();b.anchor.set(0,0,18);b.rotation.setFromAxisAngle(new T.Vector3(0,1,0),Math.PI);game.setCombatPolicy(a,ownPolicy);game.setCombatPolicy(b,otherPolicy);game.setDestination(a,{ix:0,iy:0,iz:20});game.setDestination(b,{ix:0,iy:0,iz:-20});for(const f of [a,b])game.slots(f).forEach((p,i)=>{f.ships[i].position.copy(p);f.ships[i].rotation.copy(f.rotation);});game.start(battle);for(let tick=0;tick<360;tick++){game.step(battle);const units=[...a.ships,...b.ships];for(let i=0;i<units.length;i++){assert(units[i].position.toArray().every(Number.isFinite));for(let j=i+1;j<units.length;j++)minimum=Math.min(minimum,units[i].position.distanceTo(units[j].position));}if(tick===179){const old=battle.time,point=a.ships[0].position.clone();battle.phase='PREPARATION';game.step(battle);assert.equal(battle.time,old);assert(a.ships[0].position.distanceTo(point)<1e-9);game.start(battle);}}assert(a.columnMode!=='BYPASS'&&b.columnMode!=='BYPASS',`${ownPolicy} vs ${otherPolicy} must not bypass`);pairs++;}
    assert(minimum>=2.2-1e-5,JSON.stringify({minimum,pairs}));console.log('EXPERIMENTAL_MATRIX',JSON.stringify({pairs,ticks:360,shipsPerFleet:2,minimum}));process.exit(0);
  }
  if(process.env.FLEET_STRESS_ONLY==='1'){
    for(const total of [16,64])for(const experimental of [false,true]){
      const battle=game.initialState(),a=battle.fleets[0],b=battle.fleets[2];battle.experimentalManeuver=experimental;battle.fleets=[a,b];
      for(const [f,z,yaw] of [[a,-28,0],[b,28,Math.PI]]){const prototype=f.ships[0];f.ships=Array.from({length:total/2},(_,i)=>({...prototype,id:f.id+'-perf-'+i,fleetId:f.id,position:new T.Vector3(),velocity:new T.Vector3(),rotation:new T.Quaternion(),propulsionForward:0,propulsionVertical:0,weapons:[]}));f.anchor.set(0,0,z);f.rotation.setFromAxisAngle(new T.Vector3(0,1,0),yaw);f.spacingLevels={x:'tight',y:'tight',z:'tight'};f.size.copy(game.sizeForSpacing(f.ships.length,f.spacingLevels));game.setCombatPolicy(f,'LINE');game.setDestination(f,{ix:0,iy:0,iz:0});const positions=game.slots(f);f.ships.forEach((s,i)=>{s.position.copy(positions[i]);s.rotation.copy(f.rotation);});}
      battle.profile={ticks:0,shots:0,frames:0,ms:{}};game.start(battle);const samples=[];let minimum=Infinity;for(let t=0;t<600;t++){const start=performance.now();game.step(battle);samples.push(performance.now()-start);const ships=battle.fleets.flatMap(f=>f.ships);for(let i=0;i<ships.length;i++)for(let j=i+1;j<ships.length;j++)minimum=Math.min(minimum,ships[i].position.distanceTo(ships[j].position));}samples.sort((x,y)=>x-y);assert.equal(battle.profile.ticks,600);assert(minimum>=2.2-1e-5,JSON.stringify({total,experimental,minimum}));console.log('MOVEMENT_STRESS',JSON.stringify({total,experimental,ticks:samples.length,p50:samples[300],p95:samples[570],p99:samples[594],minimum,components:battle.profile.ms}));
    }process.exit(0);
  }
  if(process.env.FLEET_POLICY_ONLY==='1'){
    const scene=game.initialState(),line=scene.fleets[0],opponent=scene.fleets[2];scene.experimentalManeuver=true;scene.fleets=[line,opponent];opponent.ships=opponent.ships.slice(0,1);line.anchor.set(0,0,-40);line.rotation.identity();game.setCombatPolicy(line,'LINE');const startLine=game.slots(line);line.ships.forEach((s,i)=>{s.position.copy(startLine[i]);s.rotation.identity();});game.setDestination(line,{ix:0,iy:0,iz:20});opponent.anchor.set(0,0,0);opponent.rotation.identity();opponent.ships[0].position.copy(opponent.anchor);opponent.ships[0].rotation.identity();game.setDestination(opponent,{ix:0,iy:0,iz:0});game.start(scene);let lineMin=Infinity,lineStop=false;for(let t=0;t<1800;t++){if(scene.phase==='PREPARATION')game.start(scene);game.step(scene);for(const ship of line.ships)lineMin=Math.min(lineMin,ship.position.distanceTo(opponent.ships[0].position));lineStop||=line.encounter.lineEngaged&&line.safetyStop;}console.log('POLICY_LINE',JSON.stringify({lineMin,lineStop,positions:line.ships.map(s=>s.position.toArray()),anchor:line.anchor.toArray()}));assert(lineStop&&lineMin>=24-1e-4,'line must stop before tactical distance');
    const battle=game.initialState(),red=battle.fleets[0],blue=battle.fleets[2];battle.experimentalManeuver=true;battle.fleets=[red,blue];red.anchor.set(0,0,-30);red.rotation.identity();blue.anchor.set(0,0,30);blue.rotation.setFromAxisAngle(new T.Vector3(0,1,0),Math.PI);game.setCombatPolicy(red,'BREAKTHROUGH');game.setCombatPolicy(blue,'LINE');game.setDestination(red,{ix:0,iy:0,iz:25});game.setDestination(blue,{ix:0,iy:0,iz:-25});for(const f of [red,blue]){const slots=game.slots(f);f.ships.forEach((s,i)=>{s.position.copy(slots[i]);s.rotation.copy(f.rotation);});}game.start(battle);let minimum=Infinity,charge=false,completed=false;for(let t=0;t<5400&&!completed;t++){if(battle.phase==='PREPARATION')game.start(battle);game.step(battle);charge||=['CHARGE','TRANSIT'].includes(red.encounter.breakthrough?.phase);completed=red.encounter.reason==='돌파 완료';const ships=battle.fleets.flatMap(f=>f.ships).filter(s=>s.alive);for(let i=0;i<ships.length;i++)for(let j=i+1;j<ships.length;j++)minimum=Math.min(minimum,ships[i].position.distanceTo(ships[j].position));}console.log('POLICY_BREAK',JSON.stringify({charge,completed,minimum,phase:red.encounter.breakthrough?.phase,reason:red.encounter.reason,anchor:red.anchor.toArray()}));assert(charge&&completed&&minimum>=2.2-1e-5,'breakthrough must cross without overlap');
    const defense=game.initialState(),guard=defense.fleets[0],threat=defense.fleets[2];defense.experimentalManeuver=true;defense.fleets=[guard,threat];threat.ships=threat.ships.slice(0,1);guard.anchor.set(0,0,0);guard.rotation.identity();game.setCombatPolicy(guard,'POINT_DEFENSE');const defenseSlots=game.slots(guard);guard.ships.forEach((s,i)=>{s.position.copy(defenseSlots[i]);s.rotation.identity();});game.setDefenseAnchor(guard,{ix:0,iy:0,iz:4});threat.anchor.set(0,0,25);threat.ships[0].position.copy(threat.anchor);game.setDestination(threat,{ix:0,iy:0,iz:12});game.start(defense);let arrived=false;for(let t=0;t<3600&&!arrived;t++){if(defense.phase==='PREPARATION')game.start(defense);game.step(defense);arrived=guard.encounter.arrived;}const radialDots=guard.ships.map(s=>{const radial=s.position.clone().sub(guard.encounter.defensePoint);radial.y=0;const bow=new T.Vector3(0,0,1).applyQuaternion(s.rotation);bow.y=0;return radial.lengthSq()>1e-6&&bow.lengthSq()>1e-6?radial.normalize().dot(bow.normalize()):1;});console.log('POLICY_DEFENSE',JSON.stringify({arrived,reason:guard.encounter.reason,anchor:guard.anchor.toArray(),ships:guard.ships.map(s=>s.position.toArray()),radialDots}));assert(arrived&&guard.encounter.defensePoint.distanceTo(new T.Vector3(0,0,8))<1e-6&&radialDots.every(dot=>dot>=.9),'defense reaches fixed point with outward heading');console.log('PASS experimental line, breakthrough and defense');process.exit(0);
  }
  if(process.env.FLEET_COLUMN_ONLY==='1'){
    const battle=game.initialState(),fleet=battle.fleets[0],enemy=battle.fleets[2];battle.experimentalManeuver=true;battle.fleets=[fleet,enemy];fleet.anchor.set(0,0,-30);fleet.rotation.identity();const points=game.slots(fleet);fleet.ships.forEach((s,i)=>{s.position.copy(points[i]);s.rotation.identity();});game.setDestination(fleet,{ix:0,iy:0,iz:25});
    enemy.ships=enemy.ships.slice(0,1);enemy.anchor.set(0,0,30);enemy.rotation.identity();enemy.ships[0].position.copy(enemy.anchor);enemy.ships[0].rotation.identity();enemy.ships[0].shield=1e6;game.setDestination(enemy,{ix:0,iy:0,iz:15});
    const weapon={id:'column-test',cooldownSec:1},owner=fleet.ships[0],victim=enemy.ships[0];battle.combat=()=>{const dir=victim.position.clone().sub(owner.position);if(dir.length()>45)return [];return [{ownerShipId:owner.id,muzzleId:'m',team:'ALLY',position:owner.position.clone(),direction:dir.normalize(),range:45,radius:.1,damage:.001,weapon}];};game.start(battle);
    let minimum=Infinity,physical=Infinity,travelShots=0,holdShots=0,sawBrake=false,sawHold=false,lateral=0;for(let tick=0;tick<3600&&!sawHold;tick++){if(battle.phase==='PREPARATION')game.start(battle);game.step(battle);sawBrake||=fleet.columnMode==='BRAKE';sawHold||=fleet.columnMode==='HOLD';lateral=Math.max(lateral,...fleet.ships.map(s=>Math.abs(s.position.x)));if(battle.attackEvents.length){if(fleet.safetyStop)holdShots++;else travelShots++;}for(const s of fleet.ships)minimum=Math.min(minimum,s.position.distanceTo(victim.position));for(let i=0;i<fleet.ships.length;i++)for(let j=i+1;j<fleet.ships.length;j++)physical=Math.min(physical,fleet.ships[i].position.distanceTo(fleet.ships[j].position));}
    assert(sawBrake&&sawHold,JSON.stringify({sawBrake,sawHold,mode:fleet.columnMode,minimum,physical,anchor:fleet.anchor.toArray()}));assert(minimum>=12-1e-4&&physical>=2.2-1e-4&&lateral<.1,JSON.stringify({minimum,physical,lateral}));assert(travelShots>0&&holdShots>0,JSON.stringify({travelShots,holdShots}));
    const stopZ=fleet.anchor.z,command=JSON.stringify(fleet.movement.movePoint);enemy.anchor.set(45,0,30);victim.position.copy(enemy.anchor);victim.velocity.set(0,0,0);victim.propulsionForward=0;game.setDestination(enemy,{ix:22,iy:0,iz:15});let resumed=false;for(let tick=0;tick<1800;tick++){if(battle.phase==='PREPARATION')game.start(battle);game.step(battle);if(fleet.columnMode==='TRAVEL'&&fleet.anchor.z>stopZ+2){resumed=true;break;}}
    assert(resumed&&JSON.stringify(fleet.movement.movePoint)===command,JSON.stringify({resumed,mode:fleet.columnMode,stopZ,anchor:fleet.anchor.toArray()}));
    const close=game.initialState(),a=close.fleets[0],e=close.fleets[2];close.experimentalManeuver=true;close.fleets=[a,e];a.ships=a.ships.slice(0,1);e.ships=e.ships.slice(0,1);a.anchor.set(0,0,0);a.rotation.identity();a.ships[0].position.copy(a.anchor);a.ships[0].rotation.identity();game.setDestination(a,{ix:0,iy:0,iz:15});e.anchor.set(0,0,10);e.ships[0].position.copy(e.anchor);game.setDestination(e,{ix:0,iy:0,iz:5});game.start(close);for(let t=0;t<120;t++)game.step(close);assert(a.safetyStop&&a.columnMode==='HOLD'&&a.ships[0].position.distanceTo(e.ships[0].position)>=2.2-1e-6,'pre-existing tactical intrusion holds without physical overlap');assert(a.ships[0].position.z>=-1e-6,'no tactical retreat to restore separation');
    const crossing=game.initialState(),c=crossing.fleets[0],moving=crossing.fleets[2];crossing.experimentalManeuver=true;crossing.fleets=[c,moving];c.ships=c.ships.slice(0,1);moving.ships=moving.ships.slice(0,1);c.anchor.set(0,0,-20);c.rotation.identity();c.ships[0].position.copy(c.anchor);c.ships[0].rotation.identity();game.setDestination(c,{ix:0,iy:0,iz:15});moving.anchor.set(-20,0,0);moving.rotation.setFromAxisAngle(new T.Vector3(0,1,0),Math.PI/2);moving.ships[0].position.copy(moving.anchor);moving.ships[0].rotation.copy(moving.rotation);game.setDestination(moving,{ix:10,iy:0,iz:0});game.start(crossing);let movingMin=Infinity,blocked=false,detour=false;for(let t=0;t<1500;t++){game.step(crossing);movingMin=Math.min(movingMin,c.ships[0].position.distanceTo(moving.ships[0].position));blocked||=c.safetyStop;detour||=c.columnMode==='BYPASS';}assert(blocked&&!detour&&movingMin>=12-1e-4,JSON.stringify({movingMin,blocked,detour,position:c.ships[0].position.toArray(),opponent:moving.ships[0].position.toArray()}));
    const multi=game.initialState(),column=multi.fleets[0],left=multi.fleets[2],right=multi.fleets[3];multi.experimentalManeuver=true;multi.fleets=[column,left,right];column.anchor.set(0,0,-30);column.rotation.identity();const initial=game.slots(column);column.ships.forEach((s,i)=>{s.position.copy(initial[i]);s.rotation.identity();});game.setDestination(column,{ix:0,iy:0,iz:20});
    for(const [f,x,z,angle,goal] of [[left,-18,0,Math.PI/2,9],[right,18,12,-Math.PI/2,-9]]){f.ships=f.ships.slice(0,1);f.anchor.set(x,0,z);f.rotation.setFromAxisAngle(new T.Vector3(0,1,0),angle);f.ships[0].position.copy(f.anchor);f.ships[0].rotation.copy(f.rotation);game.setDestination(f,{ix:goal,iy:0,iz:z/2});}
    game.start(multi);let multiMin=Infinity,multiPhysical=Infinity,multiBypass=false;for(let t=0;t<1800;t++){if(multi.phase==='PREPARATION')game.start(multi);game.step(multi);for(const s of column.ships)for(const other of [left.ships[0],right.ships[0]])multiMin=Math.min(multiMin,s.position.distanceTo(other.position));for(let i=0;i<column.ships.length;i++)for(let j=i+1;j<column.ships.length;j++)multiPhysical=Math.min(multiPhysical,column.ships[i].position.distanceTo(column.ships[j].position));multiBypass||=column.columnMode==='BYPASS';}assert(!multiBypass&&multiPhysical>=2.2-1e-6&&multiMin>=12-1e-4,JSON.stringify({multiMin,multiPhysical,multiBypass,mode:column.columnMode}));
    console.log('COLUMN_STOP_RESULT',JSON.stringify({minimum,physical,lateral,travelShots,holdShots,resumed,intrusion:a.columnMode,movingMin,multiMin,multiPhysical}));console.log('PASS experimental column brakes, fires and resumes');process.exit(0);
  }
  assert.equal(state.fleets.length,4);assert.equal(state.fleets[0].ships[0].hp,123);assert.equal(state.fleets[0].ships[0].shield,45);assert.equal(state.fleets[0].ships[0].forwardSpeed,6);
  const now=state.time;game.step(state);assert.equal(state.time,now);
  const profiled=game.initialState();profiled.profile={ticks:0,shots:0,frames:0,ms:{}};game.start(profiled);game.step(profiled);assert.equal(profiled.profile.ticks,1);assert.ok(profiled.profile.ms.movementIndex>=0);assert.ok(profiled.profile.ms.combatTotal>=0);
  state.scores.ALLY=60;const first=game.purchaseShip(state,'ALLY',game.ECONOMY_CONFIG.typeId,'regression-purchase');assert.equal(first.ok,true);assert.equal(state.scores.ALLY,30);
  const again=game.purchaseShip(state,'ALLY',game.ECONOMY_CONFIG.typeId,'regression-purchase');assert.equal(again.shipId,first.shipId);assert.equal(state.scores.ALLY,30);
  assert.equal(game.assignReserve(state,'ALLY',first.shipId,state.fleets[0].id).ok,true);
  const reserve=state.reserves[0],before=state.fleets[0].ships.length;game.deployReserves(state,()=>{throw Error('test failure');});assert.equal(reserve.status,'ASSIGNED');assert.equal(state.fleets[0].ships.length,before);
  const scoring={fleets:[{team:'ALLY',ships:[{alive:true,position:new T.Vector3(0,0,0)}]},{team:'ENEMY',ships:[]}],scores:{ALLY:0,ENEMY:0},phase:'RUNNING'};assert.deepEqual(game.scoreZones(scoring),{ALLY:2,ENEMY:0});assert.equal(scoring.scores.ALLY,2);
  // Formation geometry is available before detection and survives pause/resume.
  const formation=game.initialState(),f=formation.fleets[0];
  game.setCombatPolicy(f,'COLUMN');let points=game.slots(f),inv=f.rotation.clone().invert();
  let local=points.map(p=>p.clone().sub(f.anchor).applyQuaternion(inv));
  assert(local.every(p=>Math.abs(p.x)<1e-8&&Math.abs(p.y)<1e-8));
  assert(local.every((p,i)=>i===0||p.z<local[i-1].z));
  game.setCombatPolicy(f,'LINE');points=game.slots(f);local=points.map(p=>p.clone().sub(f.anchor).applyQuaternion(inv));
  assert(local.every(p=>Math.abs(p.z)<1e-8));
  game.setCombatPolicy(f,'BREAKTHROUGH');points=game.slots(f);local=points.map(p=>p.clone().sub(f.anchor).applyQuaternion(inv));
  assert(local[0].z===0&&local.slice(1).every(p=>p.z<0));
  game.setCombatPolicy(f,'POINT_DEFENSE');points=game.slots(f);const radius=points[0].distanceTo(f.anchor);
  assert(points.every(p=>Math.abs(p.distanceTo(f.anchor)-radius)<1e-8));
  const cached=f.sphereTemplate;game.slots(f);assert.equal(f.sphereTemplate,cached);
  game.start(formation);game.step(formation);formation.phase='PREPARATION';const paused=game.slots(f).map(p=>p.clone());game.start(formation);
  assert(game.slots(f).every((p,i)=>p.distanceTo(paused[i])<1e-8));
  // Both ships move in opposite directions through the same segment, including allies.
  function collisionCase(a0,a1,b0,b1){
    const a={id:'a',fleetId:'A',alive:true,collisionRadius:1,position:new T.Vector3(a1,0,0),velocity:new T.Vector3(a1-a0,0,0)};
    const b={id:'b',fleetId:'A',alive:true,collisionRadius:1,position:new T.Vector3(b1,0,0),velocity:new T.Vector3(b1-b0,0,0)};
    const snap=new Map([['a',new T.Vector3(a0,0,0)],['b',new T.Vector3(b0,0,0)]]);
    const index=new game.ShipSpatialIndex([a,b],snap);game.resolveShipCollisions([a,b],index,snap);return [a,b];
  }
  let pair=collisionCase(-5,5,5,-5);assert(pair[0].position.distanceTo(pair[1].position)>=2-1e-6);
  pair=collisionCase(-1,-2,1,2);assert.equal(pair[0].position.x,-2);assert.equal(pair[1].position.x,2);
  pair=collisionCase(-1,0,1,0);assert.equal(pair[0].position.x,-1);assert.equal(pair[1].position.x,1);
  const encounter=game.initialState(), attacker=encounter.fleets[0],enemy=encounter.fleets[2];
  encounter.fleets=[attacker,enemy];attacker.ships=attacker.ships.slice(0,1);enemy.ships=enemy.ships.slice(0,1);
  attacker.anchor.set(0,0,0);attacker.rotation.identity();attacker.ships[0].position.set(0,0,0);attacker.ships[0].rotation.identity();
  enemy.anchor.set(0,0,-10);enemy.ships[0].position.set(0,0,-10);game.setCombatPolicy(attacker,'BREAKTHROUGH');game.start(encounter);game.step(encounter);
  assert.equal(attacker.encounter.active,false,'rear contact must not start charge');
  enemy.anchor.set(0,0,10);enemy.ships[0].position.set(0,0,10);enemy.ships[0].velocity.set(0,0,0);encounter.time=game.CONFIG.dt*12;game.step(encounter);
  assert.equal(attacker.encounter.active,true);assert.equal(attacker.encounter.breakthrough.phase,'FORMATION');
  assert(attacker.encounter.breakthrough.axis.z>.99,'charge direction follows own heading');
  assert.throws(()=>game.setCombatPolicy(attacker,'ENCIRCLE'));
  const run=game.initialState(),own=run.fleets[0],foe=run.fleets[2];run.fleets=[own,foe];
  own.ships=own.ships.slice(0,1);foe.ships=foe.ships.slice(0,1);own.anchor.set(0,0,-35);own.rotation.identity();own.ships[0].position.copy(own.anchor);own.ships[0].rotation.identity();
  foe.anchor.set(0,0,0);foe.ships[0].position.copy(foe.anchor);game.setDestination(foe,{ix:0,iy:0,iz:0});game.setDestination(own,{ix:0,iy:0,iz:25});game.setCombatPolicy(own,'BREAKTHROUGH');game.start(run);
  let minDistance=Infinity,maxLateral=0,phase='';
  for(let i=0;i<1500&&own.encounter.reason!=='돌파 완료';i++){game.step(run);minDistance=Math.min(minDistance,own.ships[0].position.distanceTo(foe.ships[0].position));maxLateral=Math.max(maxLateral,Math.abs(foe.ships[0].position.x));phase=own.encounter.breakthrough?.phase||phase;}
  assert.equal(own.encounter.reason,'돌파 완료',JSON.stringify({phase,minDistance,maxLateral,a:own.ships[0].position.toArray(),b:foe.ships[0].position.toArray(),target:own.encounter.target?.toArray()}));
  assert(minDistance>=2.2-1e-5);assert(maxLateral>.5);
  const beforeReturn=foe.ships[0].position.distanceTo(foe.anchor);for(let i=0;i<360;i++)game.step(run);
  assert(foe.ships[0].position.distanceTo(foe.anchor)<beforeReturn,'defender returns toward its unmodified slot');
  const mutual=game.initialState(),left=mutual.fleets[0],right=mutual.fleets[2];mutual.fleets=[left,right];
  left.ships=left.ships.slice(0,1);right.ships=right.ships.slice(0,1);left.anchor.set(0,0,-20);right.anchor.set(0,0,20);
  left.rotation.identity();right.rotation.setFromAxisAngle(new T.Vector3(0,1,0),Math.PI);
  left.ships[0].position.copy(left.anchor);right.ships[0].position.copy(right.anchor);left.ships[0].rotation.copy(left.rotation);right.ships[0].rotation.copy(right.rotation);
  game.setDestination(left,{ix:0,iy:0,iz:25});game.setDestination(right,{ix:0,iy:0,iz:-25});game.setCombatPolicy(left,'BREAKTHROUGH');game.setCombatPolicy(right,'BREAKTHROUGH');game.start(mutual);
  let nearest=Infinity,maxLeft=0,maxRight=0,doneLeft=false,doneRight=false;
  for(let i=0;i<1500;i++){game.step(mutual);nearest=Math.min(nearest,left.ships[0].position.distanceTo(right.ships[0].position));maxLeft=Math.max(maxLeft,Math.abs(left.ships[0].position.x));maxRight=Math.max(maxRight,Math.abs(right.ships[0].position.x));doneLeft||=left.encounter.reason==='돌파 완료';doneRight||=right.encounter.reason==='돌파 완료';if(doneLeft&&doneRight)break;}
  assert(nearest>=2.2-1e-5);assert(maxLeft>.1&&maxRight>.1,JSON.stringify({nearest,maxLeft,maxRight,left:left.encounter.reason,right:right.encounter.reason}));
  assert(doneLeft&&doneRight,JSON.stringify({nearest,maxLeft,maxRight,left:left.encounter.reason,right:right.encounter.reason,lp:left.ships[0].position.toArray(),rp:right.ships[0].position.toArray()}));
  const route=game.initialState(),column=route.fleets[0],blocker=route.fleets[2];route.fleets=[column,blocker];column.ships=column.ships.slice(0,1);blocker.ships=blocker.ships.slice(0,1);
  column.anchor.set(0,0,0);column.rotation.identity();column.ships[0].position.copy(column.anchor);column.ships[0].rotation.identity();blocker.anchor.set(0,0,18);blocker.ships[0].position.copy(blocker.anchor);
  game.setDestination(column,{ix:0,iy:0,iz:25});game.setDestination(blocker,{ix:0,iy:0,iz:9});game.start(route);game.step(route);
  assert.equal(column.columnMode,'BYPASS');assert(column.columnTarget.clone().sub(column.anchor).dot(column.columnReference)>=0);assert(column.columnPath.points.length>=2);
  const lineScene=game.initialState(),line=lineScene.fleets[0],targetFleet=lineScene.fleets[2];lineScene.fleets=[line,targetFleet];line.ships=line.ships.slice(0,1);targetFleet.ships=targetFleet.ships.slice(0,1);
  line.anchor.set(0,0,0);line.rotation.identity();line.ships[0].position.copy(line.anchor);line.ships[0].rotation.identity();targetFleet.anchor.set(0,0,24);targetFleet.ships[0].position.copy(targetFleet.anchor);game.setDestination(targetFleet,{ix:0,iy:0,iz:12});game.setCombatPolicy(line,'LINE');game.start(lineScene);game.step(lineScene);game.step(lineScene);
  assert.equal(line.encounter.mode,'ENGAGE');assert(line.safetyStop);assert.equal(line.encounter.lineEngaged,true);
  const aimScene=game.initialState(),aimFleet=aimScene.fleets[0],aimEnemy=aimScene.fleets[2];aimScene.fleets=[aimFleet,aimEnemy];aimFleet.ships=aimFleet.ships.slice(0,1);aimEnemy.ships=aimEnemy.ships.slice(0,1);
  aimFleet.anchor.set(0,0,0);aimFleet.rotation.identity();aimFleet.ships[0].position.copy(aimFleet.anchor);aimFleet.ships[0].rotation.identity();game.setDestination(aimFleet,{ix:0,iy:0,iz:20});
  aimEnemy.anchor.set(15,0,0);aimEnemy.ships[0].position.copy(aimEnemy.anchor);game.setDestination(aimEnemy,{ix:8,iy:0,iz:0});game.start(aimScene);
  for(let i=0;i<60;i++)game.step(aimScene);
  const bow=new T.Vector3(0,0,1).applyQuaternion(aimFleet.ships[0].rotation);assert(bow.x>.1,'ship turns toward a side target while moving: '+JSON.stringify({bow:bow.toArray(),position:aimFleet.ships[0].position.toArray()}));assert(aimFleet.ships[0].position.z>0,'slot movement continues while aiming');
  const wing=game.initialState(),wf=wing.fleets[0],we=wing.fleets[2];wing.fleets=[wf,we];we.ships=we.ships.slice(0,1);wf.anchor.set(0,0,0);wf.rotation.identity();game.setCombatPolicy(wf,'LINE');const starts=game.slots(wf);wf.ships.forEach((ship,i)=>{ship.position.copy(starts[i]);ship.rotation.identity();ship.weapons=[{range:23}];});we.anchor.set(0,0,23);we.ships[0].position.copy(we.anchor);game.setDestination(we,{ix:0,iy:0,iz:12});game.start(wing);
  for(let i=0;i<30;i++)game.step(wing);
  assert.equal(wf.encounter.lineEngaged,true);assert([...wf.encounter.lineOffsets.values()].some(v=>v.length()>.01),'out of range wing ships receive a forward offset');
  const multi=game.initialState(),red=multi.fleets[0],blue=multi.fleets[2];multi.fleets=[red,blue];red.anchor.set(0,0,-30);red.rotation.identity();blue.anchor.set(0,0,30);blue.rotation.setFromAxisAngle(new T.Vector3(0,1,0),Math.PI);
  game.setCombatPolicy(red,'BREAKTHROUGH');game.setCombatPolicy(blue,'LINE');game.setDestination(red,{ix:0,iy:0,iz:25});game.setDestination(blue,{ix:0,iy:0,iz:-25});
  for(const fleet of [red,blue]){const goals=game.slots(fleet);fleet.ships.forEach((ship,i)=>{ship.position.copy(goals[i]);ship.rotation.copy(fleet.rotation);});}
  multi.profile={ticks:0,shots:0,frames:0,ms:{}};game.start(multi);let nearestMulti=Infinity,recognized=false,completed=false,resumed=false;const tickTimes=[];
  for(let t=0;t<3600&&!completed;t++){
    if(multi.phase==='PREPARATION'){game.start(multi);resumed=true;}
    const started=performance.now();game.step(multi);tickTimes.push(performance.now()-started);recognized||=red.encounter.active||blue.encounter.active;completed||=red.encounter.reason==='돌파 완료';const ships=multi.fleets.flatMap(f=>f.ships).filter(s=>s.alive);
    for(let i=0;i<ships.length;i++)for(let j=i+1;j<ships.length;j++)nearestMulti=Math.min(nearestMulti,ships[i].position.distanceTo(ships[j].position));
    for(const ship of ships)assert(ship.position.toArray().every(Number.isFinite));
  }
  assert(recognized);assert(nearestMulti>=2.2-1e-5,JSON.stringify({nearestMulti}));
  tickTimes.sort((a,b)=>a-b);console.log('MULTI_PROFILE',JSON.stringify({ticks:tickTimes.length,p50:tickTimes[Math.floor(tickTimes.length*.50)],p95:tickTimes[Math.floor(tickTimes.length*.95)],p99:tickTimes[Math.floor(tickTimes.length*.99)],max:tickTimes.at(-1),components:multi.profile.ms}));
  assert(resumed,'scenario must cross a preparation boundary');
  assert(completed,JSON.stringify({resumed,phase:red.encounter.breakthrough?.phase,reason:red.encounter.reason,anchor:red.anchor.toArray(),positions:red.ships.map(s=>s.position.toArray())}));
  const large=game.initialState();
  for(let k=0;k<large.fleets.length;k++){
    const fleet=large.fleets[k],prototype=fleet.ships[0];fleet.ships=Array.from({length:16},(_,i)=>({...prototype,id:fleet.id+'-stress-'+i,fleetId:fleet.id,position:new T.Vector3(),velocity:new T.Vector3(),rotation:new T.Quaternion(),weapons:[]}));
    fleet.anchor.set(k%2===0?-22:22,0,fleet.team==='ALLY'?30:-30);fleet.rotation.setFromAxisAngle(new T.Vector3(0,1,0),fleet.team==='ALLY'?Math.PI:0);fleet.spacingLevels={x:'tight',y:'tight',z:'tight'};fleet.size.copy(game.sizeForSpacing(fleet.ships.length,fleet.spacingLevels));
    game.setCombatPolicy(fleet,'LINE');game.setDestination(fleet,{ix:k%2===0?-11:11,iy:0,iz:0});const goals=game.slots(fleet);fleet.ships.forEach((ship,i)=>{ship.position.copy(goals[i]);ship.rotation.copy(fleet.rotation);});
  }
  large.profile={ticks:0,shots:0,frames:0,ms:{}};game.start(large);const largeTimes=[];let largeMin=Infinity,contact=false;
  for(let tick=0;tick<600;tick++){
    const t=performance.now();game.step(large);largeTimes.push(performance.now()-t);contact||=large.fleets.some(f=>f.encounter.active);
    const ships=large.fleets.flatMap(f=>f.ships);for(let i=0;i<ships.length;i++){assert(ships[i].position.toArray().every(Number.isFinite));for(let j=i+1;j<ships.length;j++)largeMin=Math.min(largeMin,ships[i].position.distanceTo(ships[j].position));}
  }
  largeTimes.sort((a,b)=>a-b);console.log('DENSE_64_PROFILE',JSON.stringify({ticks:largeTimes.length,p50:largeTimes[300],p95:largeTimes[570],p99:largeTimes[594],max:largeTimes.at(-1),minDistance:largeMin,contact,components:large.profile.ms}));
  // The shared fleet query must produce the same nearest hostile distance as individual queries.
  const allLarge=large.fleets.flatMap(f=>f.ships).filter(ship=>ship.alive),sharedIndex=new game.ShipSpatialIndex(allLarge);
  for(const fleet of large.fleets){const opponents=allLarge.filter(ship=>ship.fleetId!==fleet.id&&large.fleets.find(other=>other.id===ship.fleetId)?.team!==fleet.team);
    const box=new T.Box3().setFromPoints(fleet.ships.map(ship=>ship.position)).expandByScalar(58),shared=sharedIndex.query(box.min,box.max).filter(ship=>opponents.includes(ship));let expected=Infinity,actual=Infinity;
    for(const ship of fleet.ships){for(const other of sharedIndex.near(ship.position,58))if(opponents.includes(other))expected=Math.min(expected,ship.position.distanceTo(other.position));for(const other of shared)actual=Math.min(actual,ship.position.distanceTo(other.position));}
    assert(Math.abs(actual-expected)<1e-7||(actual===Infinity&&expected===Infinity),JSON.stringify({fleet:fleet.id,actual,expected}));
  }
  assert(contact);assert(largeMin>=2.2-1e-5,JSON.stringify({largeMin}));
  pass('64 ship dense approach stays collision safe');
  pass('four ship breakthrough completes across preparation without collisions');
  const mixed=game.initialState(),mf=mixed.fleets[0],me=mixed.fleets[2];mixed.fleets=[mf,me];const proto=mf.ships[0];mf.ships=Array.from({length:9},(_,i)=>({...proto,id:'M-'+i,fleetId:mf.id,position:new T.Vector3(),velocity:new T.Vector3(),rotation:new T.Quaternion(),weapons:[{range:23.5}]}));
  mf.anchor.set(0,0,0);mf.rotation.identity();game.setCombatPolicy(mf,'LINE');const initial=game.slots(mf);mf.ships.forEach((ship,i)=>ship.position.copy(initial[i]));me.ships=me.ships.slice(0,1);me.anchor.set(0,0,23);me.ships[0].position.copy(me.anchor);game.setDestination(me,{ix:0,iy:0,iz:12});game.start(mixed);for(let i=0;i<30;i++)game.step(mixed);
  assert(mf.encounter.lineEngaged);const centerIndex=initial.findIndex(p=>Math.abs(p.x)<1e-8&&Math.abs(p.y)<1e-8);assert(centerIndex>=0);
  const centerOffset=mf.encounter.lineOffsets.get(mf.ships[centerIndex].id);assert(!centerOffset||centerOffset.length()<1e-8,'in-range center must not gain an approach offset');
  const outer=mf.ships.filter((ship,i)=>i!==centerIndex&&(mf.encounter.lineOffsets.get(ship.id)?.length()||0)>.01);assert(outer.length>0,'out-of-range outer ships receive approach offsets');
  const blockedWing=game.initialState(),bw=blockedWing.fleets[0],ob=blockedWing.fleets[1],bwEnemy=blockedWing.fleets[2];blockedWing.fleets=[bw,ob,bwEnemy];const wp=bw.ships[0];
  bw.ships=Array.from({length:9},(_,i)=>({...wp,id:'blocked-'+i,fleetId:bw.id,position:new T.Vector3(),velocity:new T.Vector3(),rotation:new T.Quaternion(),weapons:[{range:i===4?48:17.5}]}));bw.anchor.set(0,0,0);bw.rotation.identity();game.setCombatPolicy(bw,'LINE');const bwSlots=game.slots(bw);bw.ships.forEach((ship,i)=>{ship.position.copy(bwSlots[i]);ship.rotation.identity();});
  ob.ships=ob.ships.slice(0,1);ob.anchor.set(-8,-8,6);ob.rotation.identity();ob.ships[0].position.copy(ob.anchor);ob.ships[0].rotation.identity();ob.ships[0].collisionRadius=2.5;game.setDestination(ob,{ix:-4,iy:-4,iz:3});
  bwEnemy.ships=bwEnemy.ships.slice(0,1);bwEnemy.anchor.set(0,0,23);bwEnemy.ships[0].position.copy(bwEnemy.anchor);game.setDestination(bwEnemy,{ix:0,iy:0,iz:12});game.start(blockedWing);
  let bwMin=Infinity;for(let tick=0;tick<120;tick++){game.step(blockedWing);bwMin=Math.min(bwMin,bw.ships[0].position.distanceTo(ob.ships[0].position));}
  assert(bw.encounter.lineEngaged);const blockedOffset=bw.encounter.lineOffsets?.get(bw.ships[0].id);assert(!blockedOffset||blockedOffset.length()<1e-6,JSON.stringify({blockedOffset:blockedOffset?.toArray(),blocked:bw.ships[0].position.toArray(),obstacle:ob.ships[0].position.toArray()}));assert(bwMin>=3.6-1e-5);assert(bw.ships.some((ship,i)=>i!==0&&(bw.encounter.lineOffsets?.get(ship.id)?.length()||0)>.01),'other safe wings may still approach');
  ob.anchor.set(40,0,0);ob.velocity.set(0,0,0);ob.ships[0].position.copy(ob.anchor);ob.ships[0].velocity.set(0,0,0);game.setDestination(ob,{ix:20,iy:0,iz:0});
  for(let tick=0;tick<24;tick++)game.step(blockedWing);const beforeBlock=bw.encounter.lineOffsets?.get(bw.ships[0].id)?.clone();assert(beforeBlock&&beforeBlock.length()>.1,'wing receives a route after obstacle clears');
  ob.anchor.set(-8,-8,6);ob.velocity.set(0,0,0);ob.ships[0].position.copy(ob.anchor);ob.ships[0].velocity.set(0,0,0);game.setDestination(ob,{ix:-4,iy:-4,iz:3});
  for(let tick=0;tick<24;tick++)game.step(blockedWing);const afterBlock=bw.encounter.lineOffsets?.get(bw.ships[0].id);const nowGoal=game.slots(bw)[0];
  assert(afterBlock&&nowGoal.distanceTo(bw.ships[0].position)<.5,JSON.stringify({before:beforeBlock.toArray(),after:afterBlock?.toArray(),ship:bw.ships[0].position.toArray(),goal:nowGoal.toArray()}));
  ob.anchor.set(40,0,0);ob.velocity.set(0,0,0);ob.ships[0].position.copy(ob.anchor);ob.ships[0].velocity.set(0,0,0);game.setDestination(ob,{ix:20,iy:0,iz:0});
  for(let tick=0;tick<30;tick++)game.step(blockedWing);assert(game.slots(bw)[0].distanceTo(bw.ships[0].position)>1,'wing should receive a new approach target after the obstacle clears');
  pass('line wing replans after a temporary obstacle clears');
  pass('line cancels a wing route when an obstacle enters the path');
  pass('blocked line wing holds while other safe wings approach');
  pass('line advances out-of-range ships while in-range center holds');
  pass('line formation assigns limited offsets to out of range ships');
  const broadside=game.initialState(),bf=broadside.fleets[0],be=broadside.fleets[2];broadside.fleets=[bf,be];bf.ships=bf.ships.slice(0,1);be.ships=be.ships.slice(0,1);bf.anchor.set(0,0,0);bf.rotation.identity();bf.ships[0].position.copy(bf.anchor);bf.ships[0].rotation.identity();bf.ships[0].weapons=[{range:48,damage:100,cooldownSec:1,aimDirection:new T.Vector3(1,0,0),aimCone:.2}];
  game.setDestination(bf,{ix:0,iy:0,iz:20});be.anchor.set(15,0,0);be.ships[0].position.copy(be.anchor);game.setDestination(be,{ix:8,iy:0,iz:0});game.start(broadside);for(let i=0;i<60;i++)game.step(broadside);
  const side=new T.Vector3(1,0,0).applyQuaternion(bf.ships[0].rotation),toward=be.ships[0].position.clone().sub(bf.ships[0].position).normalize();assert(side.dot(toward)>.9,'broadside weapon remains aimed at target');
  const body={id:'attitude-test',position:new T.Vector3(),velocity:new T.Vector3(),rotation:new T.Quaternion(),weapons:[{range:100,damage:1,cooldownSec:1,aimDirection:new T.Vector3(0,0,1),aimCone:.1}]};
  const base=new T.Quaternion(),limit=Math.PI/2;
  for(const target of [[50,0,0],[0,50,0],[-50,0,0],[0,-50,0],[0,0,-50]]){
    body.aimTargetPosition=new T.Vector3(...target);body.aimRevision=(body.aimRevision||0)+1;const desired=game.aimFromBase(body,base,body.position);
    for(let tick=0;tick<180;tick++){
      const before=body.rotation.clone();game.steerMotion(body,body.position.clone(),game.CONFIG.dt,{aimRotation:desired,aimBase:base,aimAngles:body.aimDesiredAngles});
      assert(before.angleTo(body.rotation)<=.8*game.CONFIG.dt+1e-7,'ship angular velocity limit');
      const angles=body.relativeAimAngles;assert(angles&&Math.abs(angles.x)<=limit+1e-6&&Math.abs(angles.y)<=limit+1e-6&&Math.abs(angles.z)<=limit+1e-6,JSON.stringify({target,tick,angles:angles?.toArray()}));
    }
  }
  const movingBody={position:new T.Vector3(),velocity:new T.Vector3(),rotation:new T.Quaternion(),weapons:[{range:100,damage:1,cooldownSec:1,aimDirection:new T.Vector3(0,0,1),aimCone:.1}]};
  movingBody.aimTargetPosition=new T.Vector3(20,0,50);movingBody.aimRevision=1;
  for(let tick=0;tick<180;tick++){
    const movingBase=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),tick*.003),desired=game.aimFromBase(movingBody,movingBase,movingBody.position),before=movingBody.rotation.clone();
    game.steerMotion(movingBody,movingBody.position.clone(),game.CONFIG.dt,{aimRotation:desired,aimBase:movingBase,aimAngles:movingBody.aimDesiredAngles});
    assert(before.angleTo(movingBody.rotation)<=.8*game.CONFIG.dt+1e-7,'world turn speed remains bounded while formation rotates');
  }
  const stress={position:new T.Vector3(),velocity:new T.Vector3(),rotation:new T.Quaternion(),weapons:[{range:100,damage:1,cooldownSec:1,aimDirection:new T.Vector3(0,0,1),aimCone:.1}],aimTargetPosition:new T.Vector3(50,0,0),aimRevision:1};
  let maxExcess=0;
  for(let tick=0;tick<650;tick++){
    const turningBase=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),tick*.008),desired=game.aimFromBase(stress,turningBase,stress.position),before=stress.rotation.clone();
    game.steerMotion(stress,stress.position.clone(),game.CONFIG.dt,{aimRotation:desired,aimBase:turningBase,aimAngles:stress.aimDesiredAngles});
    const rel=turningBase.clone().invert().multiply(stress.rotation),euler=new T.Euler().setFromQuaternion(rel,'YXZ');maxExcess=Math.max(maxExcess,Math.abs(euler.x)-limit,Math.abs(euler.y)-limit,Math.abs(euler.z)-limit);
    assert(before.angleTo(stress.rotation)<=.8*game.CONFIG.dt+1e-7);
  }
  assert(maxExcess<.02,JSON.stringify({maxExcess}));
  pass('turning base preserves relative axis bounds');
  pass('turn speed stays bounded while the base orientation changes');
  pass('stationary base aim transitions respect angular speed and axis bounds');
  pass('weapon orientation participates in ship posture scoring');
  pass('ship aims toward a side target while travelling');
  const bypass=game.initialState(),col=bypass.fleets[0],block=bypass.fleets[2];bypass.fleets=[col,block];col.ships=col.ships.slice(0,1);block.ships=block.ships.slice(0,1);
  col.anchor.set(0,0,-20);col.rotation.identity();col.ships[0].position.copy(col.anchor);col.ships[0].rotation.identity();game.setDestination(col,{ix:0,iy:0,iz:20});
  block.anchor.set(0,0,0);block.ships[0].position.copy(block.anchor);block.ships[0].rotation.identity();game.setDestination(block,{ix:0,iy:0,iz:0});game.start(bypass);
  let minBypass=Infinity,sawBypass=false,reached=false;for(let t=0;t<2400;t++){
    if(bypass.phase==='PREPARATION')game.start(bypass);game.step(bypass);minBypass=Math.min(minBypass,col.ships[0].position.distanceTo(block.ships[0].position));sawBypass||=col.columnMode==='BYPASS';reached||=col.ships[0].position.z>15;if(reached)break;
  }
  assert(sawBypass);assert(minBypass>=12-1e-4,JSON.stringify({minBypass,anchor:col.anchor.toArray(),position:col.ships[0].position.toArray(),mode:col.columnMode}));assert(reached,JSON.stringify({minBypass,anchor:col.anchor.toArray(),position:col.ships[0].position.toArray(),mode:col.columnMode}));
  const squad=game.initialState(),sc=squad.fleets[0],sb=squad.fleets[2];squad.fleets=[sc,sb];sb.ships=sb.ships.slice(0,1);sc.anchor.set(0,0,-30);sc.rotation.identity();const scStart=game.slots(sc);sc.ships.forEach((ship,i)=>{ship.position.copy(scStart[i]);ship.rotation.identity();});sb.anchor.set(0,0,0);sb.ships[0].position.copy(sb.anchor);game.setDestination(sc,{ix:0,iy:0,iz:20});game.setDestination(sb,{ix:0,iy:0,iz:0});game.start(squad);
  let squadMin=Infinity,squadPassed=false,squadBypass=false;for(let tick=0;tick<4800;tick++){
    if(squad.phase==='PREPARATION')game.start(squad);game.step(squad);for(const ship of sc.ships)if(ship.alive)squadMin=Math.min(squadMin,ship.position.distanceTo(sb.ships[0].position));squadBypass||=sc.columnMode==='BYPASS';squadPassed=sc.ships.every(ship=>!ship.alive||ship.position.z>4);if(squadPassed)break;
  }
  assert(squadBypass);assert(squadMin>=12-1e-4,JSON.stringify({squadMin,mode:sc.columnMode,anchor:sc.anchor.toArray(),positions:sc.ships.map(s=>s.position.toArray())}));assert(squadPassed,JSON.stringify({squadMin,mode:sc.columnMode,anchor:sc.anchor.toArray(),positions:sc.ships.map(s=>s.position.toArray())}));
  const blocked=game.initialState(),bc=blocked.fleets[0],be2=blocked.fleets[2];blocked.fleets=[bc,be2];bc.ships=bc.ships.slice(0,1);be2.ships=be2.ships.slice(0,1);
  bc.anchor.set(0,0,-12);bc.rotation.identity();bc.ships[0].position.copy(bc.anchor);bc.ships[0].rotation.identity();game.setDestination(bc,{ix:0,iy:0,iz:15});be2.anchor.set(0,0,0);be2.ships[0].position.copy(be2.anchor);game.setDestination(be2,{ix:0,iy:0,iz:0});game.start(blocked);game.step(blocked);
  assert.equal(bc.columnMode,'HOLD','unsafe immediate turn must stop');assert(bc.safetyStop);
  be2.anchor.set(40,0,0);be2.ships[0].position.copy(be2.anchor);be2.ships[0].velocity.set(0,0,0);game.setDestination(be2,{ix:20,iy:0,iz:0});const beforeResume=bc.anchor.z;
  for(let tick=0;tick<120;tick++)game.step(blocked);
  assert.equal(bc.columnMode,'TRAVEL');assert(!bc.safetyStop);assert(bc.anchor.z>beforeResume,'fleet resumes when route clears');
  const movingObstacle=game.initialState(),movingColumn=movingObstacle.fleets[0],crossing=movingObstacle.fleets[2];movingObstacle.experimentalManeuver=process.env.FLEET_EXPERIMENTAL==='1';movingObstacle.fleets=[movingColumn,crossing];movingColumn.ships=movingColumn.ships.slice(0,1);crossing.ships=crossing.ships.slice(0,1);
  movingColumn.anchor.set(0,0,-20);movingColumn.rotation.identity();movingColumn.ships[0].position.copy(movingColumn.anchor);movingColumn.ships[0].rotation.identity();game.setDestination(movingColumn,{ix:0,iy:0,iz:15});
  crossing.anchor.set(-20,0,0);crossing.rotation.setFromAxisAngle(new T.Vector3(0,1,0),Math.PI/2);crossing.ships[0].position.copy(crossing.anchor);crossing.ships[0].rotation.copy(crossing.rotation);game.setDestination(crossing,{ix:10,iy:0,iz:0});game.start(movingObstacle);
  let movingMin=Infinity,movingBypass=false;for(let t=0;t<1500;t++){game.step(movingObstacle);movingMin=Math.min(movingMin,movingColumn.ships[0].position.distanceTo(crossing.ships[0].position));movingBypass||=movingColumn.columnMode==='BYPASS';}
  assert(movingBypass,'moving target should be considered in route planning');assert(movingMin>=12-1e-4,JSON.stringify({movingMin,ship:movingColumn.ships[0].position.toArray(),other:crossing.ships[0].position.toArray(),mode:movingColumn.columnMode}));
  const edge=game.initialState(),ec=edge.fleets[0],ee=edge.fleets[2];edge.fleets=[ec,ee];ec.ships=ec.ships.slice(0,1);ee.ships=ee.ships.slice(0,1);
  ec.anchor.set(56,0,-20);ec.rotation.identity();ec.ships[0].position.copy(ec.anchor);ec.ships[0].rotation.identity();game.setDestination(ec,{ix:28,iy:0,iz:20});
  ee.anchor.set(56,0,0);ee.ships[0].position.copy(ee.anchor);game.setDestination(ee,{ix:28,iy:0,iz:0});game.start(edge);
  let edgeMin=Infinity,edgePassed=false;for(let tick=0;tick<3000;tick++){if(edge.phase==='PREPARATION')game.start(edge);game.step(edge);edgeMin=Math.min(edgeMin,ec.ships[0].position.distanceTo(ee.ships[0].position));assert(game.insideBattlefield(ec.ships[0].position));if(ec.ships[0].position.z>15){edgePassed=true;break;}}
  assert(edgeMin>=12-1e-4,JSON.stringify({edgeMin,position:ec.ships[0].position.toArray()}));assert(edgePassed,JSON.stringify({edgeMin,mode:ec.columnMode,position:ec.ships[0].position.toArray(),anchor:ec.anchor.toArray()}));
  pass('column bypasses inside the battlefield boundary');
  const many=game.initialState(),movingCol=many.fleets[0],crossOne=many.fleets[2],crossTwo=many.fleets[3];many.experimentalManeuver=process.env.FLEET_EXPERIMENTAL==='1';many.fleets=[movingCol,crossOne,crossTwo];movingCol.anchor.set(0,0,-30);movingCol.rotation.identity();const movingSlots=game.slots(movingCol);movingCol.ships.forEach((ship,i)=>{ship.position.copy(movingSlots[i]);ship.rotation.identity();});game.setDestination(movingCol,{ix:0,iy:0,iz:20});
  for(const [fleet,x,z,angle,goalX] of [[crossOne,-18,0,Math.PI/2,9],[crossTwo,18,12,-Math.PI/2,-9]]){fleet.ships=fleet.ships.slice(0,1);fleet.anchor.set(x,0,z);fleet.rotation.setFromAxisAngle(new T.Vector3(0,1,0),angle);fleet.ships[0].position.copy(fleet.anchor);fleet.ships[0].rotation.copy(fleet.rotation);game.setDestination(fleet,{ix:goalX,iy:0,iz:z/2});}
  game.start(many);let manyMin=Infinity,passedMany=false,closest=null,firstBreach=null;for(let tick=0;tick<3000;tick++){if(many.phase==='PREPARATION')game.start(many);const prior=new Map(many.fleets.flatMap(f=>f.ships).map(s=>[s.id,s.position.clone()]));game.step(many);for(const ship of movingCol.ships)for(const enemyShip of [crossOne.ships[0],crossTwo.ships[0]]){const d=ship.position.distanceTo(enemyShip.position);if(!firstBreach&&d<12){const a=prior.get(ship.id),b=prior.get(enemyShip.id);firstBreach={tick,ship:ship.id,enemy:enemyShip.id,before:a.distanceTo(b),after:d,shipOnly:ship.position.distanceTo(b),enemyOnly:a.distanceTo(enemyShip.position),shipPosition:ship.position.toArray(),enemyPosition:enemyShip.position.toArray(),shipVelocity:ship.velocity.toArray(),enemyVelocity:enemyShip.velocity.toArray(),mode:movingCol.columnMode,anchor:movingCol.anchor.toArray()};}if(d<manyMin){manyMin=d;closest={tick,ship:ship.id,enemy:enemyShip.id,shipPosition:ship.position.toArray(),enemyPosition:enemyShip.position.toArray(),shipVelocity:ship.velocity.toArray(),enemyVelocity:enemyShip.velocity.toArray(),anchor:movingCol.anchor.toArray(),mode:movingCol.columnMode};}}passedMany=movingCol.ships.every(ship=>ship.position.z>16);if(passedMany)break;}
  assert(manyMin>=12-1e-4,JSON.stringify({manyMin,firstBreach,closest,positions:movingCol.ships.map(s=>s.position.toArray()),enemies:[crossOne.ships[0].position.toArray(),crossTwo.ships[0].position.toArray()],mode:movingCol.columnMode}));assert(passedMany,JSON.stringify({manyMin,mode:movingCol.columnMode,positions:movingCol.ships.map(s=>s.position.toArray())}));
  if(process.env.FLEET_EXPERIMENTAL==='1')console.log('COLUMN_CROSS_RESULT',JSON.stringify({singleMin:movingMin,manyMin,closest,passedMany}));
  if(process.env.FLEET_EXPERIMENTAL==='1')for(const offset of [-4,4]){
    const scene=game.initialState(),fleet=scene.fleets[0],opponent=scene.fleets[2];scene.experimentalManeuver=true;scene.fleets=[fleet,opponent];fleet.anchor.set(0,0,-30);fleet.rotation.identity();const initialSlots=game.slots(fleet);fleet.ships.forEach((ship,i)=>{ship.position.copy(initialSlots[i]);ship.rotation.identity();});game.setDestination(fleet,{ix:0,iy:0,iz:20});
    opponent.ships=opponent.ships.slice(0,1);opponent.anchor.set(-18,0,offset);opponent.rotation.setFromAxisAngle(new T.Vector3(0,1,0),Math.PI/2);opponent.ships[0].position.copy(opponent.anchor);opponent.ships[0].rotation.copy(opponent.rotation);game.setDestination(opponent,{ix:9,iy:0,iz:offset/2});
    game.start(scene);let minimum=Infinity,progress=false;const yawChanges=Array(fleet.ships.length).fill(0),lastYaw=Array(fleet.ships.length).fill(null);for(let tick=0;tick<4200;tick++){if(scene.phase==='PREPARATION')game.start(scene);game.step(scene);for(const [i,ship] of fleet.ships.entries()){minimum=Math.min(minimum,ship.position.distanceTo(opponent.ships[0].position));const yaw=ship.maneuverCommand?.yaw;if(Number.isFinite(yaw)&&lastYaw[i]!==null&&Math.abs(Math.atan2(Math.sin(yaw-lastYaw[i]),Math.cos(yaw-lastYaw[i])))>1)yawChanges[i]++;lastYaw[i]=yaw;}progress=fleet.ships.every(ship=>ship.position.z>16);if(progress)break;}
    assert(minimum>=12-1e-4&&progress,JSON.stringify({offset,minimum,progress,mode:fleet.columnMode,regroup:fleet.columnRegroup,safetyStop:fleet.safetyStop,yawChanges,anchor:fleet.anchor.toArray(),positions:fleet.ships.map(s=>s.position.toArray()),velocities:fleet.ships.map(s=>s.velocity.toArray()),goals:game.slots(fleet).map(p=>p.toArray()),maneuvers:fleet.ships.map(s=>({yaw:new T.Euler().setFromQuaternion(s.rotation,'YXZ').y,forward:s.propulsionForward,command:s.maneuverCommand}))}));
  }
  pass('four ship column navigates two moving crossing fleets');
  pass('column maintains separation against a crossing moving fleet');
  pass('blocked column brakes and resumes when route clears');
  pass('four ship column bypass maintains clearance through the turn');
  pass('column bypass maintains clearance and resumes its destination');
  const lineHold=game.initialState(),lh=lineHold.fleets[0],le=lineHold.fleets[2];lineHold.fleets=[lh,le];lh.ships=lh.ships.slice(0,1);le.ships=le.ships.slice(0,1);
  lh.anchor.set(0,0,0);lh.rotation.identity();lh.ships[0].position.copy(lh.anchor);lh.ships[0].rotation.identity();lh.ships[0].weapons=[{range:25}];game.setCombatPolicy(lh,'LINE');game.setDestination(lh,{ix:0,iy:0,iz:20});
  le.anchor.set(0,0,24);le.ships[0].position.copy(le.anchor);game.setDestination(le,{ix:0,iy:0,iz:12});game.start(lineHold);for(let tick=0;tick<30;tick++)game.step(lineHold);
  assert(lh.encounter.lineEngaged);const heldPosition=lh.anchor.clone();le.anchor.set(0,0,18);le.ships[0].position.copy(le.anchor);le.ships[0].velocity.set(0,0,0);game.setDestination(le,{ix:0,iy:0,iz:9});
  for(let tick=0;tick<60;tick++)game.step(lineHold);
  assert(lh.anchor.z>=heldPosition.z-.03,'line must not reverse solely to restore distance');assert(lh.encounter.lineEngaged);
  le.anchor.set(0,0,31);le.ships[0].position.copy(le.anchor);le.ships[0].velocity.set(0,0,0);game.setDestination(le,{ix:0,iy:0,iz:16});const lastPosition=lh.anchor.z;
  for(let tick=0;tick<60;tick++)game.step(lineHold);
  assert(!lh.encounter.lineEngaged,'line resumes approach when target is out of engagement range');assert(lh.anchor.z>lastPosition,'line advances instead of remaining stalled');
  pass('line holds without reversing and reapproaches out-of-range target');
  pass('column selects a bounded forward bypass and line enters engagement');
  pass('opposing breakthrough fleets evade safely and cross');
  pass('breakthrough crosses while defending ship evades');
  encounter.phase='PREPARATION';const held=attacker.encounter.breakthrough;assert(held);game.start(encounter);assert.equal(attacker.encounter.breakthrough,held,'resume preserves active charge plan');
  encounter.phase='PREPARATION';game.setCombatPolicy(attacker,'COLUMN');assert.equal(attacker.encounter.active,false);assert.equal(attacker.encounter.breakthrough,null);assert.equal(attacker.encounter.target,null);assert.equal(attacker.safetyStop,false);
  game.start(encounter);game.step(encounter);assert.equal(attacker.encounter.policy,null,'old breakthrough state is not restored');
  const leadScene=game.initialState(),leadFleet=leadScene.fleets[0];game.start(leadScene);game.step(leadScene);const oldPath=leadFleet.columnPath,oldSlots=game.slots(leadFleet),beforeLeaderLoss=leadFleet.ships[1].position.clone();
  leadFleet.ships[0].alive=false;const newSlots=game.slots(leadFleet);assert(newSlots[1].distanceTo(oldSlots[0])<1e-9,'next surviving ship inherits lead position');assert(leadFleet.ships[1].position.distanceTo(beforeLeaderLoss)<1e-9,'leadership change does not teleport');
  game.step(leadScene);assert.equal(leadFleet.columnPath,oldPath,'recorded path survives leader loss');
  pass('policy change clears old state; pause and leader loss preserve appropriate state');
  function passageCase(shipStart,shipEnd,anchorEnd,enemyBox=null){
    const actor={id:'proof',alive:true,position:new T.Vector3(...shipEnd)},box=new T.Box3(new T.Vector3(-1,-1,-1),new T.Vector3(1,1,1));
    const b={phase:'CHARGE',axis:new T.Vector3(0,0,1),box,exit:new T.Vector3(0,0,20),previous:new T.Vector3(0,0,-5),time:0,timeLimit:100,entered:false,shipPrevious:new Map([['proof',new T.Vector3(...shipStart)]]),shipStart:new Map([['proof',new T.Vector3(...shipStart)]]),traversed:new Set()};
    const fleet={anchor:new T.Vector3(...anchorEnd),velocity:new T.Vector3(0,0,1),ships:[actor],encounter:{breakthrough:b,reason:''}};
    const enemyBounds={box:enemyBox||box.clone()};game.updateBreakthrough(fleet,{},enemyBounds,game.CONFIG.dt,false);return {fleet,b};
  }
  const ghost=passageCase([5,0,-2],[5,0,-2],[0,0,5]);assert.equal(ghost.b.entered,false,'anchor crossing alone cannot prove entry');assert.notEqual(ghost.fleet.encounter.reason,'돌파 완료');
  const actualPass=passageCase([0,0,-2],[0,0,2],[5,0,5]);assert(actualPass.b.traversed.has('proof'));assert.equal(actualPass.fleet.encounter.reason,'돌파 완료');
  const displaced=passageCase([0,0,-2],[0,0,2],[5,0,5],new T.Box3(new T.Vector3(-1,-1,29),new T.Vector3(1,1,31)));assert.equal(displaced.b.entered,false,'crossing a long-vacated plan area is not target passage');assert.notEqual(displaced.fleet.encounter.reason,'돌파 완료');
  const lateralMiss=passageCase([0,0,-2],[0,0,2],[5,0,5],new T.Box3(new T.Vector3(29,-1,-1),new T.Vector3(31,1,1)));assert.equal(lateralMiss.b.entered,false,'large lateral displacement invalidates stale plan evidence immediately');
  const moved=passageCase([0,0,-5],[0,0,-4],[0,0,-4]),farBounds={box:new T.Box3(new T.Vector3(30,-1,-1),new T.Vector3(32,1,1))};let continued=true;
  for(let scan=0;scan<6&&continued;scan++)continued=game.updateBreakthrough(moved.fleet,{},farBounds,game.CONFIG.dt,true);
  assert.equal(continued,false);assert.match(moved.fleet.encounter.reason,/경로에서 이탈/);
  const nearby=passageCase([0,0,-5],[0,0,-4],[0,0,-4]),nearBounds={box:new T.Box3(new T.Vector3(5,-1,-1),new T.Vector3(7,1,1))};
  for(let scan=0;scan<6;scan++)assert(game.updateBreakthrough(nearby.fleet,{},nearBounds,game.CONFIG.dt,true),'ordinary lateral avoidance must not be classified as a miss');
  pass('sustained lateral target departure fails without chasing');
  const boundary=game.initialState(),guard=boundary.fleets[0],intruder=boundary.fleets[2];boundary.fleets=[guard,intruder];
  guard.anchor.set(0,0,0);guard.rotation.identity();game.setCombatPolicy(guard,'POINT_DEFENSE');const guardSlots=game.slots(guard);guard.ships.forEach((ship,i)=>ship.position.copy(guardSlots[i]));
  intruder.ships=intruder.ships.slice(0,1);intruder.anchor.set(0,0,20);intruder.ships[0].position.copy(intruder.anchor);game.setDefenseAnchor(guard,{ix:30,iy:0,iz:0});const originalGoal=guard.destination.clone();game.start(boundary);game.step(boundary);
  assert.equal(guard.encounter.active,false);assert.match(guard.encounter.reason,/배치할 수 없습니다/);assert(guard.destination.equals(originalGoal),'failed defense placement preserves movement order');
  const normalDefense=game.initialState(),dg=normalDefense.fleets[0],de=normalDefense.fleets[2];normalDefense.fleets=[dg,de];dg.anchor.set(0,0,0);dg.rotation.identity();game.setCombatPolicy(dg,'POINT_DEFENSE');const dgSlots=game.slots(dg);dg.ships.forEach((ship,i)=>ship.position.copy(dgSlots[i]));de.ships=de.ships.slice(0,1);de.anchor.set(0,0,20);de.ships[0].position.copy(de.anchor);game.setDefenseAnchor(dg,{ix:0,iy:0,iz:0});game.start(normalDefense);game.step(normalDefense);
  assert(dg.encounter.active);assert(dg.encounter.defensePoint.equals(new T.Vector3()));
  const defenseTravel=game.initialState(),def=defenseTravel.fleets[0],threat=defenseTravel.fleets[2];defenseTravel.fleets=[def,threat];defenseTravel.scores.ENEMY=100;def.anchor.set(0,0,0);def.rotation.identity();game.setCombatPolicy(def,'POINT_DEFENSE');const defSlots=game.slots(def);def.ships.forEach((ship,i)=>{ship.position.copy(defSlots[i]);ship.velocity.set(0,0,0);ship.rotation.identity();});
  threat.ships=threat.ships.slice(0,1);threat.anchor.set(0,0,20);threat.ships[0].position.copy(threat.anchor);game.setDefenseAnchor(def,{ix:0,iy:0,iz:4});game.start(defenseTravel);game.step(defenseTravel);assert(def.encounter.active);const lockedCenter=def.encounter.defensePoint.clone();threat.ships[0].alive=false;
  let released=false;for(let tick=0;tick<3000;tick++){
    if(defenseTravel.phase==='PREPARATION')game.start(defenseTravel);game.step(defenseTravel);
    if(!def.encounter.active){released=true;break;}
    assert(def.encounter.defensePoint.equals(lockedCenter),'defense center stays fixed after target loss');
  }
  assert(released,JSON.stringify({anchor:def.anchor.toArray(),target:lockedCenter.toArray(),distance:def.anchor.distanceTo(lockedCenter),arrived:def.encounter.arrived,positions:def.ships.map(s=>s.position.toArray()),goals:game.slots(def).map(p=>p.toArray())}));
  assert(def.anchor.distanceTo(lockedCenter)<=.1,'release follows anchor arrival');
  const multiThreat=game.initialState(),guardMulti=multiThreat.fleets[0],threatOne=multiThreat.fleets[2],threatTwo=multiThreat.fleets[3];multiThreat.fleets=[guardMulti,threatOne,threatTwo];
  guardMulti.anchor.set(0,0,0);guardMulti.rotation.identity();game.setCombatPolicy(guardMulti,'POINT_DEFENSE');const multiSlots=game.slots(guardMulti);guardMulti.ships.forEach((ship,i)=>{ship.position.copy(multiSlots[i]);ship.rotation.identity();});game.setDefenseAnchor(guardMulti,{ix:0,iy:0,iz:0});
  for(const [fleet,z] of [[threatOne,20],[threatTwo,-20]]){fleet.ships=fleet.ships.slice(0,1);fleet.anchor.set(0,0,z);fleet.ships[0].position.copy(fleet.anchor);game.setDestination(fleet,{ix:0,iy:0,iz:z/2});}
  game.start(multiThreat);game.step(multiThreat);assert(guardMulti.encounter.active);const lost=multiThreat.fleets.find(f=>f.id===guardMulti.encounter.enemyId);lost.ships[0].alive=false;
  for(let tick=0;tick<20;tick++)game.step(multiThreat);
  assert(guardMulti.encounter.active,'defense must remain active while another enemy is present');assert.notEqual(guardMulti.encounter.enemyId,lost.id);assert(guardMulti.encounter.defensePoint.equals(new T.Vector3()));
  function setupDefenseStall(speed){
    const world=game.initialState(),fleet=world.fleets[0],opponent=world.fleets[2];world.fleets=[fleet,opponent];fleet.ships=fleet.ships.slice(0,1);opponent.ships=opponent.ships.slice(0,1);
    fleet.anchor.set(0,0,0);fleet.rotation.identity();fleet.ships[0].position.copy(fleet.anchor);fleet.ships[0].rotation.identity();fleet.ships[0].forwardSpeed=speed;game.setCombatPolicy(fleet,'POINT_DEFENSE');game.setDefenseAnchor(fleet,{ix:0,iy:0,iz:4});opponent.anchor.set(0,0,20);opponent.ships[0].position.copy(opponent.anchor);game.setDestination(opponent,{ix:0,iy:0,iz:10});game.start(world);game.step(world);return {world,fleet};
  }
  const stalled=setupDefenseStall(5);assert(stalled.fleet.encounter.active);let stalledOut=false;
  for(let tick=0;tick<1100;tick++){
    stalled.fleet.anchor.set(0,0,0);stalled.fleet.velocity.set(0,0,0);stalled.fleet.ships[0].position.set(0,0,0);stalled.fleet.ships[0].velocity.set(0,0,0);game.step(stalled.world);
    if(!stalled.fleet.encounter.active){stalledOut=true;break;}
  }
  assert(stalledOut);assert.match(stalled.fleet.encounter.reason,/장시간 정체/);
  const slow=setupDefenseStall(.01);for(let tick=0;tick<1000;tick++)game.step(slow.world);
  assert(slow.fleet.encounter.active,'slow but progressing fleet must not be considered stalled');assert(slow.fleet.anchor.z>.01);
  const physicalStall=game.initialState(),pd=physicalStall.fleets[0],wall=physicalStall.fleets[1],pdEnemy=physicalStall.fleets[2];physicalStall.fleets=[pd,wall,pdEnemy];pd.ships=pd.ships.slice(0,1);wall.ships=wall.ships.slice(0,1);pdEnemy.ships=pdEnemy.ships.slice(0,1);
  pd.anchor.set(0,0,0);pd.rotation.identity();pd.ships[0].position.copy(pd.anchor);pd.ships[0].rotation.identity();game.setCombatPolicy(pd,'POINT_DEFENSE');game.setDefenseAnchor(pd,{ix:0,iy:0,iz:4});
  wall.anchor.set(0,0,4);wall.rotation.identity();wall.ships[0].position.copy(wall.anchor);wall.ships[0].rotation.identity();wall.ships[0].collisionRadius=2.9;game.setDestination(wall,{ix:0,iy:0,iz:2});
  pdEnemy.anchor.set(0,0,20);pdEnemy.ships[0].position.copy(pdEnemy.anchor);game.setDestination(pdEnemy,{ix:0,iy:0,iz:10});game.start(physicalStall);let physicalFailed=false,minWallGap=Infinity;
  for(let tick=0;tick<2400;tick++){if(physicalStall.phase==='PREPARATION')game.start(physicalStall);game.step(physicalStall);minWallGap=Math.min(minWallGap,pd.ships[0].position.distanceTo(wall.ships[0].position));if(!pd.encounter.active&&/장시간 정체/.test(pd.encounter.reason)){physicalFailed=true;break;}}
  assert(physicalFailed,JSON.stringify({phase:physicalStall.phase,active:pd.encounter.active,reason:pd.encounter.reason,anchor:pd.anchor.toArray(),ship:pd.ships[0].position.toArray(),wall:wall.ships[0].position.toArray(),stall:pd.encounter.defenseStallTime}));assert(minWallGap>=4-1e-5,'physical blocker must remain non-overlapping');
  pass('real allied obstruction causes defense assembly stall and explicit failure');
  pass('defense detects stalled assembly without rejecting slow progress');
  pass('defense keeps the point when a different enemy remains');
  pass('defense completes fixed point assembly after target loss');
  pass('defense rejects infeasible boundary without moving its center');
  const scatter=game.initialState(),striker=scatter.fleets[0],spread=scatter.fleets[2];striker.ships=striker.ships.slice(0,1);striker.anchor.set(0,0,-25);striker.rotation.identity();striker.ships[0].position.copy(striker.anchor);game.setCombatPolicy(striker,'BREAKTHROUGH');
  spread.ships=spread.ships.slice(0,3);spread.ships[0].position.set(-2,0,0);spread.ships[1].position.set(2,0,0);spread.ships[2].position.set(50,0,0);
  assert(game.makeBreakthroughPlan(striker,spread));const localPlan=striker.encounter.breakthrough;
  assert.deepEqual(new Set(localPlan.targetIds),new Set(spread.ships.slice(0,2).map(s=>s.id)),'far outlier must not expand the local target');assert(localPlan.box.max.x<10);const rayHit=new T.Ray(striker.anchor,localPlan.exit.clone().sub(striker.anchor).normalize()).intersectBox(localPlan.box,new T.Vector3());assert(rayHit&&rayHit.distanceTo(striker.anchor)<=localPlan.exit.distanceTo(striker.anchor),'planned axis must intersect local region');
  const savedAxis=localPlan.axis.clone();spread.rotation.setFromAxisAngle(new T.Vector3(0,1,0),2);assert(localPlan.axis.equals(savedAxis),'enemy hull rotation must not alter locked plan');
  localPlan.phase='CHARGE';localPlan.shipPrevious.set(striker.ships[0].id,striker.ships[0].position.clone());localPlan.shipStart.set(striker.ships[0].id,striker.ships[0].position.clone());spread.ships[2].position.set(-50,0,0);
  const fullBounds={box:new T.Box3().setFromPoints(spread.ships.map(ship=>ship.position))};for(let i=0;i<6;i++)assert(game.updateBreakthrough(striker,spread,fullBounds,game.CONFIG.dt,true),'unrelated outlier must not make the local target appear to move');
  spread.ships[0].position.x+=25;spread.ships[1].position.x+=25;let localContinues=true;for(let i=0;i<6&&localContinues;i++)localContinues=game.updateBreakthrough(striker,spread,fullBounds,game.CONFIG.dt,true);
  assert.equal(localContinues,false);assert.match(striker.encounter.reason,/경로에서 이탈/,'movement of the selected local group must trigger miss');
  spread.ships[0].alive=false;spread.ships[1].alive=false;assert.equal(game.updateBreakthrough(striker,spread,fullBounds,game.CONFIG.dt,true),false);assert.match(striker.encounter.reason,/대상이 소멸/);
  const offAxis=game.initialState(),offOwn=offAxis.fleets[0],offEnemy=offAxis.fleets[2];offAxis.fleets=[offOwn,offEnemy];offOwn.ships=offOwn.ships.slice(0,1);offEnemy.ships=offEnemy.ships.slice(0,1);
  offOwn.anchor.set(0,0,-25);offOwn.rotation.identity();offOwn.ships[0].position.copy(offOwn.anchor);offOwn.ships[0].rotation.identity();game.setDestination(offOwn,{ix:0,iy:0,iz:25});game.setCombatPolicy(offOwn,'BREAKTHROUGH');
  offEnemy.anchor.set(10,0,0);offEnemy.ships[0].position.copy(offEnemy.anchor);game.setDestination(offEnemy,{ix:5,iy:0,iz:0});game.start(offAxis);game.step(offAxis);assert(offOwn.encounter.breakthrough?.axis.x>.1,'off-axis enemy requires a directed charge axis');let completedOff=false;
  let sawOffCharge=false;for(let i=0;i<2400&&!completedOff;i++){if(offAxis.phase==='PREPARATION')game.start(offAxis);game.step(offAxis);const charge=offOwn.encounter.breakthrough;if(charge&&['CHARGE','TRANSIT'].includes(charge.phase)&&!sawOffCharge){sawOffCharge=true;assert(new T.Vector3(0,0,1).applyQuaternion(offOwn.rotation).dot(charge.axis)>=Math.cos(5*Math.PI/180)-.001,'charge must begin after formation aligns');}completedOff=offOwn.encounter.reason==='돌파 완료';}assert(sawOffCharge);
  assert(completedOff,JSON.stringify({reason:offOwn.encounter.reason,phase:offOwn.encounter.breakthrough?.phase,position:offOwn.ships[0].position.toArray()}));
  const alternate=game.initialState(),at=alternate.fleets[0],ae=alternate.fleets[2];at.ships=at.ships.slice(0,1);ae.ships=ae.ships.slice(0,2);at.anchor.set(40,0,0);at.rotation.identity();at.ships[0].position.copy(at.anchor);game.setCombatPolicy(at,'BREAKTHROUGH');ae.ships[0].position.set(55,0,10);ae.ships[1].position.set(10,0,20);
  assert(game.makeBreakthroughPlan(at,ae),'planner must try another forward cluster when nearest exit leaves the battlefield');assert.deepEqual(at.encounter.breakthrough.targetIds,[ae.ships[1].id]);assert(game.insideBattlefield(at.encounter.breakthrough.exit));
  pass('breakthrough uses a feasible forward cluster when the nearest is blocked by the boundary');
  pass('local breakthrough excludes distant targets and reaches an off-axis enemy');
  pass('breakthrough requires observed ship passage rather than anchor movement');
  pass('breakthrough requires front contact and starts with formation');
  // Each policy faces each other policy under the same initial geometry.
  const policies=['COLUMN','LINE','BREAKTHROUGH','POINT_DEFENSE'];
  for(const ownPolicy of policies)for(const enemyPolicy of policies){
    const battle=game.initialState(),a=battle.fleets[0],b=battle.fleets[2];battle.fleets=[a,b];
    a.ships=a.ships.slice(0,2);b.ships=b.ships.slice(0,2);
    a.anchor.set(0,0,-14);a.rotation.identity();b.anchor.set(0,0,14);b.rotation.setFromAxisAngle(new T.Vector3(0,1,0),Math.PI);
    game.setCombatPolicy(a,ownPolicy);game.setCombatPolicy(b,enemyPolicy);
    game.setDestination(a,{ix:0,iy:0,iz:20});game.setDestination(b,{ix:0,iy:0,iz:-20});
    for(const f of [a,b])game.slots(f).forEach((p,i)=>{f.ships[i].position.copy(p);f.ships[i].rotation.copy(f.rotation);});
    game.start(battle);let recognizedA=false,recognizedB=false;
    for(let tick=0;tick<360;tick++){
      game.step(battle);recognizedA||=a.encounter.active;recognizedB||=b.encounter.active;
      const units=[...a.ships,...b.ships];
      for(let i=0;i<units.length;i++){
        assert(units[i].position.toArray().every(Number.isFinite),`${ownPolicy} vs ${enemyPolicy}: invalid position`);
        for(let j=i+1;j<units.length;j++)assert(units[i].position.distanceTo(units[j].position)>=2.2-1e-5,`${ownPolicy} vs ${enemyPolicy}: overlap`);
      }
      if(tick===179){
        const saved=a.encounter.breakthrough,position=a.ships[0].position.clone(),time=battle.time;
        battle.phase='PREPARATION';game.step(battle);assert.equal(battle.time,time);assert(a.ships[0].position.distanceTo(position)<1e-9);
        game.start(battle);assert.equal(a.encounter.breakthrough,saved,'resume keeps the encounter plan');
      }
    }
    assert(ownPolicy==='COLUMN'||recognizedA,`${ownPolicy} vs ${enemyPolicy}: first fleet did not enter an encounter`);
    assert(enemyPolicy==='COLUMN'||recognizedB,`${ownPolicy} vs ${enemyPolicy}: second fleet did not enter an encounter`);
  }
  pass('all 16 policy pairings avoid overlap and preserve state across pause');
  // Deploy into an active fleet only during preparation, then continue its encounter.
  for(const policy of policies){
    const battle=game.initialState(),a=battle.fleets[0],b=battle.fleets[2];battle.fleets=[a,b];
    a.anchor.set(0,0,-18);a.rotation.identity();b.anchor.set(0,0,18);b.rotation.setFromAxisAngle(new T.Vector3(0,1,0),Math.PI);
    game.setCombatPolicy(a,policy);for(const f of [a,b])game.slots(f).forEach((p,i)=>{f.ships[i].position.copy(p);f.ships[i].rotation.copy(f.rotation);});
    game.start(battle);for(let i=0;i<30;i++)game.step(battle);if(policy!=='COLUMN')assert(a.encounter.active,policy+' should be in encounter');
    a.ships[0].alive=false;game.step(battle);const surviving=a.ships.filter(s=>s.alive),positions=surviving.map(s=>s.position.clone());
    battle.phase='PREPARATION';battle.scores.ALLY=30;const purchase=game.purchaseShip(battle,'ALLY',game.ECONOMY_CONFIG.typeId,'transition-'+policy);assert(purchase.ok);
    assert(game.assignReserve(battle,'ALLY',purchase.shipId,a.id).ok);const result=game.deployReserves(battle,()=>({commit(){},rollback(){}}));assert.equal(result.deployed,1);
    assert(surviving.every((s,i)=>s.position.distanceTo(positions[i])<1e-9),'deployment must not teleport survivors');
    const unit=a.ships.find(s=>s.id===purchase.shipId);assert(unit?.alive);assert.equal(a.tactics.policy,policy);
    game.start(battle);for(let i=0;i<120;i++)game.step(battle);
    assert(unit.position.toArray().every(Number.isFinite));assert.equal(a.tactics.policy,policy);
    for(const s of surviving)assert(unit.position.distanceTo(s.position)>=2.2-1e-5,policy+' reinforcement overlaps an ally');
  }
  pass('loss and reinforcement into each active policy survives preparation and resume');
  for(const from of policies)for(const to of policies){
    if(from===to)continue;
    const battle=game.initialState(),a=battle.fleets[0],b=battle.fleets[2];battle.fleets=[a,b];
    a.ships=a.ships.slice(0,1);b.ships=b.ships.slice(0,1);a.anchor.set(0,0,-15);a.rotation.identity();b.anchor.set(0,0,15);b.rotation.setFromAxisAngle(new T.Vector3(0,1,0),Math.PI);
    game.setCombatPolicy(a,from);game.setDestination(a,{ix:0,iy:0,iz:15});game.setDestination(b,{ix:0,iy:0,iz:-15});
    for(const f of [a,b]){f.ships[0].position.copy(f.anchor);f.ships[0].rotation.copy(f.rotation);}
    game.start(battle);for(let i=0;i<30;i++)game.step(battle);
    battle.phase='PREPARATION';const location=a.ships[0].position.clone(),oldRevision=a.tactics.revision;
    game.setCombatPolicy(a,to);assert.equal(a.tactics.revision,oldRevision+1);assert.equal(a.encounter.active,false);assert.equal(a.encounter.breakthrough,null);assert.equal(a.encounter.lineOffsets,null);assert.equal(a.columnPath,null);
    assert(a.ships[0].position.distanceTo(location)<1e-9);game.start(battle);for(let i=0;i<30;i++)game.step(battle);
    assert.equal(a.tactics.policy,to);assert(a.ships[0].position.toArray().every(Number.isFinite));
    if(a.encounter.active)assert.equal(a.encounter.policy,to,'resumed encounter must use the new policy');
    assert(a.ships[0].position.distanceTo(b.ships[0].position)>=2.2-1e-5);
  }
  pass('12 policy changes clear stale encounter plans before resume');
  for(const policy of ['LINE','BREAKTHROUGH','POINT_DEFENSE']){
    const battle=game.initialState(),a=battle.fleets[0],b=battle.fleets[2];battle.fleets=[a,b];a.ships=a.ships.slice(0,1);b.ships=b.ships.slice(0,1);
    a.anchor.set(0,0,-12);a.rotation.identity();b.anchor.set(0,0,12);b.rotation.setFromAxisAngle(new T.Vector3(0,1,0),Math.PI);game.setCombatPolicy(a,policy);
    game.setDestination(a,{ix:0,iy:0,iz:-6});game.setDestination(b,{ix:0,iy:0,iz:6});
    for(const f of [a,b]){f.ships[0].position.copy(f.anchor);f.ships[0].rotation.copy(f.rotation);}
    game.start(battle);game.step(battle);assert(a.encounter.active);b.ships[0].alive=false;battle.scores.ENEMY=30;
    for(let i=0;i<120;i++)game.step(battle);
    assert.equal(a.encounter.active,false,policy+' should clear the destroyed target after its required formation');
    assert.equal(a.encounter.enemyId,null);assert.equal(a.encounter.breakthrough,null);
  }
  pass('destroyed target clears encounters for line, breakthrough and defense');
  // Reproduce the UI flow: one LINE battle, then switch to defense and breakthrough.
  const observed=game.initialState(),obsA=observed.fleets[0],obsB=observed.fleets[1];
  for(const fleet of observed.fleets)for(const ship of fleet.ships){ship.forwardSpeed=5;ship.weapons=[{range:48}];}
  game.setCombatPolicy(obsA,'LINE');game.prepareEnemyAI(observed);game.start(observed);for(let i=0;i<1800;i++)game.step(observed);
  assert.equal(observed.phase,'PREPARATION');game.setCombatPolicy(obsA,'POINT_DEFENSE');game.setCombatPolicy(obsB,'BREAKTHROUGH');game.prepareEnemyAI(observed);game.start(observed);
  let obsCharge=false,obsDefense=false,obsBreakReason='';for(let i=0;i<3600;i++){
    if(observed.phase==='PREPARATION'){game.prepareEnemyAI(observed);game.start(observed);}game.step(observed);
    obsCharge||=['CHARGE','TRANSIT'].includes(obsB.encounter.breakthrough?.phase);obsDefense||=!!obsA.encounter.arrived;
    if(obsB.encounter.reason)obsBreakReason=obsB.encounter.reason;
  }
  console.log('OBSERVED_TRANSITIONS',JSON.stringify({defenseArrived:obsDefense,defenseState:obsA.encounter.active,defenseReason:obsA.encounter.reason,defenseStall:obsA.encounter.defenseStallTime,defenseAnchor:obsA.anchor.toArray(),defensePoint:obsA.encounter.defensePoint?.toArray(),breakCharge:obsCharge,breakPhase:obsB.encounter.breakthrough?.phase,breakReason:obsBreakReason,formation:obsB.formationRatio,breakTime:obsB.encounter.breakthrough?.time,breakLimit:obsB.encounter.breakthrough?.timeLimit}));
  assert(obsDefense,'defense must reach its point in this no-damage transition scenario');
  assert(obsCharge,'breakthrough must eventually enter the charge phase in this no-damage transition scenario');
  pass('policy switch eventually assembles defense and enters breakthrough without damage');
  const statusURL='data:text/javascript;base64,'+Buffer.from(await readFile(new URL('./status-ui.js',import.meta.url),'utf8')).toString('base64'),{createStatusUI}=await import(statusURL);
  const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{open:id==='debug-menu',textContent:'',hidden:false});return elements.get(id);};
  let current=obsB;observed.profile={ticks:0,shots:0,frames:0,ms:{},wallMs:0,cappedMs:0,droppedStepMs:0};
  const status=createStatusUI({$:element,state:observed,SCORE_CONFIG:game.SCORE_CONFIG,ECONOMY_CONFIG:game.ECONOMY_CONFIG,tacticLabels:{COLUMN:'단종진',LINE:'일자진',BREAKTHROUGH:'어린진',POINT_DEFENSE:'원형진'},getSlots:game.slots,getContext:()=>({selected:current,draft:null,patrolEdit:null,manualPaused:false})});
  status.updateStatus();assert.match(element('debug-target').textContent,/돌파진단.*정렬각=.*최대슬롯오차=/);
  current=obsA;status.updateStatus();assert.match(element('debug-target').textContent,/거점진단.*정체시간=.*최대슬롯오차=/);
  pass('developer diagnostics expose real formation and defense state');
  pass('relative-motion collision includes allied crossings and permits separation');
  pass('formation targets exist before contact and survive pause/resume');
  pass('game balance initialization, pause, purchase idempotence, failed deployment');
 }
 {
  const spatial=await readFile(new URL('./spatial-index.js',import.meta.url),'utf8');
  const spatialURL='data:text/javascript;base64,'+Buffer.from(spatial).toString('base64');
  const hit=await readFile(new URL('./hit-resolution.js',import.meta.url),'utf8');
  const hitURL='data:text/javascript;base64,'+Buffer.from(hit).toString('base64');
  const score=(await readFile(new URL('./scoring.js',import.meta.url),'utf8')).replace("from 'three'","from '"+rt.threeURL+"'");
  const scoreURL='data:text/javascript;base64,'+Buffer.from(score).toString('base64');
  const economy=await readFile(new URL('./economy.js',import.meta.url),'utf8');
  const economyURL='data:text/javascript;base64,'+Buffer.from(economy).toString('base64');
  const game=await rt.module((await readFile(new URL('./simulation.js',import.meta.url),'utf8')).replace('./spatial-index.js?v=refactor-20261127c',spatialURL).replace('./hit-resolution.js?v=refactor-20261127c',hitURL).replace('./scoring.js?v=refactor-20261127c',scoreURL).replace('./economy.js?v=refactor-20261127c',economyURL));
  function scene(mode,block){const state=game.initialState();state.fleets=[state.fleets[0],state.fleets[2]];let a=state.fleets[0],e=state.fleets[1];a.ships=a.ships.slice(0,block?2:1);e.ships=e.ships.slice(0,1);const owner=a.ships[0],target=e.ships[0];owner.position.set(0,0,0);owner.velocity.set(0,0,0);target.position.set(0,0,10);target.velocity.set(0,0,0);target.hp=100;target.shield=5;if(block){a.ships[1].position.set(0,0,5);a.ships[1].velocity.set(0,0,0);}const weapon={id:'test-w',cooldownSec:2};state.hitSearchAlgorithm=mode;state.combat=()=>[{ownerShipId:owner.id,muzzleId:'test-m',team:'ALLY',position:new T.Vector3(0,0,0),direction:new T.Vector3(0,0,1),range:20,radius:.1,damage:10,weapon,isRayPulse:false}];game.start(state);game.step(state);return {hp:target.hp,shield:target.shield,reason:weapon.blockReason,cooldown:weapon.cooldown,events:state.attackEvents.map(x=>[x.receiverShipId,x.damage])};}
  for(const mode of ['A0','A1','D']){const hit=scene(mode,false),blocked=scene(mode,true);assert.equal(hit.hp,95);assert.equal(hit.shield,0);assert.equal(hit.cooldown,2);assert.equal(hit.events.length,1);assert.equal(blocked.hp,100);assert.equal(blocked.reason,'FRIENDLY_BLOCK');assert.equal(blocked.events.length,0);}
  assert.deepEqual(scene('A1',false),scene('A0',false));assert.deepEqual(scene('D',false),scene('A0',false));
  const ships=Array.from({length:30},(_,i)=>({id:'c'+i,position:new T.Vector3((i%5-2)*8,(Math.floor(i/5)%3-1)*8,(Math.floor(i/15)-.5)*16),collisionRadius:1.1}));
  const index=new game.ShipSpatialIndex(ships);let checked=0;
  for(const origin of [[-24,-8,-16],[0,0,0],[8,8,8]])for(const end of [[24,8,16],[-24,-8,-16],[0,0,24]])for(const radius of [0,.1,8]){
    const a=new T.Vector3(...origin),b=new T.Vector3(...end),ids=new Set(index.segmentDDA(a,b,radius).map(x=>x.id));
    for(const ship of ships){if(game.segmentSphere(a,b,ship.position,radius+ship.collisionRadius)!==null)assert(ids.has(ship.id));checked++;}
  }assert.equal(checked,810);
  pass('game attack methods preserve friendly block and shield damage');
 }
console.log(count+' game regression groups passed');
