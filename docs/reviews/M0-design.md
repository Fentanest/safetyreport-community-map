# M0 · Muse 최초 UI 방향 확인 보고서

- request_mode: plan / policy_version: cm-2026-09-24
- 실제 model/provider: `opencode export ses_f2d7318a5ffexTb60G2pIDOJ95`의 session info에서
  `providerID=opencode-go`, `model.id=muse-spark-1.3-contributor`, `variant=default`를 확인했다.
  요청한 `opencode-go/muse-spark-1.3-contributor`와 일치한다.
- worktree: /home/better0101/projects/safetyreport-community-map (지정 worktree 자체, 별도 worktree 미생성)
- commit: `ff63cfd Add community map implementation plan` / dirty: tracked 9개 수정 + untracked 다수 (본 단계에서 제품 파일 무수정)
- URL: http://127.0.0.1:4179/design/reference-ui/index.html (지정 기준판 URL 직접 접근 성공, 별도 서버 불필요)
- data_mode: 합성 예시 (기준판 고정 문구 "UI 기준판 · 합성 데이터"). **참고 스크린·기준판의 예시 수치(4,826건 등)를 실제 데이터로 사용하지 않음.**
- 지도: 모형 (기준판 명시 "디자인 모형 · 실지도 아님", Kakao 미연동)
- browser/tool: Google Chrome 154.0.8037.57 (executablePath 지정) / playwright-core 1.63.0 (node, /tmp/opencode/m0에 격리 설치. 레포 의존성 무수정)
- 일시: 2026-09-24 (UTC)

## 1. 읽은 reference (전부 실제 열람)

| # | 자료 | 열람 방식 | 비고 |
|---|---|---|---|
| R1 | design/references/family-pc-dark.png | 이미지 직접 열람 | 개인용 대시보드 4화면. **개인 민원 상세(신고번호·차량번호·사진·담당자 실명+개인 통계)는 공개 지도에 이식 금지** 대상으로 식별 |
| R2 | design/references/family-pc-light.png | 이미지 직접 열람 | light 토큰·표·뱃지 pale 배경 패턴 확인 |
| R3 | design/references/family-design-tokens.png | 이미지 직접 열람 | brand #0D6EFD, dark bg #0B1220 등. 폰트는 Pretendard 표기이나 구현 정본은 Noto Sans KR 우선 + 미번들 (tokens.json 일치) |
| R4 | design/references/family-component-kit.png | 이미지 직접 열람 | segmented, status chip, table row, bottom sheet, pagination 패턴. light/dark 동일 컴포넌트 |
| R5 | design/references/family-mobile-dark.png | 이미지 직접 열람 | 모바일 5화면(대시보드/신고내역/관리/통계/알림). 공개 지도는 bottom nav 4개(지도/지역/분석/안내)로 축소 적용 예정 |
| R6 | design/references/family-chart-guide.png | 이미지 직접 열람 | 라인/막대/도넛/가로막대/세로막대/누적막대/맵 가이드. **3D·파이 없음. 월별 TOP5 합산·평균의 중앙값 생성 등 금지 규칙과 충돌하는 해석을 가져오지 않음** |
| R7 | design/references/family-empty-states.png | 이미지 직접 열람 | light/dark 빈·로딩·동기화·네트워크·세션·권한·재시도 상태. 공개 지도 상태 13종(ui-spec §13)의 시각 어휘로 재사용 가능 |
| R8 | design/references/family-logo-source.png | manifest로 확인 (이미지 미개봉, crop 산출물로 대체 확인) | assets/family-mark.png 등 crop 산출물 존재 확인 |
| R9 | design/tokens.json + design/tokens.css | 전문 판독 | 머신 정본 일치. status 10색·radius·space·motion(reduced 0) 확인 |
| R10 | design/reference-ui/index.html + ui.css + app.js | 전문 판독 + 실브라우저 조작 | 아래 §2 |
| R11 | docs/ui-spec.md, screen-by-screen.md, design-system.md | 전문 판독 | 구현 정본. 위반 시 지적 기준 |
| R12 | docs/metrics-catalog.md, acceptance-matrix.md | 전문 판독 | 분모·검증 기준. §5 충돌 기록에 사용 |
| R13 | MUSE.md, AGENTS.md, PROJECT_RULES.md, MASTER_PROMPT.md, product-decisions.md, repository-audit.md | 전문 판독 | 고정 정책 확인 (§6) |

## 2. 브라우저 검수 결과 (실측)

기준판에 직접 접근 가능했으므로 별도 로컬 서버를 열지 않음.

