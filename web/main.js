import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG, COMMAND_GRID, BATTLEFIELD, ZONES, SCORE_CONFIG, zoneCounts, captureMuzzleChain, muzzlePoseFromData, gridToWorld, worldToNearestGrid, insideBattlefield, setDestination, ECONOMY_CONFIG, createEmptyFleet, purchaseShip, assignReserve, deployReserves, prepareEnemyAI, checkRecovery, initialState, slots, grid, dimensions, validateSize, sizeForSpacing, step, start } from './simulation.js?v=phase3-20261124-2';
import { discoverRig, initializeWeapons, applyPose, pitchRange } from '../rigging-test/rig-control.js';
import { RigSafety } from '../rigging-test/rig-safety.js';

// Game-only broad phase. The reference rigging tool and its hashed analysis remain unchanged.
class GameRigSafety extends RigSafety {
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

const $ = id => document.getElementById(id);
const state = initialState();
const friendly = state.fleets.filter(f => f.team === 'ALLY');
let prepareUnitView=null, purchaseCounter=0;
let selected = friendly[0];
let draft = null;
let activeCamera;
let pickingCamera;
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.setSize(innerWidth,innerHeight); renderer.outputColorSpace=THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0x080e1b);
const camera=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,0.1,1000);camera.position.set(48,40,65);
activeCamera=camera; pickingCamera=new THREE.OrthographicCamera(-75,75,75,-75,0.1,1000);
const orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=true;orbit.target.set(0,0,4);orbit.minDistance=4;orbit.maxDistance=160;
const cameraKeys = new Set();
const cameraKeyCodes = new Set(['KeyW','KeyA','KeyS','KeyD','KeyR','KeyF']);
const editable = element => element instanceof HTMLElement && (element.matches('input, textarea, select, button, summary') || element.isContentEditable);
window.addEventListener('keydown', event => {
  if ((draft && (event.code==='KeyR'||event.code==='KeyF')) || !cameraKeyCodes.has(event.code) || editable(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault(); cameraKeys.add(event.code);
});
window.addEventListener('keyup', event => cameraKeys.delete(event.code));
window.addEventListener('blur', () => cameraKeys.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden) cameraKeys.clear(); });
document.addEventListener('focusin', event => { if (editable(event.target)) cameraKeys.clear(); });
const cameraForward = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const cameraMove = new THREE.Vector3();
const worldUp = new THREE.Vector3(0,1,0);
function moveCamera(dt) {
  camera.getWorldDirection(cameraForward);
  cameraRight.setFromMatrixColumn(camera.matrix, 0).normalize();
  cameraMove.set(0,0,0);
  if (cameraKeys.has('KeyW')) cameraMove.add(cameraForward);
  if (cameraKeys.has('KeyS')) cameraMove.sub(cameraForward);
  if (cameraKeys.has('KeyD')) cameraMove.add(cameraRight);
  if (cameraKeys.has('KeyA')) cameraMove.sub(cameraRight);
  if (cameraKeys.has('KeyR')) cameraMove.add(worldUp);
  if (cameraKeys.has('KeyF')) cameraMove.sub(worldUp);
  if (cameraMove.lengthSq() > 0) {
    cameraMove.normalize().multiplyScalar(18 * dt);
    camera.position.add(cameraMove); orbit.target.add(cameraMove);
  }
}
scene.add(new THREE.HemisphereLight(0xddeaff,0x44536c,2));const light=new THREE.DirectionalLight(0xffffff,2.2);light.position.set(-20,40,30);scene.add(light);
const markerGeometry=new THREE.SphereGeometry(.24,12,8), markerMaterial=new THREE.MeshBasicMaterial({color:0x54dbff});
const targetMarker=new THREE.Mesh(new THREE.OctahedronGeometry(.7),new THREE.MeshBasicMaterial({color:0xffd46a,wireframe:true}));scene.add(targetMarker);
const slotGroup=new THREE.Group();scene.add(slotGroup);
const lineMaterial=new THREE.LineBasicMaterial({color:0xffd46a});const lineGeometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]);const route=new THREE.Line(lineGeometry,lineMaterial);scene.add(route);
const views=new Map(), rigs=new Map(), moveSafetyCache=new Map();
const projectileViews=new Map(),shotMaterial=new THREE.LineBasicMaterial({color:0xffd87a,transparent:true,opacity:.9});
for(const zone of ZONES){const size=zone.max.clone().sub(zone.min),center=zone.min.clone().add(zone.max).multiplyScalar(.5);const box=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x,size.y,size.z)),new THREE.LineBasicMaterial({color:zone.multiplier===2?0xc69b51:0x3d7388,transparent:true,opacity:.36}));box.position.copy(center);scene.add(box);}
// Approximate visual movement guard. AABB overlap is not an exact collision test.
// Muzzle and projectile safety continue to use the separate mesh checks.
function boxOverlapFraction(a,b){
  const x=Math.max(0,Math.min(a.max.x,b.max.x)-Math.max(a.min.x,b.min.x));
  const y=Math.max(0,Math.min(a.max.y,b.max.y)-Math.max(a.min.y,b.min.y));
  const z=Math.max(0,Math.min(a.max.z,b.max.z)-Math.max(a.min.z,b.min.z));
  const volume=box=>Math.max(0,box.max.x-box.min.x)*Math.max(0,box.max.y-box.min.y)*Math.max(0,box.max.z-box.min.z);
  const smaller=Math.min(volume(a),volume(b));return smaller>1e-15?x*y*z/smaller:0;
}
function approximateMoveBatch(rig,proposals){
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

// Weapon state belongs to the ship; the rig remains the adapter for visual and safety checks.
function battleCombat(state,ships,dt,index){
  const shots=[];
  // Aim at 5 Hz; shots are resolved against the current simulation snapshot.
  if(Math.round(state.time/CONFIG.dt)%12!==0)return shots;
  for(const ship of ships){const rig=rigs.get(ship.id);if(!rig)continue;rig.view.position.copy(ship.position);rig.view.quaternion.copy(ship.rotation);}
  const aimDt=dt*12,teamByFleet=new Map(state.fleets.map(f=>[f.id,f.team])),fleetCandidates=new Map(),assignments=new Map();
  // Query once per fleet and share the conservative enemy set across its ships.
  for(const fleet of state.fleets){
    const alive=fleet.ships.filter(s=>s.alive);if(!alive.length)continue;
    const bounds=new THREE.Box3().setFromPoints(alive.map(s=>s.position)).expandByScalar(45);
    fleetCandidates.set(fleet.id,index.query(bounds.min,bounds.max).filter(s=>teamByFleet.get(s.fleetId)!==fleet.team));
    assignments.set(fleet.id,new Map());
  }
  for(const ship of ships){const rig=rigs.get(ship.id);if(!rig?.safe)continue;const fleet=state.fleets.find(f=>f.id===ship.fleetId),nearest=[];
    for(const w of rig.weapons){w.yaw=w.combatState.yaw;w.pitch=w.combatState.pitch;}
    // Only a small approximate set is retained; line-of-fire checks remain conservative.
    for(const enemy of fleetCandidates.get(ship.fleetId)||[]){const distance=ship.position.distanceToSquared(enemy.position);if(distance>45*45)continue;
      const item={enemy,distance};let at=0;while(at<nearest.length&&(nearest[at].distance<distance||(nearest[at].distance===distance&&nearest[at].enemy.id.localeCompare(enemy.id)<0)))at++;
      nearest.splice(at,0,item);if(nearest.length>4)nearest.pop();
    }
    const loads=assignments.get(ship.fleetId);
    for(const w of rig.weapons){const data=w.combatState;data.cooldown=Math.max(0,data.cooldown-aimDt);let selected=null,best=Infinity;
      for(const item of nearest){const value=item.distance*(1+.3*(loads.get(item.enemy.id)||0));if(value<best){best=value;selected=item.enemy;}}
      w.target=selected;data.targetId=selected?.id||null;if(selected)loads.set(selected.id,(loads.get(selected.id)||0)+1);
    }
    const proposals=rig.weapons.filter(w=>w.pivot&&w.target&&w.muzzleNodes.length).map(w=>{
      const score=(yaw,pitch)=>{const pose=muzzlePoseFromData(w.muzzleChains[0],w,ship.position,ship.rotation,yaw,pitch),toward=w.target.position.clone().sub(pose.position);return toward.lengthSq()>1e-12?pose.direction.dot(toward.normalize()):-1;};
      let best=score(w.yaw,w.pitch),yaw=w.yaw,pitch=w.pitch;const oldYaw=yaw,oldPitch=pitch,delta=35*aimDt;
      for(const [dy,dp] of [[delta,0],[-delta,0],[0,delta],[0,-delta]]){
        const candidateYaw=THREE.MathUtils.clamp(oldYaw+dy,...w.settings.yaw);
        const candidatePitch=THREE.MathUtils.clamp(oldPitch+dp,...pitchRange({...w,yaw:candidateYaw}));
        const value=score(candidateYaw,candidatePitch);if(value>best+1e-9){best=value;yaw=candidateYaw;pitch=candidatePitch;}
      }
      return {weapon:w,yaw,pitch};
    }).filter(p=>Math.abs(p.yaw-p.weapon.yaw)>1e-9||Math.abs(p.pitch-p.weapon.pitch)>1e-9);
    try{approximateMoveBatch(rig,proposals);for(const w of rig.weapons){w.combatState.yaw=w.yaw;w.combatState.pitch=w.pitch;}rig.view.updateWorldMatrix(true,true);}catch(e){rig.safe=false;rig.reason='포탑 근사 검사 오류';console.error(e);continue;}
    for(const w of rig.weapons){if(!w.target||w.combatState.cooldown>0)continue;for(let muzzleIndex=0;muzzleIndex<w.muzzleNodes.length;muzzleIndex++){const muzzle=w.muzzleNodes[muzzleIndex],pose=muzzlePoseFromData(w.muzzleChains[muzzleIndex],w,ship.position,ship.rotation),origin=pose.position,dir=pose.direction,toward=w.target.position.clone().sub(origin),range=toward.length();if(range<1e-6||dir.dot(toward.normalize())<.995)continue;
      // Defer the expensive own-mesh safety check until the broad phase finds an enemy first hit.
      const validate=()=>{if(!rig.safe)return false;try{return !rig.safety.muzzleBlocked(muzzle,{radius:.1,range});}catch(e){rig.safe=false;rig.reason='포구 안전 검사 오류';console.error(e);return false;}};
      shots.push({ownerShipId:ship.id,muzzleId:muzzle.name,team:fleet.team,position:origin.clone(),direction:dir,range,radius:.1,damage:20,weapon:w.combatState,validate});
    }}
  }return shots;
}
const manager=new THREE.LoadingManager();const assetRoot='../../ship%20assets/rigged/';
manager.setURLModifier(url=>/\.(png|jpe?g)(\?.*)?$/i.test(url)?`${assetRoot}Texture/${url.split('/').pop().split('\\').pop()}`:url);
const setError=text=>{$('error').textContent=text};
const battleSize = new THREE.Vector3(BATTLEFIELD.max.x-BATTLEFIELD.min.x, BATTLEFIELD.max.y-BATTLEFIELD.min.y, BATTLEFIELD.max.z-BATTLEFIELD.min.z);
const battleBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...battleSize.toArray())),new THREE.LineBasicMaterial({color:0x304c65,transparent:true,opacity:0.55}));
battleBox.position.set((BATTLEFIELD.min.x+BATTLEFIELD.max.x)/2,(BATTLEFIELD.min.y+BATTLEFIELD.max.y)/2,(BATTLEFIELD.min.z+BATTLEFIELD.max.z)/2);scene.add(battleBox);
const pickGrid = new THREE.GridHelper(120,120 / COMMAND_GRID.spacing,0x527b91,0x263d50);pickGrid.visible=false;scene.add(pickGrid);
const pickMarker = new THREE.Mesh(new THREE.OctahedronGeometry(.65),new THREE.MeshBasicMaterial({color:0xffe08a,wireframe:true,depthTest:false}));pickMarker.visible=false;pickMarker.renderOrder=3;scene.add(pickMarker);
const pickGuide = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineBasicMaterial({color:0xffd46a,depthTest:false}));pickGuide.visible=false;pickGuide.renderOrder=3;scene.add(pickGuide);
const pickRay = new THREE.Raycaster(),pickNdc = new THREE.Vector2(),pickPlane = new THREE.Plane(),pickWorld = new THREE.Vector3();
function resizePickingCamera(){
  const aspect=innerWidth/innerHeight,half=75;pickingCamera.left=-half*aspect;pickingCamera.right=half*aspect;pickingCamera.top=half;pickingCamera.bottom=-half;pickingCamera.updateProjectionMatrix();
}
function setPickingView(){
  if(!draft)return;resizePickingCamera();
  if(draft.phase==='PICK_XZ'){
    const a=selected.anchor,c=draft.xzCenter||{x:a.x,z:a.z};pickingCamera.position.set(c.x,a.y+300,c.z);pickingCamera.up.set(0,0,-1);pickingCamera.lookAt(c.x,a.y,c.z);
    pickGrid.rotation.set(0,0,0);pickGrid.position.set(0,a.y,0);pickGuide.visible=false;$('pick-title').textContent='1 / 2 수평 위치 선택 (XZ)';
  }else{
    const x=COMMAND_GRID.origin.x+draft.ix*COMMAND_GRID.spacing,z=COMMAND_GRID.origin.z+draft.iz*COMMAND_GRID.spacing,y=selected.anchor.y;
    pickingCamera.position.set(x-300,y,z);pickingCamera.up.set(0,1,0);pickingCamera.lookAt(x,y,z);
    pickGrid.rotation.set(0,0,Math.PI/2);pickGrid.position.set(x,0,0);pickGuide.geometry.setFromPoints([new THREE.Vector3(x,BATTLEFIELD.min.y,z),new THREE.Vector3(x,BATTLEFIELD.max.y,z)]);pickGuide.visible=true;$('pick-title').textContent='2 / 2 높이 선택 (YZ)';
  }
  pickingCamera.updateMatrixWorld(true);$('pick-back').disabled=draft.phase==='PICK_XZ';
  $('pick-info').textContent=draft.phase==='PICK_XZ'?'오른쪽 +X · 위 -Z · X/Z를 선택하세요.':`오른쪽 +Z · 위 +Y · X ${COMMAND_GRID.origin.x + draft.ix * COMMAND_GRID.spacing}, Z ${COMMAND_GRID.origin.z + draft.iz * COMMAND_GRID.spacing} 고정`;
}
function startPicking(){
  if(state.phase!=='PREPARATION'||draft)return;
  // Match the perspective view's visible height at its orbit target. The two
  // projections differ away from that plane, so this is an approximate match.
  const viewDistance=camera.position.distanceTo(orbit.target);
  const visibleHeight=2*Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV())/2)*viewDistance;
  pickingCamera.zoom=THREE.MathUtils.clamp(150/Math.max(visibleHeight,1e-6),1.25,8);
  resizePickingCamera();
  draft={phase:'PICK_XZ',fleetId:selected.id,ix:null,iz:null,hover:null,snapshot:{position:camera.position.clone(),quaternion:camera.quaternion.clone(),zoom:camera.zoom,target:orbit.target.clone(),enabled:orbit.enabled}};
  cameraKeys.clear();if(document.activeElement instanceof HTMLElement)document.activeElement.blur();orbit.enabled=false;activeCamera=pickingCamera;pickGrid.visible=true;pickMarker.visible=false;$('pick-panel').hidden=false;
  setPickingView();syncUI();setError('');
}
function endPicking(){
  if(!draft)return;const snap=draft.snapshot;draft=null;activeCamera=camera;
  camera.position.copy(snap.position);camera.quaternion.copy(snap.quaternion);camera.zoom=snap.zoom;camera.updateProjectionMatrix();orbit.target.copy(snap.target);orbit.enabled=snap.enabled;orbit.update();
  cameraKeys.clear();if(document.activeElement instanceof HTMLElement)document.activeElement.blur();pickGrid.visible=false;pickMarker.visible=false;pickGuide.visible=false;$('pick-panel').hidden=true;syncUI();
}
function samplePick(event){
  if(!draft)return null;const rect=renderer.domElement.getBoundingClientRect();if(rect.width<=0||rect.height<=0)return null;
  pickNdc.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);pickRay.setFromCamera(pickNdc,pickingCamera);
  if(draft.phase==='PICK_XZ')pickPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0,1,0),new THREE.Vector3(0,selected.anchor.y,0));
  else pickPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(1,0,0),new THREE.Vector3(COMMAND_GRID.origin.x+draft.ix*COMMAND_GRID.spacing,0,0));
  if(!pickRay.ray.intersectPlane(pickPlane,pickWorld))return null;
  const snapped=worldToNearestGrid(pickWorld);
  const point=draft.phase==='PICK_XZ'?{ix:snapped.ix,iy:worldToNearestGrid(selected.anchor).iy,iz:snapped.iz}:{ix:draft.ix,iy:snapped.iy,iz:draft.iz};
  const world=gridToWorld(point);if(!insideBattlefield(world))return null;
  return {point,world};
}
function showPick(event){
  if(!draft)return;let sample;try{sample=samplePick(event);}catch{sample=null;}
  draft.hover=sample;pickMarker.visible=!!sample;if(!sample){$('pick-info').textContent='전장 안의 격자 교차점을 선택하세요.';return;}
  pickMarker.position.copy(sample.world);if(draft.phase==='PICK_XZ'){pickMarker.position.y=selected.anchor.y;$('pick-info').textContent=`X ${sample.world.x}, Z ${sample.world.z} · 높이 미지정`;}
  else $('pick-info').textContent=`X ${sample.world.x}, Z ${sample.world.z} 고정 · Y ${sample.world.y}`;
}
function commitPick(event){
  if(!draft)return;let sample;try{sample=samplePick(event);}catch{sample=null;}
  if(!sample){setError('전장 안의 유효한 격자 교차점을 선택하세요.');return;}
  if(draft.phase==='PICK_XZ'){draft.xzCenter={x:pickingCamera.position.x,z:pickingCamera.position.z};draft.ix=sample.point.ix;draft.iz=sample.point.iz;draft.phase='PICK_Y';draft.hover=null;pickMarker.visible=false;setPickingView();setError('');return;}
  if(state.phase!=='PREPARATION'||selected.id!==draft.fleetId){setError('선택 함대 또는 준비 단계가 변경되어 목표를 지정할 수 없습니다.');return;}
  try{setDestination(selected,sample.point);setError('');endPicking();refreshInputs();updatePreview();}catch(e){setError(e.message);}
}
$('pick-position').addEventListener('click',startPicking);
$('pick-cancel').addEventListener('click',()=>{endPicking();setError('');});
$('pick-back').addEventListener('click',()=>{if(draft?.phase==='PICK_Y'){draft.phase='PICK_XZ';draft.ix=null;draft.iz=null;draft.hover=null;pickMarker.visible=false;setPickingView();setError('');}});
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&draft){event.preventDefault();endPicking();setError('');}});
renderer.domElement.addEventListener('pointermove',showPick);
renderer.domElement.addEventListener('wheel',event=>{if(!draft)return;event.preventDefault();pickingCamera.zoom=THREE.MathUtils.clamp(pickingCamera.zoom*Math.exp(-event.deltaY*0.001),1.25,8);pickingCamera.updateProjectionMatrix();},{passive:false});

