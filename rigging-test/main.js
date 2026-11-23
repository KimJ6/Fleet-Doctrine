import { discoverRig, settingsFor, initializeWeapons, applyPose, pitchRange } from './rig-control.js';
import { RigSafety } from './rig-safety.js?v=neutral-joint-20261123';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const assetRoot = '../../ship%20assets/rigged/';
const $ = (id) => document.getElementById(id);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080d19);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 1000);
camera.position.set(11, 8, 14);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xddeaff, 0x444d69, 2));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
keyLight.position.set(-4, 7, 6);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x8cb8ff, 1.2);
fillLight.position.set(4, 2, -6);
scene.add(fillLight);
const manager = new THREE.LoadingManager();
let localTextures = new Map();
manager.setURLModifier((url) => {
  if (!/\.(png|jpe?g)(\?.*)?$/i.test(url)) return url;
  const name = decodeURIComponent(url.split('?')[0].split('/').pop().split('\\').pop()).toLowerCase();
  return localTextures.get(name) || `${assetRoot}Texture/${encodeURIComponent(name)}`;
});

const engineGeometry = new THREE.SphereGeometry(0.09, 12, 8);
const muzzleGeometry = new THREE.SphereGeometry(0.08, 12, 8);
const shotGeometry = new THREE.SphereGeometry(0.075, 12, 8);
const engineMaterial = new THREE.MeshBasicMaterial({ color: 0x59cfff });
const muzzleMaterial = new THREE.MeshBasicMaterial({ color: 0xffb244 });
const shotMaterial = new THREE.MeshBasicMaterial({ color: 0xffe283 });
const flameMaterial = new THREE.MeshBasicMaterial({ color: 0x53aaff, transparent: true, opacity: 0.75 });
const flameGeometry = new THREE.ConeGeometry(0.12, 0.8, 12);
const shots = [];
const anchors = [];
const turrets = [];
const v = new THREE.Vector3();
const q = new THREE.Quaternion();
const axisY = new THREE.Vector3(0, 1, 0);
let ship;
let displayRoot;
let safety;
const jointMarker = new THREE.Mesh(new THREE.SphereGeometry(1,16,12),new THREE.MeshBasicMaterial({color:0xff44aa,wireframe:true,transparent:true,opacity:.6}));
jointMarker.visible=false;scene.add(jointMarker);
let previousTime = performance.now();

