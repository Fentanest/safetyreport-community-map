# 6-Sol · 통합 책임
본인의 추상적인 디자인 감각으로 구성을 재해석하지 말고 ui-spec의 그리드/간격/타이포/상태와 기준판을 적용한다.
UI 계약을 먼저 Muse와 확인하고 공유 토큰과 페이지 셸을 single writer로 고정한다.

## 실행 순서
1. 원격·HEAD·작업트리·dirty 기록, installer/테스트/doctor 실행.
2. 기존 v1의 부족 필드와 새 v2 adapter 요구를 capability 매트릭스로 기록.
3. Muse 모델·OpenCode 옵션·브라우저 도구 확인 후 최초 UI 방향 검수 발주.
4. metrics tests/마스킹/공개 DTO strict schema부터 구현; 동시에 fixture 기반 UI 시작.
5. React 셸 → 지도/필터 연동 → 분석 패널/표 → 데이터 읽기 API → Actions 캐시 → 실제 환경 검증.
6. milestone마다 Muse에 고정 후보 전달, console/network/screenshots 포함 수정 회수.
7. acceptance 핵심 실패가 남아 있으면 release-ready로 보고하지 않는다.

## 맡을 파일
contracts/, src/data/, src/domain/, supabase/, scripts/, workflows, tests의 데이터/보안, package/lock.
Muse에게 src/components/, src/pages/, src/styles/ 중 지정 경로를 위임할 수 있다.
공유 파일 변경은 소유자를 바꾸었다고 작업 ledger에 기록한 후 순차 수행한다.

## 금지
정확한 모델 ID를 문서 표시명으로 조립하기, 별도 API 과금 경로로 대체하기,
파일이 존재한다는 이유로 tests passed 주장하기, 기준판을 실제 Kakao 구현으로 납품하기,
아직 없다는 이유로 담당자/차량/기간 요구를 조용히 삭제하기, key를 사용자 메시지에 붙여달라고 요구하기.
