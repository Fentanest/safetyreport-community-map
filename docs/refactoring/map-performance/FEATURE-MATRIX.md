# 기능 보존표 — 실행 경로 감사

초기 상태는 코드 경로 확인이며 실행 PASS와 구분한다. 정상 판정은 이번 검사 증거가 있는 범위만. 운영은 전부 환경상 미검증. 아래 전체 집계는 선택 날짜 하나·대표선출 뒤 필터·기관+담당자·n1 정책이다.

| 동작/기능 | UI 상태→요청/응답검증→API 인증/권한→DB/집계→화면/내보내기 | 변경 전 감사 / 검사 연결 |
|---|---|---|
| 카카오 진입/refresh/logout/계정 | App/useMapAuth→mapAuth PKCE/token→viewerAuth getUser/claims→internal_analytics_viewer(10건)→AccessGate | 로컬정상 경로; access/auth/viewerThreshold 단위, access_gate/logout browser; 운영OAuth미검증 |
| 지도 첫조회/이동/확대 | Dashboard scope/selection→useDashboardData/RefreshController→client strict schema→publicHandler auth/rate/state→cohort_facts→aggregate/mapNodes/placeRows→KakaoMap | 초기/hidden부분구현(취소누락), auto debounce예산있음; refreshController/mapCluster/dateBasis/browser |
| 경계색/주소핀/선택상세 | map scope/view_bbox→client places/place→auth gate→동일cohort representative→resolveRegion/placeSummary/overviewOf→ScopeDetailsPanel | 경로연결, MOCK/실SDK분리; places/placeRoutes/regions/boundaries 및browser |
| 날짜/분류/지역/기관/담당자/법규/경찰 | scope draft/apply→scopeParams→parseScope→cohort election 먼저→dimensions regionMatches/lawKey→모든분자/분모→chips/표 | SQL지역법규Edge잔류; 현재소속·폐지/분할보존; dateBasis/region/law/agency 검사 |
| 주요통계/월별/금액/처리기간/별점 | displayed scope/version→dashboard→getFacts(previous=true)→aggregateDashboard→overview/series/duration/amount/analytics→KPI/TrendCards | 부분API도full집계 병목; aggregate/amount/duration/trend/dateBasis tests |
| 기관/담당자/법규 목록 | EntityTable/LawTable 검색IME sort/page→loadEntities/loadLaws strict→auth/state/version→entityRows/lawRows 전체정렬→bounded pages | UI연결 및page전역정렬, entities full dashboard 비용; publicHandler/lawResults/managerNames/monthly-review |
| 내 신고 비교 | compareOn/briefing→usePersonalCompare/loadCompare acceptCompare→personalHandler JWT/rate→internal_my_analytics_cohort_source 동일snapshot→aggregateCompare→KPI/maps/charts | hidden활성누락; 전체/개인고유단위차이보존; compare/personalHandler/my-analytics-stack |
| 맞춤통계 조합/개인/비교 | StatisticsPage draft/applied→statistics client/schema→public/personal routes registry validation→cohort source→aggregateStatistics/candidates 전체정렬/5000cell预算→PivotTable/Chart | 모든select즉시조회 아님; dashboard선행의존 조사; statistics/schema/scope/finalization browser |
| 통계저장/불러오기/공유 | stats session settings/share whitelist→검증된recipe→한번실행→동일version result | 저장은허용설정만, 결과persist금지; uiState/shareLegend/exportBoundary + browser |
| 랭킹3×기간×7지표/내순위/공동순위 | RankingsPage draft/applied rk_*→rankings responseSchema→rankings handler getUser/JWT+SQL gate/rate→ranking_representatives→internal_user_rankings 전체rank/version/page+me→table/UUID | SQL구현됨; UI6메뉴/일괄적용/압축표개편필요; rankings/rankingPeriods + DB/Edge/50만/browser |
| 확장내신고 검색/요약/번호 | 외부소비자(수정범위밖)→my-reports whitelist/cursor→JWT본인→020100 my_reports_own/stats/page→summary/managers/번호 | 경로연결; maps10gate미적용; myReportsHandler/Contract/SQL/Edge/measure; 확장실설치미검증 |
| ingest재전송/부분실패/대표·계보 | 업로더외부→ingest handler batch validation→JWT/writer/consent→최신281800 internal_community_ingest 단일batch트랜잭션→ack | 매행RPC아님; 공개/개인dedupe 다름; communityContract/ingestHandler/community-stack; 운영업로드미검증 |
| Excel/WASM/취소/화면/계정 | UI applied snapshot→export boundary singleton→lazy exporter Worker/WASM→동일원DTO 전체행/수식방어→download | 연결있음·firstpage만내보내기아님; excelExport/exportBoundary/finalization(Worker실행); MSExcel환경없음 |
| 정적자산/경계/광고/CI | version assets/boundaries lazy→Pages distallowlist/scan→CI product/publish workflows | 운영변경금지·정적보호data없음; build/scan/compose/subpath/ad browser |

최종 실제PASS/FAIL/SKIP·미검증은 RESULTS 및 REVIEW 증거로 연결해 갱신한다. 타입/버튼·과거보고만으로 완료표시하지 않는다.
