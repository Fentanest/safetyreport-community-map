# 지도·통계·랭킹 성능 리팩터링 — 로컬 실행 보고

후속 사용자 승인으로 실제 배포를 수행했다. 이 문서는 최초 로컬 종료 기록이며 [현재 운영 적용 상태](../../implementation/map-performance-release-20261004/REPORT.md)를 참조한다.

2026-10-04 KST. 기준 `cf9009666a164ca91f694fd5a4164bffbe29ef0b`, 작업 branch `refactor/map-performance-20261003`.
사용자 untracked 실행 지시문과 기존 변경을 보존했다. **로컬 구현과 검증을 수행했으며 운영 적용은 하지 않았다. 성능 목표 전체 달성으로 판정하지 않는다.**
계획·감사 경로는 [PLAN](PLAN.md), [기능 보존표](FEATURE-MATRIX.md), [계약·소비자 영향/롤백](CONTRACT-CHANGES.md),
원자료 기반 정량 표는 [measurements-summary](measurements-summary.md), 측정 환경·해석은 [PERFORMANCE](PERFORMANCE.md)다.

## 실제 변경과 근거

| 변경 기능/주요 파일 | 관찰한 병목/문제 | 구현과 검증 범위 |
|---|---|---|
| `src/hooks/useDashboardData.ts`, `src/hooks/useAnalyticsMeta.ts`, `src/pages/Dashboard.tsx`, `src/data/refreshController.ts` | 비활성 지도/개인 비교의 타이머·요청과 통계 직접 진입의 dashboard 의존 | 활성 화면/계정/세대 guard, 중단·재개, 독립 metadata/실패 재시도. 실제20회 왕복에서 hidden API/차트/Profiler commit0 |
| `server/aggregate.ts`, `server/publicHandler.ts` | 부분 목록 요청에도 지도·차량·분포를 포함한 전체 dashboard 집계 | 경로별 builder, 월 cohort1회 분류, coverage 선형 계산. 기존 응답 전체 oracle와 규모별 CPU 측정 |
| `server/rollups.ts`, `server/rollupSchema.ts`, `supabase/functions/public-analytics/index.ts`, migration040300/040600 | 원시 신고 JSON 운반/10만 cap, 잘못 추정한 grant/user join, 행별 법규 정규화 | 기관/담당자/법규/월별을 service-only SQL 집계로 전환. 전역 선출 뒤 필터, exact schema, DISTINCT raw law 요청별 계산, source 안의 hash/merge 계획. 글로벌50만 대표 실제 확인;8–10초로 목표 미달 |
| migration040100/040200/040700 | 랭킹 번호 보완·대표/answer max 정렬 spill, 전체 후보 JSON 생성 | 번호 있는 관측만 보완, 정렬 prefix 통일, 한 번 분류, whole-candidate version/tie/rank 후 page+global me만 JSON. constrained hex key만 bytea 정렬; 외부 identity/version 불변 |
| migration040400/040500/040800 | viewer 전체 lineage 검사/metadata 전행 검사;500 own key에서 LATERAL250000번 | exact global number fallback keyed lookup, active grants 집합 bounds, 요청별 lookup CTE materialize+numbered partial index. auth/동의/10건 자격 불변;500 NULL-key EXPLAIN/90표본 및 정상HTTP 재측정 |
| `src/pages/RankingsPage.tsx`, `src/styles/rankings.css` |6진입점/일괄적용/중복정보/모바일 작은 표 |3탭·공통 기간·기본 즉시 조회·범위/상세 draft 적용·me→목록·두 줄 모바일·정확한 지표명/분모·UUID dialog. 샘플1/동률/페이지 밖 me/URL/이력 유지 |
| `src/pages/StatisticsPage.tsx`, 통계/차트 component·style | 비활성 차트 작업, 독립 진입 오류, 빈 추이 잔상 | 숨겨진 차트 defer, 최신 dirty 표시1회, lifecycle cleanup. 맞춤 통계 draft→통계 만들기, 개인 비교·행/열/지표·차트·저장/공유·전체 export 유지 |
| browser/integration/benchmark scripts, migration manifest | 실제 UI와 맞지 않는 옛 selector, proxy WebSocket/idle socket 검증 환경 문제 | current3탭 harness, 실제 GoTrue/SQL·Realtime 전달, owned local gateway60s idle 수명. 제품 timeout/rate/인증은 바꾸지 않음 |

