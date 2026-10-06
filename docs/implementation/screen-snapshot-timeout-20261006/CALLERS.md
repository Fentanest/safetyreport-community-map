# r3 호출자 전수 확인

2026-10-06, HEAD 3731126 + 미커밋 후보. `rg`로 supabase/server/src/scripts/tests를 검색하고,
로컬에 선행 migration과 후보를 transaction으로 적용한 `pg_proc.prosrc`도 검사했다.
`DROP FUNCTION`은 CASCADE를 쓰지 않는다. 미등록 view/SQL 의존성이 있으면 migration 전체가 실패한다.
이름/인자/기본값은 유지하고 cohort_facts, read_snapshot, my_analytics_cohort_source 반환형을 jsonb → json으로 바꾼다.

| 실행 호출자 | 호출/사용 | 판정·조치 |
|---|---|---|
| `private.analytics_cohort_payload` | 전송 원천 | json_agg + json_build_array/object, json 반환. 큰 값 jsonb 캐스트 없음 |
| `public.internal_analytics_cohort_facts` | private helper, compact=false | json 반환, 기존 객체 배열 유지 |
| `public.internal_analytics_read_snapshot` | helper, state, viewer, rollup | data json / json_build_object. 작은 state/viewer/options만 jsonb 유지 |
| `public.internal_my_analytics_cohort_source` | cohort_facts | CASE의 빈 배열도 json, 외부 포장 json. 반환형 변경과 권한 복원. 개인 gate는 기존 그대로 |
| `public.internal_analytics_rollup` (`040300`) | private.analytics_rollup_source (`060500`) | cohort RPC에 의존하지 않음. 4종 rollup 및 snapshot 분기 동등성 실행 |
| `public.internal_user_rankings` (`060600`) | private.ranking_representatives (`060200`), viewer | cohort/snapshot 호출 없음. 전체 페이지+내 순위 실행, 변경 없음 |
| `internal_analytics_cohort_state`, `internal_analytics_v2_state`, `internal_analytics_viewer` | 소형 메타데이터 | 입력/반환형 불변 |
| `supabase/functions/public-analytics/index.ts` | getSnapshot → read_snapshot, getFacts → cohort_facts; getRollup → rollup | JSON 파싱 뒤 객체/배열만 사용. 키 순서/문자열 서명/SQL jsonb 연산 없음. 수정·재배포 불필요 |
| `supabase/functions/my-analytics/index.ts` → `server/screenHandler.ts` | read_snapshot, columns-v1 요청 | r2 decoder 유지. 옛 SQL 객체 배열도 수용. my-analytics 재배포 필요 |
| 같은 Edge → `server/personalHandler.ts` | my_analytics_cohort_source | 객체 state/viewer/facts 사용, 수정 불필요. 개인 응답 완전 패리티 실행 |
| `supabase/functions/user-rankings/index.ts` → `server/rankings/handler.ts` | internal_user_rankings | 변경 함수와 무관. 재배포 불필요 |
| `src/data/client.ts`, screen coordinator, personal/rankings clients | 위 Edge의 공개 DTO | private SQL 전송 형식에 접근하지 않음. 기존 r2 deadline/오류 처리만 반영 |
| PC/모바일 앱 API `my-reports`, ingest, account, relay | 별도 RPC | 변경 함수 호출 없음. 원천 앱/서버 저장소는 수정하지 않음 |

호환성 이유: SQL을 먼저 배포해도 기존 Edge는 JSON 객체 배열을 받아야 한다. 따라서 columns-v1은 screen의
명시적 옵션으로만 켠다. 새 Edge + 구 SQL도 객체 배열을 읽을 수 있어 역순 롤백이 가능하다.
SQL 타입을 jsonb로 유지하는 호환 래퍼는 대용량 재변환 병목을 되살리므로 만들지 않는다.
외부 계약은 JSON 값의 의미이고 내부 객체 키 순서·공백·숫자 인쇄 문자열 동일성은 아니다.

## 검사·도구 호출자

- `tests/integration/screen-transport.test.ts`: 새 타입/ordered array/48 범위/개인/rollup/rankings/ACL/롤백/SQL caller catalog.
  비교에만 `::jsonb` 사용. native json을 Node에서 파싱하는 검사도 있어 비교 전 정규화로 문제를 숨기지 않는다.
- `screen-handler-measure.test.ts`: 실제 SQL 합성 응답을 JSON.parse → decoder → 공개 handler로 재생, 전체 DTO deep equality.
- `date-basis-sql.test.ts`, `snapshot-contract.test.ts`: 설치된 최신 함수에 jsonb_array_*를 쓰는 검사 위치에 명시적 캐스트 추가.
  이 두 전체 설치형 suite는 r3에서 실행하지 않음(현 로컬 ledger는 040800). 동일 의미의 candidate 검사는 rollback-only suite로 실행.
- `analytics-rollups.test.ts`, `analytics-rollup-measure.test.ts`: JSON.parse 혹은 text 길이, 타입 의존 없음.
- `cohort-timeout.test.ts`, `scripts/benchmark/cohort_timeout.py`: **과거 010100→060100 성능/패리티** 검증으로 자체 기준 migration을 설치.
  그 frozen jsonb 비교를 새 타입 검사로 임의 변경하지 않음. 동률 배열 실패를 REPORT에 기록.
- `scripts/query-audit/benchmark.py`: 과거 감사 baseline 재현, jsonb 지역 변수의 비교는 타입 변환 가능. r3 성능 근거로 사용하지 않음.
- `scripts/benchmark/screen_snapshot_timeout.py`: timed result/source 변수를 json으로 변경. 새 값을 jsonb 지역 변수에 대입해
  제거한 비용을 다시 측정하지 않음. jsonb 기준 함수의 text 직렬화 비용은 실제 전송과 같이 포함. parity 정규화는 타이머 밖.
- `tests/product/screenSnapshot.test.ts`, personal/public/ranking handler suites: 파싱된 JS DTO를 검사, compact/legacy/error 경계 유지.
- `migration-manifest.json`: 미배포 060700의 SHA-256 갱신, 060600 의존성, my-analytics의 screenFacts 공유 파일 등록 유지.
- 과거 `010100/060100/060200/060600` migration은 동결. 새 060700에서 세 public 함수의 반환형·소유자·ACL을 원자적으로 교체.

## 다른 jsonb 생성 경로 (목록만)

| 경로 | 크기/용도 | 이번 판단 |
|---|---|---|
| `060200 internal_analytics_v2_facts` + `internal_my_analytics_source` | 구 날짜 합집합 facts와 jsonb 재포장 | 현재 screen/personal handler는 cohort를 사용. legacy 의미 변경 없이 그대로 둠 |
| `040300 internal_analytics_rollup` | 집계된 기관/담당자/법규 페이지≤100; 월별 series; manager 전체 names 목록 | 화면 screen은 JS 집계 사용. 별도 endpoint 병목 실증 없음, 변경 안 함 |
| `060600 internal_user_rankings` | 사용자별 rows 표현, 페이지≤50 + me; 후보는 전체 사용자 수 | raw fact 1.6만 행 JSON과 다름. 이번 화면 실패 경로 아님, 변경 안 함 |
| `060200 state/cohort_state/viewer` | 단일 메타 객체·bounds·gate | 큰 facts 포장 없음, 유지 |
| `060700 personal cohort wrapper` | 큰 facts를 감싸는 현 개인 비교 경로 | 타입 호환 수정에 포함, json 포장으로 함께 해결 |

운영 설치 catalog와 PostgREST schema cache 상태는 배포 담당 총괄이 다시 확인한다. 이 세션은 운영에 접속하지 않았다.
