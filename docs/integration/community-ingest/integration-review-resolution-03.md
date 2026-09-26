# Sol 3차 통합 재검토 반영 (Opus5.5, 2026-09-26)

대상: `integration-review-sol-03.md`(판정 "수정 후 재검토"). 새 고정 후보: map = 이 문서가 들어간 commit, auth `3be1c39`(변경 없음),
PC `ea5c342`, mobile `729bc3da`. 증거: `docs/integration/community-ingest/evidence/2026-09-26-r4/`(추적, 키·JWT 치환).

## 차단 결함

| ID | 조치 | 코드 | 검증 |
|---|---|---|---|
| H-03c | 삭제 표시를 **prepared → confirmed** 두 단계로 나눴다. 중앙 호출 전 `prepared` 행을 쓴다. `prepared` 가 하나라도 있으면 업로드·reshare 는 **막기만** 하고, 정리 함수는 `confirmed` 만 적용·삭제한다(prepared 는 적용도 삭제도 안 함). 중앙이 성공을 돌려준 뒤에만 그 시점의 모든 표시(앞선 prepared 포함)를 confirmed 로 바꾸고 같은 흐름에서 적용한다(경계 = 적용 시점 journal 최대 rowid → 중앙 호출 중 생긴 행도 막힘). | PC `services/community_capture.py` `begin_deletion`·`cancel_deletion`·`confirm_deletion`·`apply_pending_deletion`·`deletion_state`·`deletion_cleanup_pending`, `web/routers/community_route.py` `_contributions_delete`; M `lib/community/capture/server_completed.dart`, `lib/community/upload_hooks.dart` `requestDeletion`, `community_wiring.dart` | PC `tests/test_community_deletion.py::test_prepared_marker_blocks_but_is_never_applied_or_removed_before_the_center_answers` — **중앙 호출 안에서** 새 capture·정리 시도·업로드·reshare 를 실제 DB 로 실행: 업로드 deferred·전송 0·reshare 차단·표시 prepared 유지·journal 미적용, 성공 뒤 두 행 모두 차단·표시 0. M `uploader_test.dart` "while the center has not answered …" 같은 시나리오(업로드 HTTP 호출 0) |
| H-03d | 중앙 결과를 **확정 거절(HTTP 4xx·토큰 없음)** 과 **불명(네트워크·타임아웃·5xx)** 으로 나눴다. 거절이면 자기 prepared 행만 지우고, 불명이면 행을 유지해 업로드를 계속 막고 "결과를 확인하지 못했다 — 다시 요청" 을 안내한다(PC 503 `deletion_unconfirmed`, 설정 카드 경고, 모바일 카드·게이트 notice). 다시 요청해 성공하면 앞선 prepared 까지 함께 확정·적용된다(중앙 삭제는 반복해도 안전 — 연결 폐기·tombstone·fence 는 멱등이거나 더 보수적). | 같음 + PC `services/community_gate.py` `status_view.deletion`, `community_consent_card.html`; M `community_account_card.dart`, `community_gate.dart` | PC `test_unknown_central_outcome_keeps_the_marker_and_a_retry_confirms`, `test_definitive_central_refusal_removes_only_its_own_marker`, `test_confirmed_marker_whose_apply_failed_blocks_until_applied`; M `uploader_test.dart` "unknown outcome keeps the marker; a retry confirms all; a 4xx refusal cancels only its own", `integration_contract_test.dart` "deletion request order" |
| M-02 | Realtime 대조 표 생성·publication 등록과 **실제 전달 확인**을 스위트 `beforeAll` 로 옮겼다(구독 → "Subscribed to PostgreSQL" → 대조 행 삽입을 이벤트가 올 때까지 반복, 90초 안에 못 받으면 준비 실패로 중단). 그래서 **초기화된 스택의 첫 실행**도 대조가 성립한다. Storage 읽기는 service role 로 실제 객체를 올리고 service role 읽기 200·본문 일치를 양성 대조로 확인한 뒤, 같은 객체에 대한 anon·사용자 읽기 거절(본문에 내용 없음)을 요구한다. 정리는 Storage API(service role)로 한다. | MAP `tests/integration/community-stack.test.ts` | `map-migration-paths.log`(스택 DB 초기화) 직후 `map-stack-run-1..3.log` 연속 21/21, 다시 `supabase db reset` 으로 **대조 표가 없는 상태를 확인한 뒤** `map-stack-run-4-clean-reset.log` 21/21 |

## 잔여 한계(통과로 쓰지 않음)
- 비계약 5xx 의 원인 매칭은 여전히 serve 로그 사건 **수** 대조다. 이번 r4 실행들에서 비계약 5xx 는 기록되지 않았다.
- Firefox 콘솔 실패(r3)는 trace 상 외부 CDN 폰트 다운로드 실패였고, r4 스모크는 126/126 통과(`pc-browser-smoke.log`).
- 호스팅 Kakao·실기기·공식 상세 실경로 파서 동등성·PC/모바일 `_run` 전체 경로·broadcast 실부하 지연은 **미검증**.
- acceptance-matrix 의 E08·I06·S-18·N-03(`not-run`/`partial`)은 그대로다.
