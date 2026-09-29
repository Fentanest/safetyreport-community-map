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
- 통합 수정: `d050334`에서 10,000개 원 지점의 1,000개 이하 표시 노드, 지도 fallback과 0/미지원 표현을 보강. `c4c3cd5`에서 담당자 행의 기관/담당자 조회 키 분리, React StrictMode에서 히스토리 중복 entry 제거, 수동 Pages workflow를 추가. `7dabd20`에서 오류 fixture와 Pages 서브패스/파비콘 경로를 보정. M3-F가 검수한 제품 코드 커밋은 `56c7a3ad15356d6e9e4e52618c36275e7e9f2d39`이며 이후 report/status 문서 commit은 제품 코드를 바꾸지 않는다.
- M3: 별도 review worktree에서 실제 `opencode-go/muse-spark-1.3-contributor` 세션 `ses_f2d44ceeaffepn0D0u3f4dT74T` 호출·export 확인. Chrome 154/Playwright 1.63, 8개 viewport/theme 셀과 73개 행동 검사(72 pass, 개발 서버 Back 중복 1 fail). 보고서 `docs/reviews/M3-integration.md`, 스크린샷 19개. 결함은 `c4c3cd5`에서 수정.
- M3-F: 고정 통합 커밋을 별도 review worktree에서 같은 실제 모델 세션 `ses_f2d31e98fffe6K7dC6Xnqeskv5`로 재검수하고 export로 provider/model 확인. dev 19/19, 로컬 Pages 서브패스 6/6, console/4xx 0; Back 1회 복귀와 기관/담당자 키 분리, 1/0/미지원, offline/429/stale를 실제 Chrome으로 확인. 보고서 `docs/reviews/M3-final.md`, 스크린샷 17개. 데모 미지원 기관 범위의 표 빈 상태 문구 1건은 비차단 관찰로 기록.
- 2026-09-25 다크 배색: safetyreport `dev` `2f20f2e`의 딥 다크 정본을 Sol이 `design/tokens.*`, 앱/기준판 UI, 차트 색·설계 문서에 반영했다. 테마 관련 8개 파일은 별도 고정 후보 `b66c8ca`와 byte 일치한다. Sol 단독 실행 후 UI 파일 소유는 Muse 검수 worktree로 넘기지 않고 review-only로 고정했다. Muse 실제 `opencode-go/muse-spark-1.3-contributor` 세션 `ses_f28e733feffelfdoBWD1jm9igq`를 export로 검증했고, Chrome 154/Playwright 1.63의 8개 viewport/theme와 상호작용 검수 결과·스크린샷은 `docs/reviews/dark-palette-muse.md`에 있다. 합성 fixture 범위 PASS, 실 Kakao 키 부재는 기존 BLOCKED.
- 최종 로컬 검사: Vitest 23/23, exporter unittest 3/3, blueprint unittest 27/27, `VITE_DATA_MODE=live npm run build`, `npm run scan` 통과. 초기 JS gzip 약 115 KB, 차트 별도 로드. 수동 `publish-pages.yml`은 작성만 했고 실행하지 않음.
- BLOCKED: 실제 Kakao JS 키/도메인, 운영 Supabase v2 사실 적재·Edge·권한·gateway, 실제 Pages 배포와 캐시 취소 전파는 아직 검증되지 않음. 지역 A/B·최근 증가 지점·전체 기관 페이지 등 남은 명세 차이는 `docs/implementation/verification-status.md`에 기록. 운영 DB 변경·Pages 배포는 수행하지 않음.
- 2026-09-27 전체×내 신고 비교 개편: 사용자가 첨부했다고 한 `community-map-personal-comparison-implementation-prompt.md`는 호스트에 없어(전체 검색) 사용자 메시지의 요구·금지사항으로 `docs/personal-comparison.md`를 정본화하고 첨부 부재로 정한 값은 §8에 분리했다. 이번 Sol 역할(통합·계약·API·인증·테스트)은 이 세션의 Claude Opus 5.5가 수행했다(gpt-6-sol 아님).
  - Sol: `server/compare.ts`·`personalHandler.ts`·`supabase/functions/my-analytics`·`202609270100_my_analytics.sql`(읽기 전용 STABLE RPC), `src/auth/mapAuth.ts`(PKCE, lazy SDK, scope local), `src/data/personal.ts`·`demoEngine.ts`·`hooks/usePersonal.ts`·`state/*`, 공개 `regions[]`, exporter 기존 버그(`location_missing` 거부) 수정, dist 스캔 정밀화, 테스트·문서. 기준 commit `9ab2631`.
  - Muse: `/home/better0101/projects/safetyreport-community-map-muse-compare`(branch `muse/personal-compare`, base `9ab2631`)에서 `src/components/**`·`Dashboard.tsx` 레이아웃·`app.css`·`kakao.ts` 표시만 소유. 실제 `opencode-go/muse-spark-1.3-contributor`(variant default) 세션 `ses_f214b7118ffexztRXRYUR7fGYp`, export로 provider/model·directory 확인. 구현+Chrome 검수 commit `e3b05fc`, 보고서 `docs/reviews/personal-compare-impl.md`.
  - 통합: merge `3b4d6a2` 후 Sol이 Dashboard 중복 제거, 표 폭(오래된 CSS 선택자 결함), 담당자 카드 잘림, 390 브랜드 겹침·차이 줄바꿈·12px 미만 정보 글자를 수정 → 후보 `ec5a847`.
  - 로컬 스택 검증에서 Deno import 확장자 누락(부팅 실패)을 발견·수정(`4f6c84f`). live 로그인 E2E 17/17(`bdc7d72` 증거).
  - 최종 재검수: 검수 전용 detached worktree `/home/better0101/projects/safetyreport-community-map-compare-review` @ `ec5a847`.
  - 운영 DB·Edge 배포·Auth 설정·push·Pages 배포는 하지 않았다.
