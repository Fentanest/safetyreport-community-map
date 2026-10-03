# Muse 구현·검수 보고 · ranking-periods (six entrypoints)

- Worktree: `/home/better0101/projects/safetyreport-community-map-ranking-periods-muse`, branch `feat/ranking-periods-muse`, base `d3ed54a`
- Variant: `opencode-go/muse-spark-1.3-contributor` high (호스트 실행 세션; 정확한 provider variant ID는 호스트 `opencode models` 기록에 따름 — 본 보고서에 임의 ID를 박지 않음)
- 소유 파일만 변경: `src/pages/RankingsPage.tsx`, `src/styles/rankings.css` (+ 소유 증거/리뷰/스크래치)
- 서버: root 준비 `http://127.0.0.1:5220/?screen=rankings` (실제 GoTrue/DB/RPC, 합성 LOCAL 데이터만). 두 번째 랭킹 서버 미기동. `cleanup/withdraw` 미호출 (`session/log/fail0/restore`만 사용). JWT는 메모리·localStorage에만, 토큰·세션 출력·캡처 없음.
- Kakao SDK는 지도 ancillary용 mock이며 실제 SDK/클라우드 연동으로 주장하지 않음.

## 구현 내용

1. 공유 계약 사용: `RANKING_PRESETS` 6개, `RANKING_THEME_METRICS`, `selectRankingPreset`, `rankingTitle` (`src/domain/rankingPeriods.ts`)로 진입점·제목·상태 전이를 일원화. 페이지 고유 `THEMES/THEME_METRICS/unluckyTitle` 제거.
2. 진입점 6개 (버튼 문구는 선택월과 무관하게 고정):
   - 누적 · 기간별: `최다 신고자`, `최다 과태료 수용자`, `최다 불운자` — 클릭 시 `selectRankingPreset`으로 `all` 복귀, 단 직접 범위 선택 중이면 `range` 유지. 기준일/분류/최소건수/start/end 보존.
   - 월별: `월별 최다 신고자`, `월별 최다 과태료 수용자`, `월별 불운자` — 클릭 시 `month` 전환 + 기존 선택월·기준일·분류·최소건수 유지 (2023-07이 월별 3테마 이동에 그대로 유지됨을 브라우저로 확인).
3. 강제 변환 전부 제거: `unlucky → month` 강제, `reporters/fines + month → all` 강제를 query·URL parse/write·validation·view에서 삭제. Theme×period가 정식 API 쿼리이며 6개의 신규 theme ID를 만들지 않음.
4. 공통 기간 선택기를 전 테마에 렌더: `전체 기간 / 직접 범위 / 월별` + `range`일 때 시작·종료일, `month`일 때 `조회 달` 입력. 제목은 `rankingTitle` — 이번달 `이달의 …`, 과거월 `2023년 7월의 …`.
5. 유지: 기본값(전체기간·reporters·답변일·KST 이번달), draft/적용 분리(적용 전 요청 없음), UUID 표·공동순위·내 요약/전체순위·min1·분자/분모·보호 응답 생명주기·429 재시도·버전 페이지·직접 URL 새로고침/뒤로가기. 기간 충돌 validation은 스키마에 위임하며 임의 연도/범위 제한 없음.
6. 접근성·반응형: `fieldset/legend` + `role=group`/`aria-label` 그룹, `aria-pressed`, 44px 터치 타깃 유지, 390px 세그먼트 전체폭·세로 스택, `prefers-reduced-motion` 유지, family light/dark 토큰만 사용.

## 실행 검사

- `npx tsc --noEmit`: PASS (출력 없음)
- `npm run build`: PASS (`✓ built in 1.44s`, 기존 chunk-size 경고만)
- 실제 브라우저: `.agent-runtime/browser.mjs` → `docs/implementation/ranking-periods/evidence/muse-implementation/` (summary.json + 14 PNG). Chrome `154.0.8037.92`, 뷰포트 1920/390 × dark/light, 2026-10-03 KST.
  - 40/40 PASS, console error 0. 네트워크는 정식 쿼리만 확인: `reporters/all`, `fines/all`, `unlucky/all`, `reporters/month`, `fines/month`, `unlucky/month`, `unlucky/range` (전부 200, bounded).
  - 확인 항목: 6개 진입점 + 제목(누적 3종 원제, 2023-07 3종 `2023년 7월의 …`, 이번달 `이달의 …`), July 2023 동일 코호트(`2023-07-01 — 2023-07-31`)를 월별 3테마가 공유, 불운 4지표 전부 렌더 + rate 분수 표기, 누적 불운자(`최다 불운자` + 전체 기간), 불운 직접범위, 신고자 월별 전환, 새로고침 URL 보존·제목 유지, 키보드 포커스 이동, 24px 대형 폰트 무수평오버플로, 390px 무수평오버플로, 응답 bounded.
- 증거에 JWT/세션/원시 토큰 없음 (스캔 확인). 스크린샷의 마스킹 UUID는 화면 표시 식별자(정책상 허용된 랭킹 집계 행 표시).

## 남은 이슈

- 없음 (본인 소유 범위). 구 `scripts/browser/verify_rankings.mjs`는旧 라벨(`이달의 불운자` 버튼·unlucky 전용 달 입력)을 전제로 하며, 본 변경의 정식 라벨(`최다 불운자/월별 불운자`, 전 테마 공통 기간 선택)과 다르다 — root(테스트 소유)가 갱신해야 하며 본 worktree에서는 수정하지 않음.
