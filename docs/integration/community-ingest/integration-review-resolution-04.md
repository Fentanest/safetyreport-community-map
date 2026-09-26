# Sol 4차 통합 재검토 반영 (Opus5.5, 2026-09-26)

대상: `integration-review-sol-04.md`(판정 "수정 후 재검토"). 새 고정 후보: map = 이 문서가 들어간 commit, auth `3be1c39`(변경 없음),
PC `8a1185e`, mobile `cd4454e8`(각각 실행 후보 `4754d9f`·`6c87d521` 뒤에 CHANGELOG 만 바꾼 commit). 증거: `docs/integration/community-ingest/evidence/2026-09-26-r5/`(추적, 키·JWT 치환).

## 지적 항목

| # | 조치 | 코드 | 검증 |
|---|---|---|---|
| 1 모바일 `local_pending` 안내 | 정리 훅 `onContributionsDeleted` 가 **남은 표시가 없는지(bool)** 를 돌려주고(`applyPendingDeletion` 결과를 버리지 않음), `contributionsDeletedNow` 는 그 값을 그대로 전달한다. `CommunityGate.handleContributionsDeleted` 는 정리 결과를 돌려주고 실패면 notice 를 남긴다. 카드는 `done`·`local_pending` 뒤 정리 결과로 문구를 고른다(`deletionOutcomeMessage`) — 남은 표시가 있으면 "정리를 끝내지 못했습니다 … 삭제 요청을 다시 눌러 주세요", 재시도가 끝났으면 성공 문구. | M `lib/community/upload_hooks.dart`, `lib/community/gate/community_gate.dart`, `lib/widgets/community_account_card.dart`, `lib/community/community_wiring.dart` | M `test/community/integration_contract_test.dart` "center deleted but local confirm failed (local_pending) …": **실제 게이트·community.db·업로더**로 중앙 성공 + 로컬 확정 실패 → `local_pending`, 정리 결과 false, 표시 `prepared` 유지, gate notice, 카드 문구가 성공 문구 아님, 업로드 `deferred/deletion_cleanup_pending`·HTTP 0회, journal 미적용 → 다시 요청 → `done`·표시 0·journal `deleted_by_user`·성공 문구 |
| 2 모바일 R4 실행 증거 | R4 모바일 로그가 비었던 원인은 제출용 치환 스크립트가 `00:12 +511: …` 형식 줄을 접속 로그로 오인해 지운 것이다(원본에는 511 passed·live 1 passed 가 있었지만 명령·SHA·종료 코드 머리말은 없었다 — 지적대로 증거로 부족). r5 는 모든 로그에 `# cmd`·`# candidate`(SHA)·`# dirty`·`# start/end`·`# exit` 를 남기고, 치환 스크립트는 키·JWT·ANSI 만 바꾼다(줄 삭제 없음). | `.agent-runs/ci-20260926/run-evidence.sh`(로컬 실행기) | `mobile-unit.log` 515 passed(3 skipped) exit 0 · `mobile-live.log` 1 passed exit 0 · `mobile-analyze.log` error 0(warning 2 는 2026-04 의 `setup_screen.dart` 기존 경고, info 38 — `flutter analyze` 는 이 때문에 exit 1) |
| §20-5 모바일 capture 의도 파일 쓰기 실패 | 새 테스트로 `SyncEngine.captureAndSaveDetail` **전체 경로**를 실제 개인 DB(sqflite ffi)와 실제 community.db 로 실행한다. retry 파일의 부모가 일반 파일이라 쓰기가 실패하면 `CaptureStoreUnavailable`, 개인 DB 에 신고 없음, community.db `detail_status` 0행. 양성 대조로 같은 입력·쓸 수 있는 파일이면 개인 DB 저장·`detail_status` 1행·의도 제거. | (코드 변경 없음) | M `test/community/capture_intent_failure_test.dart` 2건 |
| 3 PC 후처리 순서 | 중앙 성공 뒤 **로컬 확정·적용을 먼저**, writer 파일 삭제는 그 뒤. writer 삭제 실패는 로그 + 응답 `writer_reset_pending: true`(하위호환 추가 필드), 설정 카드 경고. | PC `web/routers/community_route.py` `_contributions_delete`, `web/templates/components/community_consent_card.html`, `docs/architecture/community-upload.md` | PC `tests/test_community_deletion.py::test_writer_file_failure_after_central_success_does_not_block_local_confirmation`(writer 저장 `OSError` 주입 → 표시 0·journal `deleted_by_user`·`writer_reset_pending`) |

## r5 실행 결과

| 영역 | 결과 |
|---|---|
| mobile 단위 / 실스택 / analyze | 515 passed(3 skipped) / 1 passed / error 0 |
| PC 단위 / 실스택 | 371 OK(skip 4) / 1 OK |
| map 단위 / Deno 2.9.7(4 함수) / compose check | 74 passed / 4 ok / ok |
| map migration 4경로 + legacy 가드 | PASS(`map-migration-paths.log`, 끝에 `clean_stack=true`) |
| map 실스택 | 초기화 직후 run-1·run-2 21/21, 다시 `supabase db reset` 뒤 대조 표 없음 확인(`map-stack-clean-check.txt`) → run-3 21/21 |
| PC 브라우저 스모크(chromium+firefox) | 126 passed, exit 0 |
| auth | 후보 변경 없음(3be1c39) — r4 로그 복사(`auth-*.log`, 머리말 없음) |

## 잔여 한계(통과로 쓰지 않음)
- 실제 중앙 커밋 뒤 HTTP 응답만 사라지는 경우는 주입 테스트 범위다(실스택에서 재현하지 않음).
- 비계약 5xx 원인 매칭은 serve 로그 사건 수 대조다.
- 실스택 수직 시험은 양 앱 공식 개인 저장 진입점 대신 capture 함수를 직접 부른다. 모바일 `captureAndSaveDetail` 의도 파일 실패는 위 단위 테스트로 따로 확인했다.
- 호스팅 Kakao·실기기·공식 상세 실경로 파서 동등성·PC/모바일 `_run` 전체 경로·broadcast 실부하 지연은 **미검증**.
- acceptance-matrix 의 E08·I06·S-18·N-03(`not-run`/`partial`)은 그대로다 — 7일 감사에서 다룬다.
