# 함선 10종 분석 결과

[검사 도구 사용법](README.md) · [정책](../docs/policies/ship-rigging.md) · [상세 JSON](rig-analysis.json)

생성 시점: 2026-11-22T17:32:47.551Z

실제 로더로 FBX 계층·포구·엔진·위상과 회전 방향을 조사했다. 고정 형상의 자세 표본은 포탑 30° 간격과 중립·경계, 포신 중립·중간·경계를 조합했다. 모든 다른 무장의 자세 조합이나 연속 경로를 인증한 자료가 아니다. 접합 영역은 후보이며, 엄격 모드의 차단을 실제 결함으로 단정하지 않는다.

| 모델 | 가동 포탑 | 고정 포구 | 전체 포구 | 엔진 | 표본 | 추정 접합 허용 시 고정 검사 통과 표본 | 중립 발사 차단 포구 | 열린/비다양체 메시 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Destroyer_01_rigged.fbx | 8 | 2 | 10 | 4 | 120 | 120 | 0 | 15 |
| Destroyer_02_rigged.fbx | 5 | 4 | 12 | 6 | 195 | 187 | 2 | 20 |
| Destroyer_03_rigged.fbx | 6 | 4 | 12 | 3 | 234 | 154 | 8 | 23 |
| Destroyer_04_rigged.fbx | 8 | 6 | 18 | 6 | 312 | 122 | 12 | 25 |
| Destroyer_05_rigged.fbx | 5 | 4 | 14 | 4 | 195 | 117 | 4 | 18 |
| Light_cruiser_01_rigged.fbx | 5 | 0 | 6 | 6 | 192 | 192 | 0 | 12 |
| Light_cruiser_02_rigged.fbx | 5 | 0 | 10 | 4 | 195 | 95 | 4 | 21 |
| Light_cruiser_03_rigged.fbx | 4 | 0 | 7 | 1 | 156 | 156 | 0 | 19 |
| Light_cruiser_04_rigged.fbx | 5 | 0 | 9 | 5 | 195 | 146 | 0 | 18 |
| Light_cruiser_05_rigged.fbx | 4 | 0 | 4 | 6 | 156 | 152 | 1 | 11 |

사용자가 정상이라고 확인한 경순01·구축함01의 전체 0° 자세를 형상상 정상으로 취급한다. 정상 접합부 후보의 미승인 영향이 포함돼 있어 안전 각도가 0개라고 해석하지 않는다. 추정 모드 통과 표본도 가동 부품 간 검사·표본 사이 경로·발사 가능 여부를 보증하지 않는다. 경순01·구축함01은 확인된 중립 접합 후보를 반영하며, 나머지 함선은 추정 접합 검수 결과로 구분한다. 포탑 간 간섭과 발사 경로는 별도다.

중립 발사 차단은 현재 반경 0.075, 검사 거리 36, 직선 공격 조건의 결과다. 포구 위치 오류, 다른 구조의 가림, 공격 폭이 너무 큰 경우를 구분해 검수해야 한다. 이를 포구를 임의로 앞으로 옮기거나 자기 함선 전체를 무시하는 방식으로 해제하지 않는다.

## Destroyer_01_rigged.fbx

FBX SHA-256: `4d3d8e64e8d945ed3278e28b4904e51a46ff04de5c6d9b9ee7f46fd646077a8b`

삼각형 13939개, 메시 15개, 접합 후보 18개. 분석 관측 시간 385.89ms(파일 로드·모듈 다운로드 제외).

| 무장 | 포신/포구 | 포탑 축 | 포신 축·부호 | 범위(포탑 / 포신) |
|---|---:|---|---|---|
| D01_Broadside_R_63 | 1/1 | z | x / -1 | -45~45 / 0~45 |
| D01_Broadside_L_103 | 1/1 | z | x / 1 | -45~45 / 0~45 |
| D01_Broadside_L_63 | 1/1 | z | x / 1 | -45~45 / 0~45 |
| D01_Hull_L | 1/1 | z | y / 1 | -30~90 / -15~15 |
| D01_Broadside_R_21 | 1/1 | z | x / -1 | -45~45 / 0~45 |
| D01_Hull_R | 1/1 | z | y / 1 | -30~90 / -15~15 |
| D01_Broadside_L_21 | 1/1 | z | x / 1 | -45~45 / 0~45 |
| D01_Broadside_R_103 | 1/1 | z | x / -1 | -45~45 / 0~45 |
| Fixed_D01_Pod_R | 0/1 | 고정 | 고정 | 회전 없음 |
| Fixed_D01_Pod_L | 0/1 | 고정 | 고정 | 회전 없음 |