전체 변경 목록은 `git diff --name-status cf9009666a164ca91f694fd5a4164bffbe29ef0b HEAD` 및 각 로컬 커밋으로 재현할 수 있다.
package/lock·공용 디자인 토큰·다른 프로젝트·호스트 credentials/permissions/운영 DB를 바꾸지 않았다.

## 측정 결과와 목표

일반30회/대규모10회, nearest-rank p50/p95, 첫 표본 포함.0/1/500/58,388/100,001/500,000 규모별
시간·요청 수·전송 bytes·실패율은 [정량 표](measurements-summary.md)에 모두 있다. 표의 서로 다른 측정 종류를 합친 개선율은 없다.

- Node CPU fixture의58,388건 기관 목록 p50/p955045/5583ms→132/182ms, dashboard5015/5392→889/962ms.
  50만건 dashboard는8915/11866ms다. 사실이 이미 메모리에 있는 합성 handler이며 실제 HTTP/DB/운영 개선율이 아니다.
- 랭킹50만 사용자별 고유/60만 관측/1,000명: 초기1표본7801/7512ms는 분위수로 쓰지 않았다.
  기존 text-sort 후보의 같은 connection/block 비교는 p957189→6435ms,6968→5981ms로30% 목표 미달이었다.
  bytea 후보 교대 진단에서는 p9519280→7397ms,19386→7195ms였지만 양쪽 nested auto_explain analyze overhead를 포함한다.
  일반 지연 측정과 구분한다. 계측을 끈 최종 교대10회에서는 first p50/p9514565/15181→5522/6111ms,
  rates14620/16182→5504/6056ms로p95각59.7%/62.6% 단축이었다. 30% 목표는 이 로컬 SQL 조건에서 달성했고1s/2s 지연 목표는 미달이다.
  첫25s 진단 시도는 원본 함수에서 실패했고 별도60s outer budget으로 전수 실행했다. 제품20s/HTTP budget을 바꾸지 않았으며 운영 검증이 아니다.
  candidate의4개 다른 지표 조회 뒤 원본/후보를 교대로10회 측정하고 첫 표본을 포함했다. 공용heap은 같고 함수plan 초기화 순서의 차이를 숨기지 않는다. 전체 body(version/rank/tie/me 포함) 동등성이 일치했고 결과 bytes12237/12959는 불변이었다.
- Native 글로벌50만 대표/60만 관측: manager p50/p959013/10233ms,law9151/10283ms,series8307/9811ms.
  aggregate RPC body108179/4579/454bytes. N은 각각 한 그룹1000/50000/월500000, 전체 cohort50만이다.
  원본 raw RPC 직접SQL은 cap 때문에 RESULT_TOO_LARGE(계약상422 상당,18350ms/1표본; 실제HTTP상태 측정 아님)였으므로 성공 지연 개선율을 만들지 않았다.
  최종10회씩 실패율0%는 직접SQL 진단이며 hosted HTTP50만 성공/용량으로 주장하지 않는다.
- Normal local HTTP는 실제 GoTrue/getUser/viewer/rate/state/PostgREST/Deno를 거치는500건 합성자료,
  동시1/3/5 사용자당 각route/version30회다. 원본 viewer/state를 frozen alias로 고정했고 no-store/전체 body 동등성이 일치했다.
  이전 기관 계정 회귀 p95563→1851ms를 발견해040800으로 수정한 후 세 동시성 모두 재측정했다. 최종 표와 원래 회귀 원자료를 함께 보존했다.
- 최종7542cde Production frontend30 cold context: 맞춤 통계 p50/p95424/501→295/573ms,
  요청630→330/JS1886744→802993bytes; 랭킹209/249→208/258ms, 요청270→270/JS682030→640581bytes.
  dashboard mock map+7chart까지725/810→710/1078ms, 요청1020→1020/JS1886744→1845539bytes다.
  세 화면의 p95 회귀(+14.4%/+3.8%/+33.1%)를 실패 관찰로 남긴다. API 요청은 이 fixture에서0이고 운영 auth/SQL 지연이 아니다.
  같은 최종build에서 화면/variant마다 새 browser process로 dashboard/통계만 독립 재측정했다.
  dashboard698/745→671/710ms, 통계409/453→272/304ms, 각30회/실패0이다. dashboard 요청1020→1065는 외부 widgets 요청 변동을 포함한다.
  앞선 회귀와 독립 실행을 함께 보존하며 프로세스 누적·순서·외부 요청 등 원인은 확정하지 못했다. 일반 UI 회귀 없음/성능 완료로 판정하지 않는다.
  이전 settled/repeat 실행도 보존한다. 최초 lazy 랭킹 회귀는 RAF 확인에서도 재현되어 작은 module eager import로 수정했고 Muse 재검수를 완료했다.

