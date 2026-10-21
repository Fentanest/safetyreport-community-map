# Standalone 첫 실행 계정 이중 입력 수정 보고 (2026-10-21)

## 원인
모드 선택 -> SetupScreen Standalone 로그인에서 `_loginStandalone` 이 데모 판별 뒤 `onModeSelected(standalone)` 만 호출하고 입력값을 버렸다.
이후 게이트(카카오·동의) -> 권한 -> `_SetupFlow` 가 SetupScreen 을 빈 폼으로 다시 보였다. base a03d37e0 부터 존재.

## 설계
- 새 `lib/services/pending_standalone_credentials.dart`: 메모리 전용 홀더(set/clear). 디스크·prefs 기록 없음.
- 루트 `_SafetyReportAppState` 가 홀더를 소유. 첫 SetupScreen 은 `credentials:` 로 받아, 로그인 버튼에서 값을 채운 뒤 `onModeSelected` 호출(게이트 전에는 로그인·저장 없음).
- 게이트·권한 뒤 `_SetupFlow` -> `SetupScreen(initialMode: standalone, credentials:)`. 값이 있으면 폼을 채우고 로딩 상태로 post-frame 에 기존 `_loginStandalone()` 을 한 번 자동 실행
  (StandaloneAuthService.login / prepareStandaloneAccount / 대기 DB 가져오기 / setStandaloneConfig / 계정 초기화 확인 모두 버튼과 동일 코드). 성공 시 기존 흐름 그대로.
  실패 시 값이 채워진(비밀번호 가림) 폼 + 오류 메시지. 실행 직후 홀더를 비운다(성공·실패 모두).
- 빈 아이디/비밀번호/휴대폰은 게이트 전에 바로 "모두 입력" 오류로 막는다(게이트 뒤 뒤늦은 실패 방지). 데모 demo/demo 판별은 그 앞이라 그대로 즉시 진입.
- 홀더 비움: 자동 로그인 후, 모드 선택으로 복귀/설정 완료/모드가 standalone 이 아닐 때(`_buildHome`), 게이트 canBrowse 상실(카카오 로그아웃·soft reset), 앱 detached, 백그라운드(paused) 5분 후 타이머, 루트 dispose.
- 프로세스가 죽으면 메모리가 사라져 사용자는 로그인 폼을 한 번 본다(허용). 설정 화면 로그인(onModeSelected 없음)·Client 모드·Demo 보기 링크는 영향 없음.
- PC 웹 setup 에는 이런 이중 입력이 없다(참고).

## 변경 파일 (mobile/)
lib/services/pending_standalone_credentials.dart(신규), lib/screens/setup_screen.dart, lib/main.dart,
test/community/single_login_test.dart(신규 6건), test/community/entry_order_test.dart(기존 시험이 휴대폰 없이 로그인 -> 새 검증에 맞춰 휴대폰 입력 추가), CHANGELOG.md(미출시 1줄).

## 시험
- 신규 6건: 한 번 입력 후 게이트·권한 뒤 로그인 1회(처음 값)·두 번째 빈 폼 없음, 게이트 전 prefs 비어 있음 / 실패 시 채워진 폼(비밀번호 obscure)+오류, 수정 후 1회 제출 성공 / 모드 선택 복귀 시 값 폐기 /
  불완전 입력은 게이트 전 거절 / demo/demo 즉시 진입(게이트 없음; 테스트 환경 DB 시드 실패 시 실패 안내로도 데모 경로 확인) / 홀더 단위.
- 수정 전 실패 확인은 못 했다(git 되돌리기 금지로 수정 전 코드 복원 불가). 결함 경로는 코드상 `onModeSelected` 직후 값 폐기로 설명되며, 새 시험의 "로그인 1회·채워진 폼" 단정은 옛 코드에서 성립할 수 없다.
- `flutter analyze --no-pub`: 0 issues. 전체 `flutter test --no-pub`: +2437 ~19 -1, 실패 1건은 plate_group_performance_test 50k budget(부하 평균 60 상태에서 단독 재실행도 4182ms 로 초과, 변경과 무관한 성능 시험).
- 에뮬레이터·실기기 검수는 하지 않았다(not-run).

## 사고 기록 (주의)
작업 중 `dart format <시험파일> lib` 를 시스템 dart(3.41.6)로 잘못 돌려 lib 72개 파일이 포맷만 바뀌었다(내용 불변, 하지만 curly 린트 34건 발생).
git 되돌리기가 금지라 HEAD 포맷본 기준 3-way 병합(`git merge-file`)으로 변경 없던 영역의 옛 스타일을 복원했고,
남은 린트 27건은 `dart fix --apply --code=curly_braces_in_flow_control_structures` 로 중괄호만 추가해 0건으로 만들었다.
남은 영향: 브랜치가 바꾼 영역과, 병합 충돌/신규라 복원 못 한 파일(upload/community_ingest_client.dart, upload/upload_policy.dart, widgets/community_upload_panel.dart, 신규 backfill_store·raw_capture_source·raw_ingest·client_server_consent·raw_backfill·raw_backfill_runtime·soft_reset·client_notice_host)은 새 포맷 스타일로 남아 diff 에 공백/줄바꿈 소음이 있다. 의미 변경 없음.
통합 전 이 파일들의 diff 를 확인하거나 원하면 원본 스타일로 재포맷할 것.
