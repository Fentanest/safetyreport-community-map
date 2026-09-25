# 실행 명령 · 커뮤니티 신고 지도 완성
대상 Fentanest/safetyreport-community-map. 이 문서는 UI 문구 재작성 요청이 아니라 구현 지시다.
최신 정책과 데이터 계약을 정확히 지키고 **동작하는 GitHub Pages용 웹앱·공개 읽기 계층·테스트·운영 문서**를 만들어라.
이미 작성된 upstream 프로그램은 이 작업에서 수정하지 않는다. 로컬 구현 이후 운영 변경은 승인 대상이다.

## 제품 목표
개인 앱의 통계를 넘어선 전국 지도 중심 분석 상황판. 카카오 실제 지도, 전역 날짜/지역/분류 필터,
기관·담당자의 수용/일부수용/불수용 비율, 선택 지역의 마스킹 차량 TOP5, 신고/완료/처분 월별 추이,
비교기간·현재 표본·결측을 명료하게 제시하라. 영화 속 프로젝터 상황판처럼 넓고 세련되되 실제 분석이 쉬워야 한다.

## 고정된 공개 규칙
담당자 전체 성명, exact 원 좌표, n=1도 공개, 대한민국 전국, front-end 날짜 범위 사용자 선택.
차량 접두 지역명은 표시에 그대로 두고, 지역명 뒤 문자열 앞에서 2/4/6번째 글자를 '*'로 바꿔라(경기76자3623 → 경기7*자*6*3).
마스킹 후 집계하지 말고 private 원번호 canonical로 집계 후 공개 projection에서 바꿔라.
계정 이메일/UUID/토큰·신고번호·차량원번호·전역vehicle 해시·본문/첨부는 절대 내려보내지 마라.

## 설계가 모호해 보이는 부분은 이미 정해져 있다
- docs/ui-spec.md가 치수·배치·동작·반응형·테마·차트·표·지도·상태의 상세 정본이다.
- docs/metrics-catalog.md가 분모·date axis·partial month·비교기간·0분모의 정본이다.
- docs/architecture.md의 hybrid read model을 따른다. Pages이므로 런타임 API를 못 쓴다는 오해 금지.
- docs/public-api-contract.md의 exact aggregation과 schema를 실제 DB adapter로 구현한다.
- 기존 v1 연간 aggregate로 새 기능을 만들어낼 수 없으면 capability gap을 표시한다. 가짜 값 생성 금지.

## 구체 기능
1. default 전국 overview + 최근12개월, 범위 조절·검색·초기화·공유URL·뒤로가기.
2. Kakao marker/cluster/metric legend, current viewport scope apply/auto toggle, 지역 계층·목록 대안.
3. global scope와 point selection 분리, 우측 상세 panel, panel/viewport resize relayout.
4. KPI 6 + 추이 line + 결과100%stack + TOP5 + sortable agency/manager table.
5. 월별 신고량·완료량·과태료 처분량, 이전기간 변화건수/%·rate%p, 같은 경과기간 비교.
6. 기관·담당자 상태 교차표, unknown/결측 노출, 최소 n 숨김 없음.
7. 지역 A/B 비교·최근 증가 지점은 관측값만, 위험도/능력평가 점수로 만들지 않음.
8. dark/light/system, briefing/fullscreen, mobile touch, table columns/keyboard, reduced motion.
9. loading/empty/1건/missing/429/offline/stale/map error를 실제 fixture로 검증.
10. source·generated·published timestamps 구분, coverage·capabilities·정정요청 안내.

## 일체감 있는 구현
기존 family PNG·token board를 열고 design/tokens.css·JSON을 사용하라. 기준판 HTML은 layout 기준이며
실제 앱 대신 그대로 납품하는 dummy가 아니다. React/TS·Kakao·공개 API에 연결하라.
모든 card를 네온으로 감싸거나 큰 empty hero를 만드는 대신 얇은 border·명료한 numbers·절제된 glow로 표현하라.
실제 지도 attribution을 가리지 말고 가짜 dark basemap/지명/폴리곤을 만들지 마라.

## 에이전트 운영
Sol은 총괄·데이터·계약·통합. Muse는 contributor 공동 UI 구현과 실제 browser 검수.
WorklazyTools 원본에 맞는 OpenCode 구독 호출, host models로 정확한 runtime ID 확인, stdin 닫기,
세션별 worktree 유지, 실제 결과 회수. 호출 실패를 다른 모델 검수로 몰래 대체하지 마라.
M0/M1/M2/M3 milestone 검수. UI 단순 텍스트 코멘트가 아니라 screenshot·클릭·network·console 증거를 제출받아라.

## 구현 순서
A. 실제 환경/파일 소유 ledger/README 상태 점검 → 모드/원천 gap 기록 → Muse M0.
B. reference tests를 실제 shared types/functions로 이식, 정적 synthetic fixture API adapter + React 셸.
C. map+filters+KPI+하단3카드 수직슬라이스, Muse M1 후 수정.
D. 모든 분석화면과 state fixtures + exact public API adapter/SQL + safe exporter.
E. live Kakao/Supabase smoke 가능한 범위 수행, Actions templates를 실제 scripts에 연결.
F. 통합 commit candidate → Muse M3 → 결함수정 → 재검수 → 최종보고.

## 완료 기준
acceptance-matrix P0 모두 실제검증 또는 명시BLOCKED. build/test/source/visual evidence path 포함.
키·필드가 없어도 fixture 범위 완성은 진행하라. '실연동 없음'을 감추지 마라.
이 패키지는 기본 규칙·테스트·UI 기준판이 준비된 상태이지 product deploy 완료 상태가 아니다.

## 결과물
실제 source, dependency lock, tests/fixtures, versioned DTO/schema, 공개 API·DB adapter,
Kakao component, safe data exporter, Pages workflow, README·설계/운영·법적검토 필요사항,
Muse reports/screenshots와 최종 구현/미완료 목록. 원본 두 프로그램에 필요한 변경은 upstream-gaps 문서로 분리한다.
