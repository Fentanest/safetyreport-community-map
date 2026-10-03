# 지도 성능 리팩터링 실행 계획

시작 2026-10-03 KST, 기준 cf9009666a164ca91f694fd5a4164bffbe29ef0b. 로컬/원격 main 동일(ls-remote); untracked 사용자 실행지시문 보존. Sol 작업 refactor/map-performance-20261003, Muse 구현 worktree `.agent-runtime/worktrees/muse-ui`, branch muse/map-performance-ui. 로컬만 승인됨. 원격 push/main 병합/운영 SQL/설정/배포 금지.

## 정본 충돌과 감사

630줄 실행 지시문 전체를 읽었다. 경로 실재 여부는 evidence/paths.json. contracts/selfhost-compat 없음, 대체 호환 계약은 community-ingest와 my-reports. PROJECT_RULES의 과거 지표별 날짜·초기 문서의 소유 이전/UUID 일반 금지/스냅샷 설명보다 single-date-v1, account contributions, ranking UUID 제한 예외 및 이번 명세를 우선한다. 최신 main-release-20261003/REPORT는 기존 SQL 030100/030200 및 Edge/Pages 운영 배포를 기록한다. 과거 미배포 문장은 역사이며 이번 신규 변경은 운영 미적용이다. 최종 함수는 migration 순서를 추적해 030100 대표,030200 RPC,010100 cohort,020100 my-reports로 확인했다.

## 기준선과 병목

제품 수정 전 609 PASS/100 SKIP(63파일), build/scan PASS. initial JS 681.47KB(gzip204.28KB), 랭킹/맞춤 통계 eager import. 기존 50만/60만/1000명 스크립트를 재실행해 first7800.525ms/rates7512.319ms; 쿼리별 1표본이므로 p50/p95 주장 안 함. auto_explain 대표 함수6.1–6.5초,170416KiB 및100416KiB external sort, 전체 RPC materialized reps/scoped도 temp I/O. 추가 반복 측정과 Node handler 규모별 측정은 수정 전 같은 도구로 확보한다.

- `/entities`가 aggregateDashboard를 거쳐 장소/월/차량/분포/다른 목록까지 생성한다. `/overview/map/series/vehicles/points`도 같은 경로. 필요한 builder만 실행하고 월 집합을1회 분류한다. 위험: 전체 담당자 same_name와 기간 coverage 누락. 검증: 응답 전체 oracle/differential, 모든 sort/page, 규모별 실측.
- Edge는 cohort_facts JSON 원시 최대10만 운반. 조기필터/대표/지역 history/동의 disclosure를 보존하는 전용 DB 집계로 기관/법규/추이 경로를 전환. 과거 대표 부활과 SQL/JS 지역/법규/금액 동등성은 blocker이므로 축소·truncate·상한 증가는 해결로 인정하지 않음. 완성 못한 경로는 명시 잔여.
- 랭킹 번호 보완이 null 관측까지 정렬하며 payload max와 선출의 partition 정렬 키가 달라 대량 spill. 보완이 필요한 번호만 읽고 identity 정렬 prefix를 통일; RPC 전체 후보/version 유지, DTO 생성은 페이지+me만. 위험: NULL legacy identity·정확 분수/tie·동의·version. 기존 SQL와 동일트랜잭션 differential + my_reports_own/작은 oracle + 50만 재측정. TTL/캐시 없음.
- useDashboardData(enabled=false)는 cancel하지 않아 hidden 재시도/응답 반영. 개인 비교도 screen gate 없음. pause/resume와 session render guard, 화면별 code loading/metadata 의존 분리를 보완. 기존 debounce/429/409/generation 유지, Abort를 서버취소로 주장하지 않음. 테스트: 지연 역전·계정·timer·직접진입·20회 왕복·요청수.
- UI는6진입점/전체적용/반복UUID/모바일표. 새3탭/공통기간/즉시기본조회/상세조건적용/range조회/얇은me→목록, 모바일두줄. 맞춤통계 draft→통계만들기·표/차트/저장/공유/내보내기 유지. Muse 계획/구현 및 고정후보 독립검수.

## 단계와 통과 기준

A 감사/보존표/검사/실측 → B 요청·계정·hidden 보호 → C 전용집계/랭킹SQL(oracle 이후만) → D lazy/수명·export회귀 → E Muse UI통합 → F 고정후보 독립검수/전후보고. 각 변경은 작게 검증해 로컬 커밋. 목표 p50≤1s/p95≤2s 및50만랭킹≥30%단축은 목표이며 실측 성공으로만 판단. 일반30회/무거운10회, 첫표본 포함·p95불확실성·오류율 별도. DB 큰seed/브라우저는 순차 실행, 생성자료만 cleanup 또는 rollback. production build 측정, dev는진단만.

