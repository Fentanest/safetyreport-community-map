# SONNET-MOBILE-REPORT · 모바일 검수 결함 수정 (2026-10-21)

범위: `mobile/` worktree(feat/raw-json-ingest, 기준 a03d37e0, 미커밋)만 수정. pc/map/auth, `mobile/contracts/` 사본은 건드리지 않음. 커밋·네트워크 없음. Flutter 3.47.5.

## 결과
- 전체 `flutter test --no-pub`: 마지막 전체 실행 +2419 ~19(skip) -1. 실패 1건은 `plate_group_performance_test`(부하 영향) — 단독 재실행 통과(+1). 그 외 실패 0. 처음 전체 실행의 21건은 모두 해소.
- `flutter analyze --no-pub`: No issues found.
- 중단된 이전 실행의 `raw_backfill.dart`(상태 재작성)는 `backfill_store.dart`(SQLite 건별 표)와 함께 완성하고 runtime 을 맞춰 재작성했다.
- 작업 중 실수: `git checkout` 한 번으로 `db_optimize.dart` 수정이 되돌려졌고 즉시 같은 내용(+이번 수정)으로 다시 적용했다.

## 검수 지적별 (모바일 1~17 + 낮음)
| # | 파일·요약 | 시험 |
|---|---|---|
| 1 | `gate_policy.dart`(gateVector), `community_gate.dart`(리셋 판정을 gatePolicy 로), `soft_reset.dart`(complete 가 `clearG1`: last_g1 삭제 + reset_completed_at), `consent_history.dart`, 헤드리스 `upload_background.dart` 동일 | `gate_review_test` 재로그인→동의 화면(리셋 1회), contributor none, 새 기기 |
| 2 | `raw_backfill.dart` retry 는 phase 유지, 목록 미완료면 done 불가 | `raw_backfill_review_test` retry 2건 |
| 3 | `community_capture.dart`(sticky raw_contract_scope 제거, v2 행 대기 시 v1 재생성), `community_uploader.dart`(v2 보류·v1 행 전송·보류 행이 앞을 막지 않음), `ingest_status.dart`(2 상실 시 503 쿨다운 해제), `reshare.dart`/`consent_catchup.dart`(catch-up 은 v2 면 완료 처리) | `review_fixes_test` v2→v1 5건, 503 재시도 |
| 4 | `client_server_policy.dart`(verdict: permitted/refused/unknown), `client_server_consent.dart`, 게이트 Client 분기, `upload_background.dart`, `WsService.kt`(owner 보존), `community_account_card.dart`("서버 연결 대기") | `gate_review_test` Client 4건 |
| 5 | 온보딩이 철회 대기 중에도 카카오 카드 표시, 로그인 성공 시 `CommunityReset.attempt(force)` | `gate_review_test` 로그인으로 철회 완료 (온보딩 위젯 렌더는 NOT RUN) |
| 6 | `client_notice.dart` 재작성(버전 비교, min null 숨김, status 가 정본, save 가 안 지움, 426 은 앱 버전별), `client_notice_host.dart`(배너/하루 1회 대화상자/영속 이력), 게이트·헤드리스·업로더 연결 | `review_fixes_test` notice 8건 + 위젯 |
| 7 | `consent_history.seedLastG1`: 새 버전 첫 실행 시각으로 1회 시드(검수자 추가 지시), `_prepareLocalUse` 에서 호출 | `gate_review_test` 시드 3건 |
| 8 | G7 reasons 엄격, gate 형식 이상은 G3, G9 우선. outbox 는 blocked 유지, journal 보존 → catch-up 이 재전송 | `gate_review_test`, `review_fixes_test` 리셋 후 catch-up |
| 9 | 런타임 재작성: done/보류면 타이머 정지, 로컬 선검사 후 verify, personal_sync 는 `local()` 로 쓰기 구간만, 패널 10초(진행 중만)+이벤트, poll 5분, 백그라운드 rawV2Ready 선확인·`verify:true` | nextDelay·done 시 verify 0회 시험 |
| 10 | ACK 후 journal 원본 축약(`compactRawEvent`), B 경로 이벤트 1개(enqueue 채택) | compact, adopted 시험 |
| 11 | run identity = `local_dataset_id` 하나 | identity 시험 |
| 12 | 보충 marker 표(`raw_backfill_supplements`), 실패해도 원본 전송, 재조회 없음, 캐시 무효화, 범위 정규화(`rawSnapshot`) | supplement 3건, 정규화 |
| 13 | inventory 전체 try, 인증 실패는 official_login_required | 시험 1건 |
| 14 | 삭제·부적격은 `BackfillBlocked` → not_eligible | 시험 1건 |
| 15 | 426 은 1시간 retry_wait, 게이트 무효화 안 함, 해제 시 옛 blocked 행 복구 | 시험 |
| 16 | `soft_reset.dart` 백오프(60초 배, 최대 30분), worker 는 append·force 안 함 | 백오프 시험 2건 |
| 17 | 헤드리스 markG1 은 로컬 공식 ID dataset, null 로 덮지 않음(`sessionMember` 주입 추가) | `upload_background_test` |
| 낮음 | v1 DTO 는 보강 전 report 로(기준과 같음)·rawSnapshot 은 v2 모드에서만, 실패 격리(`rawSnapshotIfReady`); `DbOptimize._captureIdentity` 예외 격리; Client 1초 prefs.reload 제거; 폰 철회 문구 분리; status 저장 세대 확인; B 경로 목록 item; schema v4 다운그레이드는 문서 안내 | rawSnapshotIfReady 시험 |

