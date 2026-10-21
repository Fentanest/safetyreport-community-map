# PC 최종 버그 검토 (커밋 b2e8679, 2026-10-21) — "→" 는 검수자 결정

1. HIGH — 예전에 로그아웃했던 사용자는 게이트 ok 인데 실시간 업로드가 조용히 멈춤(v2 꺼짐에서도).
   `services/community_cloud.py:330` local_allowed 가 deny 가 있으면 무조건 False, `:408` capture_context, `:360` seed_g1 도 동일.
   `community_account_ops.py:50` logout() 이 non-sticky deny('logout') 를 남기고 명시적 동의 POST 에서만 지움.
   재현: open_gate → ops.logout() → 같은 카카오 재로그인 → regate('login') → 게이트 ok, capture_context() == (None,'unverified_owner').
   → local_allowed·seed_g1 은 sticky deny 또는 사유(consent_revoked, account_removed, suspended, db_owner_mismatch, official_account_mismatch)에서만 거부.
     non-sticky logout deny 는 로그인 확정 때, 그리고 mark_g1·record_status 가 active 를 확인할 때 지움. 시험: logout→재로그인→capture_context active.
2. MED-HIGH — revoke_pending 중 카카오 세션을 잃으면 영구 잠김. `community_reset.py:59` 세션 없으면 False(시도 증가 없음),
   `community_gate.py:245` pending 이면 무조건 revoke_pending, `onboarding_community.html:35-56` 은 그때 로그인 UI 를 숨김.
   또 로그인 라우트의 regate('login') → `_refresh_locked`(`community_gate.py:328`)가 서버 revoked + 남은 last_g1 을 보고
   soft_reset(keep_session=False) 를 먼저 불러 새 세션도 끊음(attempt 의 keep_session 판정 우회). consent-revoke not_found 도 무한 재시도.
   → revoke_pending 이고 세션이 valid 가 아니면 로그인 UI(start/confirm) 표시. pending 중에는 _refresh_locked 의 G6 리셋을 건너뛰고
     community_reset.attempt 에 맡김. 로그인 확정 시 refresh 전에 attempt(force=True). not_found 는 stale_grant 처럼 status 재확인.
     실제 라우트(regate('login') 포함) 시험.
3. MEDIUM — 원본 1회 전송 중 예약 크롤이 조용히 건너뛰어짐(약 절반), 수동 크롤·DB 복원·로그아웃 자료 삭제 간헐 실패.
   `community_raw_backfill_runtime.py:52-60` 3초 slice 마다 rating 토큰, `crawl_manager.py:124` start_crawl 은 토큰이 잡혀 있으면 False →
   scheduler "건너뜁니다", 재시도 없음. `crawl_manager.py:71` hold_for_restore 도 RestoreBlocked.
   → 크롤·복원·로그아웃이 원본 전송 때문에 실패하거나 건너뛰지 않게 한다. 방법: crawl_manager 에 "대기 요청" 표시를 두고 원본 전송은
     건마다 확인해 즉시 토큰을 놓고 멈춘다(다음 poll 에서 재개). 예약 크롤·수동 크롤·복원은 원본 전송이 토큰을 쥐고 있으면 짧게(최대 slice+여유)
     기다렸다 진행. 네트워크 없는 단계는 토큰 없이 진행 가능하면 그렇게. 시험: 원본 전송 중 예약 크롤이 실행된다, 복원이 성공한다.
4. LOW-MED — v2 에서 재동의 catch-up 작업이 소비되지만 다시 보내지 않음(`community_consent_jobs.py:32-37`, marker done 이면 아무것도 안 함).
   → 계보가 바뀐 작업(non-active→active)이면 시작 전 raw_backfill marker 를 지워 새 run 으로 전체 재전송.
5. LOW-MED(개인정보) — `community_uploader.py:524-526` ACK 뒤 축약을 v2 행에만 함. v1 으로 ACK 된 행, 소프트 리셋 blocked 행, 로그아웃 자료 삭제 뒤
   회전된 옛 journal 에 raw_event_json 전문이 남음. raw_backfill_supplements 목록 행도.
   → durable ACK 면 형식과 무관하게 축약. rotate_dataset·소프트 리셋 때 raw_event_json 을 비우고(해시만), 옛 dataset 의 supplements 삭제.
6. LOW — `community_raw_backfill_runtime.py:213-223` enqueue() 가 import 안 된 reports_repo 사용 → import.
7. LOW — `community_uploader.py:962` v1 봉투에 trigger 'raw_backfill' → 프로토콜 2 일 때만 사용(v1 은 기존 trigger 로).
8. LOW — `community_capture.py:486-489` capture_scope_changed 가 CaptureStoreUnavailable 로 개인 저장 롤백·크롤 중단, `:895` resend 도 전체 중단.
   → 개인 저장은 절대 막지 않음: inactive 로 journal 에 남기거나 컨텍스트 재조회.
9. LOW — `community_store.py:163` os.chmod 예외 미처리 → try + note_fallback.
10. LOW(성능) — raw_backfill.start() 가 v2 꺼진 사용자에게도 60초마다 스레드·lease. seed_g1 이 저장마다 파일 잠금·복호화 2회.
   → start 앞에서 v2_ready 아니면 즉시 return, seed 는 읽기로 먼저 조건 확인.
