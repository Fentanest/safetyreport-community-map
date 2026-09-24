# M1 · Muse Spark contributor UI 공동 구현 검수 보고서

- request_mode: implementation / policy_version: cm-2026-09-24
- 실제 model/provider: 호스트 세션에서 `providerID=opencode-go`, `model.id=muse-spark-1.3-contributor` 확인 (M0-design.md §0과 동일 계열). 본 보고서의 provider 표기는 호스트 `opencode` 세션 기준이며 임의 추정 없음.
- WORKTREE: /home/better0101/projects/safetyreport-community-map-muse (지정 worktree 자체, 별도 worktree 미생성. Sol은 이 worktree에 쓰지 않음)
- BASE_COMMIT: 40ee919 (확인 후 작업. 구현 branch: `feat/community-map-muse-ui`)
- DEV_URL: http://127.0.0.1:4174/ (`VITE_DATA_MODE=demo npx vite --port 4174 --host 127.0.0.1`)
- DATA_MODE: demo (합성 fixture. `src/data/demo.ts`의 전체 기본 범위 DTO + `?fixture=one` / `?fixture=empty`)
- browser/tool: Google Chrome (/usr/bin/google-chrome) / playwright-core 1.63.0 (node, /tmp/opencode/m0에 격리 설치. 레포 의존성 무수정)
- 일시: 2026-09-24 (UTC)
- 읽은 문서: AGENTS.md, MUSE.md, PROJECT_RULES.md, docs/implementation/MASTER_PROMPT.md, docs/product-decisions.md,
  docs/repository-audit.md, docs/ui-spec.md, docs/screen-by-screen.md, docs/design-system.md, docs/metrics-catalog.md,
  docs/reviews/M0-design.md, design/tokens.json·tokens.css, design/reference-ui/index.html·app.js·ui.css (판독 + 실브라우저 조작 이력 참조)

## 1. 구현 범위 (OWNED_PATHS만 수정)

신규 생성 (Sol 소유 `src/data/**`, `src/domain/**`, `contracts/**`, `tests/**`, `design/**`, package/lock 무수정):

- `index.html` (Vite root, 폰트 미번들·시스템 스택)
- `src/main.tsx`, `src/App.tsx`, `src/pages/Dashboard.tsx` (데이터 로드 상태머신, scope/selection 분리, URL 동기화)
- `src/state/filters.ts` (draft/apply, scope 직렬화=공개 필터만, 프리셋, 날짜 검증)
- `src/lib/kakao.ts` (SDK single-load+timeout, marker, idle bbox, relayout/cleanup. Heatmap 등 가상 클래스 없음)
- `src/styles/app.css` (토큰값 소비, 1920/1440/1200/700 분기, bottom nav·sheet, briefing, reduced-motion)
- `src/components/`: `format.ts`, `TopBar.tsx`, `Rail.tsx`, `CommandBar.tsx`, `FilterDrawer.tsx`, `KpiRow.tsx`,
  `MapPanel.tsx`, `InsightPanel.tsx`, `TrendCard.tsx` (ECharts), `OutcomeCard.tsx`, `VehicleTop5.tsx`,
  `EntityTable.tsx`, `DataGuide.tsx`
- 계약 사용: `src/domain/public.ts`의 `DashboardData`/`Scope`/`DEFAULT_SCOPE`,
  `src/data/client.ts`의 `loadDashboard`/`dataMode`/`PublicApiError`를 그대로 사용. 지표를 UI에서 재추정하지 않음.
- 기준판을 HTML째 복사하지 않고 React/TS 컴포넌트로 재구현 (구조는 ui-spec §2 그리드 준수).

## 2. 브라우저 검수 결과 (실측, Playwright 스크립트 `/tmp/opencode/m1-review.mjs` + `/tmp/opencode/m1-fixcheck.mjs`)

| viewport | theme | KPI | point | 차량행 | 표행 | overflowX | trend | console err | 4xx/5xx | screenshot |
|---|---|---|---|---|---|---|---|---|---|---|
| 1920×1080 | dark | 6 | 3 | 4 | 3 | 0 | echarts canvas | 0 | 0 | `screenshots/m1/m1-1920x1080-dark.png` |
| 1920×1080 | light | 6 | 3 | 4 | 3 | 0 | canvas | 0 | 0 | `screenshots/m1/m1-1920x1080-light.png` |
| 390×844 | dark | 6(2열) | 3 | 4 | 3 | 0 | canvas | 0 | 0 | `screenshots/m1/m1-390x844-dark.png` |
| 390×844 | light | 6(2열) | 3 | 4 | 3 | 0 | canvas | 0 | 0 | `screenshots/m1/m1-390x844-light.png` |

상호작용 실측 (33/33 PASS, 최종 실행):