| viewport | theme | KPI | map-point | 차량행 | 표행 | overflowX | trend | console err | 4xx/5xx | screenshot |
|---|---|---|---|---|---|---|---|---|---|---|
| 1920×1080 | dark | 6 | 13 | 5 | 4 | 0 | svg | 0 | 0 | docs/reviews/screenshots/m0/m0-1920x1080-dark.png |
| 1920×1080 | light | 6 | 13 | 5 | 4 | 0 | svg | 0 | 0 | docs/reviews/screenshots/m0/m0-1920x1080-light.png |
| 1440×900 | dark | 6 | 13 | 5 | 4 | 0 | svg | 0 | 0 | docs/reviews/screenshots/m0/m0-1440x900-dark.png (+ bundled wall-1440-dark.png와 일치) |
| 1440×900 | light | 6 | 13 | 5 | 4 | 0 | svg | 0 | 0 | 측정만 (캡처 dark와 동등 구조) |
| 2560×1440 | dark | 6 | 13 | 5 | 4 | 0 | svg | 0 | 0 | docs/reviews/screenshots/m0/m0-2560-check.png (+ bundled wall-2560-dark.png) |
| 2560×1440 | light | 6 | 13 | 5 | 4 | 0 | svg | 0 | 0 | 측정만 |
| 390×844 | dark | 6 | 13 | 5 | 4 | 0 | svg | 0 | 0 | docs/reviews/screenshots/m0/m0-390x844-dark.png |
| 390×844 | light | 6 | 13 | 5 | 4 | 0 | svg | 0 | 0 | docs/reviews/screenshots/m0/m0-390-light-check.png (fullPage) |

상호작용 실측 (1920 dark, 전부 통과):
- 지도 지표 전환 → `#legend` 텍스트 "수용 비중"으로 변경 확인
- map-point 클릭 → `#detail-title` "서울 · 선택 미리보기", count "1,500" 변경 확인
- 테마 토글 → `data-theme` dark→light 전환 확인 (지도 캔버스 light 배경·범례까지 전환됨을 스크린샷으로 확인)
- 브리핑 모드 → `body.briefing` 토글, rail/heading/entities 숨김 확인 → `Esc`로 복원 확인
- 상세필터 drawer → 열림 확인 → `Esc`로 닫힘 확인 (`hidden` true 복원)
- 기관↔담당자 탭 → heading "담당자 · 소속기관" 전환, 4행 유지, n=1 행 "표본 1건" 뱃지 확인
- 차트 [표로 보기] → `#trend[data-table=true]` 전환 확인
- 하단 3카드+표 스크롤샷: docs/reviews/screenshots/m0/m0-lower-1920-dark.png, m0-entities-1920-dark.png, m0-entities-manager-1920-dark.png, m0-charttable-1920-dark.png

## 3. 레이아웃 위험 (기준판 → 실제 구현 이식 시)

| id | severity | 내용 |
|---|---|---|
| M0-L1 | 중 | 기준판 topbar 높이 68px(ui.css), 모바일 62px — ui-spec §2(64px/56px)와 2~6px 차이. 실구현은 spec값(64/56)+safe-area로 고정할 것 |
| M0-L2 | 중 | 기준판 추이 차트는 커스텀 SVG. 실구현 ECharts 전환 시 툴팁·gridline·12px 라벨·reduced-motion(0ms)·표 대안 토글의 동등 동작을 별도 검수해야 함 (UI08) |
| M0-L3 | 중 | 기준판 표에 정렬 컨트롤·aria-sort 없음. ui-spec §10(컬럼 클릭 정렬, 초깃값 완료건수 내림차순)은 실구현 신규 작업. 모바일 열선택+sticky 성명/기관 컬럼도 기준판에 없음 (screen 06) |
| M0-L4 | 중 | 지도 모형 버블은 % 배치+수동 offset(app.js offsets). 실 Kakao adapter에서는 projection 기반 렌더로 교체, 저줌 centroid는 "집계 표시" 명시 필수 (ui-spec §7). 모형 좌표를 실좌표처럼 이식 금지 |
| M0-L5 | 하 | 1440에서 차량카드가 5열 그리드로 전체폭 차지(ui.css). 실구현 3카드 균형(2fr/1fr/1fr 붕괴 시) 검수 필요 |
| M0-L6 | 하 | 모바일(≤700px)에서 `.map-reference-label` 숨김. 실구현에서는 지도 실패/모형 표시·attribution·legend를 숨기지 말고 유지할 것 (UI03/UI09) |
| M0-L7 | 하 | 비교기간 파선·결측 gap·진행중월 hatch가 기준판에 없음. 레이아웃 자리(legend+caption)만 있고 실계산은 공개 API 몫 — 수직슬라이스에서 fixture로 먼저 자리 확보할 것 |

