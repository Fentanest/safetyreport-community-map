---
name: cm-kakao-map
description: Integrate the real Kakao map SDK with exact coordinates, clusters, query scopes and accessible fallbacks.
---
# cm-kakao-map

## 읽기
kakao-map.md, ui-spec.md 지도 절, 공식 Kakao Guide/Docs의 해당 클래스.
## 실행
SDK single-load/timeout, domain/JS key 확인. LatLng(lat,lng)와 REST(x=lng,y=lat) 테스트.
Kakao 실제 cluster/overlay 생성, idle debounce/Abort, scope와selection 분리, resize relayout/cleanup.
현재 viewport 통계는 전체 조건 집계와 맞춘다. accessible list와 key-missing 오류 상태 제공.
## 출력
map adapter/tests, 실지도 screenshot·network evidence, attribution 검사.
## 금지
없는 DARK/Heatmap API 추정, tile invert/attribution 은폐, 모형을실지도라고 보고.