function addAnchor(node, type, directionNode) {
  const marker = new THREE.Mesh(type === 'engine' ? engineGeometry : muzzleGeometry,
    type === 'engine' ? engineMaterial : muzzleMaterial);
  scene.add(marker);
  const anchor = { node, type, directionNode, marker, flashUntil: 0 };
  if (type === 'engine') {
    anchor.flame = new THREE.Mesh(flameGeometry, flameMaterial);
    const radiusMatch = node.name.match(/_Radius_(\d+(?:p\d+)?)/);
    if (radiusMatch) {
      const radius = Number(radiusMatch[1].replace('p', '.'));
      const nodeScale = node.getWorldScale(new THREE.Vector3());
      const displayRadius = radius * Math.abs(nodeScale.x);
      anchor.flame.scale.set(displayRadius / 0.12, 1, displayRadius / 0.12);
    }
    scene.add(anchor.flame);
  }
  anchors.push(anchor);
  return anchor;
}
function directionFor(anchor, output) {
  anchor.directionNode.getWorldQuaternion(q);
  return output.set(0, 0, 1).applyQuaternion(q).normalize();
}
function selectedTurret() { return turrets[Number($('turret').value)]; }
const effectivePitchRange = pitchRange;
function updateControls() {
  const t = selectedTurret();
  const present = !!t;
  const movable = present && !!t.pivot;
  const hasBarrels = movable && t.barrels.length > 0;
  $('yaw').disabled = !movable; $('pitch').disabled = !hasBarrels;
  $('fire').disabled = !present || !t.muzzles.length;
  $('apply-settings').disabled = !movable;
  if (!present) return;
  const cfg = t.settings;
  [$('yaw').min, $('yaw').max] = cfg.yaw; [$('pitch').min, $('pitch').max] = effectivePitchRange(t);
  $('yaw').value = t.yaw; $('pitch').value = t.pitch;
  $('yaw-value').textContent = `${t.yaw}°`; $('pitch-value').textContent = `${t.pitch}°`;
  $('yaw-label').textContent = (t.key.startsWith('Side_') || /^[LR]_Side_D04(?:\.\d+)?$/.test(t.key) || /^D05_side_[np](?:\.\d+)?$/.test(t.key) || /^LC02_aft_[np](?:\.\d+)?$/.test(t.key)) ? '포탑 상하 회전' : '포탑 회전';
  $('pitch-label').textContent = (t.key.startsWith('Side_') || /^[LR]_Side_D04(?:\.\d+)?$/.test(t.key) || /^D05_side_[np](?:\.\d+)?$/.test(t.key) || /^LC02_aft_[np](?:\.\d+)?$/.test(t.key)) ? '포신 좌우 회전' : '포신 회전';
  $('yaw-axis').value = cfg.yawAxis; $('pitch-axis').value = cfg.pitchAxis;
  $('yaw-min').value = cfg.yaw[0]; $('yaw-max').value = cfg.yaw[1];
  $('pitch-min').value = cfg.pitch[0]; $('pitch-max').value = cfg.pitch[1];
  $('pitch-sign').value = String(cfg.pitchSign);
}
const applyAngles = applyPose;
function fire(t) {
  if (!t) return;
  ship.updateWorldMatrix(true, true);
  for (const anchor of t.muzzles) {
    const blocked = safety.muzzleBlocked(anchor.node, { radius: .075, range: 36 });
    if (blocked) { $('status').textContent = `발사 차단 · ${anchor.node.name} · ${blocked.part}`; continue; }
    const shot = new THREE.Mesh(shotGeometry, shotMaterial);
    anchor.node.getWorldPosition(shot.position);
    shot.position.addScaledVector(directionFor(anchor, new THREE.Vector3()), .075);
    const velocity = directionFor(anchor, new THREE.Vector3()).multiplyScalar(12);
    scene.add(shot);
    shots.push({ mesh: shot, velocity, age: 0 });
    anchor.flashUntil = performance.now() + 180;
  }
}

