# Sol 최종 인수 보고 · 원본 JSON 전환 로컬 후보

**상태: 전체 범위 미완료 / 릴리스·운영 활성화 불가.**

작업서의 P1·P2 서버 후보, P3 계정 API·정책 초안, P1b 안내, P4·P5 일반 상세 수집의 전송·게이트 변경을 구현했다.
그러나 **P4/P5 raw_backfill의 A/B/C, 완료 커서·holds·진행 UI, 모든 보충·재공유 capture 호출 지점 대응은 끝내지 못했다.**
아래 미완료 목록은 시험 환경만 기다리면 완료되는 항목과 실제 코드가 더 필요한 항목을 구분한다.
검수자는 이 보고서를 전체 구현 완료 또는 운영 전환 승인으로 사용하면 안 된다.

## 작업 경계

- 네 worktree의 branch는 feat/raw-json-ingest다. 기준 HEAD는 map 8997d78, pc 1a67d01, mobile a03d37e0, auth 3e00bc4다.
- 커밋, push, PR, 205/206 접속, 원격 SQL, Edge/Pages 배포, 정책 발급, 앱 릴리스는 하지 않았다.
- PC VERSION과 모바일 pubspec.yaml/pubspec.lock은 바꾸지 않았다. PC·모바일·auth CHANGELOG는 미출시 항목만 추가했다.
- 개인 신고 DB와 PC↔모바일 교환 스키마는 바꾸지 않았다. 추가 열은 별도 community.db의 journal에만 있다.
- 신규 wire·게이트 시험 자료는 합성이다. 고정 파서 계약 벡터는 PC 원본 커밋의 기존 사본이다. 실사용자 신고를 새로 가져오지 않았다.
- 원래 남아 있던 미완성 raw.ts·handler·계약·파서 복사본·생성 스크립트를 검토해 이어 썼다. 작업 지시서는 수정하지 않았다.
- 별도 에이전트를 호출하지 않았다. 작업서가 지정한 Claude Opus의 네 레포 전체 검수는 아직 수행하지 않았다.

## 레포별 파일 묶음과 목적

