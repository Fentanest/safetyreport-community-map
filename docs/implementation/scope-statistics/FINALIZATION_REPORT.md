# 최종 마감 보고 — F01~F06 (scope-statistics-release-excelize-2026-09-29.2)

정본 지시서: `FINALIZATION_PROMPT.md`, 인수 테스트 계획: `FINALIZATION_ACCEPTANCE_TESTS.md` (사용자 제공 원문 사본).

| 구분 | 값 |
|---|---|
| **최종 코드 SHA** | `088c98c457283d1d6caf855a980d842f89411fc4` |
| 증거 SHA | 이 보고서와 `finalization-evidence/`를 담은 다음 커밋(코드 변경 없음) |
| 증거 생성 조건 | 코드 SHA의 **깨끗한 작업 트리**(`working_tree_dirty: false`)에서 실행, 결과를 scratch에 쓴 뒤 복사 |
| main 병합 · 운영 배포 · 운영 DB | **하지 않음** (승인 전) |

환경 구분: `unit`(Node/vitest) · `browser-wasm`(로컬 Chromium, excelize-wasm이 브라우저 Web Worker에서 생성) ·
`browser-mock`(로컬 Vite + 실제 핸들러 코드 + 합성 자료 + **MOCK 카카오 SDK**) · `pages-preview`(프로덕션 빌드를 Pages 흉내 정적 서버의
하위 경로에서 제공) · `xlsx-ooxml`(생성 파일을 별도 검사기로 읽음) · `libreoffice`(보조 뷰어, **Excel 아님**) ·
`deno-local`(Deno CLI 2.9.6로 함수 실행 + 로컬 Supabase DB/Auth, **edge-runtime 컨테이너 아님**) · `real-sdk` · `excel-desktop/web` · `production`.

## 검사 요약 (코드 SHA에서)

| 검사 | 명령 | 결과 | 증거 |
|---|---|---|---|
| 단위 | `npx vitest run` | 466 통과 / 46 건너뜀(Docker 전용), exit 0 | `finalization-evidence/unit.log` |
| 타입·빌드·dist 검사 | `npx tsc -b`, `npm run build`, `npm run scan`, scan 단위 5건 | 모두 exit 0, `passed: true`. dist 초기 번들에 `__chart`/`__cmExport` 훅 0건 | `tsc.log`, `build.log`, `scan.log`, `scan_unittest.log` |
| 브라우저 판정(F01~F03, F06) | `LANG=C.UTF-8 node scripts/browser/verify_finalization.mjs` | **PASS 51 / 51**, exit 0 | `browser-wasm/runs/finalization-2026-09-29T09-44-11-184Z.json`, `browser-wasm/files/*.xlsx`, `shots/` |
| 판정기 자가 검증 | 같은 스크립트 + `SELFTEST_WRONG='FN-11:…'` | 해당 ID FAIL, **exit 1** | `selftest/` |
| 이전 라운드 회귀(C01~C08 60건) | `node scripts/browser/verify_scope_statistics.mjs` | **PASS 60 / 60**, exit 0 | `regression-c01-c08/` |
| 실제 Edge 코드 + 로컬 DB | `scripts/integration/deno_functions.mjs` + `vitest --no-file-parallelism tests/integration/{statistics-edge,my-analytics-stack,agency-recompute-stack}` | **13 / 13 통과**. 게이트웨이 기록 76건 모두 Deno 함수가 응답 | `edge-deno-local/` |
| 실제 카카오 SDK | `node scripts/browser/verify_real_sdk.mjs` | **BLOCKED 11**, exit 2 (dapi.kakao.com 프록시 CONNECT 403) | `real-sdk/` |
| LibreOffice 보조 확인 | `python3 scripts/xlsx/lo_check.py` (브라우저 산출 13개 파일) | 오류 0. 재계산 후 수식 칸 전부 숫자, 차트 있는 9개 파일 모두 원본 칸 수정 → 차트 값 변경 | `libreoffice/lo_check.json`, `libreoffice/libreoffice-png/` |

## F01 차트 유형 전환 생명주기

