import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG, COMMAND_GRID, BATTLEFIELD, gridToWorld, worldToNearestGrid, insideBattlefield, setDestination, initialState, slots, dimensions, validateSize, step, start } from './simulation.js';

const $ = id => document.getElementById(id);
const state = initialState();
const friendly = state.fleets.filter(f => f.team === 'ALLY');
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
const orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=true;orbit.target.set(0,0,4);
const cameraKeys = new Set();
const cameraKeyCodes = new Set(['KeyW','KeyA','KeyS','KeyD','KeyR','KeyF']);
const editable = element => element instanceof HTMLElement && (element.matches('input, textarea, select, button, summary') || element.isContentEditable);
window.addEventListener('keydown', event => {
  if (draft || !cameraKeyCodes.has(event.code) || editable(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
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
const views=new Map();
const manager=new THREE.LoadingManager();const assetRoot='../../ship%20assets/rigged/';
manager.setURLModifier(url=>/\.(png|jpe?g)(\?.*)?$/i.test(url)?`${assetRoot}Texture/${url.split('/').pop().split('\\').pop()}`:url);
const setError=text=>{$('error').textContent=text};
const battleSize = new THREE.Vector3(BATTLEFIELD.max.x-BATTLEFIELD.min.x, BATTLEFIELD.max.y-BATTLEFIELD.min.y, BATTLEFIELD.max.z-BATTLEFIELD.min.z);
const battleBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...battleSize.toArray())),new THREE.LineBasicMaterial({color:0x304c65,transparent:true,opacity:0.55}));
battleBox.position.set((BATTLEFIELD.min.x+BATTLEFIELD.max.x)/2,(BATTLEFIELD.min.y+BATTLEFIELD.max.y)/2,(BATTLEFIELD.min.z+BATTLEFIELD.max.z)/2);scene.add(battleBox);
const pickGrid = new THREE.GridHelper(120,120,0x527b91,0x263d50);pickGrid.visible=false;scene.add(pickGrid);
const pickMarker = new THREE.Mesh(new THREE.OctahedronGeometry(.65),new THREE.MeshBasicMaterial({color:0xffe08a,wireframe:true,depthTest:false}));pickMarker.visible=false;pickMarker.renderOrder=3;scene.add(pickMarker);
const pickGuide = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineBasicMaterial({color:0xffd46a,depthTest:false}));pickGuide.visible=false;pickGuide.renderOrder=3;scene.add(pickGuide);
const pickRay = new THREE.Raycaster(),pickNdc = new THREE.Vector2(),pickPlane = new THREE.Plane(),pickWorld = new THREE.Vector3();
function resizePickingCamera(){
  const aspect=innerWidth/innerHeight,half=75;pickingCamera.left=-half*aspect;pickingCamera.right=half*aspect;pickingCamera.top=half;pickingCamera.bottom=-half;pickingCamera.updateProjectionMatrix();
}
function setPickingView(){
  if(!draft)return;resizePickingCamera();
  if(draft.phase==='PICK_XZ'){
    const a=selected.anchor;pickingCamera.position.set(a.x,a.y+300,a.z);pickingCamera.up.set(0,0,-1);pickingCamera.lookAt(a.x,a.y,a.z);
    pickGrid.rotation.set(0,0,0);pickGrid.position.set(0,a.y,0);pickGuide.visible=false;$('pick-title').textContent='1 / 2 수평 위치 선택 (XZ)';
  }else{
    const x=COMMAND_GRID.origin.x+draft.ix*COMMAND_GRID.spacing,z=COMMAND_GRID.origin.z+draft.iz*COMMAND_GRID.spacing,y=selected.anchor.y;
    pickingCamera.position.set(x-300,y,z);pickingCamera.up.set(0,1,0);pickingCamera.lookAt(x,y,z);
    pickGrid.rotation.set(0,0,Math.PI/2);pickGrid.position.set(x,0,0);pickGuide.geometry.setFromPoints([new THREE.Vector3(x,BATTLEFIELD.min.y,z),new THREE.Vector3(x,BATTLEFIELD.max.y,z)]);pickGuide.visible=true;$('pick-title').textContent='2 / 2 높이 선택 (YZ)';
  }
  pickingCamera.updateMatrixWorld(true);$('pick-back').disabled=draft.phase==='PICK_XZ';
  $('pick-info').textContent=draft.phase==='PICK_XZ'?'오른쪽 +X · 위 -Z · X/Z를 선택하세요.':`오른쪽 +Z · 위 +Y · X ${draft.ix}, Z ${draft.iz} 고정`;
}
function startPicking(){
  if(state.phase!=='PREPARATION'||draft)return;
  pickingCamera.zoom=1;resizePickingCamera();
  draft={phase:'PICK_XZ',fleetId:selected.id,ix:null,iz:null,hover:null,snapshot:{position:camera.position.clone(),quaternion:camera.quaternion.clone(),zoom:camera.zoom,target:orbit.target.clone(),enabled:orbit.enabled}};
  cameraKeys.clear();orbit.enabled=false;activeCamera=pickingCamera;pickGrid.visible=true;pickMarker.visible=false;$('pick-panel').hidden=false;
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
  pickMarker.position.copy(sample.world);if(draft.phase==='PICK_XZ'){pickMarker.position.y=selected.anchor.y;$('pick-info').textContent=`X ${sample.point.ix}, Z ${sample.point.iz} · 높이 미지정`;}
  else $('pick-info').textContent=`X ${draft.ix}, Z ${draft.iz} 고정 · Y ${sample.point.iy}`;
}
function commitPick(event){
  if(!draft)return;let sample;try{sample=samplePick(event);}catch{sample=null;}
  if(!sample){setError('전장 안의 유효한 격자 교차점을 선택하세요.');return;}
  if(draft.phase==='PICK_XZ'){draft.ix=sample.point.ix;draft.iz=sample.point.iz;draft.phase='PICK_Y';draft.hover=null;pickMarker.visible=false;setPickingView();setError('');return;}
  if(state.phase!=='PREPARATION'||selected.id!==draft.fleetId){setError('선택 함대 또는 준비 단계가 변경되어 목표를 지정할 수 없습니다.');return;}
  try{setDestination(selected,sample.point);setError('');endPicking();refreshInputs();updatePreview();}catch(e){setError(e.message);}
}
$('pick-position').addEventListener('click',startPicking);
$('pick-cancel').addEventListener('click',()=>{endPicking();setError('');});
$('pick-back').addEventListener('click',()=>{if(draft?.phase==='PICK_Y'){draft.phase='PICK_XZ';draft.ix=null;draft.iz=null;draft.hover=null;pickMarker.visible=false;setPickingView();setError('');}});
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&draft){event.preventDefault();endPicking();setError('');}});
renderer.domElement.addEventListener('pointermove',showPick);
renderer.domElement.addEventListener('wheel',event=>{if(!draft)return;event.preventDefault();pickingCamera.zoom=THREE.MathUtils.clamp(pickingCamera.zoom*Math.exp(-event.deltaY*0.001),0.7,8);pickingCamera.updateProjectionMatrix();},{passive:false});

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
  if (draft || !fleet || fleet.team !== 'ALLY') { if(draft) $('fleet').value=selected.id; return; }
  selected = fleet;
  $('fleet').value = fleet.id;
  setError(''); refreshInputs(); refreshShips(); updatePreview();
  $('fleet-info').textContent=`아군 ${selected.id} 함대 · ${selected.ships.length}척 · 체력/교전 미구현`;
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
  const samples = state.fleets.map(f => coords(f.anchor)); samples.push(coords(selected.destination));
  const xs = samples.map(p => p[0]), ys = samples.map(p => p[1]);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2, centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const spanX = Math.max(30, Math.max(...xs) - Math.min(...xs) + 16), spanY = Math.max(30, Math.max(...ys) - Math.min(...ys) + 16);
  const scale = Math.min((width - 30) / spanX, (height - 30) / spanY);
  const project = pos => { const [x,y] = coords(pos); return [width / 2 + (x - centerX) * scale, height / 2 - (y - centerY) * scale]; };
  ctx.strokeStyle = '#2c4054'; ctx.lineWidth = 1;
  const [ox,oy] = project(new THREE.Vector3());
  ctx.beginPath(); if (ox >= 0 && ox <= width) {ctx.moveTo(ox,0);ctx.lineTo(ox,height);} if (oy >= 0 && oy <= height) {ctx.moveTo(0,oy);ctx.lineTo(width,oy);} ctx.stroke();
  const [ax,ay] = project(selected.anchor), [tx,ty] = project(selected.destination);
  ctx.strokeStyle = '#ffd46a';ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(tx,ty);ctx.stroke();ctx.setLineDash([]);
  ctx.beginPath();ctx.moveTo(tx-5,ty-5);ctx.lineTo(tx+5,ty+5);ctx.moveTo(tx+5,ty-5);ctx.lineTo(tx-5,ty+5);ctx.stroke();
  mapHitTargets = [];
  for(const f of state.fleets){
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
let pointerStart = null;
renderer.domElement.addEventListener('pointerdown', event => { if(event.button===0)pointerStart={x:event.clientX,y:event.clientY}; });
renderer.domElement.addEventListener('pointerup', event => {
  if(!pointerStart || Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>4){pointerStart=null;return;}
  pointerStart=null;
  if(draft){commitPick(event);return;}
  const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
  picker.setFromCamera(pointer,camera);
  const hit=picker.intersectObjects([...views.values()],true)[0];
  if(!hit)return;let object=hit.object;while(object && !object.userData.shipId)object=object.parent;
  if(object){const fleet=state.fleets.find(f=>f.ships.some(ship=>ship.id===object.userData.shipId));selectFleet(fleet);}
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
function number(id){const el=$(id);return el.value.trim()===''?NaN:Number(el.value);}
function refreshInputs(){
  for(const axis of ['x','y','z']){$(`dest-${axis}`).value=selected.destination[axis];$(`size-${axis}`).value=selected.size[axis];}
  const counts=dimensions(selected.ships.length);$('formation-info').textContent=`이동 격자 (${counts.join(' × ')}) · 한 층인 축: ${['X','Y','Z'].filter((_,i)=>counts[i]===1).join(', ') || '없음'}`;
}
function refreshShips(){
  const list=$('ships');list.replaceChildren();
  selected.ships.forEach((s,i)=>{
    const row=document.createElement('div');row.className='ship';const name=document.createElement('span');name.textContent=`${i+1}. 함선 ${s.id}`;row.append(name);
    for(const [label,action,disabled] of [['↑',()=>reorder(i,-1),i===0],['↓',()=>reorder(i,1),i===selected.ships.length-1],['다른 함대로',()=>transfer(s),selected.ships.length<=1]]){
      const b=document.createElement('button');b.textContent=label;b.disabled=disabled||state.phase!=='PREPARATION'||!!draft;b.addEventListener('click',action);row.append(b);
    }list.append(row);
  });
}
function reorder(i,d){if(state.phase!=='PREPARATION')return;const a=selected.ships;[a[i],a[i+d]]=[a[i+d],a[i]];refreshShips();updatePreview();}
function transfer(s){
  if(state.phase!=='PREPARATION'||selected.ships.length<=1)return;
  const other=friendly.find(f=>f!==selected);
  if(!validateSize(other.ships.length+1,other.size)){setError('대상 함대의 격자 크기를 늘려 최소 간격을 확보하세요.');return;}
  selected.ships.splice(selected.ships.indexOf(s),1);other.ships.push(s);s.fleetId=other.id;setError('');refreshInputs();refreshShips();updatePreview();
}
function syncUI(){
  const prep=state.phase==='PREPARATION', editing=!!draft;
  for(const id of ['apply','dest-x','dest-y','dest-z','size-x','size-y','size-z'])$(id).disabled=!prep||editing;
  $('fleet').disabled=editing;
  $('pick-position').disabled=!prep||editing;
  for(const button of document.querySelectorAll('[data-camera-plane]'))button.disabled=editing;
  $('start').disabled=!prep||editing;$('pause').disabled=prep;
  $('hud').textContent=prep?'준비 단계':`이동 중 · ${state.remaining.toFixed(1)}초`;
  $('status').textContent=prep?'준비 단계 — 명령을 설정하세요':`자동 이동 중 · ${state.remaining.toFixed(1)}초`;
  refreshShips();
}
$('fleet').addEventListener('change',()=>selectFleet(friendly.find(f=>f.id===$('fleet').value)));
$('apply').addEventListener('click',()=>{
  if(state.phase!=='PREPARATION')return;
  const size=new THREE.Vector3(number('size-x'),number('size-y'),number('size-z'));
  if(!size.toArray().every(Number.isFinite)){setError('모든 대형 크기에 유효한 숫자를 입력하세요.');return;}
  if(!validateSize(selected.ships.length,size)){setError('격자 크기가 너무 작습니다. 슬롯 사이 간격은 최소 4여야 합니다.');return;}
  selected.size.copy(size);setError('');refreshInputs();updatePreview();
});
$('start').addEventListener('click',()=>{start(state);setError('');syncUI();});
$('pause').addEventListener('click',()=>{if(state.phase==='RUNNING')state.phase='PREPARATION';syncUI();});
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);resizePickingCamera();});
try{
  const model=await new FBXLoader(manager).loadAsync(`${assetRoot}Light_cruiser_01_rigged.fbx`);
  const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3()),max=Math.max(size.x,size.y,size.z);
  if(!Number.isFinite(max)||max<=0)throw new Error('FBX의 크기가 올바르지 않습니다.');
  model.position.sub(center);
  const corrected=new THREE.Group();corrected.add(model);corrected.scale.setScalar(2.2/max);corrected.rotation.y=Math.PI/2;
  for(const f of state.fleets)for(const s of f.ships){
    const view=new THREE.Group();view.userData.shipId=s.id;view.add(corrected.clone(true));scene.add(view);views.set(s.id,view);
  }
  for(const f of friendly)$('fleet').add(new Option(`아군 ${f.id} 함대`,f.id));
  $('fleet').value=selected.id;refreshInputs();syncUI();updatePreview();
}catch(e){setError(`모델을 불러오지 못했습니다: ${e.message}. 상위 폴더에서 서버를 실행하고 ship assets/rigged 경로를 확인하세요.`);console.error(e);}
let last=null,acc=0,lastPhase=state.phase;
renderer.setAnimationLoop(ms=>{
  if(last===null)last=ms;const elapsed=Math.min((ms-last)/1000,CONFIG.maxFrame);last=ms;
  if(state.phase==='RUNNING'){
    acc+=elapsed;let steps=0;while(acc>=CONFIG.dt&&steps<CONFIG.maxSteps&&state.phase==='RUNNING'){step(state);acc-=CONFIG.dt;steps++;}
    if(steps===CONFIG.maxSteps&&acc>=CONFIG.dt)acc=0;
  }else acc=0;
  if(lastPhase!==state.phase){lastPhase=state.phase;syncUI();}
  if(state.phase==='RUNNING')$('hud').textContent=`이동 중 · ${state.remaining.toFixed(1)}초`;
  for(const f of state.fleets)for(const s of f.ships){const view=views.get(s.id);if(view){view.position.copy(s.position);view.quaternion.copy(s.rotation);}}
  updatePreview();
  selectedIndicator.position.copy(selected.anchor);
  selectedIndicator.quaternion.copy(activeCamera.quaternion);
  $('fleet-info').textContent=`아군 ${selected.id} 함대 · ${selected.ships.length}척 · 체력/교전 미구현`;
  if(!draft){orbit.update();moveCamera(elapsed);}renderer.render(scene,activeCamera);drawMinimap();
});
