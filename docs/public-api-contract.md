# 공개 읽기 API · 제안 계약
모든 경로명은 이 프로젝트의 구현 계약이다. 인증 전용 수정본의 운영 반영 상태는 `docs/reviews/edge-auth-2026-09-27.md`를 따른다.
base는 환경별 공개 URL. response projection은 fixed allowlist. 누가 읽을 수 있는지는 아래 §열람 조건(2026-09-27부터 공유자 전용).

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
| GET /public-analytics/points/:key | 한 지도 노드(주소 장소 또는 서버 묶음)의 요약 (구 경로, 호환 유지) |
| GET /public-analytics/places/:place_key | 주소 장소 상세: 요약(계도 포함) + 이 주소 신고만의 기관·담당자 전체 집계 (2026-09-29) |
| GET /public-analytics/places?view_bbox= | 지도 표시 정밀화 전용: 화면 안 주소 핀(통계 scope 불변) (2026-09-29) |

### 2026-09-29 대시보드 개편 추가 사항 (docs/implementation/dashboard-redesign)
- **주소 장소(grouping_version `address-v1`)**: 지도 점의 `key`는 이제 `pl1:<정규화 주소 64-bit 해시>`인 `place_key`다
  (`server/places.ts`). 같은 주소의 다른 좌표 신고는 핀 하나로 묶이고, 핀 위치는 그 주소 원천 좌표 중 결정적 규칙
  (최빈 좌표, 동률은 가장 작은 신고 identity)으로 고른 **표시용** 위치다. 원천 주소·좌표·identity는 바꾸지 않는다.
  점 응답에 `place_key`, `grouping_version`, `warning_count`(계도=`disposition='warning'`)가 추가됐다. 없으면 구 서버다
  (클라이언트는 0으로 보지 않고 '서버 미지원'으로 표시). 서버 묶음 노드(`aggregate:true`)의 모든 수는 구성원 합이고
  `point_count`는 구성 주소 수다.
- `dashboard` 응답 추가 필드: `analytics`(A01 duration·A02 heatmap·A03 scatter·A04 vehicle_days·A06 rating, 모두 같은
  완료일 cohort·같은 version), `map_unplaced`(`no_address`/`no_coordinates`별 신고·답변 수; 핀 합 + 사유별 합 = 전체).
  구 서버는 두 필드가 없거나 null이며 클라이언트는 빈 차트 대신 '서버 미지원'을 표시한다.
- `places/:place_key`: scope 파라미터 + `expected_version`. 좌표 bbox가 아니라 place_key로 모은다. 좌표가 하나도 없는
  주소와 없는 key는 404. 응답 `{place, agencies[≤100], managers[≤100], agency_total, manager_total}`.
- `places?view_bbox=w,s,e,n`: `view_bbox`는 이 경로에서만 허용되고 statistics scope(`bbox`)와 분리된다. 자동 통계 갱신이
  꺼져 있어도 서버에서 압축된 노드를 확대해 주소 핀으로 풀 수 있다(응답 scope.bbox는 그대로).
- `entities`의 `agency_type=police|non_police`: 서버 전체 목록에 적용되는 표 도구 조건(Scope 아님). 경찰은 기관명이 경찰
  조직일 때만, 비경찰은 registry 확인 기관(`inst:`) 또는 지자체·공사 이름일 때만이며 확인 불가 기관은 어느 쪽에도 넣지 않는다.
- 요청 정책(클라이언트 `src/data/refreshController.ts`): meta는 세션당 1회(409 때만 1회 재조회), 자동 지도 갱신은 500ms
  debounce·최소 간격 1.2초·분당 20회 예산, 429는 Retry-After 동안 중지 후 최신 범위만, 5xx/네트워크는 1회 지연 재시도.
  한 번의 논리 갱신은 `dashboard` 1회(+내 신고 비교가 켜져 있으면 `my-analytics` 1회). 기관표는 요약 상태에서는 dashboard
  행을 쓰고 검색·정렬·페이지·전체 보기에서만 `/entities`를 부른다.