- **변경 파일**: `src/components/stats/PivotChart.tsx`(렌더러 분리: `CartesianChart`·`ScatterChart`·`HeatmapPair/HeatmapSide`·`SummaryView`가 각자 host와 `useEChart` 소유), `src/lib/charts.ts`(DEV 전용 인스턴스·ResizeObserver 계수), `src/state/statsChartModel.ts`(공통 차트 의미 모델).
- **수정 전 재현(실제 재현됨)**: `7e4ba96` 코드(작업 트리 차이는 package.json·lock의 의존성 추가뿐)에서 자동 히트맵 → 막대 직접 전환 시 막대 host에 ECharts 인스턴스·canvas·series가 없음(`blank_bar_reproduced: true`). 막대→히트맵→막대도 동일. 증거 `f01-repro/before-7e4ba96.json`.
- **수정 후**: FN-01~04 PASS (browser-mock). 막대↔히트맵 20회 후 live 인스턴스 8 = 마운트된 host 8 = observer 8(누수 없음), 비교 히트맵 두 집단 매번 존재, 요약값↔일반 차트, 저장(세션) 복원한 히트맵에서 첫 마운트부터 막대 전환.
- 지도·페이지 remount 없음, query·적용 결과·비교 대상·정렬 유지.

## F02 분석 구성 공유 링크

- **변경 파일**: `src/state/share.ts`(버전 1 허용목록·크기 제한·strict Zod·카탈로그 재검증), `src/components/stats/SharePanel.tsx`, `StatisticsPage.tsx`, `Dashboard.tsx`(`sr` 파라미터 전달).
- **전달하는 것**: 기간, 날짜 기준, 누구의 신고(all/mine/compare), 행·열·지표 id와 순서, 분류·지역·법규·기관·담당자 scope key, 비교 대상 key, 차트 유형·주 지표·겹쳐 보기, 표/그래프.
- **넣지 않는 것**: 토큰, user id·해시, 이름·라벨(서버가 다시 만듦), 결과 수치, 작성자 내 신고 값, 주소(place_key), 지도 bbox, 스키마 밖 필드(거부). 범례 숨김 상태도 넣지 않음.
- 기본은 **적용된 결과의 구성**. 작성 중 초안은 명시적으로 고를 때만. 주소·지도 범위·내 신고가 있으면 무엇이 빠지는지 알리고 확인해야 링크 생성. 너무 길면 자르지 않고 거부. 클립보드 실패 시 선택 가능한 입력칸.
- 수신: 형식·버전·크기·SQL 모양 id·알 수 없는 id는 이유를 표시하고 **기본 구성으로 몰래 실행하지 않음**(요청 0건 확인). 로그아웃 상태는 기존 접근 게이트가 먼저 나오고 `sr`이 URL에 남아 로그인 왕복 후 실행. 실행 후 `sr` 제거, 새로고침은 세션 복원.
- **판정**: FN-05~10 PASS (browser-mock), 단위 3건. FN-08은 B 계정이 연 비교 링크의 내 신고 수가 B 토큰으로 직접 조회한 값과 같고 A 값과 다름을 확인.

## F03 범례 숨기기·복원

- **변경 파일**: `PivotChart.tsx`(`SeriesLegend`: 버튼·Enter/Space·aria-pressed, ECharts 범례는 끔), `StatisticsPage.tsx`(숨김 상태를 React 정본으로, 세션 저장, 결과 변경 시 사라진 key만 정리), `statsChartModel.ts`(안정 key = 지표×집단×선 멤버 key, 표시 이름 중복 시 번호).
- **요청·분모·합계 불변**: 숨기기/보이기 동안 API 요청 0, 표 텍스트 동일(FN-11). 100% 누적에서 불수용을 숨겨도 수용 비율 값이 그대로이고 남은 막대 합 < 100%(FN-13). 전부 숨김 → "표시할 항목을 선택해 주세요" + 전체 보기(0건·오류 아님), 테마·정렬·표↔그래프 왕복 뒤에도 유지(FN-12). 비교에서 내 신고만 숨김(FN-14).
- 히트맵의 색 막대는 값 척도라 토글 대상이 아님(화면에 안내). 월별 추이는 기존 체크박스가 유일한 정본이라 범례 토글을 중복으로 만들지 않음.

## F04 실제 환경 검증

