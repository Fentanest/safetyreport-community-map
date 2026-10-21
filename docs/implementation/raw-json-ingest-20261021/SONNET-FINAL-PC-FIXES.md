# PC 최종 검수 반영 보고 (2026-10-21, 미커밋, /home/better0101/projects/raw-json-ingest-ws/pc)

전체 시험: `unittest discover -s tests -p "test_*.py"` → Ran 1457, OK (skipped=6). 새 시험은 tests/test_final_pc_fixes.py (28건).
첫 전체 실행에서 3건 실패(기존 stub CrawlManager 속성, fallback 분류 시험, start() 시험의 v2 전제)를 고쳐 재실행 통과. 시간 민감 실패 없음.

## 1 로그아웃 뒤 재로그인 (HIGH)
- 원인 확인: local_allowed·seed_g1 이 deny 가 있으면 무조건 거부. logout() 의 non-sticky deny 가 재로그인 뒤에도 남아 capture_context == (None,'unverified_owner').
- 수정: services/community_cloud.py — `blocking_deny`(sticky 또는 사유 5종만 거부), local_allowed·seed_g1 적용, `_clear_logout_deny`를 mark_g1·record_status(active 확인)·`logout_confirmed_login`에서 호출. services/community_account_ops.py regate('login')이 로그인 확정 때 호출.
- 시험: test_1_logout_then_relogin_restores_capture_context(실제 라우트 로그인·ops.logout·재로그인), test_1_sticky_and_reason_denies_still_block_local_allowed.

## 2 revoke_pending 중 세션 상실 영구 잠김 (MED-HIGH)
- 원인 확인: 세션 없으면 attempt False, 템플릿이 로그인 UI 숨김, _refresh_locked 가 pending 중에도 soft_reset(keep_session=False).
- 수정: community_gate.py — evaluate/status_view 에 `session`; _refresh_locked 는 pending 이면 소프트 리셋을 건너뜀. community_account_ops.regate('login')은 갱신 전에 attempt(force=True). community_reset.py — not_found/account_not_found 도 stale_grant 처럼 grant 비우고 status 재확인. onboarding_community.html — 세션 없는 pending 이면 계정 카드(start/confirm) 표시 + 폴링 새로고침.
- 시험(실제 HTTP start/confirm 라우트 → regate('login')): test_2_lost_session_shows_login_ui_and_relogin_finishes_revoke_keeping_session, test_2_refresh_while_pending_does_not_soft_reset_before_attempt, test_2_revoke_not_found_rechecks_status_like_stale_grant.

## 3 원본 1회 전송 vs 크롤·복원·로그아웃 삭제 (MEDIUM)
- 원인 확인: 3초 slice 마다 rating 토큰 → start_crawl False(건너뜀), hold_for_restore RestoreBlocked.
- 수정: crawl_manager.py — reserve_rating(owner), `_rating_owner`, `_yield_waiters`, `backfill_should_yield()`, `_await_backfill_release()`(최대 10초, 원본 전송 토큰일 때만) 를 start_crawl·hold_for_restore 앞에서 호출. community_raw_backfill_runtime.py — owner='raw_backfill'로 예약, yield_requested 가 대기 요청이면 즉시 True, optimization_ready 는 대기 요청 중 재예약 안 함. 로그아웃 자료 삭제·DB 복원은 hold_for_restore 를 쓰므로 함께 해결.
- 미적용: "네트워크 없는 단계를 토큰 없이 처리"는 하지 않음(양보 방식으로 충분).
- 시험: BackfillYieldsToCrawlAndRestore 5건(예약 크롤 실행, 복원 성공, 별점 점유는 기다리지 않음, 백엔드 양보/재예약 안 함, 대기 상한).

## 4 재동의 catch-up(v2) 미전송 (LOW-MED)
- 수정: observe() 가 작업에 `lineage_changed`(이전 상태 != active) 기록. community_consent_jobs._tick 이 v2 에서 lineage_changed 면 start() 전에 raw_backfill·raw_backfill_retry marker 삭제. active 유지 grant 갱신은 유지.
- 시험: ConsentCatchupResendsUnderV2 3건.

## 5 원본 전문 잔존 (개인정보)
- 수정: CommunityStore.compact_raw_events / drop_backfill_supplements. community_uploader._apply_ack — durable ACK 면 형식 무관 축약. rotate_dataset — 전체 축약 + 옛 dataset supplements 삭제. soft_reset — 전체 축약 + supplements 전체 삭제.
- 시험: RawCopyIsCompacted 3건(v1 ACK, rotate, soft reset).

## 6 enqueue reports_repo import: 수정(runtime enqueue). 시험 test_6_*.
## 7 v1 봉투 trigger: `_envelope` 가 raw 없는 이벤트면 raw_backfill → recovery. 시험 test_7_*.
## 8 capture_scope_changed: 예외 대신 문맥을 inactive 로 낮춰 journal 에만 기록(개인 저장·크롤·resend 중단 없음). 시험 test_8_*.
## 9 chmod 예외: try + note_fallback. 시험 test_9_*.
## 10 v2 꺼짐 비용: raw_backfill.start() 가 v2 준비 아니면 즉시 return(기존 test_review_fixes_state 시험에 v2 status 전제 추가), seed_g1 은 읽기로 먼저 조건 확인(대상일 때만 잠금). 시험 test_10_*.

## 추가 지시 (a)(b)(c)
- (a) 공식 로그인 거부: RuntimeBackend.connect 가 '로그인 거부'/설정 없음 → official_login_required(permanent) , 그 외 official_login_retry. RawBackfill.run — permanent 는 10년 정지 + login_fp(계정·비밀번호 해시·토큰 지문) 저장, 지문이 바뀌면(설정 저장·수동 로그인) 즉시 재개. 비영구는 300초부터 2배, 최대 3600초(login_failures 는 진행 성공 시 0). 상세 401/403(outcome auth)은 비영구로 백오프. 시험 LoginRejectionBackoff 3건.
- (b) db_optimize.only_holds_left(): 현행 target, done=false, holds 있음, next_retry_at 있음(부분 완료), 실행 중 아님 → optimization_ready 통과. 시험 OptimizeHoldsOnlyIsReady 2건.
- (c) revoke_pending 중 다른 계정 로그인: begin 이 display_name 기록, evaluate 가 revoke_account_mismatch/name 제공, 템플릿이 "철회 중인 계정(이름)으로 로그인해야 철회를 마칠 수 있습니다" + 계정 카드(로그아웃). 다른 계정이 철회를 끝내지 않음. 시험 RevokePendingOtherAccount.

## 문서
docs/architecture/community-gate.md, community-upload.md 에 "최종 검수 반영" 절 추가.

## 모바일 1:1 대응 확인 필요 항목
1(로그아웃 deny 가 재로그인 뒤 로컬 허용·캡처를 막지 않음), 2(철회 대기 중 세션 상실 시 로그인 UI, pending 중 G6 리셋 건너뜀, 로그인 확정 시 철회 먼저, not_found 재확인), 3(원본 전송이 크롤·복원·로그아웃 삭제에 양보), 4(lineage_changed 재전송), 5(ACK 형식 무관 축약, 회전·리셋 시 축약·supplements 삭제), 7(v1 봉투 trigger), 8(캡처 문맥 변경이 개인 저장을 막지 않음), 10(v2 꺼짐 시 start 즉시 반환), (a)(b)(c) 전부. 6·9 는 PC 전용(import 누락, chmod).
