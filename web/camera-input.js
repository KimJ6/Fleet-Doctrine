import * as THREE from 'three';
export function createCameraInput({camera,orbit,isPicking}){
const cameraKeys = new Set();
const cameraKeyCodes = new Set(['KeyW','KeyA','KeyS','KeyD','KeyR','KeyF']);
const editable = element => element instanceof HTMLElement && (element.matches('input, textarea, select, button, summary') || element.isContentEditable);
window.addEventListener('keydown', event => {
  if ((isPicking() && (event.code==='KeyR'||event.code==='KeyF')) || !cameraKeyCodes.has(event.code) || editable(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
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
return {cameraKeys,moveCamera};
}
