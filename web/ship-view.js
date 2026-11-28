import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { discoverRig, initializeWeapons, pitchRange } from '../rigging-test/rig-control.js';
import { captureMuzzleChain, muzzlePoseFromData, buildWeaponAimSamples } from './simulation.js?v=movement-20261129a';
import { GameRigSafety } from './ship-rig-adapter.js?v=refactor-20261127c';

export async function loadShipViews({state,balance,scene,views,rigs}){
const manager=new THREE.LoadingManager();const assetRoot='../../ship%20assets/rigged/';
manager.setURLModifier(url=>/\.(png|jpe?g)(\?.*)?$/i.test(url)?`${assetRoot}Texture/${url.split('/').pop().split('\\').pop()}`:url);
  const assetUrl=`${assetRoot}${encodeURIComponent(balance?.ship.model_path||'Light_cruiser_01_rigged.fbx')}`;const model=await new FBXLoader(manager).loadAsync(assetUrl);
  const [report,assetBytes]=await Promise.all([fetch('../rigging-test/rig-analysis.json').then(r=>{if(!r.ok)throw Error('리깅 분석 자료 없음');return r.json();}),fetch(assetUrl).then(r=>{if(!r.ok)throw Error('FBX 해시 확인 실패');return r.arrayBuffer();})]);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',assetBytes)),x=>x.toString(16).padStart(2,'0')).join('');
  const neutralConfirmed=report.models.some(m=>m.file==='Light_cruiser_01_rigged.fbx'&&m.sha256===digest);
  const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3()),max=Math.max(size.x,size.y,size.z);
  if(!Number.isFinite(max)||max<=0)throw new Error('FBX의 크기가 올바르지 않습니다.');
  model.position.sub(center);
  const corrected=new THREE.Group();corrected.add(model);corrected.scale.setScalar(2.2/max);corrected.rotation.y=Math.PI/2;
  const blueTexture=await new THREE.TextureLoader().loadAsync(assetRoot+'Texture/T_Spase_blue.png');blueTexture.colorSpace=THREE.SRGBColorSpace;const blueMaterials=new Map();
  function allyMaterial(material){if(blueMaterials.has(material))return blueMaterials.get(material);const copy=material.clone();if(material.map){const map=blueTexture.clone();for(const key of ['wrapS','wrapT','flipY','channel','rotation'])map[key]=material.map[key];map.offset.copy(material.map.offset);map.repeat.copy(material.map.repeat);map.center.copy(material.map.center);map.needsUpdate=true;copy.map=map;}copy.needsUpdate=true;blueMaterials.set(material,copy);return copy;}
  state.spawnRadius=size.length()/max*1.1;
  const prepareUnitView=(s,options={})=>{
    s.collisionRadius=state.spawnRadius;const view=new THREE.Group();view.userData.shipId=s.id;view.add(corrected.clone(true));if((state.fleets.find(f=>f.id===s.fleetId)?.team||state.reserves.find(r=>r.id===s.id)?.team)==='ALLY')view.traverse(node=>{if(node.isMesh&&node.material)node.material=Array.isArray(node.material)?node.material.map(allyMaterial):allyMaterial(node.material);});view.position.copy(s.position);view.quaternion.copy(s.rotation);view.updateWorldMatrix(true,true);
    const rig=discoverRig(view),weapons=initializeWeapons(view,rig);if(balance){const found=new Set();for(const weapon of weapons){const m=/^LC01_(W\d{2})$/.exec(weapon.key),mount=m&&balance.mounts.get(m[1]);if(!mount||found.has(m[1])||mount.muzzles!==weapon.muzzleNodes.length||(weapon.pivot?'turret':'fixed')!==mount.kind)throw Error('LC01 모델과 CSV의 포 불일치: '+weapon.key);found.add(m[1]);weapon.balance=mount.type;}if(found.size!==balance.mounts.size)throw Error('LC01 CSV 포 누락');}s.weapons=weapons.map((weapon,i)=>({id:s.id+':'+i,shipId:s.id,yaw:weapon.yaw,pitch:weapon.pitch,cooldown:0,cooldownSec:weapon.balance?.cooldown,range:weapon.balance?.range,targetId:null}));for(let i=0;i<weapons.length;i++){const weapon=weapons[i];weapon.combatState=s.weapons[i];weapon.muzzleChains=weapon.muzzleNodes.map(muzzle=>captureMuzzleChain(view,weapon,muzzle));
      if(weapon.muzzleChains.length){
        const pose=muzzlePoseFromData(weapon.muzzleChains[0],weapon,new THREE.Vector3(),new THREE.Quaternion(),0,0),settings=weapon.settings;
        weapon.combatState.aimDirection=pose.direction;
        weapon.combatState.aimSamples=buildWeaponAimSamples(weapon,yaw=>pitchRange({...weapon,yaw}));
        weapon.combatState.aimTolerance=weapon.pivot?Math.PI/6:.1;
        weapon.combatState.aimCone=weapon.pivot?Math.min(Math.PI,THREE.MathUtils.degToRad(Math.max(...settings.yaw.map(Math.abs))+Math.max(...settings.pitch.map(Math.abs)))):.1;
        weapon.combatState.damage=weapon.balance?.damage??20;
      }}
    const safety=new GameRigSafety(view,weapons,{assetHash:digest});safety.confirmedNeutral=neutralConfirmed;if(neutralConfirmed)safety.captureConfirmedNeutralContacts();const entry={view,weapons,engines:rig.engines,safety,assetHash:digest,safe:neutralConfirmed&&rig.muzzleCount>0,reason:neutralConfirmed?'':'모델 해시가 일치하지 않아 사격 보류'};
    if(!entry.safe&&!options.allowUnsafe){safety.dispose();throw Error('검증된 리깅 모델이 아닙니다.');}
    return {commit(){scene.add(view);views.set(s.id,view);rigs.set(s.id,entry);},rollback(){scene.remove(view);views.delete(s.id);rigs.delete(s.id);safety.dispose();}};
  };
  return {prepareUnitView,neutralConfirmed};
}
