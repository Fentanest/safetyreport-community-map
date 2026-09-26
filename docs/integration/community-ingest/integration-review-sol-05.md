# community-ingest 통합 후보 독립 재검토 5차 (GPT-6-Sol, 2026-09-26)

**결론: 목표 브랜치 병합 가능.** 고정 후보 map `b467bf4`, auth `3be1c39`, PC `8a1185e`, mobile `cd4454e8`를 검토했다. 이번 판정은 승인 계획 `plan-final.md:204-209`의 **합성 스택·로컬 앱 구현 게이트**에 대한 것이다. 운영 배포나 실기기 검증 승인으로 읽어서는 안 된다. 이 세션에서 스택·Flutter·`migration_paths.sh`를 실행하지 않았다. 제출 로그는 실행의 추적 증거로만 사용했다.

## 후보와 증거의 대응

| 대상 | 확인 결과 |
|---|---|
| map | `b6bb6a6..b467bf4`의 변경은 `docs/integration/community-ingest/` 아래 문서·증거·매트릭스뿐이며 제품 코드·테스트는 같다. R5 map 로그의 `# candidate: b6bb6a6`, `# dirty: 0`, `# exit: 0`을 확인했다(`evidence/2026-09-26-r5/map-stack-run-1.log:1-18`, `map-stack-run-3-clean-reset.log:1-18`, `map-migration-paths.log:1-23`). |
| auth | HEAD `3be1c39`로 4차와 같다. R5의 `auth-unit.log:1-9`, `auth-relay.log:1-9`, `auth-browser.log:1-9`는 이전 실행 결과를 복사한 것으로 **`# cmd`·`# candidate`·`# exit` 머리말이 없다**. 각각 33 passed/35 skipped, 24/24, 11/11의 결과만 확인 가능하다. 새 후보의 독립 재실행 증거라고 쓰지 않는다. |
| PC | `git diff --stat 4754d9f..8a1185e`는 `CHANGELOG.md` 13줄 추가뿐이다. R5 `pc-unit.log:1-5,3893-3897`는 `4754d9f`, clean, 371 OK(4 skipped), exit 0; `pc-live.log:1-12`는 1 OK, exit 0; `pc-browser-smoke.log:1-5,262-264`는 126 passed, exit 0이다. |
| mobile | `git diff --stat 6c87d521..cd4454e8`는 `CHANGELOG.md` 1줄 추가뿐이다. R5 `mobile-unit.log:1-5,544-546`는 `6c87d521`, clean, 515 passed/3 skipped, exit 0; `mobile-live.log:1-10`은 1 passed, exit 0이다. `mobile-analyze.log:1-5,7-51`는 **오류 0, 경고 2·정보 38, exit 1**이다. `flutter analyze` 자체를 통과했다고 판정하지 않는다. 두 경고가 있는 `lib/screens/setup_screen.dart:581-582`는 이번 수정 범위에서 변하지 않았다. |

`map-stack-clean-check.txt:1`의 `clean_stack=true`는 명령·후보·종료 코드가 없는 보조 기록이다. 반면 초기화 후 run-3 로그의 대조 표 정책 부재 NOTICE와 21/21 통과(`map-stack-run-3-clean-reset.log:9-18`)는 깨끗한 스택에서 Realtime 준비가 다시 수행됐다는 근거다. 키를 가린 로그는 실제 실행을 이 세션에서 재현한 결과와 구별한다.

## 4차 지적과 §20-5 보완 재판정

