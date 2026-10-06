# 연속 업로드 중 화면 스냅샷 · TASK3

기준 `e133f44`, 화면 묶음 구현 `f8d68e7`, 최종 제품 보완 `5f8ef04`. 운영에는 연결하지 않았고 실제 사용자 운영 오류의 재현은 로컬 GoTrue/PostgREST/Deno + mock Kakao + 실제 ingest로 수행했다. 단순 재시도 증가는 채택하지 않았다.

## 원인과 설계

기존 meta → dashboard/표/개인 비교 사이에 ingest가 projection version을 바꾼다. meta를 다시 읽어도 다음 업로드가 곧바로 버전을 바꿀 수 있어 한 번의 재시도로 해결되지 않는다. 기존 public handler는 state와 source를 별도 RPC로 읽으므로 fence 검사를 제거하는 것만으로 응답 내부의 시점 일치도 보장하지 못한다.

새 `internal_analytics_read_snapshot`은 STABLE 함수 한 번으로 metadata와 facts/rollup, 묶음의 viewer를 읽는다. [PostgreSQL의 STABLE snapshot 보장](https://www.postgresql.org/docs/17/xfunc-volatility.html)에 따라 하위 읽기도 해당 statement의 MVCC snapshot을 사용한다. SQL probe는 3초 지연 사이 실제 ingest가 커밋되었음을 외부 버전 변화로 확인하면서 내부 version/count 일치를 검사한다.

`my-analytics/screen`은 대시보드·개인 비교·현재 표·지도 상세를 그 한 source에서 계산한다. 브라우저는 한 응답으로 전체를 교체하고 패널별 데이터도 동일 버전만 사용한다. 표 확장(누적 페이지)도 한 prefix 응답으로 받으며 이전 페이지와 최신 페이지를 이어붙이지 않는다. scoped private facts 사본을 저장하는 테이블/TTL 캐시는 만들지 않아 다음 요청의 철회·삭제 반영을 막지 않는다. 후속 표 질의를 위해 화면 전체 집계가 다시 실행되는 비용은 증가할 수 있다. 기존 raw cohort 100,000행 한도/대규모 CPU·전송 비용을 이 변경이 없애지는 않는다.

최신 화면의 expected_version은 힌트다. 맞춤 통계와 랭킹은 `consistency=latest`로 한 응답의 반환 버전을 채택한다. 기존 clients의 명시적 fence/strict DTO는 하위호환으로 남기므로 **구 Pages도 함께 배포해야** 새 경로의 보장을 받는다. 화면 묶음이 반환한 사라진 주소 404는 새 지도에서 선택을 닫는다. 네트워크/권한/429/행 예산 오류는 정상 자료로 위장하지 않는다.

빠른 A→B→A 범위 전환도 별도로 보완했다. B 요청을 취소하고 A를 계속 표시할 때 coordinator가 B에 남아 개별 fence 요청으로 돌아가던 경합을 막았다. 마지막 완전한 A 묶음을 복구하고 기다리던 표 intent를 같은 화면 묶음으로 처리한다. B가 성공하면 A intent를 취소한다. 계정 변경은 복구용 DTO까지 지운다. 취소된 intent는 서비스 오류로 표시하지 않는다.

## 재현 행렬

각 workload는 1.25초마다 5개 event를 실제 community-ingest HTTP로 보냈다(목표 4건/초, 기존 60 batch/분 한도 아래). scope/date/원천 집계 의미는 고정했고 SQL 감사 전/후에서 화면 수정 전/후를 각각 실행했다. 첫 metadata 뒤 1.5초 네트워크/스케줄 간격을 두어 연속 쓰기와의 경쟁을 재현했다. 기존 코드의 재시도에도 같은 간격을 둔다. 합성 테스트이며 운영 지연/p95 추정이 아니다.

| 조건 | 측정 초 | 실제 published events | 화면 cycle | 첫 요청 409 | 재시도 409 | 새 응답 혼합/건수 불일치 |
|---|---:|---:|---:|---:|---:|---:|
| before-fix-before-audit | 123.8 | 495 | 19 | 19 | 19 | 응답 없음 |
| before-fix-after-audit | 127.7 | 500 | 19 | 19 | 19 | 응답 없음 |
| after-fix-before-audit | 181.3 | 725 | 25 | 0 | 0 | 0 |
| after-fix-after-audit | 182.6 | 730 | 28 | 0 | 0 | 0 |
| final f8d68e7 after-audit | 306.4 | 1,225 | 47 | 0 | 0 | 0 |
| final 5f8ef04 transition | 215.1 | 860 | 33 | 0 | 0 | 0 |

수정 후 각 cycle의 대시보드 묶음·전체 맞춤 통계·개인 비교 맞춤 통계·랭킹 첫/다음 페이지는 모두 200이다. 비교 panel의 all 보고/완료 건수는 대시보드 KPI와 같다. 과거 화면의 버전은 이미 업로드로 바뀐 값이므로 성공은 우연한 동일 버전 재시도의 결과가 아니다. 원본 수치는 evidence/*.json에 있다.

## 검사 상태

- PASS: 최종 제품 `5f8ef04`의 단위 638개(초기 화면 커밋은 636개). 기본 실행의 선택적 통합/부하 121개는 skipped이며 아래 별도 local 실행과 구분한다.
- PASS: Python blueprint 27개 + 공개 자료/스캔 12개, TypeScript + Vite live build, 공개 artifact scan, 공유 manifest 48 migration/7 Edge.
- PASS: 실제 업로드 중 SQL STABLE snapshot probe 2개. 내부 1,950행/같은 버전 유지, statement 종료 후 외부 version 변경 확인.
- PASS: 최종 306.362초 / 245 batch / 1,225 published events(약 4건/초). 47 cycle × 5 응답(대시보드 묶음·전체 통계·개인 통계·랭킹 1/2쪽)이 모두 200. 묶음에 개인 비교·기관 표·법규 표를 포함하고 version/count 불일치 0.
- PASS: 연속 업로드 구간 안의 실제 브라우저 180.002초(02:38:30Z–02:41:30Z), API 56개 모두 200, 오류 화면/페이지 예외/묶음 version 불일치 0. 390/1440/1920/2560 dark/light screenshot을 열어 확인했다. 특히 390px의 개인 비교 수치와 표, 1440px의 KPI/차트/지도 배치가 표시되고 가로 overflow는 0이다.
- PASS: 별도 계정의 브라우저 추가 40초, 비교 off/on·법규 전체 조회·통계·랭킹·복귀·새로고침을 검사, API 14개 모두 200, console/pageerror 0. 이 추가 구간은 마지막 ingest 종료 이후이므로 연속 업로드 180초 증거에 합산하지 않는다.
- PASS: `/community-map/` live build/scan 및 미로그인 화면의 query URL 새로고침, asset 200/페이지 오류 0. 로그인된 기능은 root preview에서 별도 확인했다. 외부 광고/지도 SDK는 mock 처리했다.
- BLOCKED: Muse 독립 검수. OpenCode 1.18.31 / 기존 OpenCode Go의 exact ID `opencode-go/muse-spark-1.3-contributor`, session `ses_ef0ec7035ffeSZRqOru2Niho7y`, detached `f8d68e7` worktree. export에서 실제 assistant provider/model을 확인했으나 provider가 `Go usage limit exceeded`로 첫 요청부터 거절해 검수 도구/산출물은 없다. 해당 프로세스만 종료했고 과금 경로/모델/설정을 바꾸지 않았다. 상세: `evidence/muse-review-blocked.json`.
- NOT_RUN: 운영 Supabase/실제 Kakao SDK/hosted Edge gateway/Pages 배포·push, TASK2의 50만 행 선택적 성능 재측정. 이번 목적의 수 분간 쓰기 경쟁은 실제 로컬 ingest로 별도 측정했다.

초기 실패도 보존한다. 첫 단위 실행은 rankings JSON schema 미동기화와 화면 반환 metadata를 반영하지 않던 account fixture가 실패했다. schema를 재생성하고 fixture가 반환하는 화면 metadata를 해당 계정 값으로 맞췄으며 기존 account 격리 assertion은 유지했다. mock OAuth secret 불일치, 브라우저 탭/버튼 locator 및 법규 전체 보기 누락, SQL probe 타입 캐스트와 업로드 종료 후 실행 문제도 수정 후 재실행했다. `evidence/logs/`와 `*-first`/초기 browser 결과를 최종 PASS와 구분한다.

PASS: 기존 로컬 통합 회귀 110개 + 별도 Deno user-rankings Edge 2개. 서버/SQL은 `f8d68e7` 이후 변경하지 않았다. 추가 SQL snapshot probe 2개도 `5f8ef04` 연속 ingest 중 다시 통과했다.

최종 `5f8ef04` 재검증: 215.061초 / 172 batch / 860 published events / 33 cycle × 5 응답 전부 200, mixed/countMismatch 0. 그 업로드 구간 안에서 브라우저 180.002초(02:52:43Z–02:55:43Z), 응답 56개 전부 200, console/pageerror/오류 화면/mixed 0, 모든 viewport overflow 0. 3초 지연시킨 traffic 요청을 A→B→A로 취소하고 기관 표를 검색했으며, legacy 개별 entities/laws/places/compare fallback이 발생하지 않았다. 법규 전체 조회와 비교 off/on, 맞춤 통계, 랭킹도 포함한다. 실제 열린 법규/모바일 screenshot에서 KPI·지도·법규 표의 4,039건이 일치한다. 재실행 SQL probe의 내부 4,030행/버전은 고정되고 외부 버전만 바뀌었다.

PASS: 서비스 재시작 뒤 원본 로컬 스택과 다시 대조했다. 56개 auth/private/public 테이블의 건수·행 해시, public/private 함수·trigger·ACL catalog, relay FK, 4개 시퀀스, 전체 publication, migration ledger 41개가 일치한다. 기존 12개 컨테이너 ID를 유지했고 모두 정상 실행, 관련 없는 컨테이너 시작 시각은 불변이다. 이번 작업 소유 mock/Deno/preview 포트가 남아 있지 않다. 새 RPC/시험 자료도 제거했다. 원본 dump·세션·환경값은 비공개 runtime에만 남겼다. 상세 `evidence/local-restoration.json`.

배포 명령: [MIGRATION.md](MIGRATION.md). 최종 외부 보고서는 `.agent-runs/map-cohort-timeout/REPORT-3.md`에 commit SHA와 함께 기록한다.

## 변경 파일과 배포

- SQL: `supabase/migrations/202610060600_analytics_read_snapshot.sql`, 공유 migration manifest.
- Edge/server: `publicHandler.ts`, `personalHandler.ts`, 새 `screenHandler.ts`, public-analytics/my-analytics 엔트리, user-rankings optional query 계약.
- 웹: `screenCoordinator.ts`, 데이터 clients, refresh controller/hooks, Dashboard 및 기관/법규/범위 상세 표. 기존 KPI/분모/대표 선출 집계 함수는 바꾸지 않았다.
- 검증: `screenSnapshot.test.ts`, `snapshot-contract.test.ts`, `dataset-snapshot-load.test.ts`, 실제 browser 검증 스크립트.
- 문서: data-contract/deployment/CHANGELOG/MIGRATION 및 이 보고서·재현 절차.

운영자는 auth `050100`(미적용 시) → map `060100`~`060600` SQL → public-analytics/my-analytics/user-rankings Edge → Pages 순서로 반영한다. 정확한 명령은 [MIGRATION.md](MIGRATION.md). 제품 source 커밋 `5f8ef04` 이후 최종 증거 커밋은 문서·로그·스크린샷만 포함한다. auth HEAD `66a120e`는 TASK3에서 변경하지 않았다.
