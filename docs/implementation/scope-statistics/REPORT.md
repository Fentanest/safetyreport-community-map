# scope-statistics-2026-09-29.2 구현 보고 (S01–S12)

- **기준:** main `67e35c6`에서 시작, 브랜치 `claude/gallant-darwin-7ldkbl`. 미커밋 변경은 없었다.
- **역할:** 이 세션의 Claude(Opus) 혼자 구현과 검수를 맡았다. 외부 모델의 독립 검수는 없다(Muse 검수는 **MODEL_UNVERIFIED**).
- **검증 범위:**
  - 로컬 live 스택 = 실제 프런트 + 실제 Edge 핸들러 코드 + **합성 자료** + **MOCK 카카오 SDK**
  - Playwright 1.56 / Chromium 1194
  - 운영 Supabase·Edge·Pages, 실제 카카오 SDK, 운영 자료는 **운영 미검증**이다.

## 자동 검사

| 검사 | 결과 |
|---|---|
| `npm test` | **430 passed / 41 skipped** (skip은 기존 Docker 통합 전용) |
| 신규 테스트 | `trendMetrics.test.ts` 14건 — fixture oracle 7개 달과 설정 이관 |
| | `statistics.test.ts` 18건 — PV·MS·라우트 |
| | `scopeStatisticsUi.test.ts` 10건 — S10 registry, 차트 계획, 인계, 지역 경로 |
| | `refreshController.test.ts` +4건 — 단계, A→B→C, 429, 재시도 정지 |
| `npm run build` | 통과 |
| `npm run scan` | `passed: true, issues: []` |
| dist 확인 | dev 차트 hook `__chart`, oracle fixture, 서버 집계 문구 모두 **없음** |
| 브라우저 | `node scripts/browser/verify_scope_statistics.mjs docs/implementation/scope-statistics/evidence`로 `scope-statistics.json`과 PNG 생성. 8개 단계 모두 오류 없음 |
| 기존 회귀 | `verify_redesign` R10·P03·P04, `verify_followup` R1·R7 재실행 통과 |
| 회귀 결과 | 날짜 입력 포커스, 429 대기, 권한 게이트, 12년 조회, 비율 지도 핀 0, 20회 조작 시 지도 2→2 |

`fixtures/monthly-rates.example.json`은 **테스트 oracle로만** 읽는다. expected 값을 구현 출력으로 바꾸지 않았고, 운영 화면에는 넣지 않았다.
`references/*.png`는 실제 주소·이름이 있을 수 있어 **커밋하지 않았다**.

## S01–S12

이 표의 PNG 이름은 `evidence-legacy-observation/`의 관찰 기록이다(판정 아님). 판정은 아래 '인수 테스트 판정'과 `closeout-evidence/`를 본다.