async function loadShip(url, label) {
 try {
  const response = await fetch(url, {cache:'no-store'});
  if (!response.ok) throw Error(`FBX HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  const loaded = new FBXLoader(manager).parse(buffer, '');
  safety?.dispose();
  if (displayRoot) scene.remove(displayRoot);
  for (const a of anchors) { scene.remove(a.marker); if (a.flame) scene.remove(a.flame); }
  for (const shot of shots) scene.remove(shot.mesh);
  anchors.length = 0; turrets.length = 0; shots.length = 0;
  $('turret').replaceChildren();
  ship = loaded;
  const bounds = new THREE.Box3().setFromObject(ship);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(largest) || largest <= 0) throw new Error('함선 크기를 확인할 수 없습니다.');
  displayRoot = new THREE.Group();
  displayRoot.scale.setScalar(10 / largest);
  ship.position.sub(center);
  displayRoot.add(ship);
  scene.add(displayRoot);
  ship.updateWorldMatrix(true, true);
  const rig = discoverRig(ship);
  for (const node of rig.engines) addAnchor(node, 'engine', node);
  for (const weapon of initializeWeapons(ship, rig)) {
    const muzzles = weapon.muzzleNodes.map(node => addAnchor(node, 'muzzle', node));
    turrets.push({ ...weapon, muzzles });
  }
  $('draft-joints').checked = false;
  safety = new RigSafety(ship, turrets, {allowInferredJoints:false});
  $('joint-select').replaceChildren();
  safety.joints.forEach((j,i)=>$('joint-select').add(new Option(`${j.pivot.name} ↔ ${j.parentOwner?.name||'선체'} · 미승인`,i)));
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');
  try {
    const report = await (await fetch('./rig-analysis.json',{cache:'no-store'})).json();
    const entry = report.models.find(x=>x.sha256===digest);
    safety.confirmedNeutral = !!entry && ['Destroyer_01_rigged.fbx','Light_cruiser_01_rigged.fbx'].includes(entry.file);
    if(safety.confirmedNeutral)safety.captureConfirmedNeutralContacts();
    let codeMatches=true;
    for(const file of ['rig-control.js','rig-safety.js']){
      const source=await (await fetch(`./${file}`,{cache:'no-store'})).arrayBuffer();
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',source))].map(x=>x.toString(16).padStart(2,'0')).join('');
      if(hash!==report.moduleHashes[file])codeMatches=false;
    }
    // User-confirmed reference ships use their neutral baseline. The other
    // analyzed ships start in the explicitly provisional joint mode.
    $('draft-joints').checked = !!(entry && codeMatches && !safety.confirmedNeutral);
    safety.allowInferredJoints = $('draft-joints').checked;
    if(entry && codeMatches && !safety.confirmedNeutral)safety.precomputed=entry;
    const open = safety.parts.filter(p=>p.topology.boundaryEdges||p.topology.nonManifoldEdges).length;
    $('analysis-status').textContent = (entry && codeMatches ? `분석 일치 · ${entry.file} · 접합 후보 ${entry.joints.length}개` : '분석 불일치 · FBX/코드 재분석 필요') + (safety.allowInferredJoints?' · 추정 접합 초안 적용':'') + ` · 열린 메시 ${open}개, 내부 판정 미보증`;
  } catch { $('analysis-status').textContent = '사전 분석 자료 없음 · 런타임 검사만 사용'; }
  turrets.forEach((t, i) => $('turret').add(new Option(`${t.label} (${t.muzzles.length}개 포구)`, i)));
  $('turret').disabled = !turrets.length; $('reset').disabled = !turrets.length;
  updateControls();
  $('status').textContent = `준비 완료 · ${label} · 무장 ${turrets.length}개 · 포구 ${rig.muzzleCount}개 · 엔진 ${rig.engines.length}개${turrets.length ? '' : ' · 이름 규약에 맞는 무장이 없습니다'}`;
} catch (error) {
  $('status').textContent = `불러오기 실패: ${error.message}`;
  console.error(error);
 }
}
  $('turret').addEventListener('change', updateControls);
  for (const id of ['yaw', 'pitch']) $(id).addEventListener('input', () => {
    const t = selectedTurret(); if (!t) return;
    const value = Number($(id).value);
    const side = id === 'yaw' && t.key.match(/^D01_Broadside_([LR])_/);
    const targets = side ? turrets.filter(other => other.key.startsWith(`D01_Broadside_${side[1]}_`)) : [t];
    const result = safety.moveBatch(targets.map(weapon=>({weapon,yaw:id==='yaw'?value:weapon.yaw,pitch:id==='pitch'?value:weapon.pitch})));
    $('status').textContent = result.allowed ? '이동 검사 통과 · 각도 표본 검사' : `이동 차단 · ${result.reason.a||''} / ${result.reason.b||result.reason.type}`;
    updateControls();
  });
  $('fire').addEventListener('click', () => { const t = selectedTurret(); if (t) fire(t); });
  $('reset').addEventListener('click', () => {
    const result = safety.moveBatch(turrets.filter(t=>t.pivot).map(weapon=>({weapon,yaw:0,pitch:0})));
    $('status').textContent = result.allowed ? '안전 경로로 초기화됨' : '초기화 경로 차단';
    updateControls();
  });
$('apply-settings').addEventListener('click', () => {
  const t = selectedTurret(); if (!t?.pivot) return;
  const values = ['yaw-min','yaw-max','pitch-min','pitch-max'].map(id => Number($(id).value));
  if (values.some(n => !Number.isFinite(n)) || values[0] > values[1] || values[2] > values[3]) {
    $('status').textContent = '회전 범위의 최소값과 최대값을 확인하세요.'; return;
  }
  // 다른 축에 남은 이전 회전은 지우고 새 축에 적용한다.
  const previous = {...t.settings,yaw:[...t.settings.yaw],pitch:[...t.settings.pitch]};
  t.settings = { yaw: values.slice(0,2), pitch: values.slice(2,4), yawAxis: $('yaw-axis').value,
    pitchAxis: $('pitch-axis').value, pitchSign: Number($('pitch-sign').value) };
  const result=safety.moveBatch([{weapon:t,yaw:t.yaw,pitch:t.pitch}]);
  if(!result.allowed){t.settings=previous;applyAngles(t);}
  updateControls();
  $('status').textContent=result.allowed?`${t.label} 회전 설정 적용됨`:'설정 변경 차단 · 현재 자세 간섭';
});
$('model-file').addEventListener('change', async (event) => {
  const files = [...event.target.files];
  const models = files.filter(f => /\.fbx$/i.test(f.name));
  if (models.length !== 1) { $('status').textContent = 'FBX 파일 하나와 필요한 텍스처를 선택하세요.'; return; }
  const nextTextures = new Map();
  for (const file of files.filter(f => /\.(png|jpe?g)$/i.test(f.name))) {
    const key = file.name.toLowerCase();
    if (nextTextures.has(key)) {
      for (const url of nextTextures.values()) URL.revokeObjectURL(url);
      $('status').textContent = `같은 이름의 텍스처가 중복되었습니다: ${file.name}`; return;
    }
    nextTextures.set(key, URL.createObjectURL(file));
  }
  for (const url of localTextures.values()) URL.revokeObjectURL(url);
  localTextures = nextTextures;
  const url = URL.createObjectURL(models[0]);
  try { await loadShip(url, models[0].name); } finally { URL.revokeObjectURL(url); }
});
$('draft-joints').addEventListener('change',()=>{safety.allowInferredJoints=$('draft-joints').checked;$('status').textContent=safety.allowInferredJoints?'추정 접합부 허용 · 검수용':'접합부 미승인 차단 모드';});
$('approve-joint').addEventListener('click',()=>{
  const i=Number($('joint-select').value),j=safety?.joints[i];if(!j)return;
  j.status='verified';safety.precomputed=null;
  $('joint-select').options[i].textContent=`${j.pivot.name} ↔ ${j.parentOwner?.name||'선체'} · 이번 로드 승인`;
  $('status').textContent='선택 부품 쌍과 접합 영역 승인 · 모델 재로드 시 초기화';
});
$('asset-select').addEventListener('change',async()=>loadShip(`${assetRoot}${$('asset-select').value}`,$('asset-select').value));
for(const family of ['Destroyer','Light_cruiser'])for(let i=1;i<=5;i++){
  const file=`${family}_${String(i).padStart(2,'0')}_rigged.fbx`;$('asset-select').add(new Option(file,file));
}
$('asset-select').value='Light_cruiser_01_rigged.fbx';
await loadShip(`${assetRoot}Light_cruiser_01_rigged.fbx`, 'Light_cruiser_01_rigged.fbx');

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop((time) => {
  const dt = Math.min((time - previousTime) / 1000, 0.1); previousTime = time;
  if (ship) {
    ship.updateWorldMatrix(true, true);
    const joint=safety?.joints[Number($('joint-select').value)];
    jointMarker.visible=!!joint && $('joint-visible').checked;
    if(joint){joint.pivot.getWorldPosition(jointMarker.position);jointMarker.scale.setScalar(joint.radius);}
    for (const anchor of anchors) {
      anchor.node.getWorldPosition(anchor.marker.position);
      anchor.marker.visible = $('markers').checked || time < anchor.flashUntil;
      anchor.marker.scale.setScalar(time < anchor.flashUntil ? 2.5 : 1);
      if (anchor.flame) {
        anchor.flame.visible = $('engines').checked;
        directionFor(anchor, v);
        anchor.flame.position.copy(anchor.marker.position).addScaledVector(v, 0.4);
        anchor.flame.quaternion.setFromUnitVectors(axisY, v);
      }
    }
  }
  for (let i = shots.length - 1; i >= 0; i--) {
    const shot = shots[i]; shot.age += dt;
    const next=shot.mesh.position.clone().addScaledVector(shot.velocity,dt);
    if(safety?.segmentBlocked(shot.mesh.position,next,.075)){scene.remove(shot.mesh);shots.splice(i,1);continue;}
    shot.mesh.position.copy(next);
    if (shot.age > 3) { scene.remove(shot.mesh); shots.splice(i, 1); }
  }
  controls.update(); renderer.render(scene, camera);
});
