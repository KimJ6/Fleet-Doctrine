import * as THREE from 'three';
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
// Stable IDs preserve the legacy rig-specific rotation behavior after asset renaming.
const legacyMounts={"D01":["D01_Hull_L","D01_Hull_R","D01_Broadside_L_21","D01_Broadside_R_21",null,null,"D01_Broadside_L_63","D01_Broadside_R_63","D01_Broadside_L_103","D01_Broadside_R_103"],"D02":[null,null,null,null,"Top_Front_D02","Bottom_D02","Top_Rear_D02","Aft_L_D02","Aft_R_D02"],"D03":[null,null,null,null,"L_F_D03","R_F_D03","L_M_D03","R_M_D03","L_A_D03","R_A_D03"],"D04":[null,null,null,null,null,null,"L_F_D04","R_F_D04","L_Side_D04","R_Side_D04","L_R_D04","R_R_D04","L_Aft_D04","R_Aft_D04"],"D05":[null,null,null,null,"D05_fore","D05_side_p","D05_side_n","D05_aft_p","D05_aft_n"],"LC01":["Side_L","Side_R","Center","Aft_L","Aft_R"],"LC02":["LC02_fore","LC02_mid_p","LC02_mid_n","LC02_aft_p","LC02_aft_n"],"LC03":["LC03_fore","LC03_under","LC03_mid_p","LC03_mid_n"],"LC04":["LC04_under_pos","LC04_under_neg","LC04_fore","LC04_aft_pos","LC04_aft_neg"],"LC05":["LC05_fore_p","LC05_fore_n","LC05_center","LC05_under"]};
export function legacyWeaponKey(key){const match=/^((?:LC|D)\d{2})_W(\d{2})$/.exec(key);return match?(legacyMounts[match[1]]?.[Number(match[2])-1]||key):key;}
export function settingsFor(weapon) {
  weapon={...weapon,key:legacyWeaponKey(weapon.key)};
  const sideD04 = /^[LR]_Side_D04(?:\.\d+)?$/.test(weapon.key); const sideD05 = /^D05_side_[np](?:\.\d+)?$/.test(weapon.key); const sideLC02 = /^LC02_aft_[np](?:\.\d+)?$/.test(weapon.key); const localSide = sideD04 || sideD05 || sideLC02; const side = weapon.key.startsWith('Side_') || localSide;
  // FBXLoader does not expose Blender custom properties on these nodes.
  const broadside = weapon.key.startsWith('D01_Broadside_');
  const aftD02 = /^Aft_[LR]_D02(?:\.\d+)?$/.test(weapon.key);
  const hull = /^D01_Hull_[LR]$/.test(weapon.key);
  const p = presetLimits[weapon.key] || (localSide ? { yaw: [-180, 180], pitch: [0, 45], pitchSign: sideD04 ? (weapon.key.startsWith('L_') ? 1 : -1) : (weapon.key.includes('_p') ? 1 : -1) } : broadside
    ? { yaw: [-45, 45], pitch: [0, 45], pitchSign: weapon.key.includes('_R_') ? -1 : 1 }
    : hull ? { yaw: [-30, 90], pitch: [-15, 15], pitchSign: 1 }
    : { yaw: [-180, 180], pitch: [0, 45], pitchSign: 1 });
  const validAxis = x => ['x','y','z'].includes(String(x).toLowerCase()) ? String(x).toLowerCase() : null;
  return { yaw: [...p.yaw], pitch: [...p.pitch], pitchSign: p.pitchSign,
    yawAxis: validAxis(weapon.pivot?.userData?.rotation_axis) || (localSide ? 'z' : side || aftD02 ? 'y' : 'z'),
    pitchAxis: validAxis(weapon.barrels[0]?.userData?.rotation_axis) || (localSide ? 'y' : broadside ? 'x' : side || aftD02 ? 'z' : 'y') };
}
export function pitchRange(t) {
  const r = t.settings.pitch;
  if(!/^D01_Hull_[LR]$/.test(legacyWeaponKey(t.key)) || t.yaw>=0)return r;
  const lo=Math.max(r[0],-15),hi=Math.min(r[1],0);
  return lo<=hi?[lo,hi]:[0,0];
}
const axis = name => new THREE.Vector3(name === 'x' ? 1 : 0, name === 'y' ? 1 : 0, name === 'z' ? 1 : 0);
export function applyPose(t) {
  if (!t.pivot) return;
  const c = t.settings;
  t.yaw = THREE.MathUtils.clamp(t.yaw, ...c.yaw);
  t.pitch = THREE.MathUtils.clamp(t.pitch, ...pitchRange(t));
  const yawSign = legacyWeaponKey(t.key) === 'D01_Hull_L' ? -1 : 1;
  t.pivot.quaternion.copy(t.restTurret).multiply(new THREE.Quaternion().setFromAxisAngle(axis(c.yawAxis), THREE.MathUtils.degToRad(t.yaw * yawSign)));
  t.barrels.forEach((b, i) => b.quaternion.copy(t.restBarrels[i]).multiply(new THREE.Quaternion().setFromAxisAngle(axis(c.pitchAxis), THREE.MathUtils.degToRad(t.pitch * c.pitchSign))));
}
export function initializeWeapons(root, rig) {
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(root), center = bounds.getCenter(new THREE.Vector3());
  return rig.weapons.map(w => {
    const t = { ...w, settings: settingsFor(w), yaw: 0, pitch: 0, restTurret: w.pivot?.quaternion.clone(), restBarrels: w.barrels.map(b => b.quaternion.clone()), inference: null };
    // Existing user overrides are authoritative. Infer only the outward sign of otherwise generic mounts.
    const originalKey=legacyWeaponKey(w.key);const known = presetLimits[originalKey] || /D01_|D04|D05_side_|LC02_aft_|D02/.test(originalKey);
    if (!known && w.barrels.length && w.muzzleNodes.length) {
      const b = w.barrels[0], m = w.muzzleNodes.find(m=>hasAncestor(m,b)) || w.muzzleNodes[0], before = m.getWorldPosition(new THREE.Vector3());
      const mount = b.getWorldPosition(new THREE.Vector3()), outward = mount.clone().sub(center); outward.x = 0;
      t.pitch = 1; applyPose(t); root.updateWorldMatrix(true, true);
      const delta = m.getWorldPosition(new THREE.Vector3()).sub(before);
      t.settings.pitchSign = delta.dot(outward) < 0 ? -1 : 1;
      t.inference = 'outward sign inferred from mount position and a 1 degree probe; review required';
      t.pitch = 0; applyPose(t); root.updateWorldMatrix(true, true);
    }
    return t;
  });
}