- 날짜 적용: 기간 팝오버 → 시작일 2026-01-01 → 적용 → URL `?start=2026-01-01…` + `banner.warn` (demo는 기본 범위 집계만 지원 → "집계 미지원" 명시). `m1-1920-date-applied.png`
- 분류: 주정차 적용 → 동일 unsupported 배너. 전체로 복귀 확인. `m1-1920-category-filtered.png`
- 지점 선택: 목록 첫 행 클릭 → 우측 인사이트 "서울특별시 중구 예시 지점", 5건/75.0%, 좌표 6자리+원값 복사, "이 지점 범위로 분석" 버튼. 선택 행 하이라이트. `m1-1920-point-selected.png`
- 차량 중복 마스크: `1*가*4*6` 2행이 `rank_item_id` (r1/r4)로 분리 렌더. 클릭은 기준 설명 토스트만 (추적 화면 없음)
- 기관/담당자 탭·정렬: 담당자 탭 heading "담당자 · 소속기관", 전체 성명+기관, 수용 정렬 `aria-sort=descending`, n=1 "표본 1건" 배지. `m1-1920-entities-manager.png`
- theme: dark→light `data-theme` 전환, localStorage 저장, 지도·차트·drawer까지 토큰 전환 (modal만 dark 잔존 없음)
- briefing/Esc: `body.briefing` 토글 → rail/제목/표/안내 숨김, scope·분모 유지, Esc 복원. `m1-1920-briefing.png`
- drawer/Esc: `role=dialog` focus-trap(Tab 순환)+Esc+초점 복원. 모바일 bottom sheet. `m1-390-drawer.png`
- 공유 URL: 공개 필터만 복사 토스트 (차량·계정 미포함). 뒤로가기: `?fixture=one` → `?fixture=empty` → back → `?fixture=one` 복원
- 추이 [표로 보기]: 월·신고·처리·과태료·범위 테이블 대안. `m1-1920-trend-table.png`
- `?fixture=one`: KPI 1건/100%/0건/1곳/1개 + ‘표본 1건’ 배너·행 유지. `m1-1920-fixture-one.png`
- `?fixture=empty`: 결과없음 배너 + 전국 초기화 버튼 (가짜 0 대체 없음). `m1-1920-fixture-empty.png`
- Kakao 키 없음: 실패 카드 + 재시도 + "지점 목록으로 이동" + 동일 지점·건수의 접근 가능 목록 (원좌표 6자리). 다른 통계 UI 계속 사용 가능
- API 오류: `PublicApiError` catch → "통계 조회에 실패했습니다" + 재시도 + retry-after 표시 자리 (live 429 대비). demo 모드에서 강제 발생 경로는 `?fixture` 범위를 벗어난 scope의 unsupported 표시로 검증

## 3. 이슈 (시각 검수로 직접 확인)

| id | severity | viewport/theme | reproduction | expected/actual | screenshot | file hint |
|---|---|---|---|---|---|---|
| M1-V1 | 중 → 수정됨 | 390/dark | 첫 로드 상단 | 헤더 버튼 텍스트 줄바꿈("다 크", "브리핑 모 드") / 한 줄 56px topbar | 수정 전 `m1-390x844-dark.png` (구판) | `src/styles/app.css`: 버튼 `nowrap`+모바일 아이콘-only |
| M1-DATA-1 | 중 (Sol 소유, 미수정) | 전체 | vehicles r2 `1*3나*5*7` | `src/data/schema.ts` vehicleSchema regex와 fixture 불일치 (r1/r3/r4는 일치). UI는 DTO를 있는 그대로 표시. Sol 확인 필요 | `m1-1920-entities-manager.png` (차량 카드) | `src/data/demo.ts:87` (Sol 소유 — 미수정) |
| M1-N1 | 하 | 전체 | 표 caption "완료건수 내림차순 기본" | 정렬 변경 후에도 caption이 기본값 문구 유지 (현재 정렬은 헤더 ▼로 표시). 추후 동적 caption 권장 | `m1-1920-entities-manager.png` | `src/components/EntityTable.tsx` |
| M1-N2 | 하 | 1920/light | 추이 x축 | 연월 반복 표기(2026.07…) — 12개월분에서는 월만 표기 권장. 결측 gap·파선 비교는 fixture 월 3개라 미검증 | `m1-1920-trend-table.png` | `src/components/TrendCard.tsx` |

## 4. 분모·날짜기준 표기 (숨김 없음)

- KPI foot 4계층: 값 → 신고일/처리완료일 basis 배지 → 분모 절대수 ("5 / 6건 · 미확인 1건 제외", "처리완료 7건 중 28.6%") → 비교/표본 문구
- 수용·일부수용 분모 D(결과 확인건), 과태료 분모 C(처리완료건) 분리 표기. 지도 지표 전환(신고량/수용 비중/과태료)마다 legend 제목·분모·날짜기준이 함께 바뀜 (M0-D5 해소)
- 월별: 건수 변화 % (상대변화), 비율 변화 %p 문구 분리. 진행 중 월(2026-09 partial) 칩 + "같은 경과기간 비교" 캡션
- `?fixture=one`에서 비율 100.0% (1/1) 그대로 표시, n<3 숨김 없음

## 5. NOT_RUN / BLOCKED (PASS 아님)

- UI03 실제 Kakao SDK 연동 — **BLOCKED** (JS 키·도메인 없음. adapter는 single-load/marker/relayout/cleanup 구현 완료, 키 주입 시 동작. 모형을 실지도라 주장하지 않음, attribution 가림 없음)
- live 공개 API (`VITE_PUBLIC_ANALYTICS_URL`) — **BLOCKED** (엔드포인트 없음. `loadDashboard` live 분기는 client.ts 그대로 사용, 429 retry-after·409 버전불일치 처리는 코드로 구현)
- 1440×900 / 2560×1440 / 1024×768 / 768×1024 실측 — NOT_RUN (CSS 분기는 구현, M1 범위의 1920/390만 실측)
- screen-reader 전체 탐색·reduced-motion 실측 — NOT_RUN (포커스 트랩·aria-sort·표 대안은 구현+스크립트 검증, AT 실측은 미수행)
- 통계 정확성·보안·릴리스 매트릭스 — M1 범위 외, Sol 통합 시 처리

## 6. 빌드·커밋

- `npm run build` (tsc -b + vite build): PASS
- branch `feat/community-map-muse-ui`에 로컬 commit, commit ID는 하단 보고 참조
- `VITE_*`에 비밀 없음 (키 자리만 참조). 원번호·해시·계정정보가 UI 코드·DOM·URL에 없음 (마스킹 문자열만 렌더)