공통 query: start/end(ISO date), category, region_code, agency_key, manager_key,
bbox=minLng,minLat,maxLng,maxLat, expected_version, metric별 result/disposition 조건.
`bbox`는 실제 지도 화면 좌표를 유지하므로 전국 축척에서 대한민국 외곽까지 확장될 수 있다.
API와 공유 URL은 유한한 세계 경도(-180~180)·위도(-90~90)와 순서를 검사하며,
범위 안의 국내 사실만 고른다. 원천 좌표를 자르거나 이동시키지 않는다.
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
400 INVALID_QUERY, 409 DATASET_CHANGED, 422 METRIC_UNAVAILABLE, 422 RESULT_TOO_LARGE, 503 AGGREGATE_NOT_READY.
2026-09-30 장기간(R1): 기간 길이 상한(구 1826일)은 API·집계·SQL RPC 모두에서 없앴다. 2014-09-30..2026-09-29 같은 12년 범위도
받는다. 역전·실제 없는 날짜만 400이다. 비교 기간(바로 앞 같은 길이)은 자료가 없어도 실패가 아니라 `previous: null`이다.
대신 한 번에 모으는 후보 신고가 10만 건을 넘으면 잘라 내지 않고 **422 RESULT_TOO_LARGE**(메시지: 기간·지역·분류를 좁혀 달라)로
거절한다(조용한 truncate 금지). `meta.data_min/data_max`는 운영자가 따로 넣지 않았으면 공개 가능한 신고의 최소·최대
신고일/완료일로 계산한다(‘전체 기간’ 빠른 선택의 근거). 클라이언트 오류 문구에는 `(코드, HTTP 상태)`를 붙인다.
`places/:place_key`는 `entity_limit`(1..1000, 기본 100)을 받는다. 기관·담당자 행을 그 수까지 보내고 총수는 `*_total`로 따로 준다.
dashboard `regions[]`는 최대 400행(시도+시군구 전부).
오류에 SQL/stack/private 요청값/원번호 포함 금지.
초기 cache 제안: overview/series 60초, detail/entities/vehicles 30초 이하, meta 30초.
삭제·version변경 시 invalidation 경로 구현. 헤더만 적어놓고 실제 CDN cache가 생긴다고 가정하지 않는다.

## 열람 조건 (2026-09-28 사용자 결정: 10건 이상 공유자 전용)
참여하는 사람이 모일 때까지 지도와 통계는 **카카오로 로그인했고, 신고 결과를 열 건 이상 지도에 공유한 사람만** 본다.
익명 공개 모드는 없다. `public-analytics`는 모든 통계 경로에서 사용자 세션과 공유 자격을 검사한다.

| 단계 | 규칙 |
|---|---|
| 신원 | 모든 경로(`meta` 포함)에 `Authorization: Bearer <지도 세션 access token>`. `getUser` + claims(sub·role·aud·iss·session_id·익명 여부) — `server/viewerAuth.ts`(my-analytics와 공용) |
| 자격 | `internal_analytics_viewer(검증된 user, session)`: 카카오 신원·세션 유효, 활성 기여자(공유 동의 미철회), **지도에 나가는 본인 고유 신고 10건 이상**(`public_fact_count`, 완료·활성 동의 계보, 같은 신고의 여러 dataset은 1건 — `report_identity` 기준). 10건 비교는 Edge 코드 상수 `MAP_VIEWER_MIN_REPORTS`에서 하며 구버전 SQL 응답(키 없음)은 거부한다. 개인 비교(`my-analytics`)의 `has_public_facts`는 1건 기준 그대로다 |
| 응답 | 공개 DTO 그대로. 헤더는 `Cache-Control: private, no-store, max-age=0`, `Vary: Origin, Authorization`, 허용 Origin만 에코(`ANALYTICS_ALLOWED_ORIGINS`, 없으면 `MY_ANALYTICS_ALLOWED_ORIGINS`) |
| 횟수 제한 | 검증된 사용자별(`ANALYTICS_RATE_SALT`로 가린 버킷) |
| 오류 | 401 `auth_required`·`session_expired`(`WWW-Authenticate: Bearer`), 403 `kakao_required`·`contributor_required`(동의 없음·철회·정지)·`upload_required`(10건 미만 — `details: {required: 10, current: N|null}`, 건수 모름은 null)·`origin_forbidden`, 인증 서버 장애 503. 거절 응답에는 통계·버전을 넣지 않는다 |
| 정적 파일 | Pages에 통계 snapshot(`data/…`)을 만들지 않는다(주소만 알면 받을 수 있으므로). 워크플로가 산출물에 `data/`가 없는지 검사 |

화면: 거절 코드면 대시보드 대신 안내 화면(`src/components/AccessGate.tsx`) — 로그인 버튼, 동의 필요, 업로드 필요(지금 N건 / 10건 진행 표시), 카카오 필요.
통계 요청은 지도 세션 토큰을 붙이고 401이면 한 번 갱신 후 다시 보낸다(`src/data/client.ts`). 증거: `scripts/integration/access_gate_e2e.mjs`.

## 현재 로컬 구현 상태

