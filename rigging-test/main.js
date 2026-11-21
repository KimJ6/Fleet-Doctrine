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
// 모델 이름 규약: PIVOT_Turret_*, PIVOT_Barrel_*, FX_Muzzle_*, FX_Engine_*.
// 기존 모델 기본값. 다른 무장은 일반값으로 시작하며 화면에서 조정할 수 있다.
const presetLimits = {
  Center: { yaw: [-140, 140], pitch: [0, 45], pitchSign: 1 },
  Side_L: { yaw: [-180, 180], pitch: [0, 45], pitchSign: -1 },
  Side_R: { yaw: [-180, 180], pitch: [0, 45], pitchSign: 1 },
  Aft_L: { yaw: [-180, 180], pitch: [0, 45], pitchSign: 1 },
  Aft_R: { yaw: [-180, 180], pitch: [0, 45], pitchSign: 1 },
};
const labels = { Center: '중앙', Side_L: '좌현', Side_R: '우현', Aft_L: '후방 좌현', Aft_R: '후방 우현' };
const hasAncestor = (node, ancestor) => {
  for (let p = node.parent; p; p = p.parent) if (p === ancestor) return true;
  return false;
};
export function discoverRig(root) {
  const all = []; root.traverse(node => all.push(node));
  const turrets = all.filter(n => n.name.startsWith('PIVOT_Turret_'));
  const barrels = all.filter(n => n.name.startsWith('PIVOT_Barrel_'));
  const muzzles = all.filter(n => n.name.startsWith('FX_Muzzle_'));
  const engines = all.filter(n => n.name.startsWith('FX_Engine_'));
  const weapons = turrets.map(pivot => {
    const key = pivot.name.slice('PIVOT_Turret_'.length);
    // 가장 가까운 포탑만 소유한다. 중첩된 피벗을 이중 집계하지 않는다.
    const owned = n => hasAncestor(n, pivot) && !turrets.some(other => other !== pivot && hasAncestor(other, pivot) && hasAncestor(n, other));
    return { key, label: labels[key] || key, pivot, barrels: barrels.filter(owned), muzzleNodes: muzzles.filter(owned) };
  });
  for (const node of muzzles) if (!turrets.some(t => hasAncestor(node, t))) {
    const key = node.name.slice('FX_Muzzle_'.length);
    weapons.push({ key: `Fixed_${key}`, label: `고정 포 · ${key}`, pivot: null, barrels: [], muzzleNodes: [node] });
  }
  return { weapons, engines, muzzleCount: muzzles.length };
}
function settingsFor(weapon) {
  const side = weapon.key.startsWith('Side_');
  const p = presetLimits[weapon.key] || { yaw: [-180, 180], pitch: [-45, 45], pitchSign: 1 };
  const validAxis = x => ['x','y','z'].includes(String(x).toLowerCase()) ? String(x).toLowerCase() : null;
  return { yaw: [...p.yaw], pitch: [...p.pitch], pitchSign: p.pitchSign,
    yawAxis: validAxis(weapon.pivot?.userData?.rotation_axis) || (side ? 'y' : 'z'),
    pitchAxis: validAxis(weapon.barrels[0]?.userData?.rotation_axis) || (side ? 'z' : 'y') };
}
const v = new THREE.Vector3();
const q = new THREE.Quaternion();
const axisY = new THREE.Vector3(0, 1, 0);
let ship;
let displayRoot;
let previousTime = performance.now();

