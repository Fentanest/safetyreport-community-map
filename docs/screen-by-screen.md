# 화면별 구현·행동 명세

## 01. 지도 상황판(기본)
상단: family icon + 커뮤니티 신고 지도 / 데이터기준 / 테마 / 브리핑 / 도움말.
command: 기간 picker, category segmented(전체·교통·주정차·기타), 전국 breadcrumb,
상세필터 button+count, [공유], [초기화].
KPI6: 신고 접수, 처리완료, 수용·일부수용 비중, 과태료 처분 신고, 신고 지점, 기여 계정.
main: Kakao 전국 지도 + 우측 선택 범위 인사이트.
lower: 월별 신고/처리 추이, 처리결과 구성, 차량 TOP5. 아래 기관별 table.
초기 첫 데이터 로드 전 skeleton; 지도만 실패해도 lower analytics 가능.

## 02. 기간 선택
최근30일/90일/12개월/올해/전체 + start/end calendar. 오늘 이후 disabled.
최소 지원일 meta에서 가져옴. 기간 버튼 아래 적용되는 날짜 기준은 지표별이라는 설명.
[적용]을 눌러 global filter commit. draft 중에는 기존 panels 변경하지 않음.
계산 결과에 previous period 명시; MTD vs 전월 전체를 몰래 비교하지 않음.

## 03. 상세 필터 drawer
오른쪽 drawer width400 desktop, mobile bottom sheet max90dvh.
지역 계층, 기관 검색, 담당자(기관 context), 상태, 처분, 지표 표시 옵션.
selected chips, reset, apply. 지역/지도bbox 교집합 설명. API 지원하지 않는 항목은 이유 표시.
자동으로 모든 기관/담당자 raw catalog를 무제한 preload하지 않음.

## 04. 지점 선택
map click → 오른쪽 패널에 주소/좌표/신고수/처리결과 + 월별 sparkline + 기관/담당자 breakdown.
주소 copy, 좌표 원값 copy, Kakao에서 보기(차량/계정 query 없음), [이 지점으로 범위 설정].
상세패널의 data scope가 글로벌 기간과 연결돼 있다는 chip. 없는 completed_date는 결측 표시.

## 05. 지역 분석
시도→시군구→읍면동 breadcrumb + 지역 목록과 지도 병렬. 총 신고/기간 변화/처분비중 metric tabs.
compare A/B 슬롯 최대2; 같은 query/dates로 API 계산. 증가순 정렬은 소표본 count/기준일 병기.
행정경계 GeoJSON이 없으면 지점 집계+지역 리스트부터 동작, 가짜 polygon을 정식 경계처럼 쓰지 않음.

## 06. 기관·담당자
wide table 중심. 위쪽 current scope info, count/completed/result-known explanatory cards3.
기관/담당자 탭, 정렬(수용/부분/불수용/%/count), 이름 검색, 분류/기간 동일 유지.
이름 전체 공개. row expand로 결과 막대+월별 추이. 기사식 우열 평가 문장 생성 금지.
모바일: 기본 열3(성명·기관·완료)+[열 선택], 내부 가로스크롤. 전체 성명 접근 가능.

## 07. 월별 추이
report / completion / disposition tab별 날짜 기준 title이 바뀜.
line+bar combo 또는 stacked100%, 표로 보기, monthly brush. incomplete month hatch와 결측 gap.
비율 %p 변화와 count% 변화 분리. rolling3m average는 실제 monthly counts가 있을 때.
표에는 월·건수·이전월·증감건수·증감%·데이터범위. 분모0 신규를 100%로 쓰지 않음.

## 08. 비교 상세
기준 기간과 비교 기간 나란히, context가 다르면 경고. agency와 manager의 결과 원천이 일치하도록.
전국과 특정 지역은 share denominator를 고정. 직원 '누가 낫다' summary 없이 관측 counts/percent만.

## 09. 데이터 안내
데이터는 이용자의 자발적 제공 표본이며 전국 모든 신고를 대표하지 않음.
집계기준, 신고/완료 날짜, unknown 처리, 중복 정책, 마스킹 규칙, 데이터시각, capability coverage,
정정/삭제 요청 실제 채널, 관련 앱 링크. 승인되지 않은 법률 보증 문구 금지.

## 10. 상태 예시
n=1: row/marker/card를 모두 남기고 '표본 1건'. no vehicle→TOP5빈상태, 전체 신고건수는 유지.
no results→현재 필터 요약+조건해제. 원천 필드 누락→'담당자-처리결과 교차자료가 아직 제공되지 않았습니다'.
API failure→'통계 조회에 실패했습니다' + 재시도; 429는 retry-after countdown. 가짜0 표시 금지.

## 11. light mode
흰 표면과 매우 옅은 블루 background, 중간 gray typography. primary blue 유지.
hover 색·gridline·tooltip·dropdown·calendar·map controls까지 전부 전환. 일부 modal만 dark 잔존 금지.
status badges는 pale background + dark text. amber/yellow white text 금지.

## 12. mobile/briefing
mobile bottom nav: 지도/지역/분석/안내 4개. nav 전환에도 기간·지역 scope 보존.
브리핑은 실제 레이아웃 전환이며 fullscreen button만 붙인 것 아님. exit 상태 복원.
공유 URL 로딩→동일 filters; URL에 임의HTML/script/query SQL이 있어도 실행 안 됨.