| 항목 | 결과 | 환경 |
|---|---|---|
| FN-15 두 함수 번들·의존성 | **PASS (deno-local)**: `deno check` public-analytics·my-analytics 통과. 함수 5개를 Deno로 기동(npm 의존성은 환경 CA 번들 `DENO_CERT`로 받음, TLS 검증 해제 없음) | deno-local |
| FN-16 catalog/candidates/query·내 비교·인증 거부 | **PASS (deno-local)**: 새 `tests/integration/statistics-edge.test.ts` 5건(응답을 프런트 Zod 스키마로 파싱, 합계 = 칸 합, 비율 = 분자/분모, 확인 불가 key는 이름 없음, 잘못된/SQL 모양 spec 400, 무인증 401, 내 신고 = 같은 계정의 compare 경로 값, 다른 계정은 다른 값) + 기존 my-analytics 7건 + agency 1건 | deno-local + 로컬 Postgres 17/GoTrue/PostgREST |
| 기존 Docker 통합 40건 | my-analytics·agency **통과**. `community-stack`(33건, 수집 함수)은 Realtime(websocket)과 고정 로그 경로가 필요해 이 구성에서 **BLOCKED** | deno-local |
| Supabase edge-runtime 컨테이너 | **BLOCKED**: 컨테이너 안 npm 다운로드가 프록시 인증서를 신뢰하지 못함(이전 라운드와 동일). Deno CLI 버전(2.9.6)과 edge-runtime 버전은 다를 수 있음 | — |
| 게이트웨이 verify_jwt | **NOT_RUN**: 로컬 게이트웨이는 재현하지 않음(함수 자체 인증은 확인) | — |
| FN-17 실제 카카오 SDK | **BLOCKED** 11건 (네트워크 정책이 dapi.kakao.com 거부, 등록 도메인·JS 키 필요) | real-sdk |
| FN-18 같은 닉네임 A/B | **PASS (browser-mock)**: 회귀 C01-AB/NICK/RESTORE + EX-34/46(A의 엑셀 작업·파일·저장 버튼이 B에게 남지 않음). 실제 테스트 계정 2개는 **NOT_RUN** | browser-mock |
| FN-19 실제 브라우저 확대 125/150/200% | **BLOCKED** (헤드리스에 브라우저 확대 없음). viewport/DSF 흉내(ZOOM-EMU)는 회귀에서 PASS로 따로 기록 | — |
| FN-20 판정기 자가 검증 | **PASS**: 기대값 하나 뒤집으면 exit 1. BLOCKED만 있으면 exit 2 | — |
| FN-21 DB/RPC·운영 Edge 버전 | **BLOCKED**: 운영 Supabase·Pages 주소와 권한이 이 환경에 없음(저장소 변수) | production |

## F05 배포 호환성·순서

- 이번 라운드 **DB 변경 없음**. 이것이 "과거 migration이 운영에 모두 적용됨"을 뜻하지는 않는다(특히 `202609300100`은 사용자 적용 보고만 있음, 이 환경에서 미확인).
- 운영에서 먼저 확인할 것(읽기 전용, 사용자 실행):
  1. SQL Editor: `select version, name from supabase_migrations.schema_migrations order by version desc limit 5;` → `202609300100` 포함 여부.
  2. `supabase functions list --project-ref <ref>` → `public-analytics`·`my-analytics` 배포 시각/버전.
  3. 로그인한 테스트 계정 토큰으로 `GET /functions/v1/public-analytics/statistics/catalog` 200 여부. 404면 통계 API가 없는 구버전 → Pages를 먼저 올리면 맞춤 통계가 동작하지 않음(C05 상태 필드 하위호환과 다른 문제).
- **권장 순서**: ① 위 확인(미적용이면 승인 후 필요한 증분만) → ② `088c98c` 이후 코드로 Edge 두 함수 배포(이전 라운드의 Deno import 수정 포함) → ③ 같은 커밋으로 Pages 배포(**main 병합 = Pages 자동 배포**이므로 병합 시점이 배포 시점) → ④ 실제 SDK·두 계정·지역 상세·맞춤 통계·월별 다중 지표·**실제 XLSX 다운로드** smoke, WASM 자산의 base path·MIME(`application/gzip`, Content-Encoding 없음)·같은 버전 확인.
- PR #17은 이미 병합됨 → 새 PR이 필요(만들지 않음).

## F06 Excelize 엑셀 다운로드

**변경 파일**: `src/export/{model,workbook,excelizeLoader,runner,export.worker,controller}.ts`, `src/export/adapters/{statistics,dashboard}.ts`, `src/components/ExportButton.tsx`, 진입점 `StatisticsPage.tsx`·`TrendCard.tsx`·`PlaceEntityChart.tsx`(+`Dashboard.tsx` 조건 전달), 계정 경계 `App.tsx`, `public/licenses/excel-export-third-party.txt`, `scripts/scan_public_dist.py`(고정 WASM 한 개만 해시로 허용), 검사 도구 `scripts/xlsx/ooxml.mjs`·`scripts/xlsx/lo_check.py`·`scripts/browser/static_pages.mjs`.

