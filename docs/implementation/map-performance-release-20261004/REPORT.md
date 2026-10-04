# 지도 성능 리팩터링 main 통합·운영 배포 · 2026-10-04

후속 사용자 명시 요청으로 main 통합/push와 필요한 Supabase DB·Edge·Pages 적용을 수행했다.
이전 [로컬 보고](../../refactoring/map-performance/REPORT.md)의 ‘운영 미적용’은 당시 종료 상태이며, 이번 상태는 이 문서가 정본이다.

## 통합과 배포

- 원격 main cf900966에서 refactor/map-performance-20261003의 eae2096까지 fast-forward 통합했다. release검사 커밋 **bc7feccf2222bb5fa9f1f83a15bbca3e79750cf1**을 main에 push하고 배포했다.
- 통합 완료한 refactor 로컬 branch는 정상 -d로 삭제했다. Muse 두 기여 patch도 git cherry에서 main에 포함됐음을 확인했다. 원래 사용자 지시문은 untracked로 보존했다. force/reset/clean을 사용하지 않았다.
- 실제 제품 후보7542cde의 src/server/contracts/supabase 코드는 배포 시 동일하다. 앞선 고정 Muse 검수와 [로컬 회귀 증거](../../refactoring/map-performance/REVIEW.md)가 계속 적용된다. 최종 배포 증거 추가 커밋은 제품코드를 바꾸지 않는다.
- 프로젝트 nxdcxccixoswvqgjeprh에 migration **202610040100~202610040800 8개**를 정본 순서로 적용했다. 선행33개는 기존 적용 상태였고 composed manifest는41개다. after dry-run pending0/seed0/role0 확인. Auth·secret·계정·다른repo 설정을 바꾸지 않았다.
- 지도 소유5개 Edge 배포를 실행했다. **public-analytics v16**, **my-analytics v14** 갱신. community-ingest v8/my-reports v1/user-rankings v1은 CLI 동일코드 확인으로 기존 버전을 유지했다. 5개 모두 ACTIVE/verify_jwt=true. auth 소유 community-account v6/community-auth-relay v5는 불변이다. [함수 상태](evidence/production-functions.json), [적용 로그](evidence/edge-deploy.log).
- main 수동 Pages [run37170626259](https://github.com/Fentanest/safetyreport-community-map/actions/runs/37170626259)의 build/deploy 모두 success다. 서비스 [safemap.worklazy.net](https://safemap.worklazy.net/). [실행 메타데이터](evidence/pages-run.json).

## 실제 운영 검증

| 검사 | 결과 | 범위 |
|---|---|---|
| 배포 CI | Python27+12 PASS, Vitest623 PASS/111 SKIP, live build/scan PASS | SKIP은 PASS에 포함하지 않음. 정적 data없음 검사 |
| 운영 SQL 원본/후보 비교 |44 PASS | 전체 대표rows1/cohort state1/기존session viewer14/랭킹28(7지표×두날짜축×전체·2023-07) |
| 실제 함수 본문·설정·권한 |10 PASS | 운영/local md5·설정·권한 일치. anon/authenticated execute거절 |
| 익명 Edge5개 |5 PASS |401/UNAUTHORIZED_NO_AUTH_HEADER, dataset_version 없음 |
| 실제 CORS/런타임 |3 PASS | public/myanalytics/rank OPTIONS204, 실제 사이트 origin 허용 |
| Pages artifact/실제 자산 |5 PASS | HTML·JS·CSS byte/hash 일치, 전체artifact27파일, docs/tests/design/data 없음 |
| 실제 Chrome154 사이트 |8 PASS |360/390/768/1440×light/dark, 과거월URL·새로고침·키보드focus·overflow·asset응답·보호API요청없음 |

SQL 비교는 실제 운영 자료의 repeatable-read snapshot에서 pg_temp에 원본 함수만 일시 복제하고 전체 row/body/version/rank/tie/me를 비교한 뒤 rollback했다.
계정/session/신고 식별자는 DB 안에서만 사용했다. 증거는 검사명·boolean·수만 보존하고 운영 facts를 export/seed/변경하지 않았다.
이는 실제 사용자 JWT/OAuth/브라우저 로그인 검증과 다르다. [44개 결과](evidence/production-sql-parity.json), [재현 SQL](evidence/production-sql-parity-split.sql), [권한](evidence/production-rpc-permissions.json).

첫 운영SQL 비교는28조회가 한DO에 묶여 statement timeout으로 실패했다. **제품20s/SQL budget을 늘리지 않고** 독립SQL문으로 나눠 전체 비교를 재실행했다.
[첫 실패](evidence/production-sql-parity-first-fail.log)를 보존한다. dry-run CLI의 대화 대기는 owned 비변경CLI만 종료하고 --yes로 재실행했다.
첫 schema dump의 상대 output 경로는 workdir 아래로 해석되어 실패했고 정확한 절대 경로로 schema backup을 확보했다. 실패를 성공 수에 합산하지 않았다.

브라우저는 live 익명 사이트이며 fixture/SDK mock/토큰 주입/OAuth 액션을 쓰지 않았다. JS/console error0·network failure0.
스크린샷8개를 모두 실제 열어 로그인 안내·버튼·문자 배치·가로 넘침을 확인했다. [브라우저](evidence/production-browser.json), [실제 열람](evidence/visual-review.json), [배포 자산](evidence/production-assets.json).

**NOT_RUN:** 운영 로그인 후 GET200/지도SDK 상호작용/실 사용자 UI 순위·페이지·개인비교·내보내기, 운영 철회/삭제/정지 mutation, PC/mobile 실설치 소비자, 실제 운영 p50/p95·RUM/write-throughput.
운영 SQL의 기존session 호출을 사용자 JWT검증으로 주장하지 않는다. 로컬 합성50만 성능 수치를 운영 개선율로 표시하지 않는다.
이전 보고의2초 지연 목표 미달·frontend 회귀 관찰·dashboard/맞춤 통계10만raw cap 잔여 제한은 그대로다.

## 백업과 복구

운영 table 추정2872행/5365760bytes와 대기lock0을 확인한 뒤8개 적용했다. public/private schema 및 기존map 함수 정의를 ignored .agent-runtime에 백업했다(개인 자료 dump아님).
직전 성공 Pages run37107584086의 artifact도 다운로드해 확보했다. [백업 checksum](evidence/backup-manifest.json).

복구 순서: 이전 인증 전용 Pages/Edge(public v15/my v13, cf900966 source)를 forward revert/redeploy → selective 원본4함수(대표/RPC/viewer/cohort state) 및 기존 grants를 새 migration으로 복구 → 미사용rollup/helpers/index는 의존성 확인 뒤 정리한다.
실제 원본 body에서 만든 `.agent-runtime/refactor-release-rollback-functions.sql`을 준비했으며 실행하지 않았다. 전체schema dump를 통째로 실행하거나 DBreset을 하지 않는다.
유저·동의·철회·삭제·현재자료/version은 유지한다. 삭제된 데이터 snapshot/익명공개API를 복구 기준으로 사용하지 않는다.

재현: `RELEASE_WIDTHS=360,390,768,1440 RELEASE_EVIDENCE_DIR=<새증거경로> node scripts/browser/production_release_smoke.mjs`.
검증/적용 로그와 JSON/화면은 이 보고서의 evidence에 모았다. 기존 로컬 감사·계약·성능 보고서는 역사와 잔여 제한을 위해 보존했다.
