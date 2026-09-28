# 2026-09-28 로컬 검증 기록

범위는 세 worktree의 미커밋 diff다. 운영 Supabase, 배포, push는 실행하지 않았다. `community-stack.test.ts`는 로컬 합성 Supabase가 없어 실행되지 않았으며, 작성한 SQL 이전 테스트를 통과했다고 주장하지 않는다.

| 위치 | 실행 명령 | 종료 코드 | 결과 |
|---|---|---:|---|
| community-map | `npm ci --offline --ignore-scripts --no-audit --no-fund` | 0 | 로컬 npm 캐시에서 75패키지 설치 |
| community-map | `npx vitest run tests/product/ingestHandler.test.ts` (npm 설치 전) | 1 | npm 레지스트리 DNS `ENOTFOUND`; 이후 offline 설치로 해결 |
| community-map | `npm test` | 1 | 215 passed, 31 skipped, `composeScript.test.ts` 2 failed. 이 샌드박스에서 Node `spawnSync`가 `EPERM`을 반환하고 stderr가 비어 테스트 기대와 다름 (`node` 직접 재현). 신고번호 단위 검사는 통과 |
| community-map | `npm test -- --exclude tests/product/composeScript.test.ts` | 0 | 215 passed, 31 skipped |
| community-map | `npx vitest run tests/product/ingestHandler.test.ts` | 0 | 9 passed |
| community-map | `npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --skipLibCheck --allowImportingTsExtensions --types node,vitest/globals tests/integration/community-stack.test.ts` | 0 | 통합 테스트 TypeScript 컴파일 |
| community-map | `deno check server/ingest/handler.ts` | 0 | Edge handler 타입 검사 |
| community-map | `npm run build` | 0 | Vite production build |
| community-map | `npm run scan` | 0 | dist 공개/비밀 스캔 통과 |
| community-map | `sha256sum -c MANIFEST.sha256` (`contracts/community-ingest`) | 0 | 계약 정본 해시 일치 |
| pc | `python3 -m unittest tests.test_community_upload_control.UploadControlTest.test_report_number_is_sent_outside_observation tests.test_community_upload_control.OwnerTransferAckTest tests.test_community_capture.CaptureTest.test_report_number_backfill_keeps_observation_hash tests.test_community_contract_vectors tests.test_community_store` | 0 | 20 passed |
| pc | `python3 -m unittest tests.test_community_contract_vectors` | 0 | 어댑터 신고번호 단언 추가 후 7 passed |
| pc | `python3 -m unittest tests.test_community_capture.CaptureTest.test_report_number_backfill_keeps_observation_hash tests.test_community_contract_vectors tests.test_community_upload_control.UploadControlTest.test_report_number_is_sent_outside_observation` | 0 | 최종 PC 경로 수정 후 9 passed |
| pc | `python3 -m unittest tests.test_community_capture tests.test_community_store` | 1 | 당시 28 run, `sqlalchemy` 미설치 1 error 및 v3 추가 전 테스트 기대값 1 failure. 기대값은 고쳐 후속 선택 검사 통과 |
| pc | `python3 -m unittest discover -s tests -p 'test_*.py'` | 1 | 291 run, 97 errors (`sqlalchemy`, `pandas` 등 미설치), 1 failure (기존 백그라운드 재시도 시간 검사: 고정 2026-09-27 시각과 실제 생성 시각 불일치), 5 skipped. 전체 통과 아님 |
| pc | `sha256sum -c MANIFEST.sha256` (`contracts/community-ingest`) | 0 | 계약 사본 해시 일치 |
| mobile | `flutter test --no-pub test/community/community_store_test.dart test/community/capture_test.dart test/community/contract_vectors_test.dart test/community/upload_policy_vectors_test.dart` | 0 | 105 passed. 뒤이은 업로더 추가 검사는 이 실행에 포함되지 않음 |
| mobile | `flutter test --no-pub --reporter compact` | 1 | Flutter SDK `/home/better0101/development/flutter/bin/cache/engine.stamp`가 읽기 전용이라 실행 시작 전 중단 |
| mobile | `flutter analyze --no-pub` | 1 | 같은 Flutter SDK 읽기 전용 문제 |
| mobile | `/home/better0101/development/flutter/bin/cache/dart-sdk/bin/dart /home/better0101/development/flutter/bin/cache/flutter_tools.snapshot test --no-pub test/community/capture_test.dart` | 1 | 같은 SDK 캐시 `lockfile` 읽기 전용 |
| mobile | `/home/better0101/development/flutter/bin/cache/dart-sdk/bin/dart analyze lib/community/capture/community_capture.dart lib/community/capture/report_adapter.dart lib/community/capture/reshare.dart lib/community/community_store.dart lib/community/upload/community_uploader.dart lib/community/upload/upload_policy.dart lib/widgets/community_upload_panel.dart test/community/capture_test.dart test/community/community_store_test.dart test/community/contract_vectors_test.dart test/community/upload_policy_vectors_test.dart` | 1 | 처음에는 패널 `blockedReasons` 필드 누락을 찾아 수정했고, SDK 외부 telemetry 파일도 읽기 전용. 후속 `CI=true` 검사 통과 |
| mobile | `CI=true /home/better0101/development/flutter/bin/cache/dart-sdk/bin/dart analyze` | 0 | 전체 분석 7개 기존 info, error/warning 0 |
| mobile | `CI=true /home/better0101/development/flutter/bin/cache/dart-sdk/bin/dart analyze test/community/uploader_test.dart` | 0 | 새 업로드 전송 단언 타입 검사 |
| mobile | `CI=true /home/better0101/development/flutter/bin/cache/dart-sdk/bin/dart analyze test/community/capture_test.dart` | 0 | Report→어댑터 신고번호 단언 타입 검사 |
| mobile | `sha256sum -c MANIFEST.sha256` (`contracts/community-ingest`) | 0 | 계약 사본 해시 일치 |
| 세 레포 | `git diff --check` | 0 | 공백 오류 없음 |
| community-map | migration manifest SHA-256 Python 검증 | 0 | `202609280800` 파일과 manifest 일치 |