| 항목 | 판정 | 코드·검사 및 한계 |
|---|---|---|
| 1. 모바일 `local_pending` 안내 | **해결** | `M lib/community/community_wiring.dart:51`가 `applyPendingDeletion`의 bool을 보존하고, `upload_hooks.dart:104-114`가 실패·남은 표시를 false로 전달한다. 게이트는 실패 notice를 남기고 연결을 폐기한다(`gate/community_gate.dart:522-534`); 카드는 `done`·`local_pending` 뒤 실제 정리 결과로 문구를 고른다(`widgets/community_account_card.dart:564-575`, `upload_hooks.dart:117-130`). `M test/community/integration_contract_test.dart:270-330`은 **실제 community.db·게이트·업로더**에 중앙 성공 후 로컬 확정 오류를 주입해 `prepared` 유지, 실패 문구·notice, 업로드 deferred/HTTP 0, 재요청 뒤 표시 제거·journal 차단을 확인한다. 중앙 성공은 콜백 가짜이며 위젯 클릭 자체는 시험하지 않는다. 이 결함의 로컬 상태 전파와 전송 차단은 우회하지 않는다. |
| 2. 모바일 실행 증거 공백 | **해결** | R5 모바일 단위·실스택 로그에 명령, 후보 SHA, clean 상태, 종료 코드, 통과 요약이 있고 해당 테스트명이 단위 로그에 나온다(`mobile-unit.log:316-326,544-546`; `mobile-live.log:1-10`). 최종 SHA와 실행 SHA 사이 변경은 CHANGELOG뿐이다. 정적 분석 exit 1은 위처럼 별도 제한으로 남긴다. |
| 3. PC writer 파일 후처리 순서 | **해결** | 중앙 성공 후 `confirm_deletion()`을 먼저 확정·적용하고, 그 뒤 `save_writer(None)` 실패를 `writer_reset_pending`으로 반환한다(`PC web/routers/community_route.py:284-299`). 카드가 이 경우 쓰기 권한·공간 경고를 띄운다(`web/templates/components/community_consent_card.html:207-219`). `PC tests/test_community_deletion.py:145-161`는 실제 로컬 store·journal을 쓰며 writer 저장만 `OSError`로 주입해 표시 0, `deleted_by_user`, pending 응답을 확인한다. 중앙 호출·`_regate`는 목이므로 실제 HTTP 화면 전달까지 증명하는 테스트는 아니다. |
| §20-5 모바일 capture 의도 파일 실패 | **해결** | 공식 개인 저장 경로 `SyncEngine.captureAndSaveDetail`은 `recordCaptureIntent`를 먼저 await하고, capture·개인 DB upsert는 그 뒤에 둔다(`M lib/services/sync_engine.dart:688-710,723-742`; `community/capture/capture_retry_store.dart:84-91,107-119`). 새 `M test/community/capture_intent_failure_test.dart:22-90`는 sqflite ffi **실제 개인 DB와 community.db**를 열어 부모 경로가 파일인 retry 파일에 쓰기 실패를 만들고 `CaptureStoreUnavailable`, 개인 신고 없음, detail_status 0을 확인한다. 같은 입력의 쓰기 가능 경로가 신고·capture를 저장하고 의도를 지우는 양성 대조도 있다. 단위 로그에 실행과 515 passed가 기록됐다. 사진/별점 네트워크 분기를 쓰지 않는 벡터(`:16-20`)이므로 그 분기의 실경로 동등성까지 뜻하지 않는다. |

**새 병합 차단 결함은 발견하지 못했다.** 변경부에서 `prepared` 표시가 로컬 정리 실패 때 그대로 남고, 게이트 재평가 전에 업로드가 멈추는 경로를 확인했다(`M lib/community/capture/server_completed.dart:149-176,202-208`; `test/community/integration_contract_test.dart:292-330`). PC writer 정리 실패도 로컬 삭제 확정을 되돌리지 않는다. 다만 PC 카드의 두 pending 플래그가 동시에 true이면 `local_cleanup_pending` 안내가 우선해 writer 파일 문제는 별도로 표시되지 않는다(`PC web/templates/components/community_consent_card.html:212-217`). 이는 새 **낮은 심각도의 안내 결함**이며 업로드 차단·삭제 판정을 바꾸지 않는다. 운영 중 이 조합이 나타나면 두 원인을 함께 기록해 안내를 보강할 것.

## 승인 계획 §20 게이트 최종 판정

