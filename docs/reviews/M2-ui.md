# M2 · UI 결함 수정과 확대 브라우저 검수 보고서

- request_mode: implementation / policy_version: cm-2026-09-24
- 실제 model/provider: 호스트 `opencode` 세션의 구독 모델 사용 (M1과 동일, `MODEL_UNVERIFIED` 표기 없음 — providerID=opencode-go, model.id=muse-spark-1.3-contributor)
- WORKTREE: /home/better0101/projects/safetyreport-community-map-muse (Sol은 이 worktree에 쓰지 않음)
- BASE_COMMIT: 3d6de9b (M1 UI commit, 확인 후 작업) / branch: `feat/community-map-muse-ui`
- DEV_URL: http://127.0.0.1:4174/ (`VITE_DATA_MODE=demo npx vite --port 4174 --host 127.0.0.1`)
- DATA_MODE: demo synthetic (`src/data/demo.ts` + `?fixture=one` / `?fixture=empty`)
- browser/tool: Google Chrome 154.0.8037.57 (`browser.version()` 실측) / playwright-core 1.63.0 (node, /tmp/opencode/m0 격리 설치. 레포 의존성 무수정)
- 일시: 2026-09-24 (UTC)
- OWNED_PATHS만 수정. package/lock, `src/data/**`, `src/domain/**`, server, SQL, CI, `design/**` 무수정 (design asset은 import로 읽기만 함)

## 1. 지시 결함 6건 처리

| # | 지시 | 처리 | 검증 |
|---|---|---|---|
| 1 | 임의 "안" 로고 → `design/assets/family-mark.png` Vite import | `TopBar.tsx`에서 `import familyMark from '../../design/assets/family-mark.png'`로 번들. 빌드 산출물 `dist/assets/family-mark-CvINNr4v.png` (89.43 kB) 확인 | `m2-brand-asset` PASS (currentSrc에 family-mark), `m2-brand-visible` PASS, 스크린샷에서 family 아이콘 육안 확인 |
| 2 | live에서 demo 배지가 항상 나오는 버그 | 배지를 `dataMode` 기준으로 분기: demo→`demo · 합성 데이터` 항상, live→`live` / 표본일 때만 `live · 표본`. 데이터 미로드 시 기본값 `true`→`false`로 수정 (live 오류 상태에서 demo 배지가 나올 수 있던 경로 제거) | `m2-demo-badge` PASS. live 실측은 엔드포인트 부재로 BLOCKED (아래 §4) |
| 3 | `DEMO_SCOPE` 초기·reset 기준 | `src/state/filters.ts`에 `demoScope()`/`baseScope(mode)` 추가. `domainModule as { DEMO_SCOPE?: Scope }` 형태로 **Sol 상수 추가 전후 모두 컴파일**되도록 구현, Dashboard 초기·popstate·reset·스탬프가 `baseScope(dataMode)` 사용. Sol 소유 파일 무수정 | `m2-initial-scope` PASS (현재는 DEMO_SCOPE 미존재 → DEFAULT_SCOPE 동작). 빌드 경고 `IMPORT_IS_UNDEFINED`는 통합 전 예상 범위이며 Sol이 export를 추가하면 경고 없이 자동 전환 (namespace live binding) |
| 4 | 정적 `import * as echarts` → gzip 485KB | `TrendCard`를 `echarts/core`+`LineChart`+`Grid/Tooltip`+`CanvasRenderer` 동적 import·`use()` 등록으로 전환. 타입만 `import type` (런타임 영향 없음). 차트 실패 시 표 대안 유도 empty-state 추가. `theme` prop으로 테마 전환 시 차트 재생성 | 초기 JS **379.41 kB / gzip 114.15 kB** (목표 350KB 이하 달성). ECharts 청크는 lazy (`charts` 84.68 + `components` 82.91 + `renderers` 13.05 + 파생 gzip KB, 차트 마운트 시에만 로드). `m2-echarts-lazy`·`m2-trend-canvas`·`m2-chart-to-table`·`m2-table-to-chart`·`m2-chart-theme`·`m2-chart-resize` PASS |
| 5 | M1-N1 정렬 caption | caption을 현재 정렬에 동기화: `{열} {내림/오름}차순{ 기본}` (예: "수용 내림차순", 완료 내림차순일 때만 " 기본") | `m2-sort-caption` PASS ("담당자 · 소속기관 · 수용 내림차순 · …") |
| 6 | 색·이모지 아이콘 정리 | `src/components/icons.tsx` 신규 (24 viewBox·stroke 1.8·currentColor, 22종). TopBar/Rail/CommandBar/KpiRow/MapPanel/InsightPanel/FilterDrawer의 이모지·문자 아이콘을 교체. 기능·명세 라벨 유지. 정렬 ▼▲ (기능 글리프)와 줌 +/− (텍스트 버튼)는 유지 | `m2-no-emoji` PASS (본문 이모지 잔존 0), `m2-svg-icons` PASS (svg 23개). 단, 수정 과정에서 모바일 헤더 선택자가 svg 구조와 어긋나 M2-V1 발생 → 수정·재검수 (§2) |