중립에서 발사 차단된 경로:

- 현재 공격 조건에서 차단 없음. 다른 자세와 공격 폭은 별도 검사 대상.

## Destroyer_02_rigged.fbx

FBX SHA-256: `e8f98b0fa658db0b4ee4367ac6e7dab87d3016b3c13eb196965666c7bb94c608`

삼각형 14526개, 메시 20개, 접합 후보 21개. 분석 관측 시간 568.98ms(파일 로드·모듈 다운로드 제외).

| 무장 | 포신/포구 | 포탑 축 | 포신 축·부호 | 범위(포탑 / 포신) |
|---|---:|---|---|---|
| Aft_L_D02 | 1/1 | y | z / 1 | -180~180 / 0~45 |
| Top_Front_D02 | 2/2 | z | y / 1 | -180~180 / 0~45 |
| Bottom_D02 | 2/2 | z | y / 1 | -180~180 / 0~45 |
| Aft_R_D02 | 1/1 | y | z / 1 | -180~180 / 0~45 |
| Top_Rear_D02 | 2/2 | z | y / 1 | -180~180 / 0~45 |
| Fixed_Fixed_Fore_D02_4 | 0/1 | 고정 | 고정 | 회전 없음 |
| Fixed_Fixed_Fore_D02_1 | 0/1 | 고정 | 고정 | 회전 없음 |
| Fixed_Fixed_Fore_D02_2 | 0/1 | 고정 | 고정 | 회전 없음 |
| Fixed_Fixed_Fore_D02_3 | 0/1 | 고정 | 고정 | 회전 없음 |

중립에서 발사 차단된 경로:

- `FX_Muzzle_Top_Rear_R_D02` → `D02_Barrel_Top_Front_R` (muzzle-exit)
- `FX_Muzzle_Top_Rear_L_D02` → `D02_Barrel_Top_Front_L` (muzzle-exit)

## Destroyer_03_rigged.fbx

FBX SHA-256: `ea83848cffc65f95c93ebe9dde03abe0b932d89fd5119176391f01e6c2db68ed`

삼각형 14782개, 메시 23개, 접합 후보 22개. 분석 관측 시간 541.37ms(파일 로드·모듈 다운로드 제외).

| 무장 | 포신/포구 | 포탑 축 | 포신 축·부호 | 범위(포탑 / 포신) |
|---|---:|---|---|---|
| R_A_D03 | 2/2 | z | y / 1 | -180~180 / 0~45 |
| L_F_D03 | 1/1 | z | y / 1 | -180~180 / 0~45 |
| L_M_D03 | 1/1 | z | y / 1 | -180~180 / 0~45 |
| R_F_D03 | 1/1 | z | y / 1 | -180~180 / 0~45 |
| L_A_D03 | 2/2 | z | y / 1 | -180~180 / 0~45 |
| R_M_D03 | 1/1 | z | y / 1 | -180~180 / 0~45 |
| Fixed_Fixed_R_Upper_D03 | 0/1 | 고정 | 고정 | 회전 없음 |
| Fixed_Fixed_L_Upper_D03 | 0/1 | 고정 | 고정 | 회전 없음 |
| Fixed_Fixed_R_Lower_D03 | 0/1 | 고정 | 고정 | 회전 없음 |
| Fixed_Fixed_L_Lower_D03 | 0/1 | 고정 | 고정 | 회전 없음 |

바깥 방향 부호 추정: R_A_D03, L_F_D03, L_M_D03, R_F_D03, L_A_D03, R_M_D03. 1° 실제 포구 이동 벡터는 JSON의 probe를 참조한다.

중립에서 발사 차단된 경로:

