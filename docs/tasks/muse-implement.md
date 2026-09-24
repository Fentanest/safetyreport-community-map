# Muse UI 공동 구현 작업서 템플릿
request_mode=implementation / policy_version=cm-2026-09-24.
Sol은 발주 전에 아래 칸을 실제 값으로 채운다. 미기입이면 제품 수정을 하지 말고 ownership 확인만 보고한다.
WORKTREE: __FILL__
BASE_COMMIT: __FILL__
OWNED_PATHS: __FILL__
DEV_URL: __FILL__
DATA_MODE: demo|live __FILL__

AGENTS/MUSE/PROJECT_RULES와 UI 문서를 따라 승인된 UI 파일을 구현한다.
공통 contracts/package-lock/SQL은 권한 밖이다. 정확한 공개 DTO에 맞춰 UI를 연결하고 mock flag를 보존한다.
완료 조건은 실제 클릭/기간변경/dark/light/mobile 검증, screenshot, console/network 오류 기록,
수정 diff와 테스트 결과다. 최소 n=1을 숨기지 말고 가짜 실지도/실데이터로 보여주지 마라.