| 레포·계획 | 파일 묶음 | 구현 내용과 한계 |
|---|---|---|
| map · 3절/P1 | contracts/community-ingest-v2, scripts/raw-ingest/generate_contract.py·check_contract.py | envelope/event/ACK/supplement/notice 스키마, README/errors, 합성 UTF-8·해시·게이트 벡터, 새 account-api, MANIFEST. PC·모바일 사본과 바이트 대조. v1 폴더는 그대로 보존 |
| map · 4–5절/P1/P2 | supabase/migrations/202610210100_raw_json_ingest.sql, scripts/raw-ingest/build_migration.py·build_v2.py·migration_tail.sql·v2_rpc.sql | raw/parsed/diffs/queue, fact_source·parser·raw hash, 연결 버전, 공용 SQL fact 투영, v2 저장 RPC, 원본 예약의 타 dataset 충돌 차단, 철회·삭제 fence 정리, 30일 payload 정리. 원격 미적용 |
| map · 3절/P1 | server/ingest/handler.ts·raw.ts, supabase/functions/community-ingest/index.ts | v1/v2 분기, 기본 꺼짐, gzip·20건·전송 512KiB·해제 1MiB, 원본 바이트/해시/신고자 키/보조 DTO 검증, 저장 후 parse_pending ACK. Edge는 원문 의미 파싱을 하지 않음 |
| map · 6절/P2 | server/parser-py, scripts/raw-ingest/vendor_parser.py | PC 고정 파서 9모듈+자료·계약·provenance, 순수 DTO 추출, 정본 기관 resolver 사용, 전체 private 파싱 열, diff, SKIP LOCKED 대기열, savepoint·재시도·재연결, 버전 재파싱, Dockerfile/compose 예시. 실제 psycopg DB 실행은 미검증 |
| map · 9절/P1b | src/hooks/useClientUpdate.ts, src/components/ClientUpdateNotice.tsx·AccessGate.tsx, src/App.tsx·pages/Dashboard.tsx | 동의 안내의 최소 버전·다운로드 링크, 자기 status로 최근 v1 계약을 읽는 배너. 지도 로그인·relay·writer 변경은 분리. 실제 브라우저 화면은 미검수 |
| map · 검증/문서 | tests/product/rawIngest.test.ts·authBoundary.test.ts·test_scan_public_dist.py, tests/deno, tests/sql/verify-raw-ingest.mjs, .github/workflows/product-check.yml | 바이트·gzip·해시·비공개 경계, Python/TS 파생 결과 동등성, SQL 저장/삭제/권한/보관. 상태 조회 한 경로만 허용하도록 기존 경계 시험과 dist 스캐너 갱신 |
| map · 통합/문서 | docs/integration/community-ingest/migration-manifest.json, scripts/integration/compose_supabase.mjs·access_gate_e2e.mjs, docs/{data-contract,database,privacy-security,api,architecture,client-integration,personal-comparison,account-api}.md, implementation/work-ledger.md | 누락돼 있던 기존 migration·import 목록 보충, 12/14자리 migration 버전 지원, 안내 화면의 Playwright 단언 준비, 낡은 transferred 이전 성공 설명 정정 |
| auth · 8절/P3 | server/account.ts, supabase/functions/community-account/index.ts, tests/raw-ingest.unit.test.ts | status.ingest.contracts/raw_policy_version/최근 연결 메타와 client_notice. 같은 DB 설정 RPC 사용, 허용 origin에 대한 CORS. 기존 status protocol은 1 |
| auth · 8절/P3 | docs/policies/share-consent-2026-10-21.1.md·sha256, supabase/policy-drafts/202610210200_policy_2026_10_21_1.sql, docs/account-api.md, CHANGELOG.md | 사용자 검토용 초안과 정확한 본문 해시. 발급 SQL은 자동 migrations 밖에 두었고 실행하지 않음. map의 동의문/최신 계정 계약 사본도 동기화 |
| pc · 7-1/7-3/P4 | services/community_raw_ingest.py·community_capture.py·community_store.py·community_uploader.py·community_ingest_client.py·community_upload_policy.py, core/storage/reports_repo.py | 새 정책+capability가 맞는 일반 상세 수집에서 raw 스냅숏 고정, 보조 필드 변화 감지, community.db 스키마 4, v1/v2 분리 바이트 묶기·gzip, stored ACK·426 오류 분류. 일부 보충 경로는 미전환 |
| pc · 7-4/P4 | services/community_gate.py·community_gate_policy.py·community_cloud.py·community_account_ops.py, web/templates/base.html·components/community_consent_card.html·report_map.html, web/static/ui/shell-polling.js | 72시간·역행 시계 만료, 미동의/outdated 로컬 잠금, G1 뒤 주인 기록, 확인된 원격 철회/기존 계정 제거의 소프트 리셋, 로컬 철회 실패 시 토큰 유지, writer/context/cache 정리, outbox 차단, 업데이트 배너·parse_pending 문구 |
| mobile · 7-1/7-3/P5 | lib/community/capture/{raw_ingest,community_capture}.dart, community_store.dart, upload/{community_uploader,community_ingest_client,upload_policy}.dart, lib/services/sync_engine.dart | 일반 상세 저장 전에 원본·별점사유·사진 보조 값을 고정해 v2 capture, journal 열 추가, 바이트·gzip·ACK·오류 처리. 일부 재파싱/사진/재공유 경로는 미전환 |
| mobile · 7-4/P5 | lib/community/consent_history.dart, gate/{community_gate,gate_policy,gate_state}.dart, lib/widgets/community_account_card.dart | 보안 저장소의 마지막 G1, 72시간 유예·시계 역행 만료, 동의 잠금·소프트 리셋, writer 정리, 동의 철회 문구, 설정/동의 카드의 notice 대화상자·스토어 링크. Client 모드·전체 백그라운드 생명주기는 실제 검증 필요 |
| pc/mobile · 계약/시험/문서 | contracts/community-ingest-v2, docs/plans/raw-json-ingest-20261021.md, docs/architecture/{community-upload,community-gate,data-contracts}.md, CHANGELOG.md, 각 변경 시험과 모바일 scripts/check_raw_ingest.dart | 공통 계약·판정 벡터, 업그레이드 보존 시험, 새 정책 기대값. 옛 gate 벡터는 원본을 바꾸지 않고 v2 폴더에 개정 사본을 두었음 |

## 설계 상세와 PLAN 차이

1. PLAN 14절에 실제 선택을 반영했고 PC·모바일·auth의 docs/plans 사본을 동기화했다.
2. v2 플래그·원본 정책 버전·v1 차단일·안내는 private.community_ingest_config가 단일 정본이다.
   서로 다른 Edge 환경 변수가 status capability와 실제 수신을 다르게 만들지 않도록 두 함수가 같은 RPC를 읽는다.
   v2=false, v1_sunset=null이며 운영 값은 변경하지 않았다.