| 절 | 변경 파일 | 실제 배선 | 테스트 | 브라우저 증거(합성·MOCK) | 남은 것 |
|---|---|---|---|---|---|
| **S01** 선택 범위 상세 | `ScopeDetailsPanel.tsx`(신규), `EntityMetricRow.tsx`(추출), `PlaceDetailsPanel.tsx`, `CommandBar.tsx`, `Dashboard.tsx`, `server/aggregate.ts`, `publicHandler.ts`, `schema.ts`, `domain/public.ts`, `client.ts`; `RegionSummaryCard.tsx`는 흡수 후 삭제 | 핀이 없으면 **표시 중(displayed) 조건**의 상세를 보인다. 경로는 전국›시도›시군구다. 하위 지역 목록, KPI(기존 증감·내 비교 포함), 과태료와 계도(`overview.warning_count` 추가), 기관·담당자 지표 박스, 담당자별 복합 차트를 담는다. 검색과 "나머지 불러오기"는 서버 `/entities` 전체 목록을 쓴다. dashboard에 `agency_total/manager_total`을 추가했다. 상단 시도·시군구 선택기, 하위 목록, 경로, Polygon이 모두 같은 `pickRegion`을 쓰고, 이 동작은 주소 선택을 해제하고 bbox를 지운다. | `childRegions`/`regionTrail` 단위 | 전국: 하위 시도 8, "표시 5 / 전체 10". 서울: `region_code=11`, 경로 전국›서울. 시군구: 3단계 경로. 담당자 검색은 `/entities` 1회. 상단 선택기는 요청 1회, 가로 넘침 0 (`SC-*.png`, `S01-top-region-*.png`) | 장소 패널 경로 클릭은 코드로만 확인했고 브라우저에서 따로 누르지 않았다 |
| **S02** 핀 선택·해제·강조 | `lib/kakao.ts`, `MapPanel.tsx`, `Dashboard.tsx`, mock SDK | `togglePlace`(같은 핀이면 해제), `clearPlace`(버튼·Esc·빈 곳 클릭) | `mapClusterControls` 기존 테스트 유지 | 첫 클릭: `(선택됨)`, z=10. 재클릭: 해제되고 범위 상세로 돌아감. P1→P2: 선택 1개. 마커 클릭 직후 빈 클릭은 무시, 0.6초 뒤 빈 클릭은 해제. 드로어가 열린 상태의 Esc는 드로어만 닫고 선택 유지. 드래그 직후 빈 클릭은 무시. 비율 모드는 핀·강조 0. 30회 조작 뒤 마커 누적 없음, 지도 2→2 (`PI-*.png`, `PI-selected-closeup-*.png`) | 실제 카카오 SDK의 click 순서(`clickable`)는 **미검증**(MOCK만) |
| | | Esc는 드로어 → 브리핑 → 주소 순서로 한 겹만 닫고, 입력 중에는 가로채지 않는다. | | | |
| | | 마커에 `clickable:true`, 겹침 click·drag·zoom 뒤 400/300ms 무시 창을 두었다. | | | |
| | | 선택 핀은 1.3배 크기, 흰색+주황 이중 halo, "선택됨" 탭, `zIndex` 10이다. 내 신고 테두리는 halo 안쪽에 그려져 선택 표시가 우선한다. | | | |
| | | 선택을 포함한 묶음은 제목에 "선택한 주소 포함"을 붙이고 zIndex 9로 둔다. | | | |
| **S03** 스티키 보정·사이드바 | `lib/navigation.ts`(신규), `Rail.tsx`, `TopBar.tsx`, `scope-statistics.css` | 측정한 가림 높이(겹침 합산 없음)를 `--scroll-top-inset`으로 두고 `scroll-padding-top`에 쓴다. 전략은 하나이고 JS가 다시 빼지 않는다. ResizeObserver, resize, 글꼴 로딩을 반영한다. 메뉴는 지도·지역(`#regions`)·기관·추이·통계다. 통계는 `aria-current=page`, 섹션은 `location`이다. 통계 화면에서 섹션을 누르면 대시보드를 복원한 뒤 rAF로 이동한다. | – | 1440: 섹션 top 76 = TopBar 64 + 12. 390: 68 = 56 + 12. 네 메뉴 모두 같다 (`NV-entities-*.png`) | scrollspy(스크롤에 따른 활성 표시)는 **미구현**(클릭 기준). 브라우저 확대율 125/150/200%는 **미검증** |
| **S04** 맞춤 통계 화면·인계 | `StatisticsPage.tsx`(신규), `Dashboard.tsx`, `state/view.ts` | `?screen=statistics`로 들어가므로 Pages 새로고침·직접 진입이 된다. screen 값은 API로 보내지 않는다. 대시보드는 `hidden`으로 두고 지도 인스턴스를 유지하며, 통계 페이지는 한 번 열리면 계속 mount 상태다. | `screenFromSearch`, 인계 단위 | 서울 상세에서 "통계 만들기"를 누르면 URL `region_code=11&screen=statistics`, H1 포커스, 지역 칩, 결과가 나온다. 새로고침 뒤 결과가 복원되고, 뒤로가기는 대시보드로 간다. 지도 인스턴스 2→2. 주소 인계는 "주소" 칩과 해제 버튼으로 보인다 (`PG-*.png`) | 공유 링크(레시피 URL)는 최종 마감 **F02에서 구현**(`FINALIZATION_REPORT.md` F02, FN-05~10) |
| | | 인계는 **표시된 조건**(`shownScope`)을 넘긴다. 주소 인계에는 place_key를 붙인다. | | | |
| | | 설정 초안·적용 레시피·표시 설정은 viewer별 sessionStorage에 두고, 결과 자체는 저장하지 않는다. 로그아웃하면 지운다. | | | |
| **S05** 필드 registry·피벗 | `server/statistics.ts`(신규), `domain/statistics.ts`(신규), `server/aggregate.ts`(helper export) | 차원 26개: 시도, 시군구, 주소, 기관(현행명), 기관 유형, 담당자(복합 키), 법규, 분류, 처리결과, 처분, 답변·신고의 연·분기·월·일·요일, 별점, 처리기간 구간, 확인 금액 구간, 위치 자료. 지표 26개. | PV-01~10, 14, 15 단위·라우트 (G 66.7/16.7/16.7/40/25, 1/1+9/99 → 10%, distinct 차량 합 3 대 전체 2, 신고일 기준 제외 1, SQL 조각 거부, 5,000칸 초과는 422) | 표에서 합계 행이 원천 재계산 값을 보인다 (`W-stats-*.png`) | 필드 감사 결과는 아래 표 |
| | | 모집단: all = 대표행, mine = JWT 사용자 행을 identity별로 모은 것. | | | |
| | | 합계는 cell을 더하지 않고 원천 union에서 다시 계산한다. 한도(행 3·열 2·지표 6·필터 8·대상 50·5,000칸)를 넘으면 422로 알린다. | | | |
| **S06** 비교 대상 선택 | `stats/MemberPicker.tsx`(신규), `/statistics/candidates` | 서버 전체 검색, 300ms debounce, IME 조합 중 요청 없음. generation으로 늦은 응답을 버린다. 종류별 초안을 두고 "적용"에서만 실제 query를 바꾼다. 선택만 보기, 순서 변경, 모두 해제를 지원하고, "현재 조건 0건"을 표시한다. Esc는 다이얼로그만 닫는다(capture 단계). | MS-03·04·05·08·09 단위 | 검색 "경찰": candidates 1회, 입력 포커스 유지. 3개 체크 뒤 검색어를 바꿔도 선택 3개 유지. 적용 후 실행: query 1회, 결과 행 = 선택한 3개 기관. Esc: 다이얼로그만 닫힘 (`MS-picker-1440.png`) | 권한 상실 대상(MS-10) 구분은 **미구현**(0건과 동일하게 표시) |
| **S07** 표↔그래프 | `stats/PivotTable.tsx`, `stats/PivotChart.tsx`, `state/statistics.ts`, `lib/charts.ts`(Legend 등록, dev hook) | 같은 `StatisticsResult`를 두 renderer로 보인다. 결과가 완전(complete)하면 전환할 때 요청 0이다. | 차트 계획 단위(CH-07·08·09, 선 거부) | 표→그래프 요청 0, 히트맵 series 1개. 표로 돌아와도 첫 행 동일. 기관×답변월은 꺾은선 3개. 호환되지 않는 유형은 옵션에 "(이 조합 불가)" (`CH-*.png`) | 범례 클릭 숨김은 제공하지 않는다(읽기 전용 범례) |
| | | 자동 추천: 날짜 → 꺾은선, 2차원 → 히트맵, 긴 이름 → 가로 막대, 차원 없음 → 요약값. 100% 누적은 K·C 분할에만, 산점도는 차원 1개·지표 2개일 때만 허용한다. 호환되지 않는 요청은 이유를 표시하고 설정은 바꾸지 않는다. | | | |
| | | 같은 단위 지표만 겹쳐 그린다. member key로 색을 고정하고 날짜 순서를 지킨다. null은 선을 끊는다. 선 24개·항목 400개·히트맵 2,500칸을 넘으면 그리지 않고 이유를 보인다. | | | |
| | | 범례는 읽기 전용이라 분석 대상과 표시 대상이 어긋나지 않는다. cell·행을 누르면 "이 항목으로 좁히기"가 뜬다. | | | |
| **S08** 보안·성능·저장 | `publicHandler.ts`, `personalHandler.ts`, `data/statistics.ts`, `data/personal.ts` | 공개 API는 all만 받는다(mine은 400). 알 수 없는 파라미터는 400이다. Authorization은 기존 두 클라이언트 파일에서만 보낸다(경계 테스트 유지). Zod로 응답을 검증하고 scope·spec·version이 요청과 같은지 확인한다(불일치는 409). | 라우트 테스트(401, 카탈로그에 비공개 없음, mine 거부, 추가 파라미터 거부) | 실행 중 버튼 "만드는 중…", 중복 실행 방지, 이전 결과 유지 (`LD-statistics-running-1440.png`) | 서버 저장 테이블은 필수가 아니다(원지시서). CSV 대신 최종 마감 **F06 Excelize XLSX**(통계표·편집 가능한 차트·조회 조건)를 구현했다. 공유 링크는 **F02에서 구현** (`FINALIZATION_REPORT.md`) |
| | | 한 요청은 facts 조회 1회라 같은 스냅숏을 쓴다. 구성 저장은 localStorage에 하되 주소와 내 신고는 저장하지 않는다. | | | |
| **S09** 월별 복수 비율 | `trendMetrics.ts`(신규), `MonthlyRateSelector.tsx`(신규), `TrendCard.tsx`, `Dashboard.tsx` | 네 체크박스(native)와 전체 선택·해제. 기본은 수용률이고, 이전 단일 설정은 1개 배열로 이관한다. 선택은 localStorage에 표현 설정으로만 둔다. | **oracle 7개 달 전부 일치**(MT-08~13), 설정 이관(MT-07) | 기본 1선 → 네 개 체크 시 `rate:*:all` 4선 → 20회 토글에 요청 0, 같은 차트 인스턴스 | 390px에서 Space 키 조작은 브라우저에서 따로 누르지 않았다(native checkbox) |
| | | 선마다 `rate:<k>:all\|mine` id. 비교를 켜면 지표별로 실선 전체와 점선◆ 내 신고, 최대 8선이다. | | 모두 해제하면 "비교할 지표를 선택해 주세요" 안내, 체크박스 4개는 그대로 | |
| | | 지표별로 지원 여부를 판정하고 달 키로 결합한다. null은 선을 끊는다. tooltip·표·선이 같은 selector를 쓴다. | | 내 신고를 2.5초 늦추면 "내 신고를 불러오는 중"과 상단 "내 신고를 비교하는 중"이 뜨고 전체 4선은 유지된다 → 이후 8선 | |
| | | "이 조건으로 통계 만들기"는 답변월, 복수 metricId, 모집단을 인계한다. | | 표 열은 지표별 전체/내 신고, tooltip은 8값과 분자/분모. 인계 결과는 "답변 월 · 4지표"와 겹친 4선 (`MT-*.png`, `MT21-*.png`) | |
| **S10** 조회 상태 | `data/queryActivity.ts`(신규), `GlobalQueryStatus.tsx`(신규), `PanelStatus.tsx`(신규), `refreshController.ts`(`fetching`/`wait` 추가), `TopBar.tsx`, `EntityTable.tsx`, `Dashboard.tsx`, `StatisticsPage.tsx`, `MemberPicker.tsx`, `ScopeDetailsPanel.tsx` | 표시 전용 registry다. 각 소유자가 **자기 id로 현재 상태를 선언**하므로, 늦은 finally가 다른 작업의 표시를 끌 수 없다. controller 단계는 debounce → scheduled, 전송 중 → fetching, 429 → retry_wait(retryAt), 1회 재시도 → retry_wait, 오류 → error로 나뉜다. | controller +4(단계, A→B→C 역순, 되돌아가면 즉시 정리, 재시도 뒤 정지), registry 2 | 느린 dashboard: 상단 "새 조건으로 통계를 불러오는 중 · 화면은 이전 조건(…)", 진행선, 패널 aria-busy, KPI 유지, 지도 2→2. 맨 아래로 스크롤해도 상단 상태가 보임 | – |
| | | 상단은 TopBar 안 예약 슬롯에 두어 높이가 바뀌지 않는다. 150ms 늦게 표시하지만 요청은 늦추지 않는다. 가짜 진행률이 없는 무한형 선이다. countdown은 로컬 1초 틱이고 aria로는 반복해 읽지 않는다. reduced-motion에서는 정적으로 보인다. | | P1 지연 중 P2 선택: P2 제목, 상태 정리. 선택 해제 시 주소 상태만 사라짐. 자동 갱신 OFF에서 이동: 요청 0·상태 0 | |
| | | 패널별로 범위 상세, 주소 상세, 목록, 월별 차트, 맞춤 통계 결과, 후보 검색에 상태를 따로 둔다. 세션이 바뀌면 registry를 비운다. | | 429: "요청이 많아 잠시 기다리는 중 · 4초 후 다시 시도" → 그 뒤 요청 1회 (`LD-*.png`) | |
| **S11** 파일별 배선 | 위 표의 파일 목록 | – | – | – | – |
| **S12** 인수·보고 | 이 문서, `docs/public-api-contract.md`, `docs/metrics-catalog.md`, `docs/deployment.md` | – | – | 5폭(1920/1440/1280/768/390) × 다크/라이트: 대시보드·통계 화면 가로 넘침 0, 콘솔 오류 0 (`W-*.png`) | 아래 목록 |