DB backend RSS는 공유 페이지/allocator까지 포함한다. 진단 paired332212KiB,bytea 교대332544KiB, 최종 비계측332076KiB이며
쿼리 전용 사용량/메모리 개선율이 아니다. 원자료 EXPLAIN의 temp read/write와 sort disk/memory를 보존했다.
최종 기본 build main640.13kB/gzip192.40kB, 큰청크/비효율 dynamic import 경고는 유지한다. 측정 fixture/subpath flags가 다른 build의 전송bytes와 혼동하지 않는다.
제품 work_mem32MB/함수 timeout20s를 늘리지 않았다. 비계측 랭킹의 outer60s는 실패 원본을 수집하는 local 진단만의 설정이다. 직접SQL 측정 outer30s/실패180s 진단은 운영 timeout과 별개다.
DB→Edge 원시 전송량 개선 비율·서버 취소·RUM INP·실제 운영 p95/write throughput은 미측정이다.

## 통계·권한 동등성

- 작은 수동 oracle: N7/C7/K6/F5, 금액 공개4건/합40000원, zero3/withheld1, 소요일 valid5/평균0.8/중앙1/제외2, rating4.2.
  이전 응답 frozen fixture와 dashboard/entities/laws/overview/map/series/vehicles의 전체 응답을 비교했다.3 PASS, 허용 오차로 덮지 않았다.
- Native5 PASS: 두 날짜 축, null/0/부분수용/결측/역전, 법규/기관명/소속/지역 변동/동명이인,
  모든 정렬 방향·검색·분류·페이지, 전체 선출 뒤 필터/과거 대표 부활 방지, service-only 권한, stale version409, 철회·정지·삭제.
- Ranking1 PASS:126개 theme/metric/date/period/min 조합, 페이지 밖 me, 정확 분수 동률/경쟁 순위,
  numbered/legacy/기기 중복/계정별 모집단, 대표 갱신·기간 이동·version/철회 즉시변화가 원본 SQL와 일치했다.
- Gate/state1 PASS:25회 frozen 원본 비교. Kakao/profile/session·철회/재동의/정지/삭제·고유10건·전역 역사번호 보완/날짜 bounds.
  다른 계정의 최초 번호 철회 때 own identity10→9가 되는 기존 의미도 그대로다.500 NULL-key90표본은 숫자와 자격 전체 일치.
- 지도 글로벌 대표, 랭킹 계정별 대표, 개인/내 신고 기기 dedupe의 모집단을 서로 바꾸지 않았다.
  공개 익명 RPC/private table 접근은 거절하고 본인 API에 다른 user id를 입력하는 경로를 허용하지 않았다.
  원시 개인/번호/UUID 공개 경계는 기존 privacy 검사/scan와 실제 gate 테스트로 확인했다.

## 검사 상태와 실제 브라우저

| 검사 | 상태·수 | 증거/한계 |
|---|---|---|
| 제품 변경 전 단위 |609 PASS/100 SKIP | 기준선 로그 |
| 최종 전체 단위 |623 PASS/111 SKIP,53파일 PASS/18 SKIP | opt-in integration을 SKIP으로 유지; PASS에 더하지 않음 |
| 기존 local DB/API7개 suite |52 PASS | date-basis100001 cap, my-reports SQL/Edge, my-analytics, statistics Edge, agency registry, rankings Edge; 이전 단계 실제 실행 |
| 최종 ingest+ranking+native+gate+equivalence |53 unique PASS | ingest33/ranking13/native5/gate1/rank differential1. 첫 실행 auth fetch 실패는 유지하고13개 전체 재실행 PASS |
| SQL/editor·TypeScript·manifest/build/public scan |PASS |41 migrations/7functions; pinned Deno closure 검사 및 Python27+12 PASS |
| 맞춤 통계 전체 브라우저 |60 PASS | [statistics-complete](evidence/statistics-complete/), Node synthetic facts/SDK |
| export/finalization 전체 브라우저 |51 PASS | [finalization-complete](evidence/finalization-complete/), 실제WASMWorker/숫자/수식방어/취소·계정·전체행·subpath/CSP; MS Excel 프로그램은 미실행 |
|20회 왕복·late 응답/계정/metadata draft |PASS | [activity-final2](evidence/activity-final2/), hidden 요청·commit·차트0, 지도/관측자 수 안정. 실제 겹친800ms/40ms 응답 |
| 실제 Chrome200% zoom |4 PASS | [browser-zoom-cdp](evidence/browser-zoom-cdp/), headed Xvfb/DPR2/CSSzoom1/layout384, 두 화면·두 테마, screenshot 실제 열람 |
| Muse 독립 검수 |APPROVE60 행동/eager27, 마지막36컨트롤 검사+fixture조건1 | [REVIEW](REVIEW.md), 고정7d25a9f/2cd5442/7542cde 별도worktree, 실제 export model/variant 확인. 마지막은 API미제공으로행/숫자 NOT RUN |
| 실제 local GoTrue/SQL 랭킹 UI |102 기본 /96 기간 /7 접근성 PASS |[rankings-latest](evidence/rankings-latest/);3탭/기간/동률/1건/UUID/429/409/5xx/철회/이력/360·390·768·1440·1920·2560 양 테마; RPC 데이터는 합성, SDK mock; [기간96](evidence/periods-final5/result.json)/[접근성7](evidence/accessibility-final/result.json)/[subpath](evidence/subpath-final/result.json) |

