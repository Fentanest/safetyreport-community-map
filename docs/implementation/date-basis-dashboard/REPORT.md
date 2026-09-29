# date-basis-dashboard · 구현 보고 (single-date-v1)

- 코드 SHA: **`0c1473f`** (브랜치 `claude/gallant-darwin-7ldkbl`, push 완료). 증거는 이 SHA의 깨끗한 작업 트리에서 만들었고
  `evidence-0c1473f/` 에 있다(증거 커밋은 이 보고서를 담은 다음 커밋).
- main 병합·운영 DB·Edge·Pages 배포: **하지 않음**(별도 승인 필요, 순서는 `MIGRATION.md`).
- `fixtures/cohort-oracle.json`: 정본 패키지 파일이 세션에 없어서 ACCEPTANCE_TESTS 의 oracle 사실(A–E, 중앙값 30/41, D 공동 신고, 정렬
  oracle)로 새로 썼다. 문서에 없는 값(상태·처분·장소·F/G 행)은 구현자가 정했고 파일 안에 그렇게 적었다.

## 실행 환경과 결과 (모두 `0c1473f`)
| 검사 | 환경 | 결과 | 증거 |
|---|---|---|---|
| 단위·계약 | Node vitest (oracle 37 + 핸들러 10 포함) | 513/513 | `unit.log` |
| 빌드·공개 번들 검사 | `npm run build`, `npm run scan`, python unittest | 통과 / issues 0 / 12 OK | `build.log`, `scan.log`, `pytest.log` |
| SQL | **로컬 Postgres 17**(Supabase 로컬 스택), 새 migration 실제 적용 | 11/11 | `sql-postgres17.log` |
| Edge | **Deno CLI 로 띄운 두 함수**(deno-local, edge-runtime 컨테이너 아님) + 실제 로컬 DB | 13/13 | `edge-deno-local.log` |
| 브라우저(신규) | Chromium + **MOCK 카카오 SDK** + 로컬 Vite(서버 핸들러는 Node) | 40/40 | `browser-date-basis/` |
| 브라우저(회귀) | 같은 환경 | 맞춤통계 60/60, 마감 51/51 | `browser-scope-statistics/`, `browser-finalization/` |
| 스크립트 자가검사 | 일부러 틀린 기대값 | exit 1 (정상) | `selftest.log` |
| 수정 전 재현 | `de54876` 코드에 oracle 투입 | 신고 A/C/E + 결과 B/C/D 혼합 확인 | `before-de54876-membership.json` |

맞춤통계 회귀 첫 실행은 컨테이너 재시작으로 브라우저가 닫혀 W-OVERFLOW 1건이 FAIL 로 끊겼다(`*.interrupted-by-container-restart.log`).
같은 SHA로 다시 돌려 60/60.
재시작 뒤 다시 돌린 맞춤통계·마감·자가검사 run 파일은 `working_tree_dirty: true` 로 적혀 있다. 그때 추적되지 않은 파일은 이 증거 폴더와
검사가 만든 `docs/.verify-dist/`(정적 빌드)뿐이었고, `git diff 0c1473f HEAD -- src server supabase scripts tests` 는 비어 있다
(코드 변경 없음). 컨테이너 재시작으로 멈춘 것: 로컬 Supabase 스택·Deno 함수·모의 카카오 서버 — SQL·Edge 결과는 재시작 전에 끝난 것이다.

실행하지 못함: 실제 카카오 SDK(NOT_RUN), Supabase edge-runtime 컨테이너(BLOCKED — 이 환경에서 npm 받기 실패, 이전 라운드와 동일),
Microsoft Excel·LibreOffice로 이번 파일 열기(NOT_RUN), 실제 브라우저 확대 125/150/200%(NOT_RUN), 운영 DB·운영 화면(범위 밖).