## 필드 감사 (S05.1)

| 원천 | 이번 처리 |
|---|---|
| report_date / completed_date | 연·분기·월·일·요일 차원과 기간 기준으로 사용 |
| category · status · disposition | 차원과 필터로 사용 |
| status_raw | 공개 fact projection에 없어 **노출하지 않음**(새 공개 허용으로 간주하지 않음) |
| amount.kind · confirmed_won | `classifyAmount`로 공개 동의·확인된 과태료만 금액 구간과 합계·평균·중앙값에 사용. 범칙금·혼합은 제외 |
| penalty_points | 비공개. 사용하지 않음 |
| address · lat/lng · location.source | 주소(place_key), 지역 귀속, 위치 자료 유무에 사용. 좌표 합계 같은 무의미한 지표는 만들지 않음. location.source 원값은 노출하지 않음 |
| vehicle_raw | 서버 내부 정규화로 distinct 차량 수만 계산. 원번호·차량 키 차원은 없음 |
| agency_name · source_agency_code | 기관 key와 현행 표시명, 기관 유형에 사용. raw code는 노출하지 않음 |
| manager_name | 기관+담당자 복합 키로만 사용 |
| violation_law | 공개 허용분만 조 단위로 사용 |
| rating | 공개 동의분 1~5점만 사용 |
| report_number · 계정 · 이벤트 · 해시 | identity와 권한 판단에만 사용. 차원·표시 없음 |

