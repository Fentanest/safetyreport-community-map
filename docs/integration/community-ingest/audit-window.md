# 최근 7일 감사 창 (고정)

- `audit_started_at`: **2026-09-26T13:10:08+09:00 (KST)** = 2026-09-26T04:10:08Z (UTC)
- 창: **[2026-09-19T13:10:08+09:00, 2026-09-26T13:10:08+09:00]**. 작성 시각(author date) 또는 커밋 시각(committer date) 중 하나라도 창 안이면 포함.
- 기준: 1차 머지 직후 로컬 목표 branch HEAD. 감사용 worktree 는 이 SHA 에 detached 로 고정했다(`~/projects/worktree/ci-20260926/<repo>/audit`).

| repo | 목표 branch | 고정 HEAD | tree(=통합 후보 tree) | 창 안 commit(merge) | 창 경계 부모 | 범위 파일 |
|---|---|---|---|---|---|---|
| safetyreport (PC) | `dev` | `4023f64a554427cc637d12ebc69236984508cfeb` | `d1495cd2f0a4` | 128 (8) — 09-24 69, 09-25 31, 09-26 28 | `17df6cb` | 267 (`git diff 17df6cb..HEAD`, +31814/−4465) |
| safetyreport-mobile | `dev` | `9bf23e9df7af34d5bad793eaf3af212c9d583add` | `4b61208996a5` | 81 (4) — 09-24 48, 09-25 14, 09-26 19 | `c64be69a` | 338 (+38999/−4290) |
| safetyreport-community-map | `main` | `ec3142cec05b728416d1be3c137453ddbe27a58d` | `8e7378fd536d` | 42 (2) — 09-23 1, 09-24 12, 09-25 6, 09-26 23 | 없음(첫 commit 이 창 안) | 저장소 전체 354 |
| safetyreport-community-auth | `main` | `c71602d67f51f078e26a1a6cb56066acf9133065` | `47846b3364e3` | 9 (2) — 09-26 9 | 없음(첫 commit 이 창 안) | 저장소 전체 88 |

commit 목록·파일 목록: `audit-scope/<repo>-commits.txt`, `audit-scope/<repo>-files.txt`.

## 범위 확인
- 작성·커밋 시각을 둘 다 봤다. 네 저장소 모두 한쪽 시각만 창 안인 commit 은 없었다(작성 시각이 창 이전인 commit 0, 합집합 수 = 커밋 시각 기준 수).
- 병합으로 들어온 오래된 commit: PC `17df6cb` 이전 기록은 창 밖이며, 창 안 merge 8건의 두 번째 부모는 모두 창 안 작업 branch 였다(경계 부모 1개).
- shallow 아님(4개 모두 `--is-shallow-repository=false`).
- 원격: 감사 시작 직후 읽기 전용 `git fetch origin` 을 했다. `origin/dev`·`origin/main` 에만 있는 commit 은 **0**(4개 저장소). 반대로 목표 branch 가 원격보다 앞선 commit: PC dev 32 / 모바일 dev 22 / map main 20 / auth main 5(원격 push 안 함).
- 이번 작업 전 사용자 미커밋 변경(범위 밖, 수정 안 함): PC `docs/refactor-hardening-test-plan-2026-05.md`·`testresults/`·`tests/test_db_backup_regression.py`(미추적), 모바일 `kr.go.safepeople-157/`·`resultstest/`·`safepeople.md`(미추적), map `deno.lock`(미추적). map 의 `package.json`·`package-lock.json` 수정본은 통합 commit 과 바이트 동일했고 1차 머지로 추적 상태가 됐다(`merge-and-cleanup-first.md`).
- 보지 못한 범위: 없음(원격 PR 은 이번 작업에서 만들지 않았고 조회하지 않았다).