## U01–U05
| ID | 판정 | 변경과 연결 | 증거 |
|---|---|---|---|
| U01 날짜 기준 하나 | **PASS** (로컬) | `Scope.date_basis` → `server/aggregate.ts selectScope`(대표의 선택 날짜 하나) → 모든 경로·SQL `internal_analytics_cohort_facts` → Zod(`cohort_policy_version` 필수) → `CommandBar` 선택기(바로 적용, 1회 요청)·`FilterDrawer`(draft, 적용 1회, 다시 열면 초기화) → URL/공유/계정별 저장/맞춤통계 인계/엑셀 조건 | DT-01~16, EX-03/10/11 |
| U02 지도 위 주요 통계 | **PASS** (로컬) | `KpiPanel` 한 줄 스트립(내부 가로 스크롤, 1440px 높이 90–130px), `/places/{key}` 에 `overview`(대시보드와 같은 `overviewOf`), 핀 선택·해제·Esc, 늦은 응답 차단, 하단 표는 적용 범위 표시 | KP-01/02/05/06/07/12 |
| U03 복합 열 정렬 | **PASS** (기관·법규) / 개인 지표 정렬 **NOT_IMPLEMENTED** | `src/domain/tableSort.ts` 레지스트리(정확한 분수 비교, 계산 불가는 항상 마지막), `/entities` `sort_value`, 새 `/laws`, `SortHeader` 메뉴 | SO-01/02/03/06/07/09/10/13 |
| U04 레이아웃 전환 제거 | **PASS** | `ViewMode`·버튼·`data-view` CSS 삭제, 옛 `view=` 주소 정리(다른 인자 유지), 관심지역·비교·맞춤통계 표/그래프 유지 | LY-01/02/03 |
| U05 표를 차트 위로 | **PASS** | DOM: KPI → 지도/상세 → 법규 \| 기관 → 월별 \| 처리기간 → 나머지; `SPY_SECTIONS`·Rail 순서 | LY-05/06/08/10 |

## D01–D17
| ID | 판정 | 근거 |
|---|---|---|
| D01 이중 집합 | 수정 PASS | 수정 전 재현(A/C/E vs B/C/D 혼합) → 수정 후 한 묶음(단위·SQL·브라우저) |
| D02 지도 숨김·주소 수 | 수정 PASS | `hiddenNote` 분기 삭제, 주소 수 = 주소 distinct(묶음 점의 point_count 합) — MP-01; 확대 불변(MP-03)은 NOT_RUN |
| D03 KPI 혼합 | 수정 PASS | 같은 `overviewOf`, 참여자 = 선택 신고의 모든 기여 계정 |
| D04 지역 목록 | 수정 PASS(단위) | `regionRows(cohort, done)` 한 묶음; 브라우저 hover 는 NOT_RUN |
| D05 주소 요약 | 수정 PASS | `focusSelection` + `overviewOf`, 주소 담당자 차트 같은 묶음 |
| D06 내 0건·내 장소 | 수정 PASS(단위) | 내 신고도 identity 대표 날짜로 소속, `my_points` 같은 묶음 |
| D07 차량 | 수정 PASS(단위) | TOP5·반복일 같은 묶음, 반복일은 원 신고일 |
| D08 월별 | 수정 PASS | 선택 기준 월로 건수·결과 함께, 카드 제목 신고월/답변월 |
| D09 맞춤 통계 날짜 | 수정 PASS | 인계 시 `report_month`/`completed_month`+기준, 다른 날짜 축은 `other_date` 로 표시 |
| D10 늦은 정밀 핀 | 수정 PASS(MOCK) | 표시 snapshot 키(범위·기준·계정·버전·모드)+세대 검사, 대기 타이머 취소 — MP-05/06(1,100 주소 합성 자료) |
| D11 결측 중복 | 수정 PASS(단위) | 현재 기간 진단만, 전체/내 따로(`selected_date_missing{all,mine}`) |
| D12 부분 월·최근기간 | 수정 PARTIAL | 오늘(KST)/자료 최신/구간 분리·`최근 N일`=오늘까지(단위 DT-17/18), 카드 비고 표시; 브라우저에서 부분월 라벨 확인은 NOT_RUN |
| D13 대표 선정 순서 | 수정 PASS(실제 Postgres) | 새 SQL은 전체 이력에서 대표 선정 후 날짜 판정; 옛 함수가 8월 옛 답변을 대표로 되살리는 것도 같은 DB에서 재현 |
| D14 비교 조회 부하 | 수정 PASS | 비교 경로만 직전 기간 읽음, 행 예산은 거른 후보로 셈(100,001행 트랜잭션: 전국 거절·좁은 기관 통과) |
| D15 nullable 날짜 | 수정 PASS | 선택 날짜 결측 = 진단, 다른 날짜 결측 = 해당 지표만 제외(E: 신고일 기준 포함) |
| D16 문서·저장·엑셀 | 수정 PASS | 계약·지표 사전·제품 결정·MIGRATION, 공유·저장·엑셀 조건 시트 |
| D17 날짜축 공백 | 수정 PASS(단위)/PARTIAL(화면) | 월별·맞춤통계 calendar spine(0 / null / no_data / 명시 선택), 엑셀 월 열 |

