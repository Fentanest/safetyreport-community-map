# 지도 UX 3·5 — Astra 로컬 변경 (2026-10-12)

지시서: `/home/better0101/projects/worktree/map-ux-brief.md`. 작업 위치 `map-ux-astra`, 브랜치 `astra/map-ux`, 시작 HEAD `67e76d4`.
Astra 담당 3·5만 구현했다. 운영 DB, SQL 적용, Edge/Pages 배포, push는 실행하지 않았다.

## 구현과 계약 확인

| 요구 | 확인한 기존 데이터 | 변경 |
|---|---|---|
| 3. 상단 처리기간 평균 | `Overview.processing_duration.mean_days`, `CompareSummary.duration.mean_days` | 기존 중앙값을 유지하고 작은 설명 줄에 전체 평균·내 평균을 각각 병기 |
| 3. 처리기간 분포 카드 | 전체·개인 `DurationDistribution.mean_days` | 기존 전체 중앙값·평균을 유지하고 내 중앙값·평균·유효 건수 추가 |
| 5. 답변/수용률 | `CompareSide.completed_count`, `accept_rate` | 별도 내 답변·내 수용률 열 제거, 동일 지표 셀 아래 내 값 표시 |
| 5. 불수용률 | `CompareSide.rejected / result_known × 100` | 실제 개인 결과확정 건수를 분모로 사용 |
| 5. 과태료 | `CompareSide.fine_count / completed_count × 100` | 개인 과태료 건수와 비율을 동일 셀에 병기 |
| 5. 답변까지 | `CompareSide.duration_count`, `duration_median_days` | 개인 중앙값 병기. 계산 가능한 0일은 0일, 계산 불가는 — |

원시 fact 경로(`server/compare.ts`, `server/duration.ts`, `server/analyticsDistributions.ts`)와 화면 서버 집계 경로(`server/screenAggregate.ts`) 모두 위 값을 이미 제공한다. 신규 SQL·Edge·계약 필드나 migration이 필요하지 않다. 이번 변경 배포 필요 대상은 통합 이후 웹앱(Pages)뿐이며, 이번에 배포하지 않았다. 운영 응답을 직접 조회한 검증은 아니다.

개인 비교는 기존 로그인 사용자·scope·dataset version·no-store 경로를 그대로 사용한다. 계정/토큰/캐시 처리 변경 없음.
기관·담당자 비교 목록은 기존 서버 한도 최대 50행이다. 목록에 없는 행은 실제 0건과 구분하여 `내 자료 없음`을 표시한다.
확인된 0건은 0, 0분모 비율은 —로 표시한다. 전체·내 신고의 평균을 서로 대체하거나 집단 평균을 다시 평균하지 않는다.

기본 표는 기관/담당자 이름 + 5개 지표의 6열이다. 선택 열의 일부 수용도 같은 방식으로 옮겼다. 기존 저장된 개인 열 선택 ID는 대응하는 일반 열 ID로 읽어 사용자 선택을 보존한다.
파란색은 테마별 `--link`를 사용하고 숫자 앞에 `내`를 붙여 색에만 의존하지 않는다. 기존 표 내부 가로 스크롤·모바일 이름 고정 열을 유지했다.

## 파일 소유·통합 주의

- `src/components/KpiPanel.tsx`: 처리기간 hero의 두 줄만 변경. Sonnet 4번의 minor KPI 수정과 병합해야 한다.
- `src/components/AnalyticsCharts.tsx`: `DurationCard` caption만 변경. Sol 2번 Heatmap과 Sonnet 1번 Scatter 영역은 수정하지 않았다.
- `src/components/EntityTable.tsx`, 신규 `EntityTable.css`: 5번 표 수정.
- 신규 회귀 시험·브라우저 재현 스크립트·본 보고서.
- `package.json`, lock, node_modules 심볼릭 링크는 변경/추적하지 않았다.

## 실행한 검사

- `npx tsc -p . --noEmit`: PASS.
- `npx vite build`: PASS. 큰 청크·정적/동적 중복 import 경고는 남아 있다.
- `npx vitest run --exclude tests/integration/official-binding.test.ts`: **60 파일 통과 / 1 실패 / 30 건너뜀; 738 시험 통과 / 11 실패 / 167 건너뜀**.
- 실패 11건은 변경하지 않은 `tests/product/composeScript.test.ts`. 재실행도 동일. `spawnSync(node, ['-e', 'console.error("probe");process.exit(2)'])` 최소 재현에서 `error.code=EPERM`, 빈 stdout/stderr, status=2 확인. child 출력 수집이 금지되어 기대 출력 검사가 실패한다. 전체 시험 PASS로 간주하지 않는다.
- `authBoundary.test.ts` 재실행: 19건 PASS.
- `mapUxAstra.test.tsx`: 3건 PASS. 5개 개인 값이 같은 셀에 표시되는지, 비율 분모(25%/20%), 유효 0일/결측/실제 0건, 비교 끔·주소 선택 시 개인 평균 숨김, 서로 다른 전체/개인 평균을 검증.
- `git diff --check`, 브라우저 스크립트 `node --check`: PASS.
- 실행 로그: `.agent-runs/map-ux/{vitest,astra-test,recheck,build}.log` (추적 안 함).

## 브라우저 검수 — BLOCKED

Vite가 `listen EPERM 127.0.0.1:5293`으로 종료했다. 지정 Playwright/Chromium도 `setsockopt: Operation not permitted`, SIGTRAP으로 종료했다.
따라서 기준판 HTML 실제 브라우저 열람, 1280/390 × light/dark 스크린샷, 모바일 실제 overflow, console/network 0건 검증을 완료했다고 주장하지 않는다.
소스/SSR 검사는 실제 UI 검수를 대체하지 않는다. Muse 검수를 실행하지 않았다.

권한이 가능한 환경에서 다음을 실행하면 `.agent-runs/map-ux/`에 KPI·기관·담당자·처리기간 그래프/표 스크린샷과 결과 JSON을 저장한다.

```sh
VITE_DATA_MODE=demo npx vite --host 127.0.0.1 --port 5293 --strictPort
MAP_UX_ORIGIN=http://127.0.0.1:5293 node scripts/browser/verify_map_ux_astra_demo.mjs
```

스크립트는 합성 demo이며 Kakao SDK 요청은 stub 처리한다. 실제 지도 연동 검수가 아니다. 390px 표 가로 스크롤·페이지 overflow, 두 종류 표, 비교 토글, 같은 셀의 파란색과 6열, 전체/내 평균, 그래프 표 전환, 콘솔/요청 실패를 검사한다.
스크립트의 실제 UI assertion 수행은 아직 BLOCKED이며 통합 검수에서 실행해야 한다. 현재 스크린샷은 **없음**. Vite는 시작에 실패해 남은 종료 대상 PID가 없다. Chromium은 Playwright가 종료·정리했다.

## 커밋 상태

명시한 7개 파일만 `git add` 후 한국어 메시지로 commit하려 했으나 첫 단계에서 실패했다:
`Unable to create .../.git/worktrees/map-ux-astra/index.lock: Read-only file system`.
커밋은 생성하지 못했고 변경 파일을 작업트리에 보존했다. 브라우저 시작 실패 로그는 `.agent-runs/map-ux/browser-startup.log`다.
