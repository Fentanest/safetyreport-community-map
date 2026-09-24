# 공개 읽기 API · 제안 계약
모든 경로명은 이 프로젝트가 구현해야 할 계약이며 이미 배포돼 있다고 가정하지 않는다.
base는 환경별 공개 URL. 비로그인 GET, response projection은 fixed allowlist.

## 경로
| 경로 | 용도 |
|---|---|
| GET /public-analytics/meta | version, coverage, capabilities, available date bounds, dictionaries |
| GET /public-analytics/overview | 선택 범위 KPI + 기준·분모·비교값 |
| GET /public-analytics/map | zoom/bbox에 맞는 clusters 또는 exact points |
| GET /public-analytics/series | 일별/월별 report/completed/fine/results |
| GET /public-analytics/entities | agency 또는 manager의 정렬·pagination 결과 |
| GET /public-analytics/vehicles/top | 전체 조건 후보 집계 후 masked TOP5 |
| GET /public-analytics/points/:key | 한 위치의 안전한 상세 집계 |

공통 query: start/end(ISO date), category, region_code, agency_key, manager_key,
bbox=minLng,minLat,maxLng,maxLat, expected_version, metric별 result/disposition 조건.
지도 표시 옵션: zoom/resolution. SQL identifier/raw filter expression을 인자로 받지 않는다.
region과 bbox를 동시에 사용하면 교집합임을 response.scope에 명시한다. point 선택은 별도의 detail_scope로 main scope를 덮지 않는다.

## 예시 응답 구조
```json
{
  "schema_version": 2,
  "dataset_version": "sample-v2",
  "sample": true,
  "scope": {"start":"2026-01-01","end":"2026-08-31","region_code":null},
  "time_basis":"completed_date",
  "timezone":"Asia/Seoul",
  "coverage":{"eligible":3120,"missing":12},
  "metrics":{"accepted_rate":{"value":65.4929577465,"unit":"percent","numerator":1860,"denominator":2840}},
  "generated_at":"2026-09-01T00:00:00Z"
}
```
기관/담당자명 XSS 방지: textContent/React text로 렌더; arbitrary HTML 금지.
차량 응답은 contracts/public-vehicles.schema.json과 일치. 공개 rank_item_id는 응답 내 위치 구분값이지 원본 ID 아니다.

## 정확성과 취소
- count는 전체 query 결과, pagination은 보여줄 rows만. 페이지 합계를 전체 통계로 쓰지 않는다.
- totals와 response schema를 validate. 누락 필드=0이라는 fallback 금지.
- scope canonical serialization으로 query_key 생성. theme/panel UI만 바뀔 때 데이터 재조회 금지.
- 한 filter 변경은 모든 panel의 version/scope를 동기화; network 오류 panel은 이전 context stale label로 남길 수 있다.
- 동명 기관은 id/name 둘 다 처리. 클라이언트 정렬은 현재 page만 정렬하는 척하지 않는다.

## 제한·오류
기간은 meta.data_min~data_max 범위 지원. 넓은 범위 쿼리는 서버 집계로 처리하고 조용한 truncate 금지.
기관/담당자 page_size<=100, vehicle limit=5 fixed, map node budget 별도. 429는 retry-after.
400 INVALID_QUERY, 409 DATASET_CHANGED, 422 METRIC_UNAVAILABLE, 503 AGGREGATE_NOT_READY.
오류에 SQL/stack/private 요청값/원번호 포함 금지.
초기 cache 제안: overview/series 60초, detail/entities/vehicles 30초 이하, meta 30초.
삭제·version변경 시 invalidation 경로 구현. 헤더만 적어놓고 실제 CDN cache가 생긴다고 가정하지 않는다.