## 인수 테스트 판정 (2026-09-29 closeout에서 재분류)

이전 판(`39552e3`)의 PASS/PARTIAL 표는 **관찰 기록을 사람이 읽고 붙인 판정**이었다. PARTIAL에는 미구현과 미실행이 섞여 있었고, 브라우저 스크립트는 기대값을 판정하지 않았다(종료 코드는 항상 0). 이번에 아래 기준으로 다시 분류했다. 근거와 수정 내역은 `CLOSEOUT_REPORT.md`에 있다.

**판정 기준**
- **PASS(방식)**
  - `unit`: vitest 단위·라우트 테스트
  - `browser-mock`: assertion 기반 브라우저 실행 `closeout-evidence/local-mock/runs/*.json`. 합성 자료, **MOCK 카카오 SDK**, 로컬 핸들러를 쓴다. 실패가 있으면 종료 코드 1이다.
  - `sql-local`: 로컬 Supabase의 실제 migration 28개 체인에서 SQL 실행
- **FAIL**: 실행했고 기대값과 다름
- **PARTIAL**: 요구 일부만 실행 또는 판정
- **NOT_RUN**: 구현은 있으나 판정 가능한 실행이 없음
- **NOT_IMPLEMENTED**: 구현 안 함
- **BLOCKED**: 환경 때문에 실행 불가(사유 명시)
- **N/A**: 설계상 적용 경로가 없음(근거 명시)
- MOCK SDK 결과는 실제 카카오 SDK 결과나 운영 결과가 아니다.