3. 최신 account-api는 새 v2 폴더와 map/docs/account-api.md·auth/docs/account-api.md에 같은 바이트로 두었다.
   작업서의 “v1 계약 불변”과 “계정 계약 사본 갱신”을 함께 지키기 위한 문서 위치 해석이다. 기존 v1 계정 문서는 역사 사본으로 남는다.
4. 공용 SQL 함수는 기존 fact 대입·lineage·순서 규칙을 추출한다. 기존 Edge 검증/deriveFact는 유지하고 Python이 같은 파생 결과를 만든다.
   PC 파서 자체를 TS로 다시 만들지 않았다. SQL 동등성 시험은 합성 의존성을 사용한 실행 시험이며 실제 Supabase 인증 시험은 아니다.
5. 정책 개정의 superseded_policy는 철회가 아니므로 원본을 지우지 않는다. 사용자/운영자/계정 철회의 lineage는 원본을 실제 삭제한다.
   원본 FK cascade가 parsed/diffs/queue를 지운다. 기존 fact 철회 처리 방식은 유지한다.
6. 원장 30일 정리는 **payload 제거**다. event_id와 불변 필드·hash·result·receipt 최소 메타는 남긴다.
   v1은 중복 재시도 때 payload 본문이 아니라 해시와 불변 필드를 비교하므로, payload를 지운 뒤에도 duplicate ACK가 유지된다.
   원장 행까지 지우면 오래된 v1 재시도가 새 이벤트가 되어 멱등성을 잃는다. SQL 시험으로 payload 제거 뒤 duplicate를 확인했다.
   최소 메타 보관 문구는 정책 초안에 명시했으며 최종 정책 검토 대상이다.
7. 워커는 공용 투영 뒤 parsed/diff를 같은 savepoint 안에서 기록한다. 후속 저장 실패는 투영까지 롤백한다.
   서비스 역할 키 대신 제한된 DB 역할과 private finish/fail/prune 함수를 사용한다.
8. 설치된 구성 manifest가 기준 커밋의 최근 16개 migration과 일부 import를 누락했고, 검사기가 CLI 형식 14자리 버전을 거부했다.
   새 raw migration을 실제로 합성할 수 있도록 목록과 버전 검사를 함께 고쳤다. 정책 초안 SQL은 이 목록에 넣지 않았다.
9. 기존 npm run test:sql은 현재 PGlite만 사용하므로 Docker 없이 실행했다. 실제 Supabase 스택 시험과 구별한다.
10. 지정 Flutter SDK는 읽기 전용이라 실행 중 cache 쓰기가 실패했다. mobile/.agent-runs 안에 같은 SDK 사본을 만들고
    CI=true/FLUTTER_SUPPRESS_ANALYTICS=true, --suppress-analytics, --no-pub로 전역 설정 변경·의존성 다운로드 없이 검사했다.

## 시험 결과

횟수는 각 명령의 결과다. 반복/부분 실행이 서로 겹치므로 합산해서 전체 통과 건수라고 해석하면 안 된다.
로그는 각 worktree의 .agent-runs/raw-ingest에 보존했다. 일부 초기 실패 후 원인 수정·재실행한 결과를 아래에 기록한다.

### map

