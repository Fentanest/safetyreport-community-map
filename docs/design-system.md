# 디자인 시스템 · 구현용 토큰과 에셋
원본 참고 보드(사용자가 이전 제품군에 제공한 이미지)는 실제처럼 보이는 샘플 개인정보 때문에 2026-09-26 저장소에서 삭제했다.
`design/tokens.json`과 CSS는 이를 읽어 정리한 community-map 구현 정본이다. 다크 중성 표면·강조색은 safetyreport `dev` 커밋 `2f20f2e`의 `contracts/dark-palette.json`에 맞췄다. 상태색과 라이트 모드는 기존 community-map 값을 유지한다.

## 파일
- design/tokens.json: 브랜드·두 테마·상태·간격·radius·타이포·motion.
- design/tokens.css: 같은 색의 CSS custom properties, semantic chips, 기본 surface·focus.
- design/assets/family-mark.png: 사용자 LOGO 보드의 아이콘 부분을 정확히 잘라 재사용한 에셋.
- design/assets/family-logo-light.png, family-logo-dark.png: 원본의 테마별 wordmark crop.
- design/reference-ui/index.html + ui.css + app.js: 키 없이 브라우저로 확인할 수 있는 기준판.
- design/references/*: 삭제됨(2026-09-26). 토큰·기준판·로고 crop만 남는다.

## 패밀리 일체감
카메라/안전도로/방패 계열 기존 로고를 임의의 새로운 상표로 대체하지 않는다.
화면 제목 '커뮤니티 신고 지도', 작은 product family label '나만의 안전신문고'.
blue/cyan은 브랜드 강조, green/amber/red는 처리결과 의미, pink는 과태료로 고정.
새 SVG/아이콘이 필요하면 일관된 stroke1.75~2, 20/24px viewBox로 구현. emoji를 실제 UI icon으로 쓰지 않는다.
사용할 icon 라이브러리·라이선스를 확인하고 dependency pin. 폰트 파일은 이 패키지에 포함하지 않는다.

## CSS primitive
panel(radius16,border1), panel-header(gap12,height>=52), kpi(value tabular),
chip(pill,height24~28), button(height40 desktop/44 touch), icon-button(40/44),
table-row(44~48), drawer(400/100vw), tooltip(max320,wrap), empty-state(min200) 기준.
raw hex를 화면마다 흩뿌리지 말고 토큰 경로를 사용한다. 숫자 색/아이콘만 바꾸고 status meaning을 바꾸지 않는다.

## 에셋 구현 방침
gradient/mesh/glow는 CSS로 가볍게 만들고 지도/차트 위의 정보를 가리지 않는다.
개별 민원·차량 사진은 공개 UI에 필요하지 않으므로 원본 보드 사진을 실제 데이터처럼 재사용하지 않는다.
광고용 거대 히어로 일러스트 때문에 첫 화면에서 KPI/지도가 밀려나게 하지 않는다.
MUSE가 실제 화면에서 spacing, glare, readability, inconsistent shadow를 확인하고 수정한다.

## 검증
dark/light에서 status text 대비, disabled/focus, chart tooltip, date picker, toast, drawer까지 검사.
색만으로 상태를 구분하지 않는다. 배지 text/선형태/마커외곽을 사용한다.
UI 기준판의 지도 모형은 실제 지도 인증·성능·저작권 검사를 대체하지 않는다.