- `FX_Muzzle_R_A_146_D03` → `D03_Turret_R_F` (fire-path)
- `FX_Muzzle_R_A_100_D03` → `D03_Turret_R_F` (fire-path)
- `FX_Muzzle_L_M_D03` → `D03_Turret_L_F` (muzzle-exit)
- `FX_Muzzle_L_A_146_D03` → `D03_Turret_L_F` (fire-path)
- `FX_Muzzle_L_A_100_D03` → `D03_Turret_L_F` (fire-path)
- `FX_Muzzle_R_M_D03` → `D03_Turret_R_F` (muzzle-exit)
- `FX_Muzzle_Fixed_R_Lower_D03` → `D03_Hull` (muzzle-exit)
- `FX_Muzzle_Fixed_L_Lower_D03` → `D03_Hull` (muzzle-exit)

## Destroyer_04_rigged.fbx

FBX SHA-256: `fda3c12f785ea4774412a9ca5ebc6456dcccb9b6bd3156954365d52e3e2a9476`

삼각형 18670개, 메시 25개, 접합 후보 32개. 분석 관측 시간 545.68ms(파일 로드·모듈 다운로드 제외).

| 무장 | 포신/포구 | 포탑 축 | 포신 축·부호 | 범위(포탑 / 포신) |
|---|---:|---|---|---|
| R_Aft_D04 | 1/1 | z | y / 1 | -180~180 / 0~45 |
| L_Aft_D04 | 1/1 | z | y / 1 | -180~180 / 0~45 |
| R_F_D04 | 2/2 | z | y / 1 | -180~180 / 0~45 |
| L_R_D04 | 2/2 | z | y / 1 | -180~180 / 0~45 |
| L_F_D04 | 2/2 | z | y / 1 | -180~180 / 0~45 |
| L_Side_D04 | 1/1 | z | y / 1 | -180~180 / 0~45 |
| R_Side_D04 | 1/1 | z | y / -1 | -180~180 / 0~45 |
| R_R_D04 | 2/2 | z | y / 1 | -180~180 / 0~45 |
| Fixed_Fixed_R_3_D04 | 0/1 | 고정 | 고정 | 회전 없음 |
| Fixed_Fixed_L_3_D04 | 0/1 | 고정 | 고정 | 회전 없음 |
| Fixed_Fixed_R_1_D04 | 0/1 | 고정 | 고정 | 회전 없음 |
| Fixed_Fixed_L_2_D04 | 0/1 | 고정 | 고정 | 회전 없음 |
| Fixed_Fixed_R_2_D04 | 0/1 | 고정 | 고정 | 회전 없음 |
| Fixed_Fixed_L_1_D04 | 0/1 | 고정 | 고정 | 회전 없음 |

중립에서 발사 차단된 경로:

- `FX_Muzzle_R_Aft_D04` → `D04_Hull` (muzzle-exit)
- `FX_Muzzle_L_Aft_D04` → `D04_Hull` (muzzle-exit)
- `FX_Muzzle_L_R_123_D04` → `D04_Turret_L_F` (muzzle-exit)
- `FX_Muzzle_L_R_115_D04` → `D04_Barrel_L_F_115` (muzzle-exit)
- `FX_Muzzle_R_R_115_D04` → `D04_Barrel_R_F_115` (muzzle-exit)
- `FX_Muzzle_R_R_123_D04` → `D04_BackCube_R_F` (muzzle-exit)
- `FX_Muzzle_Fixed_R_3_D04` → `D04_Hull` (muzzle-exit)
- `FX_Muzzle_Fixed_L_3_D04` → `D04_Hull` (muzzle-exit)
- `FX_Muzzle_Fixed_R_1_D04` → `D04_Hull` (muzzle-exit)
- `FX_Muzzle_Fixed_L_2_D04` → `D04_Hull` (muzzle-exit)
- `FX_Muzzle_Fixed_R_2_D04` → `D04_Hull` (muzzle-exit)
- `FX_Muzzle_Fixed_L_1_D04` → `D04_Hull` (muzzle-exit)

## Destroyer_05_rigged.fbx

FBX SHA-256: `c57b1188804cabe1f8998e52ea114108e4f780b7b0cdd0868ffdee6e749a5666`

삼각형 12857개, 메시 21개, 접합 후보 25개. 분석 관측 시간 634.07ms(파일 로드·모듈 다운로드 제외).