| 명령 | 결과 | 증거/설명 |
|---|---|---|
| npm test | **1224 통과 / 11 실패 / 204 건너뜀**, 총 1439 | final-tests.log. 실패는 composeScript.test.ts의 자식 Node spawnSync EPERM 11건. 8997d78 archive 사본에서 같은 11건 재현(baseline-map-tests.log) |
| npx vitest run tests/product/rawIngest.test.ts tests/product/ingestHandler.test.ts | 29 통과 / 0 실패 | raw-edge-tests.log. 새 v2와 기존 ingest 경로. 초기 미완성 v2 변경의 v1 스트림 한도 회귀는 고쳐 통과 |
| DENO_DIR=… deno test --no-config --no-remote --allow-read tests/deno/raw_ingest_test.ts | 2 통과 / 0 실패 | deno-tests.log. 외부 import/네트워크 없이 실행 |
| python3 -m unittest discover -s server/parser-py/tests -v | 8 통과 / 0 실패 | parser-tests.log. parser/law/explicit fine/case supplement/raw/category 벡터, private 파싱, 파생 동등성 fixture |
| python3 -m unittest discover -s tests/product -p 'test_*.py' -v | 13 통과 / 0 실패 | python-product.log. dist 스캐너의 status 한 경로 허용/변경 경로 차단 포함 |
| node tests/sql/verify-raw-ingest.mjs | 1 스크립트 통과 | sql-raw.log. 실제 후보 SQL을 합성 PGlite 스키마에 적용. v1 fact 동등성, payload 정리 후 duplicate, v2 stored/duplicate, raw 동률 우선·최신 DTO, 철회 cascade·정책 대체 보존·권한 확인 |
| npm run test:sql | 3 스크립트 통과 | sql-existing.log. 현재 명령은 Docker가 아닌 PGlite 기반이다. 번호판 93벡터, 기존 SQL 경계/권한/배포 경로 검증 |
| npm run build | 통과 | build.log. 기존 chunk 크기·동적 import 경고는 남음 |
| npm run scan | 통과, 발견 0건 | scan.log. 최종 dist 대상 |
| python3 scripts/raw-ingest/vendor_parser.py --offline | 통과 | 고정 사본과 추출 DTO 대조 |
| python3 scripts/raw-ingest/vendor_parser.py --upstream ../pc | 통과, 18개 source/vector | 고정 커밋과 PC 파서 모듈·현재 순수 DTO 대조. 전체 capture의 새 전송 로직과 고정 DTO 부분을 구분 |
| python3 scripts/raw-ingest/check_contract.py --copies ../pc ../mobile | 통과, v2 계약 11파일·사본 2개 | MANIFEST 및 파일 집합/바이트 대조 |
| node scripts/integration/compose_supabase.mjs check --auth ../auth | 통과, 72 migration·7 function | composition-check.log. 파일 합성 검사이며 스택 실행/적용 아님 |
| tests/integration/*의 실제 Supabase 실행 | **NOT RUN** | Docker·loopback 네트워크 제한. npm test에 표시된 skip을 통과로 세지 않음 |
| access_gate_e2e.mjs, 실제 지도 브라우저 | **NOT RUN** | 로컬 스택/브라우저 증거는 검수자 단계. 업데이트 안내 단언만 준비 |

### pc

사용한 인터프리터는 작업서 지정 `/home/better0101/projects/safetyreport/.venv/bin/python`이다. 데이터는 새 합성 임시 디렉터리다.

| 명령 | 결과 | 증거/설명 |
|---|---|---|
| SAFETYREPORT_DATA_DIR=$(mktemp -d …) python -m unittest discover -v -s tests -p 'test_*.py' | **미완주, 180초 timeout (124)** | tests.log. test_api_input_boundary에서 전체 실행이 멈춤. 전체 통과/총 실패 건수 산출 불가 |
| python -m unittest discover -v -s tests -p 'test_community_gate.py' | 54개 중 49 setup 오류, 나머지 5 통과 | gate-tests.log. loopback HTTPServer 소켓 생성 PermissionError. 1a67d01 archive에서도 동일 54/49 재현(baseline-gate-tests.log) |
| PYTHONPATH=tests python -m unittest test_raw_ingest_v2 test_community_store test_community_capture test_community_uploader test_community_upload_control test_community_contract_vectors test_upload_policy_vectors test_community_schedule test_raw_detail_vectors test_law_parser test_explicit_fine_syntax | **240 통과 / 0 실패** | focused-tests.log. journal·스키마 이행·outbox/제어·계약·파서 회귀. 일부 기존 SQLite ResourceWarning은 남음 |
| PYTHONPATH=tests python -m unittest test_community_gate.DecideTests test_raw_ingest_v2 | **12 통과 / 0 실패** | final-gate-raw-tests.log. 최종 게이트 정리 후 재실행. raw v2 8개 + 게이트 순수 판정 4개이며 위 240개와 중복됨 |

새 시험에는 gzip 실제 전송 바이트 복원, 같은 DTO라도 보조 값 변경 시 새 journal 생성, 불변 스냅숏,
426 비재시도 분류, 실제 local_allowed의 72시간/역행 시계/명시적 거절, cache 정리가 포함된다.
네트워크 기반 소프트 리셋·재로그인·자료 소유권 통합 시험을 이 숫자로 대신하지 않는다.

### mobile

| 명령 | 결과 | 증거/설명 |
|---|---|---|
| ~/development/flutter-3.47.5/bin/flutter analyze | 시작 차단 | baseline-analyze.log. SDK cache가 읽기 전용. PATH의 3.41.6은 사용하지 않음 |
| CI=true FLUTTER_SUPPRESS_ANALYTICS=true .agent-runs/flutter-3.47.5/bin/flutter --suppress-analytics analyze --no-pub | **통과, issue 0** | final-analyze.log. 같은 지정 SDK의 worktree 안 사본 사용 |
| 같은 SDK의 flutter --suppress-analytics test --no-pub | **0 실행 통과 / 241 테스트 파일 로드 실패** | final-mobile-tests.log. Flutter tester의 127.0.0.1 소켓 생성 EPERM. 초기 시도는 native asset hook의 Visual Studio 탐색 오류도 있었음 |
| a03d37e0 archive에서 같은 SDK로 test/community/gate_evaluate_test.dart 실행 | 같은 소켓 로드 실패 재현 | baseline-mobile-socket.log. baseline 전체 초기 실행의 native hook 실패도 baseline-mobile-tests.log에 보존 |
| .agent-runs/flutter-3.47.5/bin/cache/dart-sdk/bin/dart scripts/check_raw_ingest.dart | **통과** | dart-vectors.log. G1–G11 17벡터, 원본 바이트 4벡터, envelope/supplement/DTO 해시, ACK protocol, 전체 v2 MANIFEST. Flutter native hook·소켓 없이 순수 Dart로 실행 |
| 실제 AVD·위젯·Client/Standalone 재로그인·철회 검수 | **NOT RUN** | 환경 제한. 위 Dart 벡터 통과를 실제 앱 검수로 간주하지 않음 |

SDK 사본과 기준 커밋 archive는 mobile/.agent-runs 아래의 무시되는 임시 검증 자료다. 전역 SDK/설정을 바꾸지 않았다.

### auth

| 명령 | 결과 | 증거/설명 |
|---|---|---|
| npm test | **61 통과 / 0 실패 / 51 건너뜀**, 총 112 | tests.log. capability 켜짐/꺼짐·자기 status·CORS·초안 해시 추가 시험 포함. skipped 스택 시험은 통과가 아님 |
| npm run build | 통과 | build.log |
| 새 동의문 발급 SQL 적용 | **NOT RUN — 금지 범위** | 정책 초안과 SQL 작성만 완료 |

### 공통 확인

- git diff --check 통과. HEAD·branch는 시작 값 그대로다. PC VERSION·모바일 pubspec.yaml/pubspec.lock의 diff는 없다.
- v1 계약 폴더의 diff는 없다. 새 v2 계약 사본, 최신 계정 API 사본, PLAN 사본의 바이트를 대조했다.
- 원격 DB·운영 API·실제 계정·205/206·Docker·배포 경로는 실행하지 않았다.


## 미완료: 추가 구현이 필요한 항목

1. **P4/P5 7-2 raw_backfill 전체 실행기**: meta.raw_backfill의 dataset별 완료 표시·커서·재개·3회 실패 holds·통계가 없다.
   DB 최적화 선행 대기, 목록 전 페이지 대조 A, 누락/손상 원본 재수집 B와 404/410 raw_unavailable, 별점/사유/EXIF 보충 C를
   하나의 잠금/로그인/재시도 흐름으로 연결하지 못했다. 원본 전체를 raw_backfill trigger로 enqueue하고 stored ACK로 완료하는 절차도 없다.
   기존 DB 최적화·동의 후 full crawl이 이 신규 작업을 대신 완료했다고 주장하지 않는다.
2. **PC·모바일 1:1 capture 호출 지점**: 일반 상세 수집은 연결했다. 사진 보충, 추정 금액 재전송, 재공유, 모바일 DB 최적화·재파싱 등은
   raw 스냅숏을 모두 공급하지 않는다. 일부 경로가 v1 이벤트를 계속 만들 수 있으므로 새 클라이언트 전체 전환 완료가 아니다.
3. **진행 UI와 WorkManager**: “원본 전송 n/N”, 누락 채움/못 채움, holds, foreground/background 재개, 망 제한 없음의 실제 백필 실행 연결이 없다.
4. **notice 완결성**: account status 기반 PC 배너와 모바일 계정 카드 대화상자는 구현했다. ACK에서만 바뀐 notice의 즉시 저장·전역 표시,
   426에 대한 전역 모바일 대화상자, 모든 화면의 필수 업데이트 흐름은 아직 완결되지 않았다.
5. **Client 모드**: 로컬 장애 유예로 Client를 여는 경로는 막았으나, PC 소프트 리셋을 Client의 “서버 동의 필요” 잠금으로 일관되게
   전달하는 전체 경로·오래된 세션·화면 전환은 미완료/미검증이다.
6. **소프트 리셋 실행 검수**: outbox 차단·writer/context/cache 정리 코드는 있다. 모든 수집·DB 최적화·업로더·예약/백그라운드 작업의
   즉시 중단, 실패 복구 화면과 자동 재시도, 같은 계정 재동의 후 raw 백필 재개, 다른 계정 자료 초기화 흐름을 실제 앱에서 검증하지 못했다.
7. **실제 서비스·배포 검증**: psycopg 워커 DB 왕복·동시 claim·deadlock/철회 경쟁·재파싱 배치·장시간 복구·컨테이너 실행,
   완전한 Supabase 권한/Realtime/철회/공개 API/CSV/DOM canary, 실제 브라우저·AVD 증거가 없다.
8. **긴급 정책 시험 정리**: 새 규칙에 맞춘 주요 기대값과 공통 벡터는 갱신했다. 전체 모바일/PC 네트워크 시험을 실행하지 못했으므로
   남은 구 긴급 정책 기대값·fixture 생명주기와 호출 지점은 검수자가 추가로 대조해야 한다.

위 1–6은 단순 환경 대기가 아니라 구현/통합 작업이 남은 항목이다. 이 실행에서 끝내지 못했음을 명시한다.

## 검수자가 먼저 볼 위험 지점

- 서버 플래그를 켜거나 새 정책을 발급하면 아직 백필과 모든 클라이언트 호출 지점이 준비되지 않았다. v2 기본 꺼짐을 유지해야 한다.
- Python worker의 queue → grant/raw 잠금과 ingest/revoke의 잠금 순서가 경쟁하면 deadlock이 날 수 있다.
  재시도·트랜잭션 롤백은 있지만 실제 동시 PostgreSQL 시험으로 유실/교착 없는 재개를 확인해야 한다.
- 프로젝트의 공용 fact helper는 고위험 SQL이다. v1 SQL 대입 블록 보존, 합성 실행 동등성·기존 벡터 검사는 수행했지만
  모든 기존 trigger·캐시·바인딩·tombstone 조합은 완전한 로컬 Supabase 스택에서 검증해야 한다.
- 원문/보완 요청에는 비공개 정보가 포함된다. parsed/diff/백업도 같은 삭제 경계를 유지해야 한다. 백업 정리 운영 절차는 미구현/미검증이다.
- 신규 community.db 열은 개인 DB 교환과 별도다. 스키마 1/2/3 → 4 보존·동시 업그레이드 회귀를 계속 확인해야 한다.
- 지도 status 읽기는 지도 로그인과 분리된 자기 정보 읽기 예외다. source/dist 시험은 status 하나만 허용하고 relay/계정 변경 경로를 막는다.
- 소프트 리셋 뒤에는 로그인 상태가 바뀌므로 늦게 끝난 비동기 writer/업로드/수집 결과가 새 문맥을 되살리지 않는지 확인해야 한다.
- PC·모바일 실제 버전은 원래 값이다. 3.6.0/2.5.0은 안내 설정과 합성 계약의 가정이며 배포된 새 버전이 아니다.

## 결정 필요와 계획의 모호점

- PLAN 13절의 기존 미결정: 구버전 차단 날짜, 최종 동의문 문구, 실제 릴리스 버전. 이 실행에서 결정하지 않았다.
- 30일 운영 기록 보관과 영구 멱등성용 최소 영수증 메타 보관을 동의문에 어떻게 정확히 구분할지는 초안 검토 대상이다.
  원장 행 전체를 30일 뒤 삭제했다고 표현하면 현재 구현과 다르다.
- 404/410으로 원본을 못 받는 신고를 전체 백필의 N·완료 통계에서 어떻게 설명할지 7-2의 “건너뛰기”와 “모든 stored ACK” 사이에
  세부 정의가 필요하다. 아직 백필을 만들지 않았으므로 임의로 완료 상태를 부여하지 않았다.
- 위 문서 위치·단일 설정·합성 manifest 수선 외에 새로운 제품 결정을 임의로 확정하지 않았다.

## 검수 인수 순서

raw_backfill과 1:1 호출 지점/Client 모드/전역 notice를 구현 → 완전한 로컬 스택·PC 브라우저·모바일 AVD로 전체 검수 →
정책 초안 사용자 검토 → 별도 승인된 P6/P7. 이번 작업의 변경은 커밋하지 않고 네 worktree에 남겼다.
