# PC 검수 지적 (Claude 검수, 2026-10-21)

검수자 결정은 각 항목 끝 "→" 로 적었다.

1. CRITICAL — 철회 뒤 같은 계정 재로그인 시 즉시 다시 소프트 리셋(무한 루프). `services/community_gate.py:304-308` `_refresh_locked` 가 consent.state=="revoked" 면 G1 이력·이미 리셋 여부와 무관하게 매번 soft_reset→disconnect. 로그인 확인(`community_route.py:149`, API `:343`)→regate("login")→refresh_now→revoked→리셋→로그아웃, 재동의 화면(G4)에 못 감. G8(had_g1 + contributor none, last_g1 미삭제)도 같은 루프. PC 웹·Docker·모바일 Client 공통. 예전에 철회했던 기존 사용자는 업데이트 즉시 로그아웃되고 못 들어옴. `test_community_live_stack.py` 는 regate('login') 을 우회해서 못 잡음.
   → 리셋은 "이 기기에서 G1 이 있던 grant(또는 세션)"에 대해 한 번만. 리셋 시 그 근거(last_g1 등)를 지우고, 그 뒤 로그인에서 보이는 revoked/none 은 G4(동의 화면)로. 재로그인→재동의 경로를 실제 라우트(regate('login') 포함)로 시험.
2. HIGH — 목록 단계에서 '원본 전송 다시 시도' → 0건 done. `services/community_raw_backfill.py:31-34` retry_holds 가 단계와 무관하게 phase='filling', cursor=0. items 가 빈 listing/paused(list_incomplete)/waiting_optimize 에서 누르면 filling 0건→uploading→all([])→done. 1회 일괄 전송이 영구히 건너뜀.
   → retry 는 현재 phase 를 유지하고 holds·휴지만 푼다. items 가 비어 있으면 done 이 될 수 없게(목록 단계 미완료면 done 금지) 불변식 추가.
3. HIGH(계약 위반) — v2 를 한 번 고르면 영구 고정. `community_raw_ingest.py:77-84`, `community_uploader.py:361-370`, `community_capture.py:571-600`. 운영이 v2 를 끄면 같은 grant 동안 아무것도 못 보냄. 전환 순간 outbox 의 v1 행이 raw_required 로 영구 blocked.
   → 계약(README): 공유 설정이 v2 를 끄면 서버는 503, 클라이언트는 다음 status 확인에서 v1 로 돌아간다. status `ingest.contracts` 에 2 가 없으면 v1 으로 되돌아가 v1 이벤트를 다시 만들 수 있게(대기 중 v2 행은 보류하되 v1 재생성). 전환 시 이미 있던 v1 outbox 행은 그대로 v1 으로 보낼 수 있게(영구 blocked 금지).
4. MEDIUM-HIGH — 큰 DB 성능. 신고별 상태를 meta.raw_backfill JSON 한 덩어리(2만 건 ≈4.4MB)에 넣고 건마다 deepcopy+전체 쓰기+fsync. start() 가 60초 poll 마다 run(budget=20) 만 → 원본이 이미 있어도 분당 20건(2만 건 filling ≈17시간). 실행 중 rating 토큰을 잡아 예약 크롤·DB 복원이 수 시간 굶음. request_reshare 가 v2 일 때 모든 원본을 메모리에. source_journal.raw_event_json 이 run 마다 N 건씩 쌓이고 정리 경로 없음(2만 건이면 run 당 ≈200MB).
   → 건별 상태는 별도 SQLite 표(run_id, report_id, state, attempts, ...)로, meta 에는 요약만. 원본이 이미 있는 건은 네트워크 없이 빠르게 큰 배치로. 네트워크가 필요한 단계만 요청 간격 적용. 일반 크롤과 공정하게 번갈아(잠금을 짧게 잡고 놓기). reshare 는 스트리밍/배치. journal 의 원본 사본은 ACK 저장 뒤 정리하거나 원본 표를 참조(sha)만 하고 전송 시 읽기.
5. MEDIUM — 보충(C)·행 차단이 원본 전송을 막아 done 불가. 만족도 API 확인 실패·사진 수집 실패 3회→hold, enqueue 전 예외라 원본도 안 보냄(계획: 못 받는 보충은 비운 채 기록하고 원본은 보냄). 사용자가 지운 신고 BackfillBlocked('deleted') 가 분모에 남아 영구 holds. code_blocked 도 같음. supplement 값을 스키마 범위로 정규화하지 않음(rating 0/6, 제목 1000자 초과 → 서버 422 → dead_letter → hold).
   → 보충 실패는 null 로 두고 marker 만 남기고 원본은 보낸다. 삭제된 신고·보낼 수 없는 신고는 not_eligible 로 분모에서 제외. supplement 는 스키마 범위로 정규화(범위 밖 rating→null, 문자열 길이 자르기 등 계약 규칙 확인).
6. MEDIUM — '철회 다시 시도' 버튼 항상 403. `POST /settings/community/revoke-retry`(`community_route.py:381`)가 `_GATE_ALLOW`(`main.py:366-383`)에 없음. 템플릿은 응답을 안 보고 새로고침만.
   → 허용 목록에 추가(CSRF·관리자 세션 유지), 응답을 확인해 결과 표시.
7. MEDIUM — G7 판정이 느슨함. `community_gate.py:304-306` 은 `not gate.kakao` 만 봄 → gate 키 없음/잘못된 200 도 리셋.
   → `gate.kakao is False` 이고 reasons 에 `kakao_missing` 일 때만. 응답 형식이 이상하면 G3(확인 불가) 취급.
8. LOW-MEDIUM — client_upgrade_required 플래그가 v2 ACK 성공 때만 지워짐. status 경로는 플래그를 안 지움 → 업데이트 뒤에도 하드코딩 3.6.0 FALLBACK 배너 잔존. 426 받은 행 영구 blocked.
   → status 의 client_notice 가 정본: status 가 notice null 이면 플래그 해제. 하드코딩 FALLBACK 문구 제거(서버 notice 가 없으면 일반 문구 "앱을 최신 버전으로 업데이트해 주세요"만). 426 행은 업데이트 뒤 재시도 가능하게.
9. LOW — v1 회귀 위험: `reports_repo._community_capture_for` 가 v2 꺼져도 매번 snapshot()/sha() 계산하고 예외를 안 잡음 → _CaptureFailed 로 개인 저장 롤백 가능. title_fields 병합 규칙 변경으로 v1 DTO 가 달라져 일회성 v1 재업로드. consent_jobs._tick 이 v2 준비 시 catch-up job 을 건너뛰고 return → job 영구 잔존.
   → v2 선택 전에는 raw 계산을 하지 않거나 예외를 격리(개인 저장을 절대 막지 않음). v1 DTO 생성 규칙은 기준(1a67d01)과 같게. catch-up job 은 v2 경로로 넘길 때 완료 처리.
10. LOW — 개인정보: meta.ingest_status 에 status 전체(display_name, dataset_key) 평문. community.db 0600 없음(이제 원본 전문 보관).
   → 필요한 필드만 저장. community.db 를 0600 으로(PC 기존 파일 권한 관례 따름).

## 배포 위험 (검수자 결정)
- 업데이트 직후 첫 status 확인이 실패하면 last_g1 이 없어 곧바로 G3 잠금. → 업그레이드 시 기존에 검증된 기록(기존 동의 이력의 마지막 active 확인 시각, 같은 회원·같은 DB 주인)이 있으면 그 시각으로 last_g1 을 시드한다(72시간 규칙은 그대로). 모바일도 1:1.
