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

최종 실제PASS/FAIL/SKIP·미검증은 [REPORT](REPORT.md)와 [REVIEW](REVIEW.md)에 연결한다. 타입/버튼·과거보고만으로 완료표시하지 않는다.

## 최종 실행 연결

| 보존 기능 | 이번 실행과 최종 구현 상태 | 운영 상태 |
|---|---|---|
| 지도·필터·선택·경계·내 신고 비교·주요 통계 | oracle/기존 단위/local integration/20회 왕복 PASS. 숨겨진 요청/차트 중지. raw cohort10만 cap 및 기능 유지 | Kakao 실SDK/운영자료 미검증 |
| 기관·담당자·법규·월별 | narrow builder+SQL rollup, native5 PASS/모든 정렬 및 기간/대표/권한 비교. 글로벌50만 대표10회8–10s(지연목표 미달) | hosted500k/운영 성능 미검증 |
| 맞춤 통계·개인 비교·조합·차트·저장/공유 | 기존 explicit 실행·전체 기능 유지.60 browser checks PASS 및 draft/metadata/retry/20회 왕복 | 실제 운영자료 미검증 |
|3탭 랭킹·공통기간·지표·내순위·1건·동률·UUID·이력 | 원본126 조합/전체 version/me/page동등성, DB13 PASS, Edge 및 실제 SQL browser; bytea election 및 viewer lookup 기능 유지 | 운영 미적용 |
| 본인 내신고 API·ingest·인증 | 기존 DB/Edge suite52 PASS와 ingest33 PASS. test fixture/proxy 문제 수정 후 전체 재검증. wire/consumer 권한 불변 | 외부 앱 실설치/실 OAuth 미검증 |
| Excel·취소·계정·전체행·정적자산/CI |51 browser checks와 build/scan/manifest/Python PASS. 실제 WASMWorker 실행, 보호자료 정적 저장 없음 | MS Excel 실제 프로그램/Pages 배포 미실행 |

정량 표와 각 PASS의 자료 종류·최초FAIL·SKIP·미달은 REPORT에서 구분한다. 초기 경로 감사의 버튼/타입 존재는 실행 증거로 합산하지 않는다.
