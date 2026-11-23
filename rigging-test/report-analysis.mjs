import {readFile,writeFile} from 'node:fs/promises';
const r=JSON.parse(await readFile(new URL('./rig-analysis.json',import.meta.url),'utf8'));
const rows=['# 함선 10종 분석 결과','','[검사 도구 사용법](README.md) · [정책](../docs/policies/ship-rigging.md) · [상세 JSON](rig-analysis.json)','','생성 시점: '+r.generatedAt,'',
'실제 로더로 FBX 계층·포구·엔진·위상과 회전 방향을 조사했다. 고정 형상의 자세 표본은 포탑 30° 간격과 중립·경계, 포신 중립·중간·경계를 조합했다. 모든 다른 무장의 자세 조합이나 연속 경로를 인증한 자료가 아니다. 접합 영역은 후보이며, 엄격 모드의 차단을 실제 결함으로 단정하지 않는다.','',
'| 모델 | 가동 포탑 | 고정 포구 | 전체 포구 | 엔진 | 표본 | 추정 접합 허용 시 고정 검사 통과 표본 | 중립 발사 차단 포구 | 열린/비다양체 메시 |','|---|---:|---:|---:|---:|---:|---:|---:|---:|'];
for(const m of r.models){
 const samples=m.weapons.flatMap(w=>w.samples),mov=m.weapons.filter(w=>w.samples.length).length,fix=m.weapons.filter(w=>!w.samples.length).reduce((s,w)=>s+w.muzzles,0),fire=m.weapons.flatMap(w=>w.neutralFire).filter(f=>f.blocked).length;
 rows.push(`| ${m.file} | ${mov} | ${fix} | ${m.muzzles} | ${m.engines} | ${samples.length} | ${samples.filter(s=>!s.draftBlocked).length} | ${fire} | ${m.topology.filter(t=>t.boundaryEdges||t.nonManifoldEdges).length} |`);
}
rows.push('','사용자가 정상이라고 확인한 경순01·구축함01의 전체 0° 자세를 형상상 정상으로 취급한다. 정상 접합부 후보의 미승인 영향이 포함돼 있어 안전 각도가 0개라고 해석하지 않는다. 추정 모드 통과 표본도 가동 부품 간 검사·표본 사이 경로·발사 가능 여부를 보증하지 않는다. 경순01·구축함01은 확인된 중립 접합 후보를 반영하며, 나머지 함선은 추정 접합 검수 결과로 구분한다. 포탑 간 간섭과 발사 경로는 별도다.','',
'중립 발사 차단은 현재 반경 0.075, 검사 거리 36, 직선 공격 조건의 결과다. 포구 위치 오류, 다른 구조의 가림, 공격 폭이 너무 큰 경우를 구분해 검수해야 한다. 이를 포구를 임의로 앞으로 옮기거나 자기 함선 전체를 무시하는 방식으로 해제하지 않는다.');
for(const m of r.models){
 rows.push('','## '+m.file,'','FBX SHA-256: `'+m.sha256+'`','',`삼각형 ${m.triangles}개, 메시 ${m.meshes}개, 접합 후보 ${m.joints.length}개. 분석 관측 시간 ${m.elapsedMs}ms(파일 로드·모듈 다운로드 제외).`,'');
 rows.push('| 무장 | 포신/포구 | 포탑 축 | 포신 축·부호 | 범위(포탑 / 포신) |','|---|---:|---|---|---|');
 for(const w of m.weapons)rows.push(`| ${w.key} | ${w.barrels}/${w.muzzles} | ${w.samples.length?w.settings.yawAxis:'고정'} | ${w.samples.length?w.settings.pitchAxis+' / '+w.settings.pitchSign:'고정'} | ${w.samples.length?w.settings.yaw.join('~')+' / '+w.settings.pitch.join('~'):'회전 없음'} |`);
 const inferred=m.weapons.filter(w=>w.inference).map(w=>w.key);if(inferred.length)rows.push('','바깥 방향 부호 추정: '+inferred.join(', ')+'. 1° 실제 포구 이동 벡터는 JSON의 probe를 참조한다.');
 rows.push('','중립에서 발사 차단된 경로:');
 const hits=m.weapons.flatMap(w=>w.neutralFire).filter(f=>f.blocked);
 if(!hits.length)rows.push('','- 현재 공격 조건에서 차단 없음. 다른 자세와 공격 폭은 별도 검사 대상.');
 else rows.push('',...hits.map(f=>'- `'+f.muzzle+'` → `'+f.blocked.part+'` ('+f.blocked.type+')'));
}
rows.push('','## 검증 상태','','단위 회귀 10개 그룹과 실제 Edge의 10종 로딩·분석 해시 일치·이동/발사 이벤트·검수 모드 검사를 수행했다. 접합부의 개별 시각 승인, 닫힌 검사 형상의 확보, 표본 사이의 연속 간섭 검증과 대규모 함대 프레임 성능은 미완료다. 모델 FBX는 변경하지 않았다.','');
await writeFile(new URL('./rig-analysis.md',import.meta.url),rows.join('\n'));
console.log('Wrote rig-analysis.md');