- 2026-09-27 과태료 금액·답변까지 걸린 기간·행정구역 경계(branch `feat/duration-amount-boundaries`, Sol 역할 = 이 세션의 Claude Opus 5.5).
  - 기간: `server/duration.ts`(KST 달력일, 답변 cohort, 제외 사유 집계, 중앙값·p90 nearest-rank, 그룹별 원 값 재계산). 공개 overview·월·기관·담당자·지역, 개인 비교(일 차이).
  - 금액: `server/amount.ts` 분류(confirmed/undisclosed/unconfirmed/conflict/penalty/combined), migration `202609280100`(동의 정책별 금액 공개 표
    `private.community_policy_disclosures`, 공개 RPC는 허용된 정책의 금액만 값으로 내보냄). 현재 동의문 2026-09-26.1은 등록하지 않음(금액 ‘공개’ 미고지).
  - 지역: SGIS 경계(2025-06-30)·행안부 코드(2026-07-01)로 `scripts/boundaries/build_boundaries.mjs`가 TopoJSON·코드표 생성(sha256 고정).
    통계는 법정 시도/시군구 코드, 인천 분할 구는 좌표로, 세종 하나, 전남광주 통합. 필터 두 단계, 지역 목록 단계, 카카오 경계 레이어.
  - 검증: 단위 191·Python 11·blueprint 27, 로컬 스택 27(금액 공개 게이트 포함), live build 스캔, 실제 카카오 SDK(등록 도메인을 브라우저 resolver로만 로컬에 연결)
    위 경계 hover·클릭·목록·뒤로·확대·끄기·옛 URL·390 확인. Muse 검수: `docs/tasks/muse-dab-review.md` → `docs/reviews/dab-review.md`.

## 2026-09-29 대시보드 개편 (Claude, 사용자 지시로 Sol/Muse 역할 겸임)
- 지시서: docs/implementation/dashboard-redesign/IMPLEMENTATION_PROMPT.md, 결과: REPORT.md, 증거: evidence/.
- 변경 전 재현(repro-before.json) → 서버 주소 장소·분석 6종 → 클라이언트 갱신 컨트롤러 → UI 재배치 → 로컬 live 스택 브라우저 검수.
- 운영 적용(Pages → Edge 순) 미실행. Muse(OpenCode) 교차 검수 미실행(MODEL_UNVERIFIED).
