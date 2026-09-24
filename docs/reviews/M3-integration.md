# M3 · 최종 통합 브라우저 검수 보고서 (Sol+Muse 통합본)

- request_mode: review / policy_version: cm-2026-09-24
- 실제 model/provider: 호스트 `opencode` 세션 구독 모델, providerID=`opencode-go`, model.id=`muse-spark-1.3-contributor`
  (호스트에서 확인된 런타임 ID를 그대로 기록. 추정 ID를 박아 넣지 않음)
- worktree: `/home/better0101/projects/safetyreport-community-map-review`
  / branch: `feat/community-map-m3-review`
  / checked commit: `d05033469ca30480718b6345c8ff05f50b3a0810` (고정 제품 commit, 변경 없음)
  / dirty (검수 시작 시): clean (screenshots/m3 제외·아래 `git status` 참조)
- 일시: 2026-09-24 (UTC) / URL: `http://127.0.0.1:4175/` (`npm run dev`, `VITE_DATA_MODE=demo`)
  / data_mode: demo synthetic (`src/data/demo.ts` + `?fixture=one` / `?fixture=empty`)
  / dataset_version: `synthetic-2026-09-24` (데이터 안내 패널 표기 실측)
- browser/tool: Google Chrome `154.0.8037.57` (`browser.version()` 실측)
  / playwright-core `1.63.0` (격리 설치 `/tmp/opencode/m0/node_modules`, 레포 의존성 무수정)
- 스크립트: `.agent-runtime/m3-review.mjs` (73 checks) + `.agent-runtime/m3-probe.mjs` + `.agent-runtime/m3-prod.mjs`
  (모두 git-ignored 임시 스크립트. 결과 JSON: `.agent-runtime/m3-results.json`)
- 소유 범위 준수: `docs/reviews/M3-integration.md` + `docs/reviews/screenshots/m3/**`만 신규 작성.
  제품 소스·package/lock·SQL·CI·spec·타 보고서는 미수정. `npm run build`는 읽기 전용 검증으로 1회 실행
  (생성물 `dist/`는 gitignored, commit 없음).

## 1. 뷰포트 × 테마 매트릭스 (실측, 전량 PASS)

| viewport | theme | KPI | overflowX | console err | 4xx/5xx | screenshot (육안 열람) |
|---|---|---|---|---|---|---|
| 1920×1080 | dark | 6 | 0px | 0 | 0 | `screenshots/m3/m3-1920x1080-dark.png` |
| 1920×1080 | light | 6 | 0px | 0 | 0 | `screenshots/m3/m3-1920x1080-light.png` |
| 1440×900 | dark | 6 | 0px | 0 | 0 | `screenshots/m3/m3-1440x900-dark.png` |
| 1440×900 | light | 6 | 0px | 0 | 0 | `screenshots/m3/m3-1440x900-light.png` |
| 2560×1440 | dark | 6 | 0px | 0 | 0 | `screenshots/m3/m3-2560x1440-dark.png` |
| 2560×1440 | light | 6 | 0px | 0 | 0 | `screenshots/m3/m3-2560x1440-light.png` |
| 390×844 | dark | 6(2열) | 0px | 0 | 0 | `screenshots/m3/m3-390x844-dark.png` + `m3-390-drawer-open.png` |
| 390×844 | light | 6 | 0px | 0 | 0 | `screenshots/m3/m3-390x844-light.png` |

육안 확인(Read로 실제 열람): 1920 dark 데이터 상황판 전체 계층(TopBar 합성 배지·KPI 6·지도 대체+지점 목록·인사이트·추이·처리결과·차량 TOP5·기관표·데이터 안내) 정상.
light 전환 시 차트·표·팝업·지도 대체카드까지 잔여 dark 없음. 390은 2열 KPI·420급 지도 대체·bottom sheet drawer, 표는 내부 스크롤로 전체 가로스크롤 0.
2560에서 빈 영역 과도 확장 없음. 기준판 `design/reference-ui/index.html`의 레이아웃과 대응하나,
수치·문구는 합성 fixture이며 원본 보드의 가짜 수치를 기능 요구로 가져오지 않았음(앱 푸터·데이터 안내에 표본 고지).

## 2. 상호작용 검수 (실측)

