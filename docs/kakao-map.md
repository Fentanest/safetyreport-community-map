# Kakao 지도 구현 규격
근거 S04(Kakao Maps Guide), S05(Local), S06(Web API reference).

## SDK
JavaScript key는 공개 클라이언트 키이며 등록 domain에서 사용한다. REST key와 혼용하지 않는다.
등록 후보: 실제 Pages origin(프로젝트 path 제외), 커스텀 origin, 승인된 localhost 포트.
스크립트는 https://dapi.kakao.com/v2/maps/sdk.js?appkey=...&autoload=false&libraries=clusterer
한 번만 load, promise dedupe, kakao.maps.load 후 instance 생성, timeout+retry.
기본 지도 type은 SDK에서 확인한 ROADMAP, 필요 시 HYBRID. 'DARK' type을 추정하지 않는다.

## 지리
Kakao LatLng(lat,lng), Local REST x=lng/y=lat, GeoJSON coordinates=[lng,lat]. 단위/순서 테스트 필수.
전국 bounds에 제주·울릉·독도 표시 위치를 포함하며 시군구 행정코드 기반 집계와 법정동/행정동을 혼동하지 않는다.
주소 normalizer는 제공 주소를 우선, 없는 주소만 reverse geocode. 정규화가 geocoded 좌표로 원값을 덮지 않음.

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