**버전·로딩**
- `excelize-wasm` **0.1.3** (package.json·lock에 정확히 고정, BSD-3-Clause; Go 런타임 glue BSD-3, 내장 pako MIT). 설치본 `index.d.ts`·loader·`excelize.wasm.gz`를 확인했고 차트 enum 번호는 단위 테스트가 d.ts와 대조.
- 클릭 시에만 로드: Vite가 WASM(4.1MB gz)을 같은 origin·base path의 해시 자산으로, Worker(41.6KB)를 별도 청크로 낸다. 초기 번들엔 Excel 코드 없음(EX-36, 경계 테스트).
- 일반 Web Worker, `crossOriginIsolated=false`, SharedArrayBuffer 없음, COOP/COEP·격리 service worker 추가 없음(EX-37/38). Worker 실패 시 같은 코드를 메인 스레드에서 실행.
- 로더가 바이트를 먼저 검사: gzip이면 그대로, 서버가 이미 푼 WASM이면 한 번만 다시 감싸고, HTML/404/깨진 파일은 WebAssembly로 넘기지 않음(EX-41, 단위 6건). 실패는 캐시하지 않아 재시도 가능(EX-42).
- 시간(로컬): 첫 파일 ≈1.5초(WASM 포함), Worker 재사용 시 0.14~0.17초. 122,000칸 합성 표 + 차트: 12.3초, 665KB, 그동안 메인 스레드 최대 지연 4ms(EX-58).

**파일 구성**: `통계표`(전체 결과·다단계 머리글 + 고유 열 이름·비율 = 같은 행 분자/분모 수식·서버 합계·빈 값 사유) / `차트`(셀 참조 native 차트, 히트맵은 셀 + 색 척도 조건부 서식) / `차트 데이터`(차트가 읽는 칸 = `'통계표'` 칸을 가리키는 수식) / `조회 조건`(고정 날짜 Asia/Seoul·조건·범례 상태·계산식·결측 기준·snapshot 안내). 파일명 `커뮤니티신고지도_맞춤통계_YYYYMMDD_HHMMSS.xlsx`.

**Capability matrix (excelize-wasm 0.1.3, 실제 확인)**

| 웹 표현 | 파일 | 확인 |
|---|---|---|
| 막대/가로 막대/꺾은선 | native Col/Bar/Line, 이름·범주·값 모두 셀 참조, `dispBlanksAs=gap` | EX-50, 단위 |
| 월별 1~4 지표 × 전체/내 | native line 최대 8계열, 내 신고 점선·◆ | EX-04/05 |
| 누적 / 100% 누적 | ColStacked + 원래 분모로 나눈 칸(=값/SUM(전체 분할)), 축 0~1. percent-stacked는 쓰지 않음 | EX-21 |
| 산점도 | native Scatter. **제약**: 0.1.3은 X값을 `strRef`로 기록(Excel은 셀 숫자를 다시 읽는 것으로 예상, 미확인) | 단위(EX-19) |
| 히트맵(비교 포함) | 셀 행렬 + `colorScale` 조건부 서식, 두 집단 같은 행·열 순서·같은 척도(비율 0~1, 건수 공통 최대) | EX-15/16/51 |
| 건수선 + 100% 막대 | native 콤보, 건수는 **보조축** | EX-07/24(단위) |
| 요약값 | 차트 없이 통계표 합계 + 안내 | FN-03, 코드 |
| 너무 많은 항목 | 50개(담당자 40명)씩 나눈 여러 차트, 생략 없음 | 코드·단위 |
| 수식 캐시 | **제약**: 0.1.3은 수식 칸을 `t="str"`로 쓰고 캐시 값을 문자열로 남김, 차트 numCache는 비어 있음. `fullCalcOnLoad=true`로 Excel이 열 때 재계산. 재계산하지 않는 뷰어는 숫자를 문자열로 볼 수 있음. 임의 OOXML 덧붙이기는 하지 않음 | 단위 기록, LibreOffice 재계산 확인 |

**EX 판정 (브라우저가 만든 실제 XLSX 기준)**

