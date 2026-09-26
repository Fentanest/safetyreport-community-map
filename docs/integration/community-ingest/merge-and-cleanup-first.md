# 1차 머지·정리 (2026-09-26, Opus5.5)

근거: GPT-6-Sol 통합 재검토 5차 "목표 브랜치 병합 가능"(`integration-review-sol-05.md`, 후보 map `b467bf4`·auth `3be1c39`·PC `8a1185e`·mobile `cd4454e8`,
증거 `evidence/2026-09-26-r5/`). 원격 push·PR·운영 반영은 하지 않았다.

## merge commit (로컬, `--no-ff`)

| repo | 목표 branch | 머지 전 | 병합한 branch tip | merge commit | 결과 tree = 통합 후보 tree |
|---|---|---|---|---|---|
| safetyreport | `dev` | `cb4b027` | `ci0926/integration` `8a1185e` | `4023f64` | 예(`d1495cd2f0a4`, `git diff` 0) |
| safetyreport-mobile | `dev` | `af2ae809` | `ci0926/integration` `cd4454e8` | `9bf23e9d` | 예(`4b61208996a5`) |
| safetyreport-community-map | `main` | `a829079` | `ci0926/integration` `467fedc` | `ec3142c` | 예(`8e7378fd536d`) |
| safetyreport-community-auth | `main` | `558ed6b` | `ci0926/integration` `3be1c39` | `c71602d` | 예(`47846b3364e3`) |

네 목표 branch 모두 통합 branch 기준 뒤처짐 0(충돌 없음). 통합 branch 가 각 작업 branch 를 이미 merge commit 으로 합친 결과이므로
merged HEAD tree 는 r5 테스트를 돌린 tree 와 같다(PC·모바일은 r5 실행 SHA 뒤 CHANGELOG, map 은 문서만 추가).
최종 merged HEAD 재검사는 감사 수정 뒤 최종 머지에서 다시 실행한다(`merge-and-cleanup-final.md`).

### 사용자 미커밋 변경 처리
- PC·모바일·auth: 사용자 미추적 파일은 병합이 건드리는 경로와 겹치지 않아 그대로 두었다.
- map: 사용자 작업 트리의 `package.json`·`package-lock.json` 수정본(supabase CLI 2.118.0 devDependency)이 통합 commit 과 **바이트 동일**했다.
  git 이 덮어쓰기를 거부해 (1) 두 파일을 `.agent-runs/ci-20260926/map-user-dirty-backup/` 에 SHA-256 과 함께 복사, (2) 통합 commit 과 `cmp` 로 동일 확인,
  (3) 두 파일만 `git checkout --` 후 병합, (4) 병합 뒤 두 파일 SHA-256 이 백업과 같음을 확인했다. 미추적 `deno.lock`·`supabase/.temp/`(새 .gitignore 대상)는 그대로 있다.

## 1차 정리
작업 전 확인: 각 worktree `git status --porcelain` 0(아래 예외), HEAD 가 목표 branch 의 조상, 해당 worktree 의 모델 작업·서버 없음.
ignored `.agent-runs/` 산출물과 `plan-review-sol` 의 미추적 검토 입력은 먼저 `safetyreport/.agent-runs/ci-20260926/worktree-archive/` 로 복사했다
(`plan-review-sol-final.md` 는 추적본과 동일 확인).

| 제거한 worktree (`git worktree remove`) | 비고 |
|---|---|
| safetyreport/{gate-rebuild, qa, rebuild, survey, upload} | |
| safetyreport-mobile/{gate-rebuild, survey, upload} | |
| community-map/{ingest, qa, survey, plan-review-sol} | plan-review-sol 은 미추적 검토 입력(보관 후) 때문에 `--force` |
| community-auth/{account, survey} | |

| 삭제한 branch (`git branch -d`, 목표 branch 에 포함 확인) | tip |
|---|---|
| safetyreport `ci0926/gate-rebuild`·`ci0926/rebuild`·`ci0926/upload` | `b5b2451`·`c5d12fb`·`f064333` |
| safetyreport-mobile `ci0926/gate-rebuild`·`ci0926/upload` | `b9a249ba`·`9333443d` |
| community-map `ci0926/ingest` | `394218e` |
| community-auth `ci0926/account` | `fa82511` |

유지(이유): 네 저장소의 `ci0926/integration` worktree·branch — 합성 로컬 스택(`ci0926-int`, 함수 serve·mock Kakao)이 map 통합 worktree 의
`.integration-stack` 에서 돌고 있고 감사 수정 재검증에 쓴다. 감사용 detached worktree `<repo>/audit` 와 map `audit-fix` 는 감사 단계에서 새로 만들었다.
모두 2차 정리 대상이다. `~/projects/worktree/` 루트와 다른 작업 폴더는 건드리지 않았다.
