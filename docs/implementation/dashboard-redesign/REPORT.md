# 대시보드 개편 구현 보고 (2026-09-29)

기준: 작업 시작 HEAD `72ea526`(미커밋 변경 없음), 브랜치 `claude/gallant-darwin-7ldkbl`.
역할: 이 세션에는 Sol(`gpt-6-sol`)·Muse(OpenCode) 호출 경로가 없었다. 사용자 지시("Opus로 알아들으면 돼")에 따라
계약·서버·통합(Sol 몫)과 UI 구현·실제 브라우저 검수(Muse 몫)를 모두 이 세션의 Claude가 수행했다. Muse 모델 검수는
**MODEL_UNVERIFIED**(수행 안 함)이며, 브라우저 검수는 Playwright 1.56 + Chromium 1194(headless)로 직접 실행했다.

## 검수 환경과 한계
- **로컬 live 스택**(`scripts/browser/vite.e2e.config.ts`): 실제 프런트(live 모드) + 실제 Edge 핸들러 코드
  (`server/publicHandler.ts`, `server/personalHandler.ts`)를 Vite 미들웨어로 실행, 합성 사실(`demoFacts`), 로컬 가짜 인증.
  모든 조회가 실제 HTTP 요청이며 429/409/5xx/지연/권한 상실을 주입했다.
- **MOCK 카카오 SDK**(`scripts/browser/mock-kakao-sdk.js`): 문서화된 기본 객체만 흉내 내고 지도 인스턴스·idle·마커를 계수한다.
  화면에 "MOCK 지도 · 실제 카카오 지도 아님"이 찍힌다. **실제 카카오 SDK·등록 도메인 검수는 미검증**이다.
- 운영 Supabase·Deno Edge 런타임·Pages 배포는 권한이 없어 **미적용/미검증**이다. 핸들러는 Node(vitest·Vite SSR)로만 실행했다.
- 개발 서버는 React StrictMode라 지도 인스턴스가 시작 시 2번 생성(1개는 모의 unmount로 폐기)된다. 이후 어떤 동작에도 늘지 않았다.
  production preview에서의 인스턴스 수는 따로 재지 않았다(미검증).

## 변경 전 재현 (evidence/repro-before.json, 변경 전 코드 `72ea526`)
| 문제 | 재현 결과 | 원인(코드) |
|---|---|---|
| R04 지도 이동 시 새로고침·요청 폭증 | 자동 갱신 ON + 20회 이동 → 지도 인스턴스 2→**8**, 논리 갱신 3회 × (meta+dashboard+entities 2) = 12요청, 스켈레톤 반복 | `Dashboard.tsx` 갱신마다 `loadState='loading'` → 본문·지도 unmount → 새 지도의 첫 idle이 사용자 이동으로 취급(`onIdle()` 즉시 호출, programmatic=false) → `applyView` → 또 갱신. 매 갱신 `meta` 재조회, 분당 60회 제한에 도달 |
| R10 상세 필터 날짜 포커스 | 3번째 키 입력 직후 포커스가 `닫기` 버튼으로 이동 | `FilterDrawer` effect 의존성 `p.onClose`(매 렌더 새 함수) → 입력마다 cleanup(포커스 복귀)+setup(첫 버튼 포커스) 재실행 |
| R03 지표 색 고정 | 비율 지표의 단일 핀이 모두 같은 색(`rgba(13,180,253)`), 묶음은 평균/최대건수로 계산 | `metricValue()` 0~100을 `markerDataUrl()`이 0~1로 clamp, 클러스터는 비율 단순 평균 ÷ 최대 건수, 경계는 항상 report_count |

## 추적표 (R01~R10, A01~A06, P01~P08)
자동검사 명령: `npm test`(vitest 5.0.1) → **33 files passed (3 skipped), 369 passed / 41 skipped** (skip은 기존 Docker 통합 스택 전용 테스트),
`npm run build` 통과, `npm run scan` → `passed: true, issues: []`.
브라우저: `node scripts/browser/verify_redesign.mjs docs/implementation/dashboard-redesign/evidence/after` → `evidence/after/verify.json` + PNG.

