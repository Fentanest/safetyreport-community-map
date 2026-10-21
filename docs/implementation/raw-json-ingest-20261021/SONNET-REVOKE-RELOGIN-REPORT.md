# 철회 대기 중 재로그인 — 세션 유지 (2026-10-21)

결정: 철회가 대기(revoke_pending)인 동안 사용자가 카카오로 새로 로그인해 철회가 끝나면, 그 새 세션을 끊지 않고 바로 동의 화면(G4)으로 둔다(로그인 한 번).
원래(철회 요청 때) 세션으로 끝나면 예전처럼 로그아웃 → 카카오 로그인 단계.

## 세션 식별
철회 요청 때 `revoke_pending.session_connected_at` 에 현재 세션의 확정 시각을 적는다(PC `current.connected_at`, 모바일 `sessionConnectedAt()` = 저장 세션 `connectedAt` UTC ISO).
완료 때 현재 값이 기록과 다르면(둘 다 있을 때) "새 세션". 기록 없는 옛 pending 은 원래 세션으로 본다(예전 동작).

## 변경 파일
PC (/home/better0101/projects/raw-json-ingest-ws/pc)
- services/community_reset.py: `begin` 이 `session_connected_at` 기록, `session_is_fresh()` 추가, `attempt` 의 두 완료 지점이 `soft_reset(..., keep_session=...)` 호출
- services/community_account_ops.py: `soft_reset(reason, *, keep_session=False)` — keep 이면 `service.disconnect()` 만 건너뜀(sticky 거부·gate invalidate·작업 중지·outbox blocked·context/raw_backfill/revoke_pending 삭제·reset_evidence(last_g1)·writer 삭제·게이트 캐시 clear 는 그대로)
- tests/test_soft_reset_retry.py: 시험 2건 추가
- docs/architecture/community-gate.md, docs/plans/raw-json-ingest-20261021.md
- (community_gate.py 는 수정 불필요: last_g1 이 지워진 revoked 상태는 기존 판정으로 consent_required)

모바일 (/home/better0101/projects/raw-json-ingest-ws/mobile)
- lib/services/community_auth_service.dart: `sessionConnectedAt()` 추가
- lib/community/soft_reset.dart: `begin` 기록, `sessionIsFresh()`, `complete(keepSession:)` — keep 이면 disconnect 생략, 헤드리스 게이트 캐시를 `consent_required` 로 기록(그 외 정리는 동일). `attempt` 두 완료 지점이 판정해 전달
- (community_gate.dart 는 수정 불필요: 로그인 확정 시 기존 코드가 attempt(force) 를 부르고 이후 refresh 가 G4 로 판정)
- test/community/fake_account.dart: StubAuthService 에 `connectedAt`/`sessionConnectedAt`
- test/community/revoke_pending_gate_test.dart: 시험 2건 추가
- docs/architecture/community-gate.md, docs/plans/raw-json-ingest-20261021.md

문서
- map/docs/implementation/raw-json-ingest-20261021/PLAN.md 7-4 소프트 리셋 절차 2·3·5단계 보강, pc/mobile/auth 의 docs/plans/raw-json-ingest-20261021.md 에 바이트 동일 복사(cmp 확인)

## 시험
(a) 철회 실패 → 토큰 없음 → 새 로그인(connected_at 변경) → 철회 완료 → 세션 유지, pending 삭제, 활성 문맥/raw_backfill 삭제, 게이트 consent_required, 두 번째 로그인 없음
- PC: test_revoke_completed_after_fresh_login_keeps_that_session_and_goes_to_consent
- 모바일: 'revoke completes after a fresh login keeps that session and shows the consent screen (one login only)'
(b) 원래 세션으로 완료 → 연결 해제(카카오 단계), 예전 동작
- PC: test_revoke_completed_with_original_session_still_disconnects
- 모바일: 'with the original session disconnects to the Kakao step (unchanged)'

## 결과
- PC 전체: Ran 1429 tests, OK (skipped=6)
- 모바일 analyze: No issues found
- 모바일 전체: 2429 통과, 실패 3건은 모두 부하 의존 성능 예산 시험(raw_backfill_review 20,000건, plate_group_performance, sqlite_contention) — 각각 단독 재실행 시 모두 통과. 첫 전체 실행(PC 전체와 동시)에서는 gate_review/gate_state 등 타이밍 시험도 흔들렸으나 단독 통과, 이후 단독 전체 실행에서는 나타나지 않음.
- 신규 모바일 (a) 시험은 게이트가 띄운 백그라운드 attempt/refresh 가 끝나기를 기다린 뒤 종료(DB 닫힘 경합 방지). 8회 연속 통과 확인.

## 남은 사항 (이번 범위 밖)
사용자 문구가 "철회하면 … 앱은 카카오 로그인부터 다시 시작합니다"로 남아 있다(mobile community_account_card.dart:491·community_gate.dart:467·community_onboarding_screen.dart:151, pc community_consent_card.html:48/206·onboarding_community.html:85). 원래 세션 경로에서는 여전히 맞고 새 세션 경로에서만 달라지므로 손대지 않았다. 문구 변경이 필요하면 별도 지시 바람.