| # | 동작 | 결과 | 증거 |
|---|---|---|---|
| I1 | 분류 `교통위반` 적용 → URL `category=traffic`, demo unsupported 배너+초기화 | PASS | `m3-interact-reset.png`, URL 실측 |
| I2 | 날짜 변경(2026-01-01~) 적용 → URL 반영, unsupported 안내(합성 fixture는 기본 범위만 지원) | PASS | probe 로그 |
| I3 | 유효하지 않은 범위(시작>종료) → toast `시작일은 종료일보다 늦을 수 없습니다`, URL 미커밋, 재오픈 시 field-error 유지 | PASS | prod probe 로그 |
| I4 | 초기화 → base scope 복원+토스트 | PASS | `m3-interact-reset.png` |
| I5 | back/forward (prod 빌드) → Back 1회로 이전 조건 복원 | PASS | prod probe (`len 2→3`, back→base URL) |
| I6 | `?fixture=one` → `표본 1건` 배지, KPI `1건`, 기관 행 1 유지, 마커/카드 유지 | PASS | `m3-fixture-one.png` |
| I7 | `?fixture=empty` → `결과가 없습니다`+초기화, KPI `0건`, 수용비중 `분모 0건 · 비율 없음` | PASS | `m3-fixture-empty.png` |
| I8 | 지점 선택 → 인사이트 `선택 지점`, 신고 5건/75.0% vs 전체 9건/83.3% (선택≠전체 분리) | PASS | `m3-interact-point.png` |
| I9 | 인사이트 처리결과 탭(분모 D 명시) / 기관·담당자 탭 | PASS | 스크립트 텍스트 실측 |
| I10 | `이 지점 범위로 분석` → URL `bbox=` 적용 | PASS | URL 실측 |
| I11 | 담당자 탭+전체성명(`김하늘`)+`수용·일부 %` 정렬(`aria-sort=descending`, caption 동기) | PASS | `m3-interact-entities.png` |
| I12 | 차트 표 대안 토글(표↔차트), canvas 렌더 | PASS | `m3-interact-trend-table.png` |
| I13 | 지도 지표 전환 신고량→수용 비중→과태료, 범례·날짜기준 전환 | PASS | `m3-interact-mapmetric.png` |
| I14 | 테마 토글 dark→light (`data-theme` 실측) | PASS | `m3-interact-light.png` |
| I15 | 브리핑 모드 진입+Esc 종료, 범위·기준·분모 유지 | PASS | `m3-interact-briefing.png` |
| I16 | 390 상세필터 drawer 오픈·Esc 종료·포커스 이동 가능, overflow 0 | PASS | `m3-390-drawer-open.png` |
| I17 | 허용 bbox 직접 로드(`?bbox=126,35,128,37`) 유지+unsupported 안내, Back 시 base 복원 | PASS | `m3-bbox.png` |
| I18 | 공유 → toast `공개 조회 조건 URL을 복사했습니다. 차량·계정정보는 포함되지 않습니다.` | PASS | 스크립트 실측 |
| I19 | 키 없음 경로: SDK script 미삽입·`window.kakao` 없음·실패 카드+재시도+지점 목록 (MOCK ONLY 표기, 실지도 아님) | PASS | 스크립트 실측 |

KST·날짜기준: 스탬프 `데이터 기준 2026.09.24`, KPI·인사이트에 `신고일 기준`/`처리완료일 기준` 배지 실측.
허용 범위 밖 bbox는 `scopeFromSearch`가 null로 버림(코드 확인+허용 bbox 실측).

## 3. 결함 (재현 가능 1건 — dev-only, 낮음)

| id | severity | viewport/theme | 재현 | expected | actual | evidence | owner |
|---|---|---|---|---|---|---|---|
| M3-D1 | 하 (dev-only) | 전체/dev 서버 | `npm run dev`에서 조건 적용 1회 → `history.length` +2 → Back 1회가 적용을 되돌리지 못함 | Back 1회 = 적용 1회 취소 | 동일 URL entry 2개가 쌓여 Back 2회 필요 | `m3-probe.mjs` 로그 (`len0=2→len1=4→len2=6`) | Sol (통합, `src/pages/Dashboard.tsx` `apply`·`pickEntity`·`applyView`의 `pushUrl`이 `setScope` updater 내부 호출. StrictMode dev 이중실행과 결합) |
| — | 참고 | 전체/prod 빌드 | 동일 시나리오를 `npm run build`+정적 호스팅(emul `/safetyreport-community-map/`)에서 재측 | — | entry +1, Back 1회로 base 복원, pageerror 0 (M3-D1은 운영 아티팩트에 영향 없음) | `m3-prod.mjs` 로그 | — |

M3-D1 수정 제안(구현 아님): `pushUrl`을 updater 밖으로 이동(다음 scope를 먼저 계산 후 `setScope(next); pushUrl(next)`).
단, `pickEntity`·`applyView`도 동일 패턴이므로 함께 정리 필요. 검수 worktree에서는 수정하지 않음.

M2 잔존 `M1-DATA-1` 해소 확인: demo `r2`가 `1*3나*5*7` → `1*3*4*67`로 교체돼
`src/data/schema.ts` regex(`/^[0-9]\*[0-9가-힣]\*[0-9]\*[0-9]{1,2}$/`)와 일치. 1-based 2/4/6 마스킹 위치 실측 일치.
중복 표시 `1*가*4*6`(r1/r4)은 `rank_item_id` 분리 독립 행으로 렌더(PRIV04 준수, 합산 없음).

## 4. 통계·공개 경계 (실측)