| ID | 변경 파일 | 집계/API 연결 | 자동검사 | 브라우저 증거 (fixture, MOCK SDK) | 결과/남은 조건 |
|---|---|---|---|---|---|
| R01 | `MapPanel.tsx`, `state/view.ts`, `state/pointMarks.ts`, `Dashboard.tsx` | `pointFilter`/`filterPoints` 삭제 | `mapClusterControls` "no place-filter tabs", `pointMarks` R01 | 탭·안내 텍스트 0건, 레거시 `?pointFilter=mine` 로드 시 핀 9=기본 9 (`R01_R02_R03`) | 통과(fixture). 관심 지역 ★·내 신고 비교는 유지 |
| R02 | `MapPanel.tsx` | 수동 bbox 버튼 삭제, 자동 범위는 칩으로만 표시·해제 | 같은 테스트 | `.map-apply` 0개, 자동 범위 칩 "지도에 보이는 범위(자동) ×" | 통과(fixture) |
| R03 | `mapMetrics.ts`(신규), `lib/kakao.ts`, `MapPanel.tsx`, `server/aggregate.ts mapNodes` | 핀/묶음=Σ분자/Σ분모, 색 입력 0..1, null 회색 '–', 경계·hover·범례 동일 지표 | F01(서버 `placesAnalytics`, 클라이언트 `mapClusterControls`) 10%/90%/30%, 0·null 구분 | 4버튼 정확, 지표별 핀 텍스트 107→55%→29%→22% 등 변경, 지표 전환 중 요청 0·지도 생성 0 (`R03-metric-*.png`) | 통과(fixture). 실제 SDK 미검증 |
| R04 | `data/refreshController.ts`(신규), `hooks/useDashboardData.ts`(신규), `data/client.ts`, `Dashboard.tsx`, `lib/kakao.ts`, `MapPanel.tsx` | displayed 스냅샷 유지, 500ms debounce·1.2s 간격·분당 20 예산, generation, meta 세션 캐시, 409 1회, 429 대기 후 최신만, 5xx 1회 재시도, 사용자/프로그램 이동 구분, `replaceState` | `refreshController.test.ts` 9건 | 20회 이동 → dashboard **1**요청, meta 0, 지도 2→2, 줌·스크롤 유지, history 증가 0; A/B 지연 → B만 표시 (`R04_P01_P02`) | 통과(fixture) |
| R05 | `PlaceDetailsPanel.tsx`(신규), `Dashboard.tsx`, `InsightPanel.tsx`(삭제) | `/places/:place_key` 별도 요청, A→B 경합 차단 | `placeRoutes` "every agency/manager of that address" | 탭 0, 순서 요약→처리 결과→처리 기관→담당자, 클릭 시 places만 2회(A,B)·dashboard 0, B 제목 표시 (`R05-place-panel-1440.png`) | 통과(fixture) |
| R06 | `server/places.ts`, `aggregate.ts`, `domain/public.ts`, `schema.ts`, `PlaceDetailsPanel.tsx`, `EntityTable.tsx`, `LawTable.tsx` | `warning_count`(warning만) 장소·묶음·기관·상세에 연결, 구 서버=‘서버 미지원’ | F02 warning4/penalty2/fine3 → 계도4·과태료3, 필드 없음=undefined | 장소 요약에 ‘계도 4 · 경고·계도 처분’, ‘답변 완료’ 칸 없음 | 통과(fixture). 원천 계도 분류는 ingest 계약 그대로(추가 변경 불필요) |
| R07 | `server/places.ts`(신규), `aggregate.ts`, `compare.ts`, `publicHandler.ts`, `client.ts`, `schema.ts`, `demoEngine.ts` | 정규화 주소 `place_key`(address-v1), 결정적 표시 대표점, 주소별 unplaced 분리, `/places?view_bbox` | F03 20좌표→1핀/20건, 공백·시도 약칭 동일, 10≠10-1, 타 시군구 구별, null 주소 미핀, 순서 무관 대표점; F04 1,200주소 압축+정밀화 | 확대 시 31개 핀 제목 모두 서로 다른 주소, 패널에 ‘주소 복사’만(좌표 UI 없음) | 부분: 정밀화(`view_bbox`)는 단위·라우트 테스트만(데모 자료 < 1,000곳이라 브라우저 미검증). 대표점은 **같은 scope 안에서** 결정적이며 scope가 바뀌면 달라질 수 있음(고정 대표점 테이블은 미구현) |
| R08 | `AppliedFilterChips.tsx`(신규), `CommandBar.tsx`, `Dashboard.tsx`, `redesign.css`, `EntityTable.tsx`, `LawTable.tsx`, `RegionList`(CSS) | 요청 scope vs 기본값으로 칩 계산, 이름만 표시, 개별 ×·전체 해제, 미적용 draft 별도 표시 | – (UI) | 다크 bg `rgb(232,240,255)`/fg `rgb(11,18,32)`, 라이트 `rgb(11,31,77)`/흰색, 칩 제거→뒤로가기 복원, 법규 select 값 일치 (`R08-active-filters-*.png`) | 통과(fixture) |
| R09 | `EntityTable.tsx`(재작성), `client.ts`, `publicHandler.ts`, `server/agencyType.ts`(신규), `demoEngine.ts` | 열 정의 단일 소스, 요약은 dashboard 행·확장/검색/정렬/경찰 구분은 `/entities`, `agency_type` 서버 필터 | `placeRoutes` agency_type, `auditSol060708` 요약 표시 | 도구줄 순서 [검색][열 선택][기관·담당자][경찰 구분], 열 숨김/추가 반영, 검색 ‘김하늘’ 순차 입력 → 요청 1회, 목록 오류는 표 안에서만, 390px 전환 버튼 화면 안·가로 넘침 0 (`R09-*.png`) | 통과(fixture) |
| R10 | `FilterDrawer.tsx`, `Dashboard.tsx` | open에만 의존하는 포커스 effect, 최신 onClose ref, 적용 시 검증·draft 유지 | – | 16키 순차 입력 동안 activeElement 항상 `INPUT[date]`, 입력 중 요청 0, 역전 범위 오류+draft 유지, 적용 1회 요청·상단 날짜 일치, Esc 후 포커스 복귀 (`R10-drawer-reversed-error-1440.png`) | 통과(fixture). 이 Chromium은 ko-KR에서도 mm/dd/yyyy 세그먼트로 표시됨 |
| A01 | `server/analyticsDistributions.ts`, `AnalyticsCharts.tsx DurationCard`, `compare.ts` | dashboard `analytics.duration`, 개인 `analytics.duration` | 0일·구간 경계·긴 꼬리·신고일 없음·역전·개인 분모 | 카드·캡션(유효/중앙값/제외 사유) 표시 | 통과(fixture) |
| A02 | 같은 모듈 `lawHeatmap`, `HeatmapCard` | `analytics.heatmap`, 셀 클릭=기관+법규 1요청 | 건별 정답과 교차 일치, 법규 미상·표본 1·결측 | 셀 클릭 → dashboard 1요청(agency_key+law), 칩 2개 | 통과(fixture) |
| A03 | `entityScatter`, `ScatterCard` | `analytics.scatter`(최대 500, 총수) | 원시 중앙값·기간 계산 불가 x=0 금지 | 카드 표시, 개인 비교 시 테두리 | 통과(fixture) |
| A04 | `vehicleDayDistribution`, `VehicleDaysCard` | `analytics.vehicle_days`(번호·해시 없음) | 같은 날 5건=1일, 다음 날=2일, 마스킹 충돌 분리, 원번호 미포함 | 카드 표시 | 통과(fixture) |
| A05 | `TrendCard.tsx`, `compare.ts mine_outcomes` | 기존 monthly(완료월 분자/분모) + 개인 월별 | 신고월≠답변월 배치·null 구분 | 건수/처리결과 비율 전환, aria에 월별 수용률 | 통과(fixture). 기존 건수 그래프 유지 |
| A06 | `ratingDistribution`, `RatingCard` | `analytics.rating`, 개인 `analytics.rating` | [3,3] vs [1,5], 미평가 0점 금지, 행 합=평가 건수 | 카드 표시 | 통과(fixture) |
| P01 | `Dashboard.tsx`(단일 grid), `MapPanel.tsx` ResizeObserver | 보기 전환은 CSS grid만 | – | 20회 이동·지표·핀 선택·테마·보기 전환 모두 지도 인스턴스 2 유지(StrictMode), 보기 전환은 relayout만 (`P01_views`) | 통과(dev). production preview 계수 미검증 |
| P02 | `refreshController.ts` | 논리 갱신 = dashboard 1 (+my-analytics 1) | debounce·경합·예산 테스트 | 20회 이동 1요청, A/B 역순 완료 시 B 유지 | 통과(fixture) |
| P03 | `refreshController.ts`, `Dashboard.tsx` | 429 Retry-After, 409 1회, 5xx 1회 | 429/409/5xx/Abort 테스트 | 429(10초) 동안 요청 0·이전 수치 유지·배너, 대기 후 최신 bbox 1회; 409→meta→200; 503×2 → 오류 배너, 지도·KPI 유지 (`P03-429-banner-1440.png`) | 통과(fixture) |
| P04 | `refreshController.reset`, `useDashboardData`, `Dashboard.tsx` | 권한 코드 → 캐시·meta 삭제, 게이트 | access 테스트 | 권한 상실 → 게이트, KPI·지도 0, localStorage에 응답 없음 (`P04-access-gate-1440.png`) | 통과(fixture). 실제 계정 전환 미검증 |
| P05 | `aggregate.ts`, `compare.ts`, 표·차트 | 모든 카드가 같은 displayed scope/version | 기존 compare 동일성 테스트 + 신규 DTO strict | KPI·차트·표가 같은 scopeLabel 표시 | 통과(자동검사). 교차 수치 전수 대조는 테스트 범위만 |
| P06 | `analyticsDistributions.ts`, `schema.ts` strict | 원번호·해시·계정 id 없음 | DTO에 원번호·user id 없음 검사, `npm run scan` | – | 통과(자동검사) |
| P07 | `redesign.css` | – | – | 390/768/1440/1920 × 다크/라이트 8조합 가로 넘침 0, 화면 밖 버튼 0, 콘솔 오류 0 (`P07-*.png`) | 통과(fixture, MOCK 지도) |
| P08 | 이 문서 §운영 적용 | – | test/build/scan 통과 | – | 로컬 준비 완료. 운영 적용 **미실행** |

