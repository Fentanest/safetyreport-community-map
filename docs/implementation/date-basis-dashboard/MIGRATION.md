# single-date-v1 · 적용 순서와 되돌리기

운영 DB·Edge·Pages 적용은 **별도 승인 전에는 하지 않는다.** 이 문서는 준비물과 순서다.

## 바뀌는 계약
| 구분 | 이전 | 이후 |
|---|---|---|
| 신고 묶음 | 신고 지표는 신고일, 처리 지표는 답변일로 따로 선택 (두 묶음) | `date_basis`(신고일 또는 답변일) **하나**로 고른 묶음에서 모든 값 |
| 대표 선정 | 기간으로 먼저 잘린 행 안에서 선정 (옛 답변 재승격 가능, D13) | 신고 identity 의 전체 이력에서 최신 답변 대표를 먼저 정하고, 대표의 선택 날짜로 기간 판정 |
| 직전 기간 | 모든 요청이 직전 기간까지 읽음 | 비교를 보여 주는 경로(dashboard, overview, 주소 상세)만 |
| 행 예산 | 전국 날짜 범위 전체를 먼저 셈 | SQL에서 거를 수 있는 조건(분류·기관·담당자·bbox)을 적용한 후보로 셈 |
| 응답 | `cohort_policy_version` 없음 | 모든 분석 응답에 `cohort_policy_version: "single-date-v1"`, `scope.date_basis` |
| 기간 검사 | 자료 범위 밖이면 400 | 올바른 달력 날짜면 0건 |
| 정렬 | `/entities?sort=` 한 값 | `sort`+`sort_value`+`dir` (src/domain/tableSort.ts), 새 `/laws` |

## 순서 (권장)
1. **DB**: `supabase/migrations/202610010100_single_date_cohort.sql` 적용. 새 함수 3개만 추가하고 옛 함수는 그대로 둔다
   (`internal_analytics_cohort_facts`, `internal_analytics_cohort_state`, `internal_my_analytics_cohort_source`, service_role 전용).
   옛 Edge 는 옛 함수로 계속 동작한다. 로컬 Postgres 17 검증: `tests/integration/date-basis-sql.test.ts` (evidence 참고).
2. **Edge**: `public-analytics`, `my-analytics` 배포. 새 Edge 는 새 함수만 부르고 `date_basis` 가 없는 요청을 답변일로 읽는다.
   이 사이에 **옛 Pages** 는 `date_basis` 없이 요청하므로 답변일 묶음 값을 받는다(옛 화면은 신고 건수 칸에 답변일 묶음 N 을 신고일 라벨로
   보여 준다 — Pages 배포까지의 짧은 구간, 알려진 표시 차이).
3. **새 계약 확인**: `/meta` 의 `basis_bounds`, `/dashboard` 의 `cohort_policy_version` 을 실제 계정으로 확인.
4. **Pages**: 새 클라이언트는 `cohort_policy_version` 이 없으면(옛 Edge) 통계를 보여 주지 않고 안내한다(EX-09). 그러므로 반드시 Edge 뒤.
   main 병합이 Pages 배포를 부르면(publish-pages.yml 은 수동 실행) 2 → 3 확인 뒤에 실행한다.
5. **실기기**: 실제 카카오 SDK·두 테스트 계정으로 신고일/답변일 전환, 주소 핀 선택/해제, 정렬, 엑셀을 한 번씩.
6. **정리(나중에, 별도 승인)**: 새 Edge 가 안정된 뒤 옛 `internal_analytics_v2_facts`·`internal_my_analytics_source` 를 새 migration 에서 drop.

## 되돌리기
- Pages: 이전 빌드 재배포.
- Edge: 이전 배포로. 옛 함수가 남아 있으므로 DB 는 그대로 둬도 된다.
- DB: `drop function public.internal_analytics_cohort_facts(text, date, date, boolean, text, text, text, text, double precision[]);`
  `drop function public.internal_analytics_cohort_state();`
  `drop function public.internal_my_analytics_cohort_source(uuid, uuid, text, date, date, boolean, text, text, text, text, double precision[]);`
  (테이블·자료 변경 없음)

## 저장된 설정·링크 이관
- 옛 지도 링크(`date_basis` 없음) → 답변일로 열고 주소창을 `date_basis=completed_date` 로 한 번 고친다.
- 옛 레이아웃 인자 `view=map|stats|both` → 무시하고 주소창에서 뺀다(다른 인자는 유지).
- 맞춤 통계 공유 링크 v1·저장 구성의 `spec.date_basis` → 그 값을 그대로 조회 기준으로 쓴다(신고일 구성은 신고일 그대로).
- 계정별 날짜 기준 저장: `localStorage['cm-date-basis']` (계정 해시 키, 서버로 보내지 않음). 복원 순서: URL/링크/인계 > 저장 > 기본(답변일).