## 2. 브라우저 검수 결과 (실측, 스크립트 `/tmp/opencode/m2-review.mjs`, 28/28 PASS)

| viewport | theme | KPI | overflowX | console err | 4xx/5xx | screenshot |
|---|---|---|---|---|---|---|
| 1920×1080 | dark | 6 | 0 | 0 | 0 | `screenshots/m2/m2-1920x1080-dark.png` |
| 1920×1080 | light | 6 | 0 | 0 | 0 | `screenshots/m2/m2-1920x1080-light.png` |
| 1440×900 | dark | 6(1열 유지) | 0 | 0 | 0 | `screenshots/m2/m2-1440x900-dark.png` |
| 1440×900 | light | 6 | 0 | 0 | 0 | `screenshots/m2/m2-1440x900-light.png` |
| 2560×1440 | dark | 6 | 0 | 0 | 0 | `screenshots/m2/m2-2560x1440-dark.png` |
| 2560×1440 | light | 6 | 0 | 0 | 0 | `screenshots/m2/m2-2560x1440-light.png` |
| 390×844 | dark | 6(2열) | 0 | 0 | 0 | `screenshots/m2/m2-390x844-dark.png` + `m2-390-drawer.png` |
| 390×844 | light | 6(2열) | 0 | 0 | 0 | `screenshots/m2/m2-390x844-light.png` |

상호작용 (M1 회귀 포함, 전부 PASS): 날짜 적용→unsupported+URL, 초기화, 지점 선택 상세, 브리핑/Esc, `?fixture=one`(표본 1건 유지)/`?fixture=empty`(결과없음+초기화), 모바일 bottom nav·sheet·Esc, 기관/담당자 탭·정렬·전체성명.

## 3. 이슈

| id | severity | viewport/theme | reproduction | expected/actual | screenshot | file hint |
|---|---|---|---|---|---|---|
| M2-V1 | 중 → 수정됨 | 390/dark | M2 아이콘 교체 후 | 헤더 라벨 숨김 선택자(`span + span`)가 svg 구조와 어긋나 모바일 topbar가 2줄로 붕괴·제목 절단 / 한 줄 56px | — (재촬영본 `m2-390x844-dark.png`에서 수정 확인) | `src/styles/app.css`: `svg + span`·`:has()`로 수정, `m2-review.mjs` 재실행 28/28 |
| M1-DATA-1 | 중 (Sol 소유, 잔존) | 전체 | vehicles r2 `1*3나*5*7` | `src/data/schema.ts` regex와 fixture 불일치. M1에서 보고, M2에서 미수정 (소유 범위 외). UI는 DTO 그대로 표시 | `screenshots/m2/m2-1920x1080-dark.png` 차량 카드 | `src/data/demo.ts:87` — Sol 확인 필요 |
| M2-N1 | 하 | 전체 | 빌드 경고 1건 | `IMPORT_IS_UNDEFINED` (DEMO_SCOPE 미존재). 통합 후 자동 해소 예상, UI 추가 조치 불필요 | — | `src/state/filters.ts:14` |

## 4. NOT_RUN / BLOCKED (PASS 아님)

- 키 없는 Kakao 실지도 — **BLOCKED**. 실패 카드+재시도+지점 목록 대체는 8개 viewport에서 육안 확인, attribution 가림 없음.
- live 공개 API·live 배지 실측 — **BLOCKED** (엔드포인트 없음. live 분기·429·409 처리는 코드 구현 상태).
- screen-reader 전체 탐색·reduced-motion 실측 — NOT_RUN (aria-sort·표 대안·포커스 트랩은 스크립트 검증).
- M1-DATA-1의 Sol 측 수정분 — NOT_RUN (본 worktree 범위 외).

## 5. 빌드·커밋

- `npm run build` PASS. 초기 JS: M1 `index-*.js 1,494.09 kB / gzip 485.33 kB` → M2 **`index-*.js 379.41 kB / gzip 114.15 kB`** (목표 350KB 이하).
  ECharts는 lazy chunk (`charts` 258.86 / `components` 258.89 / `renderers` 33.68 kB raw, gzip 84.68/82.91/13.05 kB + 파생 모듈)로 차트 마운트 시에만 로드.
- branch `feat/community-map-muse-ui` 로컬 commit (ID 하단 보고). `VITE_*` 비밀 없음, 원번호·해시·계정정보 UI/DOM/URL에 없음.
