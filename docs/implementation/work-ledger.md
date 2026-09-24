# 구현 작업 기록

- 기준: 2026-09-24, `main` HEAD `ff63cfd0ac49da346d96bc22a39e7157254e336f`, origin `git@github.com:Fentanest/safetyreport-community-map.git`, 작업트리 최초 clean, 추가 worktree 없음.
- 패키지: 동일 SHA-256의 ZIP 2개 중 최신 `(1).zip` 사용. `install.py` dry-run은 create 71, replace/merge 10, conflicts 9를 보고했고 `--apply --overwrite`로 배치. 기존 파일은 `.cm-bootstrap-backups/20260924T083222Z-b5d65670`에 백업. 최초 SQL migration 보존.
- 검증: blueprint unittest 27개 통과. `cm_doctor.py`는 Kakao/API/export 키가 없음을 확인. 이 상태에서 실연동은 검증 불가이며 합성 fixture UI/계약 구현은 가능.
- 원천 차이: 현재 v1은 연도·분류·지점 집계 중심이다. 임의 날짜 범위, 완료일 축, 기관·담당자×결과 교차, 원번호 기반 차량 순위를 계산할 사실이 없다. `docs/upstream-gaps.md`에 따라 unsupported capability로 표시하며 추정하지 않는다.
- 모델: OpenCode CLI 1.18.31의 `opencode models`에서 `opencode-go/muse-spark-1.3-contributor`를 확인했고 `opencode auth list`는 OpenCode Go credential 1개를 확인. 실제 응답 모델은 세션 export로 별도 확인한다.
- 파일 소유: Sol은 `contracts/`, `src/data/`, `src/domain/`, `supabase/`, `scripts/`, `tests/`의 데이터·보안, 공통 package/lock, API/CI, 통합 파일을 쓴다. Muse M0는 `docs/reviews/M0-design.md`와 증거만 쓴다. UI 구현은 별도 worktree에서 `src/components/`, `src/pages/`, `src/styles/`를 소유하도록 후속 발주한다. 동시 동일 worktree 쓰기를 금지한다.