| 무장 | 포신/포구 | 포탑 축 | 포신 축·부호 | 범위(포탑 / 포신) |
|---|---:|---|---|---|
| D05_side_n | 2/2 | z | y / -1 | -180~180 / 0~45 |
| D05_side_p | 2/2 | z | y / 1 | -180~180 / 0~45 |
| D05_aft_n | 2/2 | z | y / 1 | -180~180 / 0~45 |
| D05_aft_p | 2/2 | z | y / 1 | -180~180 / 0~45 |
| D05_fore | 2/2 | z | y / 1 | -180~180 / 0~45 |
| Fixed_D05_Fixed_n_inner | 0/1 | 고정 | 고정 | 회전 없음 |
| Fixed_D05_Fixed_p_outer | 0/1 | 고정 | 고정 | 회전 없음 |
| Fixed_D05_Fixed_p_inner | 0/1 | 고정 | 고정 | 회전 없음 |
| Fixed_D05_Fixed_n_outer | 0/1 | 고정 | 고정 | 회전 없음 |

바깥 방향 부호 추정: D05_aft_n, D05_aft_p, D05_fore. 1° 실제 포구 이동 벡터는 JSON의 probe를 참조한다.

중립에서 발사 차단된 경로:

- `FX_Muzzle_D05_side_n_lower` → `D05_hull_draft` (muzzle-exit)
- `FX_Muzzle_D05_side_n_upper` → `D05_hull_draft` (muzzle-exit)
- `FX_Muzzle_D05_side_p_lower` → `D05_hull_draft` (muzzle-exit)
- `FX_Muzzle_D05_side_p_upper` → `D05_hull_draft` (muzzle-exit)

## Light_cruiser_01_rigged.fbx

FBX SHA-256: `a92546881b3ca313143812a0f9f4c4d106fe20a4970c19605905340c0ea8a8bb`

삼각형 13497개, 메시 13개, 접합 후보 17개. 분석 관측 시간 5755.02ms(파일 로드·모듈 다운로드 제외).

| 무장 | 포신/포구 | 포탑 축 | 포신 축·부호 | 범위(포탑 / 포신) |
|---|---:|---|---|---|
| Center | 2/2 | z | y / 1 | -140~140 / 0~45 |
| Side_L | 1/1 | y | z / -1 | -180~180 / 0~45 |
| Side_R | 1/1 | y | z / 1 | -180~180 / 0~45 |
| Aft_R | 1/1 | z | y / 1 | -180~180 / 0~45 |
| Aft_L | 1/1 | z | y / 1 | -180~180 / 0~45 |

중립에서 발사 차단된 경로:

- 현재 공격 조건에서 차단 없음. 다른 자세와 공격 폭은 별도 검사 대상.

## Light_cruiser_02_rigged.fbx

FBX SHA-256: `b4b34c3933c9f0b5a0fe0685a86a7795964d72694f6e69ce84d5281b700750c0`

삼각형 22016개, 메시 25개, 접합 후보 25개. 분석 관측 시간 2134.92ms(파일 로드·모듈 다운로드 제외).

| 무장 | 포신/포구 | 포탑 축 | 포신 축·부호 | 범위(포탑 / 포신) |
|---|---:|---|---|---|
| LC02_mid_n | 2/2 | z | y / 1 | -180~180 / 0~45 |
| LC02_aft_p | 2/2 | z | y / 1 | -180~180 / 0~45 |
| LC02_fore | 2/2 | z | y / 1 | -180~180 / 0~45 |
| LC02_aft_n | 2/2 | z | y / -1 | -180~180 / 0~45 |
| LC02_mid_p | 2/2 | z | y / 1 | -180~180 / 0~45 |

바깥 방향 부호 추정: LC02_mid_n, LC02_fore, LC02_mid_p. 1° 실제 포구 이동 벡터는 JSON의 probe를 참조한다.

중립에서 발사 차단된 경로:

- `FX_Muzzle_LC02_aft_p_1` → `LC02_hull_draft` (muzzle-exit)
- `FX_Muzzle_LC02_aft_p_2` → `LC02_hull_draft` (muzzle-exit)
- `FX_Muzzle_LC02_aft_n_1` → `LC02_hull_draft` (muzzle-exit)
- `FX_Muzzle_LC02_aft_n_2` → `LC02_hull_draft` (muzzle-exit)