const indicatorPoints = Array.from({ length: 48 }, (_, i) => { const a = i * Math.PI * 2 / 48; return new THREE.Vector3(Math.cos(a) * 1.3, Math.sin(a) * 1.3, 0); });
const selectedIndicator = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(indicatorPoints), new THREE.LineBasicMaterial({ color: 0x74dcff, depthTest: false }));
selectedIndicator.renderOrder = 2; scene.add(selectedIndicator);
const mapCanvas = $('minimap');
const mapContext = mapCanvas.getContext('2d');
let mapPlane = 'XZ';
let mapHitTargets = [];
const planeDefinitions = {
  XY: { horizontal: 'x', vertical: 'y', sign: 1, direction: [0, 0, 1], label: '오른쪽 +X · 위 +Y · 깊이 Z' },
  YZ: { horizontal: 'z', vertical: 'y', sign: 1, direction: [-1, 0, 0], label: '오른쪽 +Z · 위 +Y · 깊이 X' },
  XZ: { horizontal: 'x', vertical: 'z', sign: -1, direction: [0, 1, 0], label: '오른쪽 +X · 위 -Z · 높이 Y' },
};
function selectFleet(fleet) {
  if (draft || !fleet || fleet.team !== 'ALLY') return;
  selected = fleet;
  chosenShip=null; setError(''); refreshFleetTabs(); refreshInputs(); refreshShips(); refreshEconomy(); updatePreview();
  $('fleet-info').textContent=`아군 ${selected.id} 함대 · 생존 ${selected.ships.filter(s=>s.alive).length}/${selected.ships.length}척 · 점수 ${state.scores.ALLY} : ${state.scores.ENEMY}`;
  drawMinimap();
}
function alignCamera(plane) {
  const target = selected ? selected.anchor : orbit.target;
  const distance = Math.max(camera.position.distanceTo(orbit.target), 12);
  const direction = new THREE.Vector3(...planeDefinitions[plane].direction);
  // OrbitControls uses +Y up; a tiny offset avoids its polar singularity.
  if (plane === 'XZ') direction.z = 0.001;
  direction.normalize(); orbit.target.copy(target); camera.position.copy(target).addScaledVector(direction, distance);
  camera.up.set(0,1,0); camera.lookAt(orbit.target); orbit.update();
}
for (const button of document.querySelectorAll('[data-camera-plane]'))
  button.addEventListener('click', () => { alignCamera(button.dataset.cameraPlane); button.blur(); });