## 4. 개선 제안 (가독성·여백·정렬·타이포·차트·map UI)

1. **KPI foot 4계층 유지**: 현행 label→값→기준일→분모/context 구조가 ui-spec §5와 일치. 실구현에서도 12px 미만으로 축소 금지 (기준판 말미에 12px 하한 패치 있음. 모바일도 12px 유지됨을 확인).
2. **과태료 KPI foot 문구**: "완료건의 48.5%" → "처리완료 3,120건 중 48.5%"처럼 분모 절대수 병기 권장 (아래 M0-D1).
3. **차트**: y축 0 시작(절단 없음) 양호. 실구현 시 truncated bar 금지·dual축 금지 유지, 비교기간은 실선/파선+색 외 구분자(모양·레이블) 병행, 결측 구간은 선 연결 금지.
4. **처리결과 스택**: A/P/J 3색+분모 D 상시 표시 구조 양호. "결과 미확인 280건은 분모 제외" 캡션을 실구현에서도 유지 (D 정의).
5. **차량 TOP5**: rank+mono 마스킹+건수+share bar 구조 유지. 마스킹 충돌 2행 독립 렌더(기준판 01/04행 동일 표시) 확인 — 실구현도 rank_item_id 분리 렌더 (PRIV04).
6. **표**: count 우측정렬·성명 좌측정렬·행 44~48px·sticky header를 실구현에서 추가. 우열 문구 금지 푸터 문구 유지.
7. **지도 UI**: "이 화면 범위 적용" explicit 버튼 + 자동갱신 상태 표시를 실구현 command bar에 유지. zoom/reset 키보드 조작 가능 버튼으로 구현, Kakao 로고/축척 가림 금지, dark invert 금지.
8. **인사이트 패널**: 좌표 6자리 기본+원값 복사 확장 구조를 실구현에 반영 (원값 보존). "이 지점 범위로 분석" 명시 버튼 유지.
9. **라이트 모드**: 지도 캔버스·버블·범례·팝업·drawer·calendar까지 토큰 전환됨을 확인. 실구현도 modal만 dark 잔존 금지 (screen 11).
10. **empty/에러 어휘**: R7의 빈·로딩·재시도·네트워크 패턴을 ui-spec §13의 13종 상태에 매핑 (skeleton 전면 opacity 깜빡임 금지).

## 5. 데이터 분모 vs UI label 충돌 기록 (협상이 아닌 기록)

| id | 위치 | 관측 | 판정 |
|---|---|---|---|
| M0-D1 | KPI "과태료 처분 신고 / 완료건의 48.5%" | 1,512/3,120=48.46% → 분모 C(처리완료). metrics-catalog fine_rate=F/C와 일치 | 일치하나 label에 분모 절대수 없음. 실구현 label에 "처리완료 N건 중" 병기 권장 |
| M0-D2 | KPI "수용·일부수용 비중 80.3% / 2,280/2,840건" | (1,860+420)/2,840=80.28% → 분모 D(결과확인). accepted_including_partial과 일치 | 일치. "처리완료 3,120"와 "결과확인 2,840"이 같은 행에 있어 혼동 가능 → foot에 "결과 미확인 280건 제외" 캡 유지로 해소 (기준판 처리결과 카드에 있음) |
| M0-D3 | KPI "처리완료 신고 3,120건 / 결과 확인 2,840건" | C vs D 구분 표시 | 양호한 패턴. 실구현 유지 |
| M0-D4 | 추이 "8월 신고 +16.9% 전월 대비" | (928−794)/794=16.87% → count 상대변화 %. 비율 %p와 혼동 소지 | 수치 정확. 실구현에서 비율 변화는 %p 표기 분리 (metrics-catalog 변화량) |
| M0-D5 | 지도 지표 전환(신고량/수용 비중/과태료) | 전환 시 legend 제목만 변경, 범례 range·분모·날짜기준 미변경 (모형 한계) | **실구현 필수 수정**: 지표별 독립 범례/분모/기준일 표시 (product-decisions "지도 색 기본" + ui-spec §7) |
| M0-D6 | "신고 지점 386곳 / 원 좌표로 표시" + 지도 13버블 | 386점(합성)과 13개 집계 버블의 관계 설명 없음 | 실구현에서 고줌 exact / 저줌 집계 표기 분리 (ui-spec §7) |
| M0-D7 | "기여 계정 128개 / 선택 범위의 고유 계정" | distinct 표현 있음 | metrics-catalog contributor_count(합산 금지)와 일치. 유지 |