## Light_cruiser_03_rigged.fbx

FBX SHA-256: `d960c436016df38e58b048a05a65afd0bad822ef0faecd3c1f9ad748b5e747a0`

삼각형 12342개, 메시 20개, 접합 후보 18개. 분석 관측 시간 2118.47ms(파일 로드·모듈 다운로드 제외).

| 무장 | 포신/포구 | 포탑 축 | 포신 축·부호 | 범위(포탑 / 포신) |
|---|---:|---|---|---|
| LC03_under | 1/1 | z | y / -1 | -180~180 / 0~45 |
| LC03_mid_n | 2/2 | z | y / 1 | -180~180 / 0~45 |
| LC03_mid_p | 2/2 | z | y / 1 | -180~180 / 0~45 |
| LC03_fore | 2/2 | z | y / 1 | -180~180 / 0~45 |

바깥 방향 부호 추정: LC03_under, LC03_mid_n, LC03_mid_p, LC03_fore. 1° 실제 포구 이동 벡터는 JSON의 probe를 참조한다.

중립에서 발사 차단된 경로:

- 현재 공격 조건에서 차단 없음. 다른 자세와 공격 폭은 별도 검사 대상.

## Light_cruiser_04_rigged.fbx

FBX SHA-256: `2e78104a6a1ee10b153786280f7677290ce1d58a5e03c2aa04e37fbaf5c04d3d`

삼각형 13822개, 메시 22개, 접합 후보 22개. 분석 관측 시간 1535.52ms(파일 로드·모듈 다운로드 제외).

| 무장 | 포신/포구 | 포탑 축 | 포신 축·부호 | 범위(포탑 / 포신) |
|---|---:|---|---|---|
| LC04_aft_neg | 2/2 | z | y / 1 | -180~180 / 0~45 |
| LC04_fore | 3/3 | z | y / 1 | -180~180 / 0~45 |
| LC04_under_pos | 1/1 | z | y / -1 | -180~180 / 0~45 |
| LC04_aft_pos | 2/2 | z | y / 1 | -180~180 / 0~45 |
| LC04_under_neg | 1/1 | z | y / -1 | -180~180 / 0~45 |

바깥 방향 부호 추정: LC04_aft_neg, LC04_fore, LC04_under_pos, LC04_aft_pos, LC04_under_neg. 1° 실제 포구 이동 벡터는 JSON의 probe를 참조한다.

중립에서 발사 차단된 경로:

- 현재 공격 조건에서 차단 없음. 다른 자세와 공격 폭은 별도 검사 대상.

## Light_cruiser_05_rigged.fbx

FBX SHA-256: `61abd1b92aa80c2401c8123f2e9a0ce2fec7b893a08ff425ca739162a9247310`

삼각형 25735개, 메시 12개, 접합 후보 12개. 분석 관측 시간 1278.73ms(파일 로드·모듈 다운로드 제외).

| 무장 | 포신/포구 | 포탑 축 | 포신 축·부호 | 범위(포탑 / 포신) |
|---|---:|---|---|---|
| LC05_center | 1/1 | z | y / 1 | -180~180 / 0~45 |
| LC05_fore_n | 1/1 | z | y / 1 | -180~180 / 0~45 |
| LC05_under | 1/1 | z | y / -1 | -180~180 / 0~45 |
| LC05_fore_p | 1/1 | z | y / 1 | -180~180 / 0~45 |

바깥 방향 부호 추정: LC05_center, LC05_fore_n, LC05_under, LC05_fore_p. 1° 실제 포구 이동 벡터는 JSON의 probe를 참조한다.

중립에서 발사 차단된 경로:

- `FX_Muzzle_LC05_under_1` → `LC05_hull_draft` (muzzle-exit)

## 검증 상태

단위 회귀 10개 그룹과 실제 Edge의 10종 로딩·분석 해시 일치·이동/발사 이벤트·검수 모드 검사를 수행했다. 접합부의 개별 시각 승인, 닫힌 검사 형상의 확보, 표본 사이의 연속 간섭 검증과 대규모 함대 프레임 성능은 미완료다. 모델 FBX는 변경하지 않았다.