| ID | 판정 | 방식·증거 |
|---|---|---|
| SC-01·02·03·04·05·09 | PASS | browser-mock (SC-05는 주소 패널 경로를 실제로 클릭) |
| SC-06 | PASS | browser-mock. PI-02에서 선택·해제 뒤에도 URL scope가 변하지 않음 |
| SC-07·08 | NOT_RUN | bbox 문구와 자동 갱신 ON/OFF 상세는 코드만 있고 판정 실행이 없음 |
| SC-10 | PASS | unit(mine 모집단) + browser-mock C01-AB(두 계정의 내 신고 분리) |
| SC-11 | PASS | 기존 R7 회귀(관찰 기반, 지도 2→2) |
| SC-12 | PASS | unit(controller A→B→C) |
| PI-01~07·10·13 | PASS | browser-mock. 클릭은 MOCK의 `__click`으로 했고, 실제 SDK 이벤트 순서는 SDK-* 참조 |
| PI-08 | PARTIAL | 선택 zIndex 10과 halo가 mine 링 바깥이라는 것은 코드와 스크린샷으로만 확인. 자동 판정은 zIndex만 |
| PI-09·11·12·14 | NOT_RUN | |
| NV-01·02·07·08·09·10 | PASS | browser-mock (±2px, 뒤로·앞으로 시 스크롤·필터·초안 복원) |
| NV-SPY (scrollspy) | PASS | browser-mock (이번에 구현) |
| NV-03·05·06 | NOT_RUN | |
| NV-04 (브라우저 확대율) | BLOCKED | headless Chromium에는 브라우저 확대 기능이 없다. 대신 `ZOOM-EMU`(viewport/DSF 에뮬레이션)는 PASS다. 둘은 같은 검사가 아니다 |
| PG-01·02·03·04·06 | PASS | browser-mock |
| PG-05 | PASS | unit(인계는 shownScope) + 코드 |
| PG-07 | PASS | browser-mock C01-RESTORE와 C01-AB(같은 닉네임의 다른 계정) + unit(sessionKey). 로그아웃 후 새로고침은 NOT_RUN |
| PV-01~12·14·15 | PASS | unit/route |
| PV-13 (버전 변경 중 조회) | PARTIAL | expected_version 409는 route 테스트, 표·차트 혼합 여부는 코드 |
| MS-01·02·06·10·11 | PASS | browser-mock. MS-10은 이번에 구현, unit 3건 포함 |
| MS-03·04·05·07·08·09 | PASS | unit |
| MS-12 | NOT_RUN | |
| CH-01·03·04 | PASS | browser-mock |
| CH-02·07·08·09·11·12 | PASS | unit(차트 계획, key 결합, null gap) |
| CH-05·06 | N/A · PASS | CH-05: 결과가 항상 complete(5,000칸 한도 안에서 전부 반환)라 부분 결과 경로가 없다. 대신 한도 초과 422 거부를 PV-14 unit으로 확인. CH-06 안내 문구는 NOT_RUN |
| CH-10 (범례로 숨기기) | PASS (최종 마감 F03) | 이 표는 이전 라운드 기록이다. F03에서 키보드로 조작 가능한 계열 범례(안정 key, 요청 0, 100% 누적 분모 유지)를 구현했고 FN-11~14로 판정했다 (`FINALIZATION_REPORT.md`) |
| CH-13·16 | PASS · NOT_RUN | CH-13: browser-mock(표↔그래프 반복). CH-16: NOT_RUN |
| CH-14 | 대체: F06 XLSX | CSV 대신 Excelize XLSX 내보내기를 최종 마감 F06에서 구현했다(EX-01~60, `FINALIZATION_REPORT.md`) |
| CH-15 · CH-CMP | PASS | unit(C02 4건) + browser-mock(compare 히트맵 2개) |
| MT-01~06·16·18·19·20·21 | PASS | browser-mock |
| MT-07~13·15·24 | PASS | unit(oracle fixture) |
| MT-14 | PARTIAL | 진행 중 달 배지는 fixture 단위로만 확인 |
| MT-17 | PASS | 설계상 읽기 전용 범례. 체크박스가 유일한 제어 |
| MT-22·23 | NOT_RUN | 390px Space 키 조작, 숨김 후 재표시 |
| LD-02·04·05·06·12·13·19·26 | PASS | browser-mock |
| LD-16·17·18·20·34 | PASS | unit(controller) |
| LD-01·03·07·08·09·10·11·14·15·21~25·27~33 | NOT_RUN | 코드는 있음. 이번 판정 실행에는 포함하지 않음 |
| IN-01~06 | NOT_RUN | 통합 흐름을 하나의 assertion 시나리오로 돌리지 않았다(구성 단계는 위 ID로 판정) |
| SDK-* (실제 카카오 SDK) | BLOCKED | `closeout-evidence/real-sdk`. 세션 네트워크 정책이 `dapi.kakao.com`을 거부(proxy CONNECT 403)하고, 등록 도메인과 JS 키도 필요 |
| Docker 통합 40건 | BLOCKED | DB는 sql-local로 PASS(migration 28개 적용, facts 함수 12년 호출, 권한 anon/auth 거부·service_role 허용). Edge 런타임은 TLS 가로채기 proxy 뒤에서 npm을 받지 못해 함수가 뜨지 않았다(UnknownIssuer) |

## 운영 적용 (승인 필요, 이 세션에서 하지 않음)

1. DB 마이그레이션 없음
2. Edge 재배포
   - `npx supabase functions deploy public-analytics`
   - `npx supabase functions deploy my-analytics`
3. Pages 배포

자세한 확인 절차(smoke)는 `docs/deployment.md`에 있다. 계약은 모두 additive라 구 클라이언트가 깨지지 않는다.
