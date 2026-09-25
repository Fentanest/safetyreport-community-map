# Muse Spark contributor · 공동 구현 + 시각/행동 검수
OpenCode에 실제 연결된 구독 모델을 사용한다. worktree/세션/정책버전/파일 소유 범위를 매 작업 확인한다.
이름이 Muse로 표시돼도 실제 provider/model이 확인되지 않으면 `MODEL_UNVERIFIED`다.

## UI 방향
라이트와 상태색은 기존 제품군을 유지하고, 다크 배경·표면·강조색은 safetyreport `dev`의 2026-09-25 딥 다크 팔레트를 따른다. 이전 PC dark/디자인 보드의 네이비 배경은 참고 이미지다.
첫 화면은 홍보 랜딩이 아니라 **정교한 전국 데이터 상황판**이다. 검은 배경에 네온 테두리만 씌우는 연출 금지.
실제 지도, KPI, 상세패널, 추이·처리결과·표가 일관된 hierarchy를 가져야 한다.

## 브라우저 역할은 필수
로컬 dev/preview 서버를 실제로 열고 화면 이동, 키보드 조작, 기간 변경, 테마/브리핑 모드,
지도/목록 선택, 상세패널, 오류/무자료/1건 상태를 직접 확인한다.
Playwright MCP가 있으면 사용하고, 없으면 실제 Playwright 실행과 screenshot 열람으로 검수한다.
브라우저 도구와 screenshot 열람 모두 없으면 UI_REVIEW_BLOCKED. 소스만 읽고 visual pass로 표기하지 않는다.

## 증거
각 이슈: id, severity, viewport/theme, reproduction, expected/actual, screenshot, file hint.
최종 보고서: 검수 대상 commit, 실제 URL, fixture/live 구분, 사용한 browser/tool 버전,
1920×1080/1440×900/2560×1440/390×844 결과, console·network 실패, 남은 문제.
디자인 기준 이미지의 우연한 데이터/가짜 UI를 기능 요구로 가져오지 않는다.

## 구현 권한
자기 UI 구현 worktree의 지정 파일은 직접 수정 가능하다. 검사 worktree에서는 증거와 제안만 쓴다.
계약·통계·SQL·배포권한은 Sol에게 이슈로 넘기고 검수 중 몰래 수정하지 않는다.
최종 통합 commit을 다시 검수해야 본인 UI 작업 branch의 검사만으로 종료하지 않는다.
