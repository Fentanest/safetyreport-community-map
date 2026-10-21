# SONNET-MOBILE-REPORT-2 (AVD 검증 결함 5건 수정)

작업 위치: /home/better0101/projects/raw-json-ingest-ws/mobile (Flutter 3.47.5, 미커밋). git 상태 변경 명령, 네트워크, 에뮬레이터 사용 없음.

## 1. 철회 대기 + 토큰/세션 소실 -> 일반 "로그인 만료" + 동의 카드
- 원인: community_gate.dart `_refresh` 의 세션 무효 분기와 토큰 null 분기가 `CommunityReset.pending` 을 보지 않았다(상태 응답 뒤에서만 확인).
- 수정: `_holdRevokePending()` 추가. 세션이 valid 가 아닐 때와 토큰이 없을 때 pending 이면 `revoke_pending` 으로 유지하고 재시도 타이머 재개, 업로드 비활성. 온보딩은 기존대로 revoke_pending 에서 동의 카드를 숨기고 카카오 카드를 보인다.
- 로그인 1회 문제: PC 도 동일하게 두 번 로그인한다. `services/community_reset.attempt` 는 pending 계정과 같은 세션이 있어야 하고, 성공하면 `ops.soft_reset` 이 `service.disconnect()` 로 방금 세션까지 끊는다. 모바일 `CommunityReset.complete` 도 `disconnect()`. 지시에 따라 PC 와 갈라지지 않고 유지했다(철회 완료 뒤 동의 화면에 가려면 로그인 2회: 철회 마무리용 + 새 동의용). 바꾸려면 PC 와 함께 soft_reset 에서 disconnect 를 빼야 하므로 결정 필요.
- 파일: lib/community/gate/community_gate.dart
- 테스트: test/community/revoke_pending_gate_test.dart (reauthRequired / disconnected / 토큰 null 3건, 수정 전 실패 확인), test/widgets/community_onboarding_flow_test.dart (세션 없음 + 철회 대기 시 문구 표시, 동의 체크박스 없음).

## 2. 필수 공지 다이얼로그 두 번
- 원인: 리스너와 `_load()` 가 같은 틱에 `_show()` 를 불러, `_handled` 가 두 await 뒤에 세팅되어 둘 다 통과.
- 수정: `_resolving`(공지 해시) 가드를 await 이전에 동기로 설정, finally 에서 해제. 결정 뒤 `_handled` 를 동기 세팅. 하루 1회(shownRecently) 유지.
- 파일: lib/widgets/client_notice_host.dart
- 테스트: test/widgets/raw_progress_notice_test.dart 새 케이스 (스토어에서 required 공지 로드 -> 다이얼로그 정확히 1개, 확인 후 호스트 재생성해도 재표시 없음). 수정 전 2개로 실패 확인.

## 3. Client "서버 연결 대기" 표시 불가
- 원인: 표시가 Standalone 전용 설정 블록 안의 community_account_card 에만 있었다.
- 수정: `ClientServerWaitingBanner` 추가(비차단, 작은 줄 "PC 서버 연결 대기"), MainNavigationScreen 상단 CloudDelayBanner 옆에 Client 모드에서만 표시. 게이트에 `markClientServerUnreachable()` 추가(이후 버전 재확인 실패 시 표시, 다음 게이트 확인이 해제).
- 파일: lib/widgets/cloud_delay_banner.dart, lib/community/gate/community_gate.dart, lib/main.dart
- 테스트: test/widgets/client_waiting_banner_test.dart (PC 불가 시 표시 + canEnter 유지, mark 후 표시 / 다음 확인에서 해제).

## 4. main.dart:282 setState 화살표 + PC 불가 시 차단 화면
- 수정 1: `setState(() { _serverVersionFuture = ...; })` 블록 본문.
- 수정 2(릴리스 경로): 원래 최초 실행은 PC 확인이 성공해야 진입하는 의도이므로 그대로 유지(첫 확인이 네트워크 오류면 'PC 서버 연결 확인' 차단 화면). 한 번이라도 성공한 뒤(같은 주소·키) 일시 실패(네트워크 오류 또는 HTTP 5xx, `ServerConnectionResult.isTransient`)는 `_onCompatibilityFailure` 에서 `onGateBlocked`/WS 중지/화면 교체를 하지 않고 대기 배너만 띄운다. 401·비호환은 기존대로 차단. `_buildHome` 도 같은 조건으로 차단 화면을 건너뛴다.
- 추가 발견: `ClientCompatibility` 가 일시 실패 결과를 영구 캐시("명시적 재시도 전까지 차단")해 PC 복귀 후에도 API 호출이 계속 거부될 수 있었다. 일시 실패는 15초 뒤 재확인하도록 변경(`transientRetryAfter`). 명시적 거부는 기존 유지.
- 파일: lib/main.dart, lib/services/server_connection_service.dart (`isTransient`), lib/services/client_compatibility.dart
- 테스트: test/community/entry_order_test.dart (성공 뒤 networkError 는 차단 화면 없음 / 401 은 차단, 최초 실행 networkError 는 차단 유지). 수정 전 실패 확인.
- 한계: 1분 초과 PC 불가의 실기기 재현은 하지 않았다(에뮬레이터 미사용). 위 위젯 테스트로 대체.

## 5. 철회 처리 중 화면 '다음' 활성
- 원인: `_canGoNext` 가 카카오 연결 + 서버 동의 active 만 봤다.
- 수정: `_revokePending` 이면 `_canGoNext` false, 안내 문구 "철회 처리가 끝나면 카카오 로그인부터 다시 시작할 수 있습니다."
- 파일: lib/screens/community_onboarding_screen.dart
- 테스트: community_onboarding_flow_test.dart (로그인 유지 + 동의 active + 철회 시작 -> 다음 비활성). 수정 전 실패 확인.

## 기타
- test/community/gate_state_test.dart F14: 새 await 로 백그라운드 확인이 테스트 종료 뒤로 밀려 DB closed 오류 -> 테스트 끝에 300ms 대기 추가(제품 로직 변경 아님).

## 검증
- `flutter analyze --no-pub`: No issues found.
- `flutter test --no-pub` 전체: 2429 통과, 19 skip, 1 실패(plate_group_performance_test 부하 의존) -> 단독 재실행 통과. 실질 실패 0.

## 남은 것
- 철회 완료 후 로그인 2회(PC 와 동일, 결정 대기).
- AVD 재검증(철회+토큰 소실, 공지 1회, 배너 가시성) 필요.