- 1건: 행·마커·카드 유지+`표본 1건` 배지. 수용 100.0%(D=1, 분모 명시), 일부수용 0건 0.0%(D=1 기준 실측 0%, 0분모 아님).
- 0 vs null: empty에서 실측 0은 `0건`, 미지원/0분모는 `—`+사유(`분모 0건 · 비율 없음`, `결과 미확인`). `—%` 문자열 0건.
- partial month·비교기간: 추이 카드에 `진행 중 월 포함`+`%p/건수 % 구분`注記 실측. 동일 경과기간 비교 로직은 코드 수준이며 live 비교 실측은 BLOCKED.
- completed_date 결측 대체 없음: 인사이트 `결과 미확인 … 결측 표시`, 데이터 안내에 결측 정책 명시.
- mask 충돌: r1/r4 동일 표시 독립 행.
- 노출 검사: DOM·URL에서 미마스킹 번호 패턴(`[0-9]{2,3}[가-힣][0-9]{4}`)·`service_role`·`eyJh`·`vehicle_hash`·계정 이메일·신고번호 관련 문자열 0건.
  공유/북마크 URL은 start/end/category/region_code/agency_key/manager_key/bbox/fixture만 포함.
- 합성 고지: TopBar `demo · 합성 데이터`, 인사이트 `합성 예시 · demo`, 푸터·데이터 안내에 표본 고지+capability chips
  (`daily_report_dates: 지원` … `region_boundaries: 미지원` 등)+`UI03 실제 Kakao 지도와 live 공개 API 연동은 키·엔드포인트가 없어 BLOCKED` 문구 실측.
- 집계 표시 노드: `aggregate` 분기(MapPanel 목록·InsightPanel 상세·`이 지점 범위로 분석` bbox)가 코드에 구현돼 있으나
  demo overview fixture에 aggregate 표본이 없어 시각 검수는 NOT_RUN(저줌 centroid 표시는 `원좌표 아님` 라벨과 함께 코드로 확인).

## 5. 최종 판정

- UI01 (1920 dark/light 지도 대체·KPI·차트·표 연동): PASS (fixture 범위)
- UI02 (390 overflow·필터/sheet/표 터치): PASS
- UI03 (실제 Kakao SDK 로딩·도메인·키·마커·relayout): **BLOCKED** — `VITE_KAKAO_MAP_JS_KEY` 없음.
  실패 카드+재시도+동일 지점 목록 대체·attribution 비가림은 8 viewport에서 육안 확인. 주입 stub 실험은 MOCK ONLY로 별도 표기.
- UI04 (1건 유지·unsupported/empty/0 구분): PASS
- UI05 (범위 chip·기간·date basis·분모 일치): PASS
- UI06 (1440/2560·브리핑·Esc·포커스): PASS
- UI07 (light 토큰 전역 적용): PASS
- UI08 (키보드 탭/aria-sort/표 대안): PASS (스크린리더 전체 탐색·reduced-motion 실측은 NOT_RUN)
- UI09 (attribution 비가림·dark invert 미사용): PASS (실패 카드 문구+육안)
- REL01 (Pages subpath): PASS — `base=/safetyreport-community-map/` 빌드 산출물을 정적 emul 호스팅에서 부팅·적용·Back까지 실측.
  단, 실제 Pages 배포 smoke는 미승인·미실행이므로 **live smoke는 BLOCKED**.
- REL02 (live 실패 시 demo 자동전환 없음·sample 배지): PASS (코드 분기+배지 실측. live endpoint 자체는 BLOCKED)
- DATA/PRIV/SEC 항목: fixture 범위 PASS (DATA02 월 귀속·DATA04 0분모·DATA06 TOP5 전집합·DATA07 canonical 집계는 Sol unit 테스트 영역으로,
  본 검수는 UI 표출값으로 교차 확인). live API·운영 DB 관련 항목은 NOT_RUN/BLOCKED.
- M3-D1 1건은 dev-only·낮음. 출시 차단 아님.

실행하지 않은 테스트(NOT_RUN): 스크린리더 전체 탐색, reduced-motion 실측, 10k synthetic perf(PERF01/02),
live 공개 API·실제 Pages URL smoke, aggregate 저줌 노드 시각 확인.

## 부록 · 재현 정보

- `git status` (보고서 작성 시점): `?? docs/reviews/screenshots/m3/` 외 clean.
  보고서 본 파일(`docs/reviews/M3-integration.md`)은 commit 시점에 추적 전환.
- `git rev-parse HEAD`: `d05033469ca30480718b6345c8ff05f50b3a0810` (검수 대상 고정 commit, 변경 없음).
- 브라우저 실측 버전: Chrome 154.0.8037.57 / playwright-core 1.63.0.
- 총 73 checks 중 72 PASS, 1 FAIL(b2-back — 원인 규명 후 M3-D1로 기록, prod 재측 PASS).
- 콘솔 에러·4xx/5xx: 매트릭스 16셀+상호작용 전체에서 0건.