## 6. 고정 정책 확인 (재협상 없음)

- 담당자 전체 성명+기관 표시 / 차량 지역접두 제거+2·4·6 마스킹(집계 후 projection) / 원좌표 그대로(n=1 포함, 격자화 금지) /
  전국+날짜범위 사용자 선택 / 신고일·처리완료일 지표별 기준 — 모두 기준판·문서와 정합. 본 보고서에서 변경 제안 없음.
- 원번호·해시·계정정보가 기준판 DOM/JS에 없음(app.js에 raw plate·신고번호·토큰 없음, 차량은 마스킹 문자열만) — 실구현도 PRIV02 유지.

## 7. 수직슬라이스 구현에 필요한 정확한 UI 파일 범위

현재 레포에 `src/`가 없음(설계·기준판 단계). 아래는 **신규 생성 범위**이며, 토큰·기준판·원본보드 파일은 수정하지 않는다:

- `index.html` (Vite root, 폰트 미번들·Noto Sans KR 스택 참조)
- `src/main.tsx`, `src/App.tsx` (테마 dark 기본+저장값, briefing, toast, skip-link)
- `src/styles/tokens.css` ← `design/tokens.css` 값 consumption (복사 아닌 import; single writer 원칙상 토큰 변경은 Sol 승인 필요)
- `src/components/TopBar.tsx`, `src/components/Rail.tsx` (모바일 bottom nav 전환 포함)
- `src/components/CommandBar.tsx` (기간 picker draft/commit 분리, 분류 segmented, scope-chip, 공유/초기화)
- `src/components/FilterDrawer.tsx` (400px drawer / 모바일 sheet, focus trap+Esc, chips+reset+apply)
- `src/components/KpiRow.tsx` (6카드, 기준일 배지+분모 foot 4계층)
- `src/components/MapPanel.tsx` + `src/lib/kakao.ts` (SDK adapter, marker/cluster/metric legend, 화면범위 적용 버튼, relayout, 실패 카드+표 대안)
- `src/components/InsightPanel.tsx` (개요/처리결과/기관·담당자 탭, 좌표 6자리+원값 복사)
- `src/components/TrendCard.tsx` (ECharts line+area, 표 대안 토글, brush→draft 범위)
- `src/components/OutcomeCard.tsx` (100% stack, 분모 D 캡션)
- `src/components/VehicleTop5.tsx` (rank_item_id 독립행, n=1 표시)
- `src/components/EntityTable.tsx` (기관/담당자 탭, 정렬+aria-sort, sticky 열, 모바일 열선택)
- `src/state/filters.ts` (scope vs selection 분리, 공유URL 허용 필드만)
- `src/api/publicClient.ts` + `src/fixtures/*` (fixture/live 구분, denominator_filter 반환)
- `tests/` 대응: stat 단위테스트는 기존 tests/blueprint 아래가 아닌 신규 `tests/ui/*` 또는 공용 stat 테스트와 통합 (Sol 계약과 중복 방지 — 통합 시 Sol 지정 경로 따름)
- 제외: `design/references/*`, `docs/*`, `tests/*` 원본, 실데이터 — Pages artifact allowlist 대상 아님

## 8. NOT_RUN / BLOCKED (본 단계 범위 외, PASS 아님)

- UI03 실제 Kakao SDK 연동 — BLOCKED(키·도메인·실지도; 모형으로 PASS 대체 안 함)
- ECharts 실차트·brush·파선 비교·결측 gap — NOT_RUN (기준판 SVG만 확인)
- 표 정렬·aria-sort·모바일 열선택·sticky 열 — NOT_RUN (기준판 미구현)
- drawer Tab focus-trap 순환 — 부분 확인(Esc·초점복원 코드 판독, Tab 순환 미실측) → NOT_RUN
- 1024×768·768×1024, reduced-motion, 키보드 전체탐색, screen-reader — NOT_RUN
- 통계 정확성(DATA01~10)·보안(SEC01~05)·릴리스(REL01~05) — 본 M0 범위 외, 후속 마일스톤에서 처리

## 9. 최종 판정

- M0 범위(방향 확인·기준판 브라우저 검수·분모/label 기록·파일범위 특정): **PASS**
- 실구현 연동(UI03/ECharts/정렬/전체 접근성): **NOT_RUN** — M1 이후 실측
- 제품 파일 수정: 없음 (본 보고서 `docs/reviews/M0-design.md`만 신규 작성)
