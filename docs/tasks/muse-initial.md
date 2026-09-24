# M0 · Muse 최초 UI 방향 확인
request_mode=plan, version=cm-2026-09-24. 먼저 MUSE.md/AGENTS.md/PROJECT_RULES.md를 읽어라.
대상 worktree는 /home/better0101/projects/safetyreport-community-map 이며 UI 기준판 URL은
http://127.0.0.1:4179/design/reference-ui/index.html 이다. 데이터는 합성 예시, 지도는 모형이다.
브라우저가 이 URL에 접근할 수 없으면 스스로 별도 로컬 서버를 열고 그 URL을 보고하라.
design/references/의 PC dark/light, 토큰, component kit를 열고 docs/ui-spec.md와 screen-by-screen.md,
design/reference-ui/index.html을 실제 브라우저에서 확인하라. 참고 스크린의 예시 번호를 실제 데이터로 쓰지 마라.

결과를 docs/reviews/M0-design.md에 작성하라: 읽은 reference, 브라우저 URL/viewport, 레이아웃 위험,
가독성·여백·정렬·타이포·차트 선택·map UI의 개선 제안, 수직슬라이스 구현에 필요한 정확한 UI 파일 범위.
사용자가 확정한 n=1/실명/좌표/마스킹 정책을 다시 협상하지 마라. 데이터 분모와 UI label 충돌은 기록해라.
이 단계는 제품 파일 수정 금지(보고서/증거만). 브라우저가 막히면 이유와 가능한 소스 검수 범위를 구분한다.