## 인수 항목 99개
PASS 판정은 표시된 환경에서만이다(MOCK·Node 핸들러는 실제 SDK·Edge·운영 통과가 아님).

- **PASS**: DT-01~11, DT-13~16, AG-01~05, AG-07~10, AG-12, MP-01, MP-04~07, MP-11, MP-12, KP-01~03, KP-05~07, KP-12,
  SO-01~03, SO-06, SO-07, SO-09, SO-10, SO-13, LY-01~06, LY-08~10, EX-01, EX-03~10, EX-13~15 (EX-13~15 는 회귀 마감 스위트)
- **PARTIAL**: DT-12(단위만), DT-17, DT-18(단위만), DT-19(공개 적격 필터는 그대로지만 전용 검사 없음), AG-06, AG-11(SQL은 통과,
  화면 유지·재시도는 미검사), AG-13(Deno CLI, edge-runtime 아님), MP-02, MP-03, KP-04, KP-13(N=C 경로만 화면 확인), SO-04, SO-05, SO-08,
  SO-11, LY-11(5폭×2테마 통과, 실제 확대율 NOT_RUN), EX-02, EX-11(조건 시트 확인, 갱신 중 다운로드는 이번에 다시 안 봄), EX-12
- **NOT_RUN**: AG-14, MP-08, MP-09, MP-10, KP-08, KP-09, KP-10, KP-11, KP-14, LY-07
- **NOT_IMPLEMENTED**: SO-12(개인 지표 정렬을 메뉴에 넣지 않음 — 상위 50 비교행으로 전체 순위를 만들 수 없어서), SO-14(기관·법규 표의
  엑셀 내보내기 자체가 아직 없음)
- **BLOCKED**: 실제 edge-runtime 컨테이너 기동(이 환경에서 npm 다운로드 실패)

## 계약 요약
- 요청: 모든 경로 `date_basis=report_date|completed_date`(없으면 답변일, 틀리면 400). 맞춤통계는 scope 와 spec 기준이 다르면 400 `BASIS_CONFLICT`.
- 응답: `scope.date_basis`, `cohort_policy_version: "single-date-v1"`(없으면 새 화면이 표시 거부), `meta.basis_bounds`·`today_kst`,
  `overview.cohort{selected_date_missing, other_date_missing}`, 월별 `interval_start/end, range_partial, in_progress`.
- 정렬 키: `sort ∈ {completed, accepted, partial, rejected, fine, warning, penalty, duration, amount, rating}`,
  `sort_value ∈ {count, rate, median, sum, mean}`(열마다 허용 값 고정), `dir ∈ {asc, desc}`. 수용·일부·불수용 비율 분모 K, 과태료·계도·범칙금 분모 C.
- 주소 포커스 필드: N, C, K, A/P/R, F·W(분모 C), 처리기간(중앙값·계산 건수·결측 사유), 확인 금액, 평균 별점·평가 수, 장소 수, 참여자 수, 직전 기간 비교.

## 이번에 찾은 추가 결함
- 내 신고 비교 응답 스키마가 월별 80행으로 막혀 6.6년이 넘는 기간(전체 기간 허용 이후)의 비교가 실패했다 → 2,400행으로 올리고 12년 단위 검사 추가.

## 남은 일 (승인 필요)
1. 운영 DB에 `202610010100_single_date_cohort.sql` 적용 → 2. Edge 배포 → 3. 새 계약 확인 → 4. Pages → 5. 실제 SDK·두 계정 점검
(`MIGRATION.md`). 옛 함수 drop 은 그 뒤 별도 migration. main 병합용 PR 은 요청 시 만든다.
