# 모바일 검수 지적 (Claude 검수, 2026-10-21)

1·2·3·6·7·8 은 PC 에도 같은 로직이 있다(`pc-review.md` 1·2·3·8·배포위험·7). 두 앱을 1:1 로 고친다. "→" 는 검수자 결정.

## 치명·높음
1. 철회(G6) 뒤 같은 계정 재동의 불가(무한 리셋). `community_gate.dart:926`, `upload_background.dart:273`, `gate_policy.dart:13-15`. 서버는 활성 grant 가 없고 철회 기록이 있으면 계속 revoked. G8 도 last_g1 이 리셋 뒤 남아 같은 루프. 구버전에서 철회 뒤 로컬로 쓰던 사용자는 업데이트 즉시 영구 사용 불가.
   → pc-review 1 과 같게. 리셋 처리한 근거(last_g1 등)는 리셋 때 지우고, 이후 revoked/none 은 G4. 판정 벡터(gate-vectors.json — 지도 정본이므로 필요한 벡터 변경은 SOL-REPORT-3 에 적고 pc/mobile 사본과 Dart/Python 판정은 고친다) 갱신.
2. '원본 전송 다시 시도' → 0건 done. `raw_backfill.dart:83-98`. → pc-review 2 와 같게.
3. v2 를 끄면 v1 로 안 돌아감. → pc-review 3 과 같게.
4. Client 모드에서 PC 에 닿지 않으면 "서버 동의 필요"로 잠기고 백그라운드 알림 영구 중단. `ClientServerConsent.verify` 가 네트워크 실패를 거절로 처리(포그라운드 `community_gate.dart:1054-1056`, 헤드리스 `upload_background.dart:304` owner 없는 캐시, `notification_background.dart:47-48`, `WsService.kt` 4403).
   → 네트워크 실패·시간 초과는 거절이 아니다(G3/유예 규칙: Client 모드에서는 "서버 연결 대기" 표시만, 잠그지 않음 — 기존 Client 동작 유지). PC 가 명시적으로 can_local=false 를 준 경우만 잠금. 캐시는 owner 를 보존.
5. 철회 대기 중 카카오 토큰이 사라지면 영구 잠김. `soft_reset.dart:146-148`, 온보딩(`community_onboarding_screen.dart:393`)이 revoke_pending 일 때 카카오 카드를 숨김.
   → revoke_pending 화면에서 카카오 재로그인을 허용하고, 로그인 성공 시 철회를 다시 시도해 완료. PC 도 같은 경우(세션 만료)를 확인해 같게.
6. client_notice 가 최신 사용자에게도 매번 모달. `client_notice_host.dart:32-66`: min_version 과 앱 버전 비교 없음, info/warning 도 모달, `_shown` 메모리만. 426 플래그는 notice 키가 있는 ACK 로만 해제(`client_notice.dart:47-52`, `community_uploader.dart:1009`). `ClientNotice.save(store, current.value, upgrade:true)` 가 current null 이면 저장 notice 를 지움(`:1012`).
   → 앱 버전 ≥ min_version(플랫폼별)이면 표시하지 않음. info/warning 은 배너, required 만 대화상자. 표시 이력은 notice 내용 해시로 영속 저장(같은 notice 는 하루 1회 이하). status 의 client_notice 를 정본으로 426 플래그도 해제. save 가 기존 notice 를 지우지 않게. PC 배너도 min_version 비교·하드코딩 문구 제거(pc-review 8).

## 중간
7. 업데이트 직후 오프라인이면 기존 사용자 잠김(last_g1 이관 없음). → pc-review 배포 위험과 같게 시드.
8. G7 판정이 reasons 를 안 봄(session_missing, user_not_eligible 도 리셋). 리셋이 outbox 전체를 blocked 로 → v1 미전송분 영구 손실. 정지+철회 동시면 G9 보다 리셋이 먼저.
   → `gate.kakao is false` + reasons 에 `kakao_missing` 일 때만 G7. 판정 순서는 gate_policy 표(G9 정지가 리셋보다 먼저). 리셋 시 outbox 는 blocked 로 두되 같은 계정 재동의 시 v2 백필이 다시 보내므로 손실은 아님 — v1 모드(v2 전환 전)에서는 미전송 v1 행을 재동의 뒤 다시 보낼 수 있게 보존.
