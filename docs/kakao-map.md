# Kakao 지도 구현 규격
근거 S04(Kakao Maps Guide), S06(Web API reference).

## SDK
JavaScript key는 공개 클라이언트 키이며 등록 domain에서 사용한다. 신고 좌표를 얻기 위한 REST key는 쓰지 않는다.
등록 후보: 실제 Pages origin(프로젝트 path 제외), 커스텀 origin, 승인된 localhost 포트.
스크립트는 https://dapi.kakao.com/v2/maps/sdk.js?appkey=...&autoload=false&libraries=clusterer
한 번만 load, promise dedupe, kakao.maps.load 후 instance 생성, timeout+retry.
기본 지도 type은 SDK에서 확인한 ROADMAP, 필요 시 HYBRID. 'DARK' type을 추정하지 않는다.

## 지리
Kakao LatLng(lat,lng), GeoJSON coordinates=[lng,lat]. 단위/순서 테스트 필수.
전국 bounds에 제주·울릉·독도 표시 위치를 포함하며 시군구 행정코드 기반 집계와 법정동/행정동을 혼동하지 않는다.
주소 normalizer는 제공 주소만 사용한다. 좌표는 수신한 값 그대로 유지한다.

## 인터랙션
idle 이벤트 debounce, pan/zoom/selection은 state source가 하나. query change때 setCenter feedback loop 금지.
클러스터 marker count는 렌더링용 node 수가 아닌 신고 count. 가까운 위치를 클러스터 표시해도 private fact를 합쳐 지우지 않는다.
CustomOverlay 클릭 target, 키보드로 동일 항목을 선택할 수 있는 병렬 지점 목록 제공.
ResizeObserver에서 map.relayout; cleanup에서 event handlers/overlays 제거; React StrictMode 이중 초기화 방지.

## 히트/경계
일반 marker/cluster가 P0. heat/intensity는 공식 primitives/projection canvas로 실검증한 뒤 추가.
polygon 경계는 출처/기준일/license를 metadata와 NOTICE에 남긴다. 없는 국가/시군구 윤곽을 꾸며 실제 GIS처럼 사용하지 않는다.
저작권/로고·축척·지도 controls를 overlay나 CSS filter로 가리지 않는다. 서비스 이용조건 확인 전 대량 tiles cache 금지.

## 오프라인/키 없음
디자인검수 demo 모드에서는 '지도 모형 · 실제 지도 아님'. production은 '지도 연결을 확인할 수 없습니다' +
재시도/목록 보기. 통계는 계속 탐색 가능. 지도가 보였다는 screenshot은 실제 SDK key/domain 성공 로그가 있을 때만 live evidence.

## 2026-09-29 개편 (docs/implementation/dashboard-redesign)
- 핀은 정규화 주소당 1개(`place_key`, address-v1). 핀 위치는 그 주소 원천 좌표 중 결정적으로 고른 표시용 위치이며 원천 좌표는 바꾸지 않는다.
- 지표: 신고 수 / 수용률 / 불수용률 / 과태료(부과율). 핀·묶음 숫자는 건수 또는 %; 묶음 비율은 Σ분자/Σ분모. 색 입력은 0..1, 분모 없음은 회색 '–'.
- 경계 채움·hover·범례도 선택 지표를 따른다. 지도 생성·fitBounds·relayout은 프로그램 이동이라 자동 통계 범위에 쓰지 않는다.
- 지도 host는 보기 전환에서 재삽입하지 않고 ResizeObserver로 relayout만 한다. SDK가 컨테이너에 inline `position:relative`를 써도 host가 크기를 유지하도록 CSS가 `!important`로 고정한다.

## 2026-10-13 R1: 밀집도(수용률 색 + 신고 건수 크기/숫자) 핀
- 다섯 번째 지표 '밀집도'는 '신고 수'와 같은 points 경로(핀·클러스터·선택·내 신고/관심 표시)를 그대로 쓴다 — 새 render mode가
  아니다. `kind: 'density'`인 `KakaoPointInput`만 `markerSvg`/`clusterSvg` 대신 `densityPinSvg`/`densityClusterSvg`로 그린다.
- 색과 크기가 서로 다른 숫자를 쓴다: 색은 `acceptanceColor(num/den)`(수용/분류된 답변, 고정 `ACCEPTANCE_RAMP`), 크기·텍스트는
  `densityDiameter(weight)`(report_count, `DENSITY_STEPS` 1–9/10–29/30–99/100–299/300+ → 32/38/44/50/56px)다. 기존
  `METRIC_RAMP`(신고량/과태료, 파란 로그 스케일)와 `rampColor`를 공유하되 램프 배열만 다르게 넘긴다(`rampColor(t, ramp)`).
- 서버 압축점 보존: 클라이언트 재묶음(`clusterPoints`)의 `places`는 더 이상 묶인 노드 수가 아니라
  `Σ(member.places ?? 1)`이다 — `KakaoPointInput.places`(기본 1, `PublicPoint.aggregate`면 `point_count`)를 더한 값이라
  서버가 이미 압축해 보낸 주소 수가 추가 묶음에서도 사라지지 않는다. 이 수정은 density뿐 아니라 '신고 수' 묶음에도 적용된다.
- 선택 핀의 앵커는 `densityPinGeometry(diameter, selected)`로 계산해 비선택 핀과 같은 실좌표 앵커(원 중심 + r + 4px)를
  유지한다(기존 `SELECTED_SIZE`와 같은 의도, 선택해도 핀이 튀지 않음).
- 실제 Kakao SDK 키가 없는 환경에서는 `densityPinSvg`/`densityClusterSvg`가 만드는 SVG를 임시 미리보기 페이지로 직접 띄워
  크기·색·겹침을 확인했다(라이브 Kakao 캔버스 위 겹침은 실 키로 별도 확인 필요, BLOCKED로 기록).