360/390/768/1440(light/dark), 키보드/200% 실제글꼴, 클릭/console/network/screenshots 실제열람. Kakao MOCK와 LOCAL GoTrue/DB와 운영검증 분리. Microsoft Excel/실카카오OAuth/실사용자운영값은 환경미검증. 환경문제는 독립 로컬작업을 막지 않음.

## 소유와 롤백

Sol: 계약/데이터/DB/CI/test/scripts/Dashboard/common tokens/package(single writer). Muse: RankingsPage.tsx,rankings.css,StatisticsPage.tsx,scope-statistics.css 및 자기보고/증거. 같은파일·worktree 동시쓰지 않음. UI 커밋회수 후 소유를Sol로이전. 검수는최종제품고정 commit별도worktree(readonly product). 모델opencode-go/muse-spark-1.3-contributor/high host목록에서 확인; 실제session export 별도 확인.

롤백: 각 단계커밋을 forward revert(사용자파일 보존). DB는새migration만, 이전함수본문 복구 forward migration. 권한·철회·현재자료를 보존하고 데이터snapshot 복원 금지. 배포는 DB→Edge→Pages 호환순서 준비만. SQL/Edge변경과 기존PC/mobile/확장API영향은 CONTRACT-CHANGES/RELEASE에최종기록.

## 추가 실측에 따른 좁은 변경 (2026-10-04)

반복 SQL 계획에서 viewer threshold의 key_numbers Hash Semi Join이 key 제한 전에 전체 60만 관측에 lineage 함수를 실행해 약9초를 썼다. 다른 실행의 planner 선택에서는 같은 gate가 약52ms였다. 결과 캐시 없이 이 계획 변동을 없애기 위해 번호 없는 own key마다 LATERAL/LIMIT1 lookup을 적용한다(040400). metadata 전체 bounds도 행별 lineage 호출을 active-grants 집합 JOIN으로 바꾼다(040500). auth와 global historical number 정의는 원본 그대로다. 작은 frozen-function differential 이후에만 로컬 적용했다. 통합 성능은 같은 rollback seed/connection에서 원본 alias와 후보를 비교하고 plan_cache_mode를 명시해 gate 계획 차이를 숨기지 않는다. 서로 다른 gate 계획의 별도 실행 수치를 그대로 개선율로 단정하지 않는다.

## 계획 실험과 적용 후보

500k 글로벌 집계의 custom bound plan만으로는30s 및 진단180s timeout이 재현됐다. 작은 oracle PASS는 대규모 성능 PASS가 아니었다. EXPLAIN은 consent_grant_id와 user_id의 상관된 join을1행으로 추정해 후보/관측에 nested loop를 골랐다. profiles/grants ANALYZE 후에도 재현됐다. 040600은 이 함수 안에서만 nested loop를 배제해 hash/merge 계획을 검증한다. 사용자 SQL 보간, 결과 캐시, work_mem·제품 timeout 증가가 없다. 같은10회 대규모 실측과 작은 전수 정렬/권한 differential을 실행하고 미달은 보고한다.

production 랭킹 lazy 진입은 RAF readiness로 재측정해도 p95 회귀가 있었다. 작은 RankingsPage는 eager로 복구하되 mount/API는 활성 화면에 한정한다. 통계는lazy를 유지한다. 변경후30회 측정과2cd5442 독립 Muse 재검수로 확인한다. 단순 code split 자체를 성공으로 취급하지 않는다.

## 최종 계획 근거 보완

040700은 DB의64자리 lower-case hex CHECK가 있는 source/dataset key만 bytea로 정렬한다. payload hash는 검증되지 않은 문자열이므로 text를 유지한다. 대표 순서와 외부 identity/version은 그대로다. 같은 seed/connection 원본·후보10회 interleave에서 전체 응답 동등성과 계측된 p95 19.3s→7.4s를 확인했다. auto_explain analyze의 양쪽 overhead가 포함되며 일반 HTTP 개선율로 확대하지 않는다.

HTTP 기관500건에서 일부 계정 p95 1.85s가 재현됐다. EXPLAIN에서 inline된 key_numbers가500 own row마다500키를 다시 조회해 LATERAL250000회 실행되는 근거를 확인했다. 040800은 key_numbers를 요청 안에서 한 번 materialize하고 completed/numbered partial lookup index를 추가한다. 영구 자격/집계 캐시는 아니다. 동등성25비교와 normal auth/rate HTTP1/3/5 재측정 후 결과를 보고한다. rollback은040400 함수 복구 및 새 index 제거. 첫 계획/반복 계획의 변동도 원자료에 유지한다.