| 게이트 | 판정 | 실제 확인 범위 |
|---|---|---|
| 1. 통합 DB | **충족(합성 스택)** | `evidence/2026-09-26-r5/map-migration-paths.log:6-23`에 빈/map 선행/auth 선행/양쪽, 공개 legacy v2 가드 및 복구 PASS가 있다. migration SHA·중복·의존성 검사도 `compose-check.log:1-8` 통과. 경쟁 검사는 실제 DB의 ingest/삭제/철회/takeover/정책 DML과 deadlock·삭제 사용자 공개 0을 본다(`map tests/integration/community-stack.test.ts:667-717`); 실스택 21/21 세 번(`map-stack-run-{1,2,3-clean-reset}.log:12-18`). 운영 이력은 별도다. |
| 2. HTTP·권한 | **충족(합성 스택)** | 실제 Edge/GoTrue/PostgREST의 중복 422·원장 0, JWT/동의/연결/세션, private REST/RPC/GraphQL 거부, 익명 published/removed·좌표 결측·오류 JSON/HTTP를 검사한다(`map tests/integration/community-stack.test.ts:214-389,481-657`). Realtime은 **실제 공개 변경 전달 양성 대조** 뒤 private 변경 0을 확인하고(`:136-161,390-444`), Storage는 service role이 넣어 읽은 실객체에 대한 비특권 읽기·쓰기 거부를 확인한다(`:446-479`). 호스팅 프로젝트 설정은 검증하지 않았다. |
| 3. manifest·앱·삭제 | **충족(로컬/합성 스택)** | 중앙 빈 `"0"`·페이지 검사와 양 앱의 전체 페이지·토큰·개수·중복·최대 3회 후 fail-closed가 코드와 테스트에 있다(`PC services/community_uploader.py:733-788`, `tests/test_community_uploader.py:527-564`; `M lib/community/capture/server_completed.dart:39-101`, `test/community/capture_test.dart:295-330`). 삭제 전 표시→중앙 성공 뒤 확정, 옛 연결·대기 차단, 재요청·reshare는 로컬 DB 테스트와 중앙 스택 삭제 fence로 확인했다(`PC tests/test_community_deletion.py:71-161`; `M test/community/integration_contract_test.dart:270-330`; `map supabase/migrations/202609260200_community_ingest.sql:420-455`). 중앙 커밋 뒤 HTTP 응답만 소실되는 실스택 주입은 미검증이다. |
| 4. 공개 버전 | **충족(합성 스택)** | 운영자 방식의 실제 fact DML 뒤 새 익명 HTTP 조회에서 `dataset_version`과 category 건수 증가를 비교한다(`map tests/integration/community-stack.test.ts:719-736`; R5 stack 21/21 ×3). |
| 5. 원천·앱 내구성 | **충족(로컬 앱 테스트 범위)** | PC의 capture 실패·retry, rebuild/ACK 상태 검사는 실제 로컬 저장소를 사용한다(`PC tests/test_community_capture.py:206-243`, `test_community_rebuild.py:307-320`, `test_community_uploader.py:352-379`). 모바일의 공식 개인 저장 진입점 의도 파일 실패·양성 대조가 새 테스트로 채워졌고, rebuild·ACK·manifest 실패도 로컬 저장소 테스트가 있다(`M test/community/capture_intent_failure_test.dart:72-90`, `test/community/rebuild_hook_test.dart:49-118`, `test/community/uploader_test.dart:130-162`, `test/community/capture_test.dart:295-330`). 양 앱 실스택 수직 시험은 capture 함수를 직접 호출한다(`PC tests/test_community_live_stack.py:142-159`; `M test/community/live_stack_test.dart:122-143`); 공식 `_run` 전체 파서를 통과했다는 뜻은 아니다. |

## 병합 후 조건과 미검증 범위

**(a) 병합부터 7일 감사 전까지:** 고정 SHA와 해당 migration·함수·앱 산출물의 대응을 보존하고, 공유 삭제 `local_cleanup_pending`/`writer_reset_pending`, 모바일 `local_pending`, 런타임 5xx, Realtime/Storage 설정 차이를 관측 가능하게 유지한다. 7일 감사에서 `acceptance-matrix.md:38,47,67,72`의 E08(fork/PR 운영 호출), I06(trigger만 다른 재전송), S-18(IP 헤더 위조), N-03(정책 불변 HTTP)의 `not-run`/`partial`을 실제 검사로 닫거나 계속 미검증으로 보고한다. `flutter analyze` exit 1의 기존 경고·정보를 정리하고, 분석을 필수 CI 게이트로 쓰려면 **종료 코드 0**을 재확인한다. PC 두 pending 플래그 동시 발생 시 사용자 안내도 점검한다.

**(b) 운영 반영 전:** 읽기 전용 `scripts/integration/preflight_counts.sql`을 실제 운영 데이터에 적용해 공개 legacy v2가 있으면 중단한다. migration 원문 SHA와 이력을 대조한 뒤 auth `202609260100` → map `202609260200` 순서로 적용하고, `deployment-and-rollback.md:3-10,12-22`의 중앙 함수·사이트·앱·제한 업로드·ready 전환 순서 및 무삭제 롤백을 따른다. 호스팅 Kakao 리디렉션, JWT/CORS·키·비밀·rate limit, private 권한, Realtime publication, Storage 정책, PC 번들·모바일 빌드 변수와 동의문, Android/iOS 실기기 권한·딥링크·복원·백그라운드를 운영 환경에서 별도로 검증한다. 중앙 capability 확인 전 앱 배포를 시작하지 않는다.

**(c) 미검증 한계:** 호스팅 Kakao, 실기기, 공식 상세의 PC↔모바일 실경로 파서 동등성, 양 앱 `_run` 전체 경로, PC broadcast 실부하 지연, 중앙 삭제 커밋 후 응답만 소실되는 실스택 주입은 **통과가 아니라 미검증**이다. 비계약 5xx는 serve 로그 사건 수로만 분리한다(`map tests/integration/community-stack.test.ts:164-170,667-714`). R5 auth 로그는 출처 머리말이 없어 이전 후보 결과 이상으로 주장할 수 없다.

**병합 차단 결함: 없음.** 위 운영·감사 조건은 이번 §20 합성 게이트 통과를 운영 배포 검증으로 확장하지 않기 위한 조건이다.