## BLOCKED

- 로컬 실스택: `docker ps`가 `/var/run/docker.sock` 접근 거부를 반환했다. Supabase 함수/SQL을 실제 Postgres에 적용한 통합 검사, 동시 A/B, 삭제·철회 상호작용, 집계 건수·기여자 수·공개 비노출 런타임 검증은 BLOCKED. 기존 migration 또는 운영 DB에는 적용하지 않았다.
- PC 전체 스위트: 이 작업환경 Python에 `sqlalchemy`, `pandas` 등이 없어 97 import 오류. 첫 실행에서 재시도 시간 검사 1건도 실패했으며 변경 관련성은 입증되지 않았다.
- 모바일 전체 Flutter 스위트: SDK 캐시가 작업 허용 경로 밖의 읽기 전용 영역이라 뒤이은 명령을 시작하지 못했다. 앞서 완료된 105개 관련 검사는 유효하지만 새 `uploader_test.dart` 단언의 런타임 결과는 미검증.
- 지도 전체 스위트의 compose 2건: Node 자식 프로세스 `EPERM`로 테스트 harness가 stderr를 받지 못했다. compose 자체는 `node scripts/integration/compose_supabase.mjs check` 직접 실행 시 기대 문구·종료 코드 2를 냈다.

## 적용 전 확인

합성 로컬 Supabase에서 신규 migration을 적용하고 위 `community-stack.test.ts`를 실행해야 한다. 현재 SQL은 코드·해시 검증만 마쳤으므로 운영 적용 판단에는 실스택 결과가 필요하다. 실제 PC·모바일 클라이언트는 Edge/migration 배포 뒤 배포한다.

## Claude 재검증 (2026-09-28, 위 BLOCKED 해소)

Sol 샌드박스 밖에서 같은 worktree를 다시 검사했다. 운영 DB·배포·push 없음.

| 위치 | 실행 | 결과 |
|---|---|---|
| community-map | 별도 로컬 스택(`rot0928-int`, 포트 573xx — 기존 `ci0926-int` 스택은 건드리지 않음)에 migration 13개 적용 후 `COMMUNITY_STACK=1 npx vitest run tests/integration` | 첫 실행: 신규 이전 테스트 4건 전부 `server_error`. 원인은 migration 187행 `e->'payload' - 'status' - 'status_raw'` 가 연산자 우선순위로 `e -> ('payload' - …)` 로 해석된 것(`operator is not unique: unknown - unknown`). 괄호로 수정, manifest SHA 갱신 |
| community-map | 수정 후 DB 초기화·재실행 | 29 통과 / 2 실패. 실패는 둘 다 `my-analytics-stack` (두 파일 동시 실행 간섭 1건 + 아래 기존 결함 1건) |
| community-map | `my-analytics-stack` 단독 실행 | 6 통과 / 1 실패(`contributor-only map: no sign-in → 401` 에서 오류 코드 `auth_required` 누락) |
| community-map | 같은 테스트를 수정 전 `main`(09c216b) 스택으로 단독 실행 | 동일하게 1 실패 → **기존 결함, 이번 변경과 무관** |
| community-map | `npm test` / `npm run build` / `npm run scan` | 217 통과·31 건너뜀 / 0 / 0 (compose 테스트 포함) |
| pc | `.venv/bin/python -m unittest discover -s tests -p 'test_*.py'` | 516 실행, OK (5 skipped) |
| mobile | Flutter 3.47.5 `flutter test` (3.41.6 이 남긴 `build/unit_test_assets` 삭제 후) | 740 통과·14 건너뜀 |
| 세 레포 | `sha256sum -c MANIFEST.sha256` (`contracts/community-ingest`) | 모두 일치 |

남은 결정: 처리상태 예외는 사용자 확인으로 `status_raw`·`status` 두 필드만 유지한다(2026-09-28).
