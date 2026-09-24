---
name: cm-sol-muse
description: Dispatch and recover Muse contributor via the existing OpenCode subscription workflow with verified model and session.
---
# cm-sol-muse

## 읽기
agent-dispatch-runbook.md, agent-ops-config.json, task ledger.
## 실행
opencode models/run --help/mcp list host 확인. verified provider/model로만 dispatch.
stdin DEVNULL, worktree별 lock, prompt 단일argv, exact session -s, 살아있는작업 중복발주 금지.
실제 session/export/diff/report를 회수하고 request model과 실제model을 구분한다.
## 출력
job request/result/session/actual-model evidence, file ownership, milestone review reports.
## 금지
API과금전환, 모델ID 추정, global permissions해제, broad pkill, 완료약속후결과미회수.