for (const button of document.querySelectorAll('[data-map-plane]')) button.addEventListener('click', () => {
  mapPlane = button.dataset.mapPlane;
  for (const other of document.querySelectorAll('[data-map-plane]')) other.setAttribute('aria-pressed', String(other === button));
  drawMinimap();
});
function drawMinimap() {
  const width = mapCanvas.clientWidth, height = mapCanvas.clientHeight;
  if (!width || !height) return;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  if (mapCanvas.width !== Math.round(width * ratio) || mapCanvas.height !== Math.round(height * ratio)) {
    mapCanvas.width = Math.round(width * ratio); mapCanvas.height = Math.round(height * ratio);
  }
  const ctx = mapContext; ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = '#091523'; ctx.fillRect(0, 0, width, height);
  const def = planeDefinitions[mapPlane];
  const coords = pos => [pos[def.horizontal], pos[def.vertical] * def.sign];
  const samples = state.fleets.map(f => coords(f.anchor)); samples.push(coords(selected.destination),coords(BATTLEFIELD.min),coords(BATTLEFIELD.max));
  const xs = samples.map(p => p[0]), ys = samples.map(p => p[1]);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2, centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const spanX = Math.max(30, Math.max(...xs) - Math.min(...xs) + 16), spanY = Math.max(30, Math.max(...ys) - Math.min(...ys) + 16);
  const scale = Math.min((width - 30) / spanX, (height - 30) / spanY);
  const project = pos => { const [x,y] = coords(pos); return [width / 2 + (x - centerX) * scale, height / 2 - (y - centerY) * scale]; };
  ctx.strokeStyle = '#2c4054'; ctx.lineWidth = 1;
  const [ox,oy] = project(new THREE.Vector3());
  ctx.beginPath(); if (ox >= 0 && ox <= width) {ctx.moveTo(ox,0);ctx.lineTo(ox,height);} if (oy >= 0 && oy <= height) {ctx.moveTo(0,oy);ctx.lineTo(width,oy);} ctx.stroke();
  for(const zone of ZONES){const a=project(zone.min),b=project(zone.max);ctx.strokeStyle=zone.multiplier===2?'#bda064':'#41677a';ctx.strokeRect(Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]));}
  const [ax,ay] = project(selected.anchor), [tx,ty] = project(selected.destination);
  ctx.strokeStyle = '#ffd46a';ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(tx,ty);ctx.stroke();ctx.setLineDash([]);
  ctx.beginPath();ctx.moveTo(tx-5,ty-5);ctx.lineTo(tx+5,ty+5);ctx.moveTo(tx+5,ty-5);ctx.lineTo(tx-5,ty+5);ctx.stroke();
  mapHitTargets = [];
  for(const f of state.fleets){
    if(f.emptyDraft&&!f.ships.some(s=>s.alive))continue;
    const [x,y] = project(f.anchor); const ally = f.team === 'ALLY';
    ctx.fillStyle=ally?'#59c8ff':'#ff7777';ctx.strokeStyle=f===selected?'#ffffff':'#0c1a27';ctx.lineWidth=f===selected?2.5:1;
    ctx.beginPath();if(ally)ctx.arc(x,y,5,0,Math.PI*2);else {ctx.moveTo(x,y-6);ctx.lineTo(x+6,y);ctx.lineTo(x,y+6);ctx.lineTo(x-6,y);ctx.closePath();}ctx.fill();ctx.stroke();
    ctx.fillStyle='#e8f4ff';ctx.font='11px system-ui';ctx.fillText(f.id,x+8,y-5);
    if(ally)mapHitTargets.push({fleet:f,x,y});
  }
  $('map-info').textContent = `${mapPlane} · ${def.label} | 선택 ${selected.id}: (${selected.anchor.x.toFixed(1)}, ${selected.anchor.y.toFixed(1)}, ${selected.anchor.z.toFixed(1)})`;
}
mapCanvas.addEventListener('click', event => {
  const rect = mapCanvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
  let nearest = null, min = 12;
  for(const hit of mapHitTargets){const d = Math.hypot(x-hit.x,y-hit.y);if(d<min){min=d;nearest=hit;}}
  if(nearest && !draft)selectFleet(nearest.fleet);
});
const picker = new THREE.Raycaster(), pointer = new THREE.Vector2();
let pointerStart=null;
function panPicking(dx,dy){if(!draft)return;const scale=150/(Math.max(1,renderer.domElement.clientHeight)*pickingCamera.zoom);if(draft.phase==='PICK_XZ'){pickingCamera.position.x=THREE.MathUtils.clamp(pickingCamera.position.x-dx*scale,BATTLEFIELD.min.x,BATTLEFIELD.max.x);pickingCamera.position.z=THREE.MathUtils.clamp(pickingCamera.position.z-dy*scale,BATTLEFIELD.min.z,BATTLEFIELD.max.z);}else{pickingCamera.position.z=THREE.MathUtils.clamp(pickingCamera.position.z-dx*scale,BATTLEFIELD.min.z,BATTLEFIELD.max.z);pickingCamera.position.y=THREE.MathUtils.clamp(pickingCamera.position.y+dy*scale,BATTLEFIELD.min.y,BATTLEFIELD.max.y);}pickingCamera.updateMatrixWorld(true);pickMarker.visible=false;}
function movePicking(dt){if(!draft)return;const dx=(cameraKeys.has('KeyD')?1:0)-(cameraKeys.has('KeyA')?1:0),dy=(cameraKeys.has('KeyW')?1:0)-(cameraKeys.has('KeyS')?1:0);if(dx||dy){const speed=18*dt,scale=150/(Math.max(1,renderer.domElement.clientHeight)*pickingCamera.zoom);panPicking(-dx*speed/scale,dy*speed/scale);}}
renderer.domElement.addEventListener('pointerdown',event=>{if(event.button!==0)return;pointerStart={x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,dragged:false};if(draft)renderer.domElement.setPointerCapture(event.pointerId);});
renderer.domElement.addEventListener('pointermove',event=>{if(!draft||!pointerStart)return;const distance=Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y);if(distance>4)pointerStart.dragged=true;if(pointerStart.dragged){panPicking(event.clientX-pointerStart.lastX,event.clientY-pointerStart.lastY);pointerStart.lastX=event.clientX;pointerStart.lastY=event.clientY;}});
renderer.domElement.addEventListener('pointerup',event=>{
  if(!pointerStart||pointerStart.dragged||Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>4){pointerStart=null;return;}
  pointerStart=null;if(draft){commitPick(event);return;}
  const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);picker.setFromCamera(pointer,camera);
  const hit=picker.intersectObjects([...views.values()],true)[0];if(!hit)return;let object=hit.object;while(object&&!object.userData.shipId)object=object.parent;if(object){const fleet=state.fleets.find(f=>f.ships.some(ship=>ship.id===object.userData.shipId));selectFleet(fleet);}
});
renderer.domElement.addEventListener('pointercancel',()=>{pointerStart=null;});
function updatePreview(){
  const positions=slots(selected);
  while(slotGroup.children.length>positions.length)slotGroup.remove(slotGroup.children[slotGroup.children.length-1]);
  while(slotGroup.children.length<positions.length)slotGroup.add(new THREE.Mesh(markerGeometry,markerMaterial));
  positions.forEach((p,i)=>slotGroup.children[i].position.copy(p));
  targetMarker.position.copy(selected.destination);
  lineGeometry.setFromPoints([selected.anchor,selected.destination]);
}
function refreshInputs(){
  $('destination-info').textContent=`현재 목적지: (${selected.destination.x}, ${selected.destination.y}, ${selected.destination.z})`;
  const counts=dimensions(selected.ships.length);

  for(const [i,axis] of ['x','y','z'].entries()) {
    const field=$(`spacing-${axis}`);field.disabled=state.phase!=='PREPARATION'||!!draft||counts[i]<=1;
    field.title=counts[i]<=1?'이 방향은 한 층이므로 간격이 적용되지 않습니다.':'';
    for(const radio of field.querySelectorAll('input'))radio.checked=radio.value===selected.spacingLevels[axis];
  }
}
let draggedShip=null,draggedReserve=null,chosenShip=null;
function refreshFleetTabs(){
  const tabs=$('fleet-tabs');tabs.replaceChildren();
  for(const fleet of friendly){const button=document.createElement('button');button.type='button';button.textContent=fleet.id+' 함대 · '+fleet.ships.filter(s=>s.alive).length+'/'+fleet.ships.length;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(fleet===selected));button.setAttribute('aria-pressed',String(fleet===selected));button.disabled=!!draft;
    button.addEventListener('click',()=>{if(chosenShip&&fleet!==selected){transfer(chosenShip,fleet);chosenShip=null;refreshShips();}else selectFleet(fleet);});
    button.addEventListener('dragover',e=>{if((draggedReserve||(draggedShip&&fleet!==selected))&&state.phase==='PREPARATION'&&!draft){e.preventDefault();button.classList.add('drop-target');}});
    button.addEventListener('dragleave',()=>button.classList.remove('drop-target'));
    button.addEventListener('drop',e=>{e.preventDefault();button.classList.remove('drop-target');if(draggedReserve){const result=assignReserve(state,'ALLY',draggedReserve,fleet.id);setError(result.ok?'':result.reason);refreshEconomy();}else if(draggedShip&&fleet!==selected)transfer(draggedShip.id,fleet);draggedShip=null;draggedReserve=null;});tabs.append(button);
  }
  const add=document.createElement('button');add.type='button';add.className='fleet-add';add.textContent='+';add.title='새 함대 추가';add.setAttribute('aria-label','새 함대 추가');add.disabled=state.phase!=='PREPARATION'||!!draft;add.addEventListener('click',()=>{const result=createEmptyFleet(state,selected.id);if(!result.ok){setError(result.reason);return;}friendly.push(result.fleet);selectFleet(result.fleet);});tabs.append(add);
}
function swapShips(a,b){if(state.phase!=='PREPARATION'||draft||a===b)return;const from=selected.ships.findIndex(s=>s.id===a),to=selected.ships.findIndex(s=>s.id===b);if(from<0||to<0)return;[selected.ships[from],selected.ships[to]]=[selected.ships[to],selected.ships[from]];chosenShip=null;refreshShips();updatePreview();}
function refreshShips(){
  const list=$('ships');list.replaceChildren();const offsets=grid(selected.ships.length,selected.size),layers=new Map();
  offsets.forEach((p,i)=>{const key=p.y.toFixed(6);if(!layers.has(key))layers.set(key,[]);layers.get(key).push({ship:selected.ships[i],index:i});});
  const ordered=[...layers.entries()].sort((a,b)=>Number(b[0])-Number(a[0]));
  ordered.forEach(([,entries],layer)=>{const line=document.createElement('div');line.className='ship-layer';const label=document.createElement('span');label.className='layer-label';label.textContent=ordered.length===1?'중층':layer===0?'상층':layer===ordered.length-1?'하층':'중층';line.append(label);
    for(const {ship} of entries){const card=document.createElement('button');card.type='button';card.className='ship'+(ship.alive?'':' dead')+(chosenShip===ship.id?' selected':'');card.dataset.shipId=ship.id;card.draggable=state.phase==='PREPARATION'&&!draft&&ship.alive;card.title=ship.alive?'함선 '+ship.id+' · 체력 '+ship.hp+'/'+ship.maxHp:'격침된 슬롯';card.setAttribute('aria-label',card.title);card.append(document.createTextNode(ship.alive?ship.id:'빈 슬롯'));const health=document.createElement('span');health.className='ship-health';health.textContent=ship.alive?'체력 '+ship.hp:'격침';card.append(health);
      card.addEventListener('click',()=>{if(state.phase!=='PREPARATION'||draft)return;if(chosenShip&&chosenShip!==ship.id)swapShips(chosenShip,ship.id);else {chosenShip=ship.alive?(chosenShip===ship.id?null:ship.id):null;refreshShips();}});
      card.addEventListener('dragstart',e=>{draggedShip={id:ship.id,fleetId:selected.id};chosenShip=null;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',ship.id);});
      card.addEventListener('dragover',e=>{if(draggedShip&&draggedShip.id!==ship.id){e.preventDefault();card.classList.add('drop-target');}});card.addEventListener('dragleave',()=>card.classList.remove('drop-target'));
      card.addEventListener('drop',e=>{e.preventDefault();if(draggedShip&&draggedShip.fleetId===selected.id)swapShips(draggedShip.id,ship.id);draggedShip=null;});card.addEventListener('dragend',()=>{draggedShip=null;document.querySelectorAll('.drop-target').forEach(n=>n.classList.remove('drop-target'));});line.append(card);
    }list.append(line);
  });
}
function removeEmptyFleet(fleet){
  if(fleet.ships.some(s=>s.alive))return false;
  for(const unit of fleet.ships){const rig=rigs.get(unit.id),view=views.get(unit.id);if(view)scene.remove(view);rig?.safety.dispose();rigs.delete(unit.id);views.delete(unit.id);}
  for(const reserve of state.reserves)if(reserve.status==='ASSIGNED'&&reserve.fleetId===fleet.id){reserve.status='OWNED';reserve.fleetId=null;reserve.reason='함대가 삭제되어 배정이 해제되었습니다.';}
  const i=state.fleets.indexOf(fleet);if(i>=0)state.fleets.splice(i,1);const j=friendly.indexOf(fleet);if(j>=0)friendly.splice(j,1);return true;
}
function transfer(id,other){
  if(state.phase!=='PREPARATION'||draft||!other||other===selected)return;const source=selected,unit=source.ships.find(s=>s.id===id);if(!unit?.alive)return;
  const otherSize=sizeForSpacing(other.ships.length+1,other.spacingLevels);if(!validateSize(other.ships.length+1,otherSize)){setError('대상 함대의 간격을 확인하세요.');return;}
  source.ships.splice(source.ships.indexOf(unit),1);other.ships.push(unit);unit.fleetId=other.id;other.emptyDraft=false;source.size.copy(sizeForSpacing(source.ships.length,source.spacingLevels));other.size.copy(otherSize);chosenShip=null;
  if(!source.ships.some(s=>s.alive)){removeEmptyFleet(source);selected=other;}
  setError('');refreshFleetTabs();refreshInputs();refreshShips();refreshEconomy();updatePreview();
}
for(const axis of ['x','y','z'])$(`spacing-${axis}`).addEventListener('change',event=>{
  if(state.phase!=='PREPARATION'||draft){refreshInputs();return;}
  if(!event.target.matches('input[type=radio]'))return;const levels={...selected.spacingLevels,[axis]:event.target.value};
  const size=sizeForSpacing(selected.ships.length,levels);
  if(!validateSize(selected.ships.length,size)){setError('이 간격은 현재 대형에 적용할 수 없습니다.');refreshInputs();return;}
  selected.spacingLevels=levels;selected.size.copy(size);setError('');refreshInputs();updatePreview();
});
function syncUI(){
  const prep=state.phase==='PREPARATION', editing=!!draft;
  refreshFleetTabs();
  $('pick-position').disabled=!prep||editing;
  for(const button of document.querySelectorAll('[data-camera-plane]'))button.disabled=editing;
  $('start').disabled=!prep||editing;$('pause').disabled=state.phase!=='RUNNING';$('start').hidden=state.phase==='RUNNING';$('pause').hidden=state.phase!=='RUNNING';
  $('hud').textContent=state.phase==='RESULT'?`결과: ${state.result==='DRAW'?'무승부':state.result==='ALLY'?'아군 승리':'적군 승리'}`:prep?`준비 · 아군 ${state.scores.ALLY} : ${state.scores.ENEMY} 적군 / ${SCORE_CONFIG.victory}`:`전투 중 · ${state.remaining.toFixed(1)}초`;
  refreshInputs();refreshShips();refreshEconomy();
}
function refreshEconomy(){
  const prep=state.phase==='PREPARATION'&&!draft;$('buy-ship').disabled=!prep||state.scores.ALLY<ECONOMY_CONFIG.price||!prepareUnitView||!state.assetsAvailable;
  $('buy-ship').title=!state.assetsAvailable?'사용 가능한 함선 모델이 없습니다.':state.scores.ALLY<ECONOMY_CONFIG.price?'점수가 부족합니다.':'';
  $('purchase-info').textContent='가격 '+ECONOMY_CONFIG.price+' · 구매 후 '+Math.max(0,state.scores.ALLY-ECONOMY_CONFIG.price)+' 점';
  const list=$('reserves');list.replaceChildren();for(const reserve of state.reserves.filter(r=>r.team==='ALLY'&&(r.status==='OWNED'||r.status==='ASSIGNED'))){const item=document.createElement('div');item.className='reserve-item';item.draggable=prep;item.addEventListener('dragstart',e=>{draggedReserve=reserve.id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',reserve.id);});item.addEventListener('dragend',()=>{draggedReserve=null;document.querySelectorAll('.drop-target').forEach(n=>n.classList.remove('drop-target'));});const label=document.createElement('span');label.textContent=reserve.id+' · '+(reserve.status==='OWNED'?'미배정':reserve.fleetId==='NEW'?'신규 함대 대기':reserve.fleetId+' 투입 대기')+(reserve.reason?' · '+reserve.reason:'');item.append(label);
    const bind=(text,target)=>{const button=document.createElement('button');button.textContent=text;button.disabled=!prep;button.addEventListener('click',()=>{const result=assignReserve(state,'ALLY',reserve.id,target);setError(result.ok?'':result.reason);refreshEconomy();});item.append(button);};
    bind('배정: '+selected.id,selected.id);bind('신규 함대','NEW');if(reserve.status==='ASSIGNED')bind('배정 취소',null);list.append(item);
  }
}
$('buy-ship').addEventListener('click',()=>{const result=purchaseShip(state,'ALLY',ECONOMY_CONFIG.typeId,'ui-'+(++purchaseCounter));setError(result.ok?'':result.reason);refreshEconomy();syncUI();});
$('start').addEventListener('click',()=>{
  if(state.phase!=='PREPARATION'||draft||!prepareUnitView)return;
  for(const fleet of [...friendly])if(fleet.emptyDraft&&!fleet.ships.length&&!state.reserves.some(r=>r.status==='ASSIGNED'&&r.fleetId===fleet.id)){removeEmptyFleet(fleet);if(selected===fleet)selected=friendly[0];}
  prepareEnemyAI(state);const result=deployReserves(state,prepareUnitView);friendly.splice(0,friendly.length,...state.fleets.filter(f=>f.team==='ALLY'));checkRecovery(state);if(!state.result)start(state);
  const failed=state.reserves.filter(r=>r.status==='ASSIGNED'&&r.reason);setError(failed.length?'일부 증원 투입 대기: '+failed.map(r=>r.reason).join('；'):[...rigs.values()].some(r=>!r.safe)?'검증되지 않은 무장의 사격이 보류되었습니다.':'');refreshEconomy();syncUI();
});
$('pause').addEventListener('click',()=>{if(state.phase==='RUNNING'){state.phase='PREPARATION';state.preparationId++;}refreshEconomy();syncUI();});
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);resizePickingCamera();});
try{
  const assetUrl=`${assetRoot}Light_cruiser_01_rigged.fbx`;const model=await new FBXLoader(manager).loadAsync(assetUrl);
  const [report,assetBytes]=await Promise.all([fetch('../rigging-test/rig-analysis.json').then(r=>{if(!r.ok)throw Error('리깅 분석 자료 없음');return r.json();}),fetch(assetUrl).then(r=>{if(!r.ok)throw Error('FBX 해시 확인 실패');return r.arrayBuffer();})]);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',assetBytes)),x=>x.toString(16).padStart(2,'0')).join('');
  const neutralConfirmed=report.models.some(m=>m.file==='Light_cruiser_01_rigged.fbx'&&m.sha256===digest);
  const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3()),max=Math.max(size.x,size.y,size.z);
  if(!Number.isFinite(max)||max<=0)throw new Error('FBX의 크기가 올바르지 않습니다.');
  model.position.sub(center);
  const corrected=new THREE.Group();corrected.add(model);corrected.scale.setScalar(2.2/max);corrected.rotation.y=Math.PI/2;
  state.spawnRadius=size.length()/max*1.1;
  prepareUnitView=(s,options={})=>{
    s.collisionRadius=state.spawnRadius;const view=new THREE.Group();view.userData.shipId=s.id;view.add(corrected.clone(true));view.position.copy(s.position);view.quaternion.copy(s.rotation);view.updateWorldMatrix(true,true);
    const rig=discoverRig(view),weapons=initializeWeapons(view,rig);s.weapons=weapons.map((weapon,i)=>({id:s.id+':'+i,shipId:s.id,yaw:weapon.yaw,pitch:weapon.pitch,cooldown:0,targetId:null}));for(let i=0;i<weapons.length;i++){const weapon=weapons[i];weapon.combatState=s.weapons[i];weapon.muzzleChains=weapon.muzzleNodes.map(muzzle=>captureMuzzleChain(view,weapon,muzzle));}
    const safety=new GameRigSafety(view,weapons);safety.confirmedNeutral=neutralConfirmed;if(neutralConfirmed)safety.captureConfirmedNeutralContacts();const entry={view,weapons,safety,assetHash:digest,safe:neutralConfirmed&&rig.muzzleCount>0,reason:neutralConfirmed?'':'모델 해시가 일치하지 않아 사격 보류'};
    if(!entry.safe&&!options.allowUnsafe){safety.dispose();throw Error('검증된 리깅 모델이 아닙니다.');}
    return {commit(){scene.add(view);views.set(s.id,view);rigs.set(s.id,entry);},rollback(){scene.remove(view);views.delete(s.id);rigs.delete(s.id);safety.dispose();}};
  };
  for(const f of state.fleets)for(const s of f.ships)prepareUnitView(s,{allowUnsafe:true}).commit();
  state.assetsAvailable=neutralConfirmed&&[...rigs.values()].every(r=>r.safe);
  state.combat=battleCombat;if(!neutralConfirmed)setError('검증된 리깅 모델과 일치하지 않아 사격을 보류합니다.');
  refreshInputs();syncUI();updatePreview();
}catch(e){setError(`모델을 불러오지 못했습니다: ${e.message}. 상위 폴더에서 서버를 실행하고 ship assets/rigged 경로를 확인하세요.`);console.error(e);}
let last=null,acc=0,lastPhase=state.phase,lastFleetStatus='';
renderer.setAnimationLoop(ms=>{
  if(last===null)last=ms;const elapsed=Math.min((ms-last)/1000,CONFIG.maxFrame);last=ms;
  if(state.phase==='RUNNING'){
    acc+=elapsed;let steps=0;while(acc>=CONFIG.dt&&steps<CONFIG.maxSteps&&state.phase==='RUNNING'){step(state);acc-=CONFIG.dt;steps++;}
    if(steps===CONFIG.maxSteps&&acc>=CONFIG.dt)acc=0;
  }else acc=0;
  if(lastPhase!==state.phase){lastPhase=state.phase;syncUI();}
  const fleetStatus=friendly.flatMap(f=>f.ships.map(s=>s.id+':'+s.hp+':'+s.alive)).join('|');if(fleetStatus!==lastFleetStatus){lastFleetStatus=fleetStatus;refreshFleetTabs();refreshShips();}
  if(state.phase==='RUNNING')$('hud').textContent=`전투 ${state.remaining.toFixed(1)}초 · 아군 ${state.scores.ALLY} : ${state.scores.ENEMY} 적군 / ${SCORE_CONFIG.victory}`;
  for(const f of state.fleets)for(const s of f.ships){const view=views.get(s.id);if(view){view.position.copy(s.position);view.quaternion.copy(s.rotation);view.visible=s.alive;}}
  const activeShots=new Set(state.shotEffects.map(p=>p.id));for(const [id,view] of projectileViews)if(!activeShots.has(id)){scene.remove(view);view.geometry.dispose();projectileViews.delete(id);}for(const p of state.shotEffects){if(!projectileViews.has(p.id)){const geometry=new THREE.BufferGeometry().setFromPoints([p.origin,p.position]);const view=new THREE.Line(geometry,shotMaterial);scene.add(view);projectileViews.set(p.id,view);}}
  updatePreview();
  selectedIndicator.position.copy(selected.anchor);
  selectedIndicator.quaternion.copy(activeCamera.quaternion);
  $('fleet-info').textContent=`아군 ${selected.id} 함대 · 생존 ${selected.ships.filter(s=>s.alive).length}/${selected.ships.length}척 · 점수 ${state.scores.ALLY} : ${state.scores.ENEMY}`;
  if(draft)movePicking(elapsed);else{orbit.update();moveCamera(elapsed);}$('zoom-debug').textContent=draft?'입력 줌 '+pickingCamera.zoom.toFixed(2)+'×':'카메라 거리 '+camera.position.distanceTo(orbit.target).toFixed(1);renderer.render(scene,activeCamera);drawMinimap();
});