FAIL을 지우거나 SKIP을 성공으로 합산하지 않았다. 전수 unit의 opt-in SKIP과 명시적으로 실행한 integration은 별도 ledger다.
초기 Realtime 검증은 gateway에 upgrade forwarding이 없어33 SKIP이었다. 투명 WebSocket 전달 후33개 전체 PASS다.
좌표 없는 신고 fixture는 좌표가 있는 다른 신고와 같은 주소여서 기존 R07도 배치 가능한 자료였다. 주소를 고유하게 바꿔 실제 unplaced 검사를 복구했다.
여러 HTTP/SQL 동작이 있는 한 integration case의 예산5s→30s를 조정했고 모든 기존 통계 assert를 유지했다. 제품 성능 목표나 timeout 변경이 아니다.
GoTrue fixture auth 실패는 fetch 실패로 확인해 fresh session/getUser를 검증했고 local gateway idle socket 수명을 조정한 뒤13개 전부 PASS였다.
상세 패널의 native toggle이 빠른 첫 편집을 초기화하는 실제 UI 문제와 rk_min 문자열 때문에 실제 reload/remount/history 조건이 기본값으로 돌아가는 문제를 추가로 재현·수정했다. 기간96검사는 URL만이 아닌 실제 응답scope/통계값까지 검사한다. 초기 기간 harness의 reload waiter가 TypeScript 계약 module을 API로 오인한 실패도 정확한 /functions/v1/user-rankings 경로로 수정했다.
비계측 랭킹 최초 원본25s 실패와 뒤의60s 진단 실행을 분리했다.
초기 HTTP series의 금지된 page_size400, 정상HTTP cold503/8.155s, native generic/custom/ANALYZE timeout,
lazy진입 회귀·잘못 설정한100% zoom·harness response race/옛 selector 실패도 원자료와 로그에 남아 있다.

Screenshot 생성만으로 승인하지 않았다. Sol은 최종 실제200%4장과 지도20회 뒤/360dark·768light/Muse 주요 자료를 직접 열었고,
Muse는24장 실제 열람+클릭/keyboard/console/network를 제출했다. forced error의 expected console429/409/403/503은 별도로 분류한다.
CSS body zoom으로 유효195px가 되는 Muse OBS-01 header overflow는 미해결 관찰로 남긴다. 실제200% viewport384 검사를 대신 그 문제가 해결됐다고 표시하지 않는다.

## 미달·환경상 미검증과 후속 범위

**성능 완료 판정은 보류한다.** 최종 SQL 랭킹 p956초, 글로벌50만 native8–10s와 CPU50만 dashboard11.9s는 p50≤1s/p95≤2s 목표에 미달한다.
지도/dashboard·개인 비교·맞춤 통계의 raw cohort10만 상한을 늘리거나 truncate하지 않았다. 이 경로들의 대규모 DB aggregate 전환은 잔여 작업이다.
SQL의 의미를 바꿔 과거 대표를 살리거나 월별TOP을 합치거나 현재 page만 정렬하지 않았다. TTL/snapshot/Redis/materialized ranking/결과 저장은 없다.

BLOCKED/NOT RUN: 실제 Kakao SDK key/실OAuth, hosted Edge gateway JWT검증/네트워크, 운영자료·운영집계/운영SQL/운영RUM,
실제 Excel application 열기, PC/mobile/확장 실설치 소비자 smoke. 공개된 합성 자료와 mock은 운영 검증이 아니다.
500k 직접SQL PASS를 일반 PostgREST deadline/용량 보장으로 쓰지 않는다. index가 있는 numbered ingestion의 운영 유지비용도 미측정이다.