| ID | 상태 | 환경 | 근거 |
|---|---|---|---|
| EX-01, 02, 03 | PASS | browser-wasm | Worker·WASM 요청 확인, 표 보기(히트맵)·그래프 보기(막대) 파일의 통계표가 동일 |
| EX-04, 05, 06, 07 | PASS | browser-wasm | 체크한 지표만, 8계열, 건수 보기 날짜 기준, 담당자 100명/125명 = "일부" 명시 + 보조축 |
| EX-08, 09, 10, 13, 14, 18, 19, 24 | PASS | unit(실제 Excelize) | G: 12/18·3/18·3/18·8/20·5/20 수식과 0~1, 1/1+9/99 = 0.1, 빈 달 gap·실제 0%, 막대·산점도·보조축, 동명이인(소속 표기), 서버 미지원 사유 |
| EX-11, 12, 17, 20, 28 | **NOT_RUN** (구현됨, 전용 assertion 없음) | — | 중앙값·P90은 서버 값을 그대로 씀(수식 없음), 1건도 같은 서식, 건수 히트맵 공통 최대 척도, 겹치는 집합은 누적 불가(기존 planChart 규칙), 다단계 행·열 머리글. 코드로 구현했지만 이 ID별 판정 테스트는 만들지 않았다 |
| EX-15, 16, 21, 22, 23 | PASS | browser-wasm | 비교 히트맵 2개(0-1), 내 칸 26개만, 5/6 막대, 전부 숨김 안내, 명시 포함 옵션 |
| EX-25, 29, 30 | PASS / N/A | unit·코드 | 요약값은 차트 강제 안 함. 결과는 항상 `complete: true`(한도 초과는 서버 422) → 부분 결과 경로 N/A. 표는 페이지가 아닌 전체 행 |
| EX-31, 32, 33 | PASS | browser-wasm | 조회 중 잠금, 내 비교 도착 전 잠금, 클릭 시점 snapshot 유지 |
| EX-34, 35, 46 | PASS | browser-wasm | 계정 전환·로그아웃 시 진행 작업 취소(Worker 종료, 파일 없음), 완성 파일·저장 버튼 폐기. **실제 결함 수정**: 로그아웃이 Dashboard를 unmount해 취소되지 않던 것을 `App.tsx`로 옮김 |
| EX-36~41, 60 | PASS | browser-wasm, pages-preview | 첫 클릭 전 요청 0, 비격리, 하위 경로, 엄격 CSP에서 생성, Content-Encoding 서버, 재방문 캐시(서버 요청 1회), 고정 버전·라이선스 |
| EX-42~45, 47, 48 | PASS | browser-wasm | 404 → 안내·재시도, 취소, 더블클릭 1작업·10회 반복 Worker 1개, 실제 단계 순서, API 요청 0, 파일 저장 버튼 |
| EX-49~55 | PASS | xlsx-ooxml(브라우저 산출) | ZIP·Content Types·관계 무결, numRef/strRef 범위 = 웹 값, 조건부 서식, 문자열/수식 구분, 비공개정보 0, 확인 불가 대상 이름 없음, 서버 값 222개 일치 |
| EX-56 Excel에서 열기 | **BLOCKED** | excel-desktop/web | 이 Linux 컨테이너에 Microsoft Excel 없음. 보조: LibreOffice 24.2에서 13개 파일 오류 없이 열림 |
| EX-57 원본 칸 수정 → 차트 | **BLOCKED (Excel)** / 보조 PASS | libreoffice | LibreOffice에서 9개 파일 모두 원본 칸 수정 후 차트 값 변경(예: 41→42일 때 0.3565→0.3652). Excel 확인은 아님 |
| EX-58 | PASS (로컬 측정) | browser-wasm | 위 시간·크기. 모바일 실기기 측정은 NOT_RUN |
| EX-59 | PASS | unit, build | Edge 함수 import 폐쇄에 export/excelize 없음, deno check 통과, dist 검사는 고정 WASM 한 개만 해시로 허용 |

**알려진 사항**
- 엄격 CSP 검사에서 보고된 위반 1건은 기존 `personal` 청크의 Zod JIT 탐지(`try { Function('') }`, 잡힌 뒤 jitless로 동작)이며 엑셀 기능과 무관. 사이트에는 현재 CSP가 없고 이번에 추가하지 않았다.
- 헤드리스 Chromium은 UTF-8이 아닌 로캘에서 한글 파일명을 `download`로 바꾼다(환경 문제). 판정은 `LANG=C.UTF-8`로 실행.
- 월별 추이 표의 `월` 칸은 날짜 값(`yyyy-mm` 서식), 차트 범주는 시간순 텍스트.

