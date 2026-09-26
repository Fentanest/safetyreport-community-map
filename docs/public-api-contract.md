# 공개 읽기 API · 제안 계약
모든 경로명은 이 프로젝트가 구현해야 할 계약이며 이미 배포돼 있다고 가정하지 않는다.
base는 환경별 공개 URL. 비로그인 GET, response projection은 fixed allowlist.

## 경로
| 경로 | 용도 |
|---|---|
| GET /public-analytics/meta | version, coverage, capabilities, available date bounds, dictionaries |
| GET /public-analytics/dashboard | 첫 화면용 overview/map/series/entities/TOP5 합성 응답. 같은 버전·scope에서 한 번만 집계 |
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
기관/담당자 행은 표시용 `key`와 조회 필터용 `agency_key`, `manager_key`를 분리한다.
담당자 행을 선택하면 해당 기관 키와 담당자 키를 함께 전달한다. 키가 없는 미상 행은
필터 버튼을 비활성화하고 해당 1건 표본 자체는 계속 표시한다.
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

## 현재 로컬 구현 상태

`server/publicHandler.ts`가 이 경로와 합성 `dashboard` 경로를 고정 라우팅한다. Supabase Edge
`supabase/functions/public-analytics/index.ts`는 service-role credential을 서버 안에서만 사용해
`internal_analytics_v2_*` RPC를 호출하고 고정 공개 DTO만 반환한다. base 설정값은
`https://<project>.supabase.co/functions/v1`이며 브라우저는 그 뒤에 `/public-analytics/...`를 붙인다.
현재 응답은 철회/버전 무효화 전파를 우선해 `Cache-Control: no-store`다. 공개 정적 snapshot은
meta version이 같은 경우에만 읽는다. 운영에서 v2 사실이 준비되지 않으면 meta capability는 missing,
집계 경로는 503을 반환한다. 이 코드는 아직 운영 DB·Edge에 배포되지 않았다.
지도는 현재 bbox로 범위를 좁히고 표시 노드를 1,000개 이하로 묶는다. 별도 `zoom/resolution`과
result/disposition 조건은 아직 구현되지 않아 `INVALID_QUERY`를 돌려준다.
기관·담당자 표(2026-09-26 감사 SOL-08): dashboard 의 `agencies`/`managers` 는 상위 100행 요약이고,
표는 `/entities` 로 **전체**를 조회한다. `/entities` 는 하위호환으로 `q`(기관·성명 부분 일치, 160자 이하),
`sort`(`completed`·`accepted`·`partial`·`rejected`·`fine`·`acceptRate`), `dir`(`asc`·`desc`)를 받는다. 셋 다 없으면
예전 순서 그대로이고 응답 필드는 바뀌지 않았다. 다른 경로에 이 인자를 주면 400.
지도 점(SOL-06): 신고일 위치와 완료일 위치의 합집합이며 점마다 신고 건수(신고일 기준)와 완료 건수(완료일 기준)를 따로 센다.
`location_missing`(SOL-07): 현재 범위의 신고일 또는 완료일 지표에 실제로 들어간 고유 fact 중 좌표 없는 것(비교 기간만 속한 fact 제외, 한 번만).