## migration·소비자 영향·배포/롤백

migration040100~040800은 **이 저장소의 로컬 후보/own local DB 검사에만 적용**했다.
service-only RPC 추가와 private resolver/index/function 변경이며 공개 wire 버전·URL·auth10건/랭킹min1·rate·정확한 분모는 불변이다.
기존 PC/mobile ingest/내 신고 API에는 신규 deployment가 필요하지 않지만 실제 설치 consumer 검증은 미실행이다.
정적 Pages는 보호된 facts/UUID/계정 결과를 담지 않는다. [CONTRACT-CHANGES](CONTRACT-CHANGES.md)에 함수 설정/registry drift/의존성과 전체 롤백을 적었다.

운영 승인 후 준비 순서: manifest/backup/권한→DB040100…040800→public Edge→Pages→실제 인증/소비자/동등성/성능 smoke.
040800의 partial index는 일반 transactional CREATE INDEX이므로 운영 큰 테이블 lock·소요시간을 검토한 뒤 적절한 배포창을 선택해야 한다.
새 DB는 이전 Edge와 호환되고 새 Edge는040300 RPC를 요구한다. 실행하거나 승인받았다고 주장하지 않는다.
rollback: Pages/Edge forward revert→기존030100대표/030200RPC/281900viewer/010100state 함수 본문을 새 migration으로 복구→
미사용 service-only rollup/private registry/index 정리.040700 단독 rollback은040100 대표 함수,040800 단독은040400 viewer+index 제거.
현재 사용자·동의·철회·삭제·자료를 과거 snapshot으로 되돌리거나 reset/clean/force push하지 않는다.

## 재현

`npm test`, `npm run build`, `npm run scan`; `node scripts/integration/compose_supabase.mjs check --auth <실재 auth checkout>`.
로컬 stack 구성/실행은 기존 integration 문서를 따르고 다른 프로젝트/운영 DSN을 사용하지 않는다. 이 실행에서는 `COMMUNITY_STACK_DIR=.agent-runtime/refactor-stack`,
`COMMUNITY_API_URL=http://127.0.0.1:57099`, Deno CLI의 실제 product entrypoint+owned proxy, local PostgreSQL17.6을 사용했다.
`COMMUNITY_STACK=1 npx vitest run <integration file> --no-file-parallelism`으로 ledger의 각 suite를 재실행한다.

성능 opt-in: `MAP_PERF=1`, `RANKINGS_MEASURE=1 RANKINGS_COMPARE=1 RANKINGS_INTERLEAVE=1 RANKINGS_REPEATS=10`,
`HTTP_PERF=1 HTTP_FROZEN_GATES=1 HTTP_CONCURRENCY=1|3|5`, `VIEWER_MEASURE=1`; output 경로는 각 test env로 분리한다.
랭킹 primary timing은 `RANKINGS_PLANS=0 RANKINGS_DIAGNOSTIC_TIMEOUT=60`, 계획 진단은 별도 실행이다. seed/전체 API/version/body 검사 실패 시 성공 수를 만들지 않는다.
HTTP 원본 alias는 `scripts/integration/prepare_http_baseline.py`로 own local DB에 service-only로 만들고 마지막 `--cleanup`으로 제거한다.
`python3 scripts/benchmark/summarize_refactor.py`가 원자료로 표/JSON을 재생성한다.
브라우저는 `scripts/browser/verify_rankings.mjs`, `verify_ranking_periods.mjs`, `verify_rankings_accessibility.mjs`, `build_rankings_subpath.mjs`→`verify_rankings_subpath.mjs`,
statistics/activity/finalization/actual zoom scripts와 각 evidence 재현 안내를 따른다. 참조 경로 존재 여부 감사도 [paths](evidence/paths.json)에 남겼다.

화면 독립 재측정: `PERF_ISOLATED=1 PERF_SCREENS=dashboard,statistics node scripts/browser/measure_production.mjs <output-dir>`. 일반 최종180context 실행과 별도로 해석한다.

최종 체크 stdout과 실패 기록: [checks](evidence/checks/), [상태 분리](evidence/checks/FINAL-STATUS.json). 임시 HTTP alias0개 확인 및 확인된 own server 프로세스만 종료했다. 사용자 실행 지시문은 그대로 untracked로 보존한다.