## 사용자·외부 조치

1. **Excel 검수**: Windows/Mac Excel 또는 Excel Web에서 `finalization-evidence/browser-wasm/files/`의 파일을 열어 복구 경고 여부, 차트·히트맵 색, 원본 칸 수정 → 차트 반영을 확인하고 제품·버전을 기록.
2. **실제 SDK**: 세션 네트워크에서 `dapi.kakao.com` 허용 + 등록 도메인과 JS 키 → `verify_real_sdk.mjs`.
3. **edge-runtime 컨테이너 통합**: 프록시 없는 CI/로컬에서 `supabase functions serve`로 `tests/integration` 전체(수집 33건 포함).
4. **운영 확인·배포**: F05의 확인 명령 → 승인 후 Edge → Pages(= main 병합) → smoke.
5. 새 PR 생성 여부.

## 추가: 사용자 문구 전수 정리 (코드 `4974861`, 검증 `fb1105c`)

화면·엑셀 파일·공유 링크·오류 메시지·맞춤 통계 항목 설명(서버 카탈로그)의 한글 문구 약 1,400개를 모두 읽고, 일상어로 이해되지 않는 표현을 고쳤다.

| 유형 | 예전 | 지금 |
|---|---|---|
| 전문 용어 | 분모 없음 · 분자/분모 · 계열 · 집단 · 원 신고 · 보조축 · 차원 · snapshot | 계산 불가 · 해당 건수/기준 건수 · 항목 · 전체와 내 신고 · 해당 신고 전체 · 오른쪽 축 · 행·열 항목 · 내려받은 시점의 결과 |
| 기호 | 수용률 A/K, 과태료처분율 F/C, (C), (K) | 수용률 (수용 ÷ 결과 나온 신고) 같은 말로 풀어 씀 |
| 개발자 말투 | 서버 미지원 · 이 서버는 … · (코드, HTTP 503) · Kakao SDK … · 구성 · 적용 전 · 요약값 · 주 지표 | 제공 안 됨 · 아직 제공하지 않습니다 · (알 수 없는 오류에만) 오류 코드 · 카카오 지도를 … · 설정 · 아직 반영 안 됨 · 숫자 요약 · 기준 지표 |
| 어색한 표현 | 내 신고(이 파일을 내보낸 사람) · (Asia/Seoul 날짜, 양 끝 포함) · 막대 요청 → 히트맵 · …(으)로 그렸습니다 | 내 신고 (이 파일을 내려받은 계정의 신고) · (시작일·종료일 포함), (한국 시간) · 히트맵 (고른 막대 그래프는 이 설정에서 쓸 수 없어 바꿨습니다) |
| 용어 통일 | 대시보드 ‘과태료 부과율’ ↔ 맞춤 통계·엑셀 ‘과태료처분율’, ‘계도처분율’, ‘범칙금처분율’ | 과태료 부과율 · 경고·계도 비율 · 범칙금 부과율로 통일 |

- 변경 범위: `src/**`(화면·엑셀·공유), `server/statistics.ts`(항목 이름·설명, 표 크기 초과 안내), `server/publicHandler.ts`·`personalHandler.ts`(오류 문구). 계산·계약(코드 값, id)은 바꾸지 않았다. **서버 문구도 바뀌었으므로 Edge 두 함수를 다시 배포해야 화면 문구가 모두 맞는다**(배포 전에도 동작 문제는 없음).
- 검사(`fb1105c`, 깨끗한 작업 트리): 단위 466 통과, 브라우저 판정 **51/51 PASS**, 이전 라운드 회귀 **60/60 PASS** → `finalization-evidence/copy-review-fb1105c/`.
- 테스트 기대 문구를 새 문구로 맞췄다. 그중 FN-06은 복원된 차트의 계열이 그려지기 전에 읽어 한 번 실패했고, 계열을 기다리도록 테스트를 고쳤다(제품 결함 아님).
- 이 문구 변경 뒤 deno-local 통합 테스트는 다시 돌리지 않았다(**NOT_RUN**, 응답 코드·구조는 그대로라 영향이 없을 것으로 봄).