9. 부하·배터리: 백필 타이머가 done 뒤에도 15초마다(requireFresh·lease·personal_sync·marker 디코드·wakeUploadNow). 네트워크 작업 중 personal_sync 를 쥐어 사용자 동기화가 sync_busy 반복. publish() 가 항목마다 marker 전체 복사·인코딩·저장(O(N²), UI isolate). 패널 3초 디코드. 게이트 poll 5분→1분(PC 는 그대로, 주석은 5분). 패널 3초 재읽기(Client 는 3초마다 PC HTTP). 백그라운드 RawBackfillRuntime.run 이 rawV2Ready 확인 전에 refreshGateHeadless 부터.
   → done/비활성이면 타이머 정지(조건이 바뀔 때만 재시작). personal_sync 는 로컬 DB 쓰기 구간에만 짧게. 건별 상태는 별도 표(pc-review 4 와 같은 구조). 패널은 실행 중에만 10초 간격, 그 외 이벤트 기반. 게이트 poll 5분으로 되돌림. 백그라운드는 rawV2Ready 를 먼저 로컬 캐시로 확인.
10. community.db 증가: raw_event_json 무압축 append-only, B 경로가 이벤트 2개 생성(`raw_backfill_runtime.dart:318-331, 461-469`). → B 경로는 이벤트 하나만. 원본 사본 정리는 pc-review 4 와 같게.
11. 파서 세대·writer rebind 마다 전체 원본 재전송(run identity 에 parser_target·writer_epoch). → run identity 에서 parser_target·writer_epoch·connection 을 뺀다(서버가 재파싱하므로 재전송 불필요). 다시 도는 조건은 PLAN 7-2: local_dataset_id 변경, 소프트 리셋 뒤 재동의(리셋이 marker 를 지움). 정책 개정 재동의(같은 lineage)는 다시 돌지 않는다. PC 도 같게.
12. C 단계 실패가 원본 전송을 막음: 별점 조회가 휴대폰 번호 의존(`standalone_api_service.dart:374`)이라 번호 없으면 항상 hold. 조건 `별점사유==''` 라 사유 없는 별점도 매 run 재조회·"채움" 수 부풀림. 사진 조회 null 도 hold. 직접 UPDATE 뒤 캐시 무효화 없음(PC refresh_effective_rows 대응).
   → 보충은 시도 결과를 marker 로 남기고(성공/없음/불가) 실패해도 원본은 보낸다(pc-review 5). 이미 조회한 신고는 다시 조회하지 않음. 캐시 무효화 추가.
13. 목록 총건수 실패가 백오프 없이 반복(`raw_backfill_runtime.dart:240` try 밖). → try 안으로, 인증 실패는 official_login_required 로 pause(PC BackfillPaused 와 같게).
14. 삭제 tombstone 신고 영구 hold. → not_eligible 로 분모 제외(pc-review 5).
15. 426 받은 행 영구 blocked. → 업데이트 뒤 재시도 가능하게(pc-review 8).
16. 백그라운드 철회 재시도가 백오프 무시·약 1분 무한. `soft_reset.dart:95-105,196`, `background_login_check.dart:32-35`. → 백오프 준수(최대 30분, PC 와 같게), worker 안에서 자기 자신을 REPLACE 재등록하지 않음.
17. 헤드리스 markG1 dataset 값이 포그라운드와 다름(status.officialDatasetKey vs 로컬 공식 ID, null 덮어쓰기). → 같은 값(로컬 공식 ID 기준)으로 통일, null 로 덮지 않음.

## 낮음
- `_augmentRatingCause` 순서 변경으로 v1 DTO rating 출처 변화 가능, 주석 불일치. v1 모드에서도 rawSnapshot 을 capture try 안에서 계산 → 실패 시 개인 저장 막힘. → pc-review 9 와 같게(개인 저장을 절대 막지 않음, v1 DTO 규칙은 기준과 같게).
- `DbOptimize._captureIdentity` 가 예외 재던짐 → 최적화 시작 실패·running 잔존. → 예외 격리, 상태 정리.
- Client 모드 1초마다 prefs.reload(). → 필요 시점에만.
- 폰 자신의 동의 철회도 "서버 동의 필요" 문구. → 문맥별 문구 분리.
- 늦은 status 결과의 ingest_status·notice 저장이 세대 미확인. → 세대 확인.
- B 경로가 상세 `result` 를 목록 item 으로 넘겨 목록 열(신고명·만족도 등)을 상세 값으로 계산. → 실제 목록 item(또는 기존 행 스냅숏, db_optimize 재파싱과 같은 방식) 사용.
- community.db schema v4 다운그레이드 시 StateError. → 문서화(구버전으로 되돌리면 community.db 를 새로 만든다는 안내) 또는 v3 호환 유지 중 쉬운 쪽.