## 운영 적용(권한 필요, 미실행)
DB 마이그레이션은 **필요 없다**. 주소 키·대표점·신규 분석은 기존 `internal_analytics_v2_facts`가 이미 돌려주는 `address`·좌표·
처분·법규·별점으로 Edge에서 계산한다(원천·consent·identity 불변).

순서(구·신 호환 때문에 **프런트 먼저**):
1. Pages 프런트 배포. 새 클라이언트는 구 Edge 응답(필드 없음)도 받는다: 신규 차트 → ‘서버 미지원’, 계도 → ‘서버 미지원’,
   `place_key` 없는 점 → 주소 상세 요청 안 함.
2. Edge Functions `public-analytics`, `my-analytics` 재배포(`server/*.ts` 변경 포함). 구 프런트의 strict 스키마는 새 필드를 거부하므로
   1 → 2 순서를 지킨다.
3. 확인: 실제 카카오 키·등록 도메인에서 지도 지표·주소 핀·경계 색, 운영 데이터로 `/places/:key`·`view_bbox`·rate limit(60/분) 동작.

롤백: Edge를 이전 버전으로 먼저 되돌리고(새 프런트는 구 응답 호환), 필요하면 프런트를 되돌린다. 데이터 변경이 없어 되돌릴 DB 작업은 없다.

## 남은 조건·한계(숨기지 않음)
- 실제 카카오 SDK·운영 Supabase·Deno 런타임·Pages: 미검증.
- R07 표시 대표점은 같은 scope에서만 결정적이다(필터가 바뀌면 그 범위의 원천 좌표에서 다시 고른다). scope 무관 고정 대표점(주소 차원 테이블)은 미구현.
- R07/F04 `view_bbox` 정밀화: 단위·라우트 테스트만, 브라우저 미검증.
- 경찰 구분은 기관명 기반(원천 기관코드는 비공개 범위). 확인 불가 기관은 ‘비경찰’에 넣지 않는다.
- A02 히트맵은 최대 40행×16법규, A03 산점도는 최대 500개씩 전송(총수는 캡션에 표시).
- Muse(OpenCode) 교차 검수: 수행하지 않음(MODEL_UNVERIFIED).
