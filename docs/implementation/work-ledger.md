# 구현 작업 기록

- 기준: 2026-09-24, `main` HEAD `ff63cfd0ac49da346d96bc22a39e7157254e336f`, origin `git@github.com:Fentanest/safetyreport-community-map.git`, 작업트리 최초 clean, 추가 worktree 없음.
- 패키지: 동일 SHA-256의 ZIP 2개 중 최신 `(1).zip` 사용. `install.py` dry-run은 create 71, replace/merge 10, conflicts 9를 보고했고 `--apply --overwrite`로 배치. 기존 파일은 `.cm-bootstrap-backups/20260924T083222Z-b5d65670`에 백업. 최초 SQL migration 보존.
- 검증: blueprint unittest 27개 통과. `cm_doctor.py`는 Kakao/API/export 키가 없음을 확인. 이 상태에서 실연동은 검증 불가이며 합성 fixture UI/계약 구현은 가능.
- 원천 차이: 현재 v1은 연도·분류·지점 집계 중심이다. 임의 날짜 범위, 완료일 축, 기관·담당자×결과 교차, 원번호 기반 차량 순위를 계산할 사실이 없다. `docs/upstream-gaps.md`에 따라 unsupported capability로 표시하며 추정하지 않는다.
- 모델: OpenCode CLI 1.18.31의 `opencode models`에서 `opencode-go/muse-spark-1.3-contributor`를 확인했고 `opencode auth list`는 OpenCode Go credential 1개를 확인. 실제 응답 모델은 세션 export로 별도 확인한다.
- 파일 소유: Sol은 `contracts/`, `src/data/`, `src/domain/`, `supabase/`, `scripts/`, `tests/`의 데이터·보안, 공통 package/lock, API/CI, 통합 파일을 쓴다. Muse M0는 `docs/reviews/M0-design.md`와 증거만 쓴다. UI 구현은 별도 worktree에서 `src/components/`, `src/pages/`, `src/styles/`를 소유하도록 후속 발주한다. 동시 동일 worktree 쓰기를 금지한다.
- M0: Muse `opencode-go/muse-spark-1.3-contributor` 실제 호출, session `ses_f2d7318a5ffexTb60G2pIDOJ95` export에서 provider/model 확인. 기준판 Chromium/Playwright 다해상도 캡처·조작 후 `docs/reviews/M0-design.md` 작성. 제품 파일 수정 없음.
- M1/M2: 별도 `/home/better0101/projects/safetyreport-community-map-muse` worktree에서 UI 소유를 Muse에 배정. M1 `3d6de9b`, M2 `2885747` 로컬 commit과 브라우저 증거를 회수. M2 후 Muse 구현 job 종료; 통합 branch의 UI 파일 소유를 Sol로 회수해 데이터 계약 연결과 코드 검토 결함을 순차 수정한다.
- 데이터/API: Sol branch `215b37f`에서 private plate mask-v1, 날짜축·snapshot 중복제거·TOP5·결과분모 집계, strict public DTO, Edge route/RPC migration, 공개 snapshot exporter, CI 검증을 구현. Muse UI를 로컬 merge로 통합했다.
- DB 로컬 검사: 임시 PostgreSQL 16 컨테이너에서 기존 v1 migration 후 새 v2 migration 적용 성공. anon/authenticated의 private table 및 내부 RPC 권한 없음, service_role 조회·rate RPC 가능, synthetic 1건 조회 후 기여 철회 시 `ready=false`/version 변경/0건 조회 확인. 컨테이너 종료. 운영 DB에는 연결·적용하지 않음.