function addAnchor(node, type, directionNode) {
  const marker = new THREE.Mesh(type === 'engine' ? engineGeometry : muzzleGeometry,
    type === 'engine' ? engineMaterial : muzzleMaterial);
  scene.add(marker);
  const anchor = { node, type, directionNode, marker, flashUntil: 0 };
  if (type === 'engine') {
    anchor.flame = new THREE.Mesh(flameGeometry, flameMaterial);
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
  [$('yaw').min, $('yaw').max] = cfg.yaw; [$('pitch').min, $('pitch').max] = cfg.pitch;
  $('yaw').value = t.yaw; $('pitch').value = t.pitch;
  $('yaw-value').textContent = `${t.yaw}°`; $('pitch-value').textContent = `${t.pitch}°`;
  $('yaw-label').textContent = t.key.startsWith('Side_') ? '포탑 상하 회전' : '포탑 회전';
  $('pitch-label').textContent = t.key.startsWith('Side_') ? '포신 좌우 회전' : '포신 회전';
  $('yaw-axis').value = cfg.yawAxis; $('pitch-axis').value = cfg.pitchAxis;
  $('yaw-min').value = cfg.yaw[0]; $('yaw-max').value = cfg.yaw[1];
  $('pitch-min').value = cfg.pitch[0]; $('pitch-max').value = cfg.pitch[1];
  $('pitch-sign').value = String(cfg.pitchSign);
}
function applyAngles(t) {
  if (!t?.pivot) return;
  const cfg = t.settings;
  t.yaw = THREE.MathUtils.clamp(t.yaw, ...cfg.yaw); t.pitch = THREE.MathUtils.clamp(t.pitch, ...cfg.pitch);
  t.pivot.rotation[cfg.yawAxis] = THREE.MathUtils.degToRad(t.yaw);
  for (const barrel of t.barrels) barrel.rotation[cfg.pitchAxis] = THREE.MathUtils.degToRad(t.pitch * cfg.pitchSign);
}
function fire(t) {
  ship.updateWorldMatrix(true, true);
  for (const anchor of t.muzzles) {
    const shot = new THREE.Mesh(shotGeometry, shotMaterial);
    anchor.node.getWorldPosition(shot.position);
    const velocity = directionFor(anchor, new THREE.Vector3()).multiplyScalar(12);
    scene.add(shot);
    shots.push({ mesh: shot, velocity, age: 0 });
    anchor.flashUntil = performance.now() + 180;
  }
}

async function loadShip(url, label) {
 try {
  const loaded = await new FBXLoader(manager).loadAsync(url);
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
  for (const weapon of rig.weapons) {
    const muzzles = weapon.muzzleNodes.map(node => addAnchor(node, 'muzzle', node));
    turrets.push({ ...weapon, muzzles, settings: settingsFor(weapon), yaw: 0, pitch: 0 });
  }
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
    const t = selectedTurret(); t[id] = Number($(id).value); applyAngles(t); updateControls();
  });
  $('fire').addEventListener('click', () => { const t = selectedTurret(); if (t) fire(t); });
  $('reset').addEventListener('click', () => {
    for (const t of turrets) { t.yaw = 0; t.pitch = 0; applyAngles(t); }
    updateControls();
  });
$('apply-settings').addEventListener('click', () => {
  const t = selectedTurret(); if (!t?.pivot) return;
  const values = ['yaw-min','yaw-max','pitch-min','pitch-max'].map(id => Number($(id).value));
  if (values.some(n => !Number.isFinite(n)) || values[0] > values[1] || values[2] > values[3]) {
    $('status').textContent = '회전 범위의 최소값과 최대값을 확인하세요.'; return;
  }
  // 다른 축에 남은 이전 회전은 지우고 새 축에 적용한다.
  t.pivot.rotation[t.settings.yawAxis] = 0;
  for (const barrel of t.barrels) barrel.rotation[t.settings.pitchAxis] = 0;
  t.settings = { yaw: values.slice(0,2), pitch: values.slice(2,4), yawAxis: $('yaw-axis').value,
    pitchAxis: $('pitch-axis').value, pitchSign: Number($('pitch-sign').value) };
  applyAngles(t); updateControls();
  $('status').textContent = `${t.label} 회전 설정 적용됨`;
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
await loadShip(`${assetRoot}Light_cruiser_01_rigged.fbx`, '작업 폴더 FBX');

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop((time) => {
  const dt = Math.min((time - previousTime) / 1000, 0.1); previousTime = time;
  if (ship) {
    ship.updateWorldMatrix(true, true);
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
    const shot = shots[i]; shot.age += dt; shot.mesh.position.addScaledVector(shot.velocity, dt);
    if (shot.age > 3) { scene.remove(shot.mesh); shots.splice(i, 1); }
  }
  controls.update(); renderer.render(scene, camera);
});