`server/publicHandler.ts`가 이 경로와 합성 `dashboard` 경로를 고정 라우팅한다. Supabase Edge
`supabase/functions/public-analytics/index.ts`는 service-role credential을 서버 안에서만 사용해
`internal_analytics_v2_*` RPC를 호출하고 고정 공개 DTO만 반환한다. base 설정값은
`https://<project>.supabase.co/functions/v1`이며 브라우저는 그 뒤에 `/public-analytics/...`를 붙인다.
현재 코드의 통계 응답은 철회/버전 무효화 전파를 우선해 `Cache-Control: private, no-store`다.
정적 snapshot은 공유자 전용 전환과 함께 쓰지 않는다(위 §열람 조건). 운영에서 v2 사실이 준비되지 않으면 meta capability는 missing,
집계 경로는 503을 반환한다. 운영 `public-analytics` v5는 사용자 JWT를 요구하고 익명 `meta`는 401이다.
지도는 현재 bbox로 범위를 좁히고 표시 노드를 1,000개 이하로 묶는다. 별도 `zoom/resolution`과
result/disposition 조건은 아직 구현되지 않아 `INVALID_QUERY`를 돌려준다.
기관·담당자 표(2026-09-26 감사 SOL-08): dashboard 의 `agencies`/`managers` 는 상위 100행 요약이고,
표는 `/entities` 로 **전체**를 조회한다. `/entities` 는 하위호환으로 `q`(기관·성명 부분 일치, 160자 이하),
`sort`(`completed`·`accepted`·`partial`·`rejected`·`fine`·`acceptRate`), `dir`(`asc`·`desc`)를 받는다. 셋 다 없으면
예전 순서 그대로이고 응답 필드는 바뀌지 않았다. 다른 경로에 이 인자를 주면 400.
지도 점(SOL-06): 신고일 위치와 완료일 위치의 합집합이며 점마다 신고 건수(신고일 기준)와 완료 건수(완료일 기준)를 따로 센다.
`overview.point_count` 는 신고일 기준 위치 수 그대로다(basis `report_date`) — 완료일만 범위에 든 위치는 지도 점에는 있지만 이 지표에는 없다.
`location_missing`(SOL-07): 현재 범위의 신고일 또는 완료일 지표에 실제로 들어간 고유 fact 중 좌표 없는 것(비교 기간만 속한 fact 제외, 한 번만).

지역 행(2026-09-27): `dashboard`에 `regions[]`(최대 300행)를 추가했다. 같은 날 공식 코드로 바꿨다:
`{level: 'sido'|'sgg'|'unknown', region_code: '11'|'11140'|null, name, sido_code, report_count(신고일), completed_count·outcomes·fine_count(처리완료일), duration?, fine_amount?}`.
`region_code` 조건은 2자리 시도 또는 5자리 시군구(2026-07-01 법정 코드, 시도는 하위 시군구 포함). 옛 표시 키(`서울 중구`)는 모호하지 않으면 변환, 아니면 400.
지도 점의 `region_code`는 5자리 시군구 코드 또는 null. 규칙·출처: docs/region-boundaries.md.
필드가 없으면 클라이언트는 '미제공'으로 표시하고 빈 목록으로 바꾸지 않는다.

기간·금액(2026-09-27): `overview.processing_duration`(basis, count, mean/median/p90/min/max_days, excluded{no_report_date, reversed}, answer_date_missing),
`overview.fine_amount`(basis, fine_count, confirmed_count, sum_won, mean_won, median_won, zero_count, unconfirmed/undisclosed/conflict/penalty/combined_count, partial).
월·기관·담당자·지역 행에는 요약 `duration{count, median_days, mean_days}`, `fine_amount{fine_count, confirmed_count, sum_won, mean_won}`. 정의: docs/metrics-catalog.md.
개별 신고의 금액·기간은 내보내지 않는다. 두 필드는 선택(optional)이라 예전 응답도 schema를 통과한다.
위반법규(2026-09-28): 공통 query `law` = 위반법규(1..80 코드포인트, C0 제어문자·DEL 불가) 또는 `__none__`(법규 미상 = null).
서버가 **조 단위 키**(`lawKey`, 항 제외)로 바꿔 비교하고 `scope.law`로 그 키를 되돌려 준다(없으면 null). 빈 값·공백뿐·81자 이상·제어문자·반복 인자는 400. 필터는 `server/aggregate.ts`에서 적용한다(SQL 인자 없음, 지역과 같음) —
신고일·처리완료일 지표, 지도 점, 기관·담당자·지역·월·차량 모두 같은 법규로 좁혀진다. `dashboard`에 `laws[]`(최대 300행, 행 = 조 단위 키):
`{law|null, completed_count, outcomes, accept_rate, partial_rate, fine_count, fine_rate, penalty_count, warning_count, fine_amount{fine_count, confirmed_count, sum_won, mean_won}}`,
처리완료일 기준, 답변 많은 순 → 법규 이름 순(법규 미상은 같은 건수에서 뒤). meta capability `violation_law`(coverage = 법규 있는 답변/C). 정의: docs/metrics-catalog.md §위반법규별 현황.
`laws`는 선택(optional) 필드라 예전 응답도 schema를 통과한다. `my-analytics/compare`도 같은 `law`를 받는다(같은 parser).
이 API는 개인 비교를 제공하지 않는다. 로그인 사용자의 비교는 별도 `my-analytics/compare`(docs/personal-comparison.md §3)다.

## 숫자 별점 공개(2026-09-28)
공개 fact projection의 `rating`은 정책 공개 플래그가 참인 계보에서만 1..5이고, 그 밖은 null이다. API는 숫자 자체를 행 단위로 외부에 보내지 않고 완료일 cohort의 `rating: {count, mean}` 집계만 반환한다. .1/.2 동의만으로는 공개하지 않는다. 기관·담당자·지역·법규·월·개인 비교는 같은 필터와 분모를 쓴다. 별점사유는 payload·DB fact·API에 없다.
