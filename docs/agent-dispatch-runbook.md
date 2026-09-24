# Sol × Muse 호출·브라우저 검수 런북
근거: WorklazyTools 2026-09-22 docs/agent-dispatch-runbook.md Muse/OpenCode 절,
해당 blob 46253121e8db79c0a57897764b6bfc4cea39348d. 구현 model gpt-6-sol, muse_runtime_id=null.
현재 host 설치본이 최종 명령 계약이다. 이 문서는 특정 Muse provider ID를 추정하지 않는다.

## 1. 첫 확인
```bash
git rev-parse --show-toplevel
git rev-parse HEAD
git status --short
git worktree list --porcelain
python3 scripts/cm_doctor.py
python3 scripts/muse_dispatch.py doctor --worktree "$WORKTREE"
```
실제 `opencode models` 목록과 기존 구독 연결에서 Muse Spark contributor 지원을 확인하고
로컬 `.agent-runtime/runtime.json`의 muse_runtime_id에 정확한 provider/model 문자열을 기록한다.
variant가 별도라면 확인된 variant를 요청서에 기록한다. 새 API key/유료 API 경로를 자동 생성하지 않는다.

## 2. 작업 격리
Sol은 공유 계약·통합 writer. Muse UI 구현은 별도 worktree branch를 만들고 승인 파일만 소유한다.
기준 파일을 아직 commit하지 않았다면 미승인 commit으로 위장하지 말고 별도 copy+diff 전달 또는 순차작업을 사용한다.
각 workspace에는 독립 dev port와 browser session을 사용한다(예: Sol4173/Muse4174).
모델 세션 fork는 파일격리를 대신하지 않는다. node_modules·fixture mutable 공유를 피한다.

## 3. 호출
작업지시서는 worktree 내부 파일에 둔다. 긴 shell 문자열을 eval로 실행하지 않는다.
```bash
python3 scripts/muse_dispatch.py dispatch --worktree "$MUSE_WORKTREE"   --model "$MUSE_MODEL_ID" --prompt docs/tasks/muse-initial.md --timeout 1800
# 같은 작업의 정상 후속만, 실제 session ID로 재개
python3 scripts/muse_dispatch.py dispatch --worktree "$MUSE_WORKTREE"   --model "$MUSE_MODEL_ID" --prompt docs/tasks/muse-review.md --session "$SESSION_ID" --timeout 1800
```
실제 명령 형태는 WorklazyTools와 동일한 `opencode run --dir ... --model ... [-s ...] PROMPT < /dev/null`이다.
실행기는 stdout/stderr/request를 `.agent-runtime/jobs/`에 남기고 foreground로 결과를 회수한다.
명시한 시간은 watchdog일 뿐 모든 작업을 같은 시간에 끝내라는 지시가 아니다.
같은 worktree에 살아있는 lock이 있으면 두 번째 호출 금지. lock이 stale이면 owner PID/로그 확인 후에만 해제.
정확한 session과 worktree가 일치할 때만 -s. -c 기본 사용 금지. 동일 worktree 대안 실험만 --fork+--session.

## 4. 실제 실행 확인
exit0/첫 '착수합니다'만으로 완료하지 않는다. 실제 생성파일/diff/test/report를 확인한다.
JSON event의 sessionID를 수집하고 설치본 `opencode export <id>`로 해당 모델·directory를 확인한다.
요청 model만 기록된 경우 'actual model verified'라 쓰지 않는다. docs/reviews 보고서에 확인근거를 남긴다.
실패/timeout시 자기 subprocess만 terminate, broad pkill/다른 세션 reset 금지.
도구옵션/권한/모델 부재를 구분하고 원인이 분명한 부분만 수정 후 1회 재시도. 자동 과금 전환 금지.

## 5. 브라우저 도구
`opencode mcp list`, 실제 설치된 Playwright MCP와 browser 실행 경로를 확인한다.
미설정이면 `.opencode/opencode.browser.example.json`을 참고하되 기존 설정을 덮지 말고 merge한다.
예제는 이미 lockfile에 설치한 @playwright/mcp를 `npx --no-install`로 실행하는 구성이며
설치명/옵션 지원은 `--help`로 확인한다. global permission을 전부 allow로 바꾸지 않는다.
MCP 없이도 Muse가 shell에서 Playwright를 실행하고 screenshot을 열 수 있으면 실제 검수로 인정한다.
스크린샷만 받고 클릭/키보드/network를 전혀 확인하지 않으면 행동 검수 미완료.

## 6. 검수 시점
M0: family refs+기준판을 읽고 레이아웃 방향 확인.
M1: 지도+KPI+필터 수직 슬라이스 실제 browser, dark/light/390.
M2: 모든 기능+edge fixture 실제 browser, 1440/1920/2560/mobile.
M3: Sol 통합 commit에 최종 재검수. Muse 자신이 만든 화면만 검사해서 완료하지 않는다.
확인 가능한 토큰 절약: 사소한 수정마다 전체 검수 반복 대신 milestone/공유 UI 변경/최종 통합에 집중한다.

## 7. 실패 보고
MODEL_UNVERIFIED / AUTH_BLOCKED / UI_REVIEW_BLOCKED / LIVE_MAP_BLOCKED / UPSTREAM_SCHEMA_GAP을 구분한다.
검수 실패를 숨기지 않되 이를 이유로 독립적인 Sol 데이터/타입/fixture 구현까지 중지하지 않는다.
미완료 잡을 띄운 채 결과를 약속하고 대화를 끝내지 않는다. 남은 잡/결과를 명시적으로 회수한다.