## 처음 실패 21건 → 원인/처리
- login_gate_security 4, gate_state(client…, F14), gate_silent_refresh 3, official_binding(5분 poll), client_account_notice 2, demo_gate_bypass, kakao_logout: Client 분기가 `SharedPreferences`/PC 거절 판정에 의존, poll 1분. → Client 판정을 tri-state·주입 우선·예외 격리, poll 5분 복원, F14 시험에 prefs mock.
- upload_background 2: 시험의 한글 본문 `Response`(latin1) → `Response.bytes`; 근거 없는 revoked 는 G4(consent_required).
- raw_delivery_lifecycle(늦은 철회 확인): 시험 스텁 `sessionFingerprint` 가 로그아웃 후에도 값을 줌 → 스텁이 disconnected 면 null.
- raw_backfill(fresh grant): 정책 변경(identity). community_store(v1→v2 duplicate column): 현재 통과.
- db_optimize closeDb 1b: 시작 20ms 고정 타이머 경합 → 첫 신고 처리 중 루트 zone 에서 닫기.
- plate_group_performance: 부하 영향, 단독 통과.

## 바꾼 기존 시험과 이유
`raw_backfill_test`(identity 정책), `raw_delivery_lifecycle_test`(notice API·fallback 일반 문구), `fake_account.dart`(스텁 fingerprint), `gate_state_test`(prefs mock, 대기 루프), `upload_background_test`(bytes 응답), `db_optimize_review7_test`(1b 타이밍). 이전 실행분(긴급 정책 폐기 등)은 SOL-REPORT-2 참조.

## 새 시험
`gate_review_test`(16), `review_fixes_test`(약 18), `raw_backfill_review_test`(13: 20,000건 포함), `upload_background_test` 2건 추가. PC 요청 벡터 5건(`review_gate_cases.json`, PC 와 바이트 동일)은 `raw_ingest_v2_test` 가 `gatePolicy` 로 검증(통과).

## 계약/벡터 변경 요청 (map 정본)
PC 보고서 5절과 동일: `gate-vectors.json` 의 G7·G7_new 에 `"reasons":["kakao_missing"]` 추가, 케이스 5개(G7_unproven_false, G7_malformed, G6_after_reset, G8_after_reset, G9_before_reset) 추가 — 내용은 `mobile/test/fixtures/review_gate_cases.json` 전체를 그대로 정본으로 쓰면 된다. 문서: client_notice 표시 조건(min_version 비교, null 숨김, status 가 정본), 503 service_unavailable 의 클라이언트 처리(재시도, 다음 status 에서 2 없으면 v1).

## 남은 일
- 실제 앱/AVD 렌더(배너·대화상자·온보딩 철회 대기 화면), 실제 안전신문고 호출 경로(B 상세 재수집·사진 EXIF), WorkManager/Kotlin 4403 은 NOT RUN.
- B 경로(상세 재수집)는 `captureAndSaveDetail` 안의 네트워크(사진·별점)가 한 신고 동안 personal_sync 안에 있다.
- 다른 카카오 계정으로 로그인하면 이전 계정의 철회 대기는 풀리지 않는다.
- 재실행: `cd mobile && ~/development/flutter-3.47.5/bin/flutter test --no-pub && ~/development/flutter-3.47.5/bin/flutter analyze --no-pub`
