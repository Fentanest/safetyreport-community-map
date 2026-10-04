# UI/UX 정본 · COMMUNITY REPORT OBSERVATORY
이 문서는 Sol이 감각적으로 다시 선택해야 하는 제안집이 아니다. 정해진 화면 규격이다.
기준판 `design/reference-ui/index.html`을 브라우저로 보고 구현하며, 실제 상품화 디테일은 Muse가 검수한다.

## 1. 시각적 방향
**나만의 안전신문고 제품군의 공개 분석 상황판**. 딥 다크 중성 표면과 블루·시안의 절제된 강조,
큰 전국 지도, 명확한 수치, 서로 연결된 패널로 '거대한 프로젝터의 정보 월'을 표현한다.
화려한 랜딩 히어로, 과도한 네온, SF 장식 숫자, 눈에 띄는 장식 애니메이션, 3D 파이차트는 쓰지 않는다.
지도와 데이터가 주인공이며 장식은 여백·경계·조명감에서만 나온다.

## 2. 전체 그리드(데스크톱) · 2026-10-04 개편
사용자가 캔버스 목업("커뮤니티 신고 지도 개편안")을 보고 승인한 배치다. 이전의 좌측 rail·6열 KPI·카드 나열은 폐기했다.
- 페이지 폭을 1200/1280px 컨테이너에 가두지 않는다. 본문은 최대 1760px에서 가운데 정렬(2560에서 빈 영역 과다 방지).
- global topbar: 60px. 로고 + 제품명 + **화면 탭 3개(대시보드 · 맞춤 통계 · 유저 랭킹)** + 기준일·계정·테마·브리핑.
  좌측 rail은 없다. 대시보드 안의 구역 이동은 페이지 안 탭이 맡는다.
- 소개 문구(hero 제목·설명)는 화면에 그리지 않는다(스크린리더용 h1만 남김).
- 조건 바: topbar 바로 아래 sticky. [기간(날짜 기준 포함) ▾] [분류 segmented] [시도][시군구] [필터 N] [내 신고와 비교] … [공유][초기화].
  날짜 기준(답변일/신고일)은 기간 팝오버 안에서 바로 적용, 위반법규는 세부 필터(drawer)로 옮겼다.
- 주요 통계: 큰 칸 = 신고 · 처리 결과(수용/일부수용/불수용 한 칸 + 100% 막대, 분모 표기) · 과태료(비율, 건수÷답변) · 답변까지(중앙값).
  N≠C면 답변 확인 칸이 추가된다. 나머지(계도·확인 과태료 금액·평균 별점·장소·참여자)는 그 아래 한 줄 텍스트.
- 쿠팡 광고: 주요 통계와 지도 사이 한 줄. 대가성 문구는 배너 **위**(사용자 결정, 광고사 상단 배치 요청). 모바일에서도 보인다.
- 지도 row: 지도 1fr + 우측 패널 clamp(340px, 28vw, 460px). **패널은 지도 카드와 같은 높이**이고 안에서 스크롤한다
  (contain:size). 패널 탭: 개요 / 지역(지역 목록·관심 지역·내 신고) / 기관 / 담당자. 주소를 고르면 주소 상세로 바뀐다.
- 주소를 고른 경우 그 주소의 담당자별 처리 차트는 지도 row 바로 아래 전체 폭.
- 아래 row: 분석 탭 카드(월별 추이 / 기관·담당자 / 위반법규 / 담당자별 처리) + 차량 TOP5. 한 번에 한 분석만 그린다.
- '그래프 더 보기'(답변까지 걸린 기간 · 기관×위반법규 · 차량별 반복 신고 · 처리기간×처리결과 · 별점 분포)는 접힌 상태로 시작하고
  펼칠 때만 그린다. 옆에 '맞춤 통계에서 직접 만들기'.
- 이용 안내 → footer. 전체 페이지 정상 스크롤, body overflow hidden으로 내용 절단 금지.
- detail drawer가 열려도 map geometry는 `relayout()` 후 재계산. minmax(0,1fr)로 overflow 방지.

## 3. 해상도별
| viewport | 구성 |
|---|---|
| 2560×1440 | 본문 최대 1760px 가운데, 지도/우측 460 |
| 1920×1080 | 기본 검수 기준. 큰 KPI 4~5칸 한 줄, 지도/우측 패널 같은 높이 |
| 1440×900 | 같은 배치, 우측 패널 340~400 |
| ≤1100 | 지도와 우측 패널·분석 카드와 차량 TOP5가 세로로 쌓임. 우측 패널 높이 min(640px, 82vh) |
| ≤700 (390×844) | 상단56, 화면 탭 대신 bottom nav(대시보드·통계·랭킹·안내). 조건 바는 가로 스크롤 한 줄(기간은 이름만). 작은 KPI 3칸 한 줄 + 처리 결과 한 줄, 지도 위 광고도 보임(1030×250 배너를 폭에 맞춰 축소, 309px 미만에서만 숨김), 지도 높이380 |

모바일을 단순 '열람만 가능'으로 방치하지 않는다. 기간/분류/지역/기관 선택, 차량TOP5, 처리결과 표,
일자 비교가 터치로 실제 사용 가능해야 한다. 표는 column selector+sticky 기관/성명 컬럼+내부 가로스크롤을 허용한다.
페이지 전체 가로스크롤은 금지. 360px에서도 핵심 동작이 잘리지 않는다.

### 3.1 로그인 전 안내 화면 (2026-10-04)
KBS 뉴스9 화면 갈무리(인터뷰 대상의 얼굴·이름은 모자이크한 이미지, `src/assets/gate-news-quote.jpg`) + 캡션
"그들에게 현실감각을 불어넣어주는 화풀이 프로젝트" · 출처 "KBS 뉴스9 화면 갈무리" → 대가성 문구 → 쿠팡 배너(640×200) →
안내 카드(카카오 로그인). 사진과 로그인 카드의 위아래는 사용자 지시로 바꿨다.

## 4. 색과 표면
`design/tokens.json`이 머신 정본, `design/tokens.css`는 동등 값의 실행 기준이다.
- dark: bg#0b0b0c, panels#131314, raised#1b1b1c, high#232324, border#2d2d2f, text#f3f3f4, muted#9ea0a4.
- light: bg#F8FAFC, panels#FFFFFF, raised#F1F5F9, border#E2E8F0, text#0F172A/#64748B.
- 브랜드: 라이트 #0D6EFD; 다크 강조 글자·아이콘 #60a5fa, 흰 글자 채움 #2563eb; cyan#06B6D4.
- 다크 배색은 safetyreport `dev` 커밋 `2f20f2e`의 `contracts/dark-palette.json`을 따른다. 상태 의미색과 실제 Kakao 지도 타일은 유지한다.
- 좌측 rail(원본 사이드바 배색 bg#050505 계열)은 2026-10-04 폐기했다. 화면 탭과 모바일 bottom nav는 surface·border·muted 토큰을 쓴다.
- 상태: 수용 green, 일부수용 amber, 불수용 red, 처리중 blue, 답변완료 cyan,
  취하 slate, 보완요청 orange, 과태료 pink, 경고/범칙금 purple, 미확인 neutral.
- 상태 색은 차트·badge·범례에서 동일. 과태료 건수를 red failure로 칠하지 않는다.
- 모든 KPI 전체 배경을 무지개색으로 채우지 않는다. dark neutral panel+small icon tile+thin top accent.
- glow는 active/selection/hero line에만 opacity0.12~0.2. 모든 패널에 파란 halo 금지.
- map 캔버스는 Kakao 실제 기본 지도로 유지한다. 어두운 테마라고 invert/filter를 걸어 도로명·저작권을 왜곡하지 않는다.

## 5. 타이포·숫자
system stack에 Noto Sans KR 우선 참조, 파일은 별도 번들하지 않는다. fallback Apple SD Gothic Neo/Malgun Gothic/system-ui.
큰 제목24/32/700, section17/24/650, body14/22, small13/20, metadata12/18, KPI32/38/700.
데이터 숫자는 font-variant-numeric:tabular-nums. 한글 letter spacing -0.02em 이내, 큰 숫자 -0.03em.
실제 정보는 12px 미만 금지(작은 decorative overline11px만 허용). 표14px, 행44~48px.
빈 줄을 없애서 억지로 dense하게 만들지 않는다. label→값→분모→비교기간 4계층이 우선이다.

## 6. 필터·context 모델
상단 모든 화면에 공통 기간·지역·분류를 유지한다. `scope`와 `selection`을 분리한다.
- scope: main stats의 기간, 행정구역, category, agency, manager, optional committed bbox.
- selection: 현재 선택한 지점/row만 상세패널에 보여줌. 선택만으로 전체 데이터 scope가 몰래 달라지지 않는다.
- 기본 공간은 전국. map drag만으로 nationwide KPI가 저절로 달라지지 않도록 '화면 범위 적용'을 explicit button으로 둔다.
- `화면 범위 자동 갱신` toggle을 제공하고 켠 경우 idle debounce로 scope를 갱신. 상태가 command bar에 표시돼야 한다.
- 기관/담당자 row 클릭 시 해당 필터 chip이 생기고 지도·표·차트가 같은 context로 조회된다.
- back/forward·공유 URL은 허용 필터와 panel 상태만. 차량번호·계정정보는 URL에 넣지 않는다.
- 태그 X로 개별 해제, [초기화]는 전체 초기값, 날짜 오류는 submit 전에 안내.

## 7. 지도
Kakao Maps Web SDK actual instance를 공통 adapter로 생성; 초기 전국 extent. keyboard zoom/reset/scope controls.
클러스터 bubble은 count, 같은 지점 marker는 report count·metric gradient. 선택 marker outline2px와 안정적 z-index.
hover tooltip에는 주소·건수만, click detail에는 full breakdown. touch에서 hover를 선행 요구하지 않는다.
지도 우하단 attribution·scale·Kakao logo를 cover하지 않는다. floating panels는 edge safe margins12~16px.
`신고량 / 수용·일부수용 비중 / 과태료 비중 / 기간 변화` metric switch, legend title+range+date basis.
고줌 exact coordinates, 저줌 cluster/지역 centroid는 **집계 표시**임을 명시; 원좌표를 저장 단계에서 바꾸지 않는다.
heat/intensity mode는 실제 SDK supported primitives 또는 projection 기반 canvas로 구현. 없는 Kakao Heatmap 클래스를 지어내지 않는다.
지도 SDK 실패 시 카드 형태의 오류와 재시도·표보기. 다른 통계 UI는 계속 사용 가능.

## 8. 우측 인사이트 패널
상단 context overline13 → 지역/주소20px → sample/date chips → 3개 compact metrics.
탭: 개요 / 처리결과 / 기관·담당자. 차량 TOP5는 하단 독립 section 또는 선택 지역 패널의 drill-down.
주소2줄 허용, 복사 버튼, 좌표6자리 표시 기본/전체정밀도 copy 또는 expansion(원값 보존).
막대 그래프는 labels+count+percent 3열로 고정. small n은 옅게 지워버리지 않고 표본 badge만 둔다.
점 선택 시 [이 지점 범위로 분석] 버튼을 따로 제공하여 범위 전환을 명시적으로 한다.

## 9. 차트
ECharts canvas/SVG 택1로 일관 적용. text·gridline·tooltip 테마 token 사용, animation180~250ms·reduced-motion0.
신고 추이 기본은 line+subtle area, 처리완료/fine 비교는 별도 series labels. 단위가 다른 값에 무표시 dual y-axis 금지.
선형 추이 axis zero 여부를 명시하고 차이를 과장하는 truncated bar 금지. stacked100%는 A/P/J 분모 D.
월 클릭·brush는 범위 선택과 연결하되 선택중 draft와 적용 context를 분리. table accessible alternative 제공.
비교기간은 solid/current vs dashed/previous, color만으로 구분하지 않는다. 데이터 결측 구간은 선을 연결하지 않는다.

## 10. 기관·담당자 표
기본 tab 기관, 옆 tab 담당자. 검색은 이름/기관만. sticky header, count right align, name left align.
기본 열: 기관(담당자탭은 성명+기관), 완료건수, 수용 count/%, 일부수용 count/%, 불수용 count/%, 결과확인 D, 과태료 count/%.
표본=1 행도 반드시 나온다. row의 100% 막대 옆 D를 항상 표시. 같은 기관/이름 묶음 한계 info tooltip.
각 컬럼 click 정렬, 정렬 방향 aria-sort. 초깃값 완료건수 내림차순. 별·메달·우수담당자 선정은 없다.
테이블 download가 있으면 현재 공개 DTO·열·scope만 CSV; raw 번호·내부 keys는 포함하지 않는다.

## 11. 차량 TOP5
heading '신고 접수 차량 TOP5', caption '선택 지역·신고일 기준 · 위반 확정 아님'.
left rank 01~05 muted, middle monospace masked plate 18/600, right count16/600 + bottom share bar.
금/은/동 트로피·범죄자 표현 없음. 5대 미만이면 빈 자리 억지 채우지 않는다.
클릭은 tooltip/기준 설명 정도; 전체 실번호 조회, 이동 경로, 여러 지역의 연속 추적 화면을 만들지 않는다.
마스킹 충돌 시 row를 합치지 않고 rank_item_id로 렌더. 같은 표시 가능 설명.

## 12. 브리핑 모드
헤더 [브리핑 모드] 클릭으로 화면 탭/비핵심 설명을 접고 full-screen API는 사용자 제스처에서 요청.
전국 overview + 6 KPI + map + 3하단카드가 16:9에서 균형을 이루게 한다. 큰 화면에서 숫자만 과도하게 키우지 않는다.
마우스/키보드 focus가 있을 때 controls 노출, Esc로 종료. 자동 페이지 전환/깜빡이는 realtime 효과는 기본 꺼짐.
브리핑 모드에서도 scope·data age·분모는 남겨놓는다. 창 높이가 부족하면 scroll 허용; 글자8px로 축소 금지.

## 13. 상태·접근성
필수: loading skeleton, no data, filter empty, one sample, partial coverage, missing metric,
Kakao failure, API429, offline cached, stale dataset, source update, invalid range.
결측은 '—' + 사유, 실제0은0. loading 시 전 화면 opacity0.3 깜빡임 금지.
ARIA·tab order·focus trap·Esc dismissal, 44px touch targets, contrast 검수. 지도와 동등한 지역/지점 목록 탐색을 제공.
reduced-motion과 시스템 테마 변경 대응. 그래프에 이미지처럼 의미 없는 alt만 달지 말고 값 표 제공.

## 14. 참여자 랭킹 (2026-10-04 로컬 리팩터링)

기존 라이트/다크 page·panel·primary·focus·텍스트 토큰을 사용한다. `신고 랭킹 / 과태료 랭킹 / 불운 랭킹` 세 탭과
공통 `전체 기간 / 월별 / 기간 지정`을 제공한다. 기본 진입·테마·지표·분류·월 이동은 즉시 조회하고 동일 선택은 중복 요청하지 않는다.
기간 지정과 상세 조건(날짜 기준/최소 신고)은 각자의 조회/적용 버튼으로 확정한다. 탭별 마지막 지표는 세션 내 메모리에서 유지한다.
얇은 내 순위 → 목록 순서, 정확한 지표명, 축약 UUID 버튼의 전체 UUID dialog/복사/키보드·focus 복귀를 제공한다.
모바일은 표 대신 두 줄 목록이다. 공동순위·표본 1건·페이지 밖 전체 기준 내 순위·기존 rk_* URL/이력을 유지한다.
큰 TOP3/왕관/시상대/인사이트/중복 KPI는 없다. 현재 월만 집계 중이며 제목은 실제 조회월이다.
맞춤 통계는 별도 draft → 통계 만들기 실행이며 select 편집을 즉시 API 호출로 바꾸지 않는다.
2026-10-04 화면 정리: 제목 아래 랭킹 탭(밑줄 탭) → 조건 한 줄(지표·기간·월 이동/기간 입력·분류·상세 조건 팝오버·초기화) →
얇은 내 순위 줄 → 순위 목록(값 옆 가로 막대, 페이지 안 최대값 기준) | 집계 기준(넓은 화면에서 오른쪽 고정). 표 내부 스크롤은 없앴다.
데모 빌드는 `src/data/demoRankings.ts` 합성 참여자 37명으로 같은 화면을 보여 준다(live 번들에는 포함되지 않음).
맞춤 통계(2026-10-04): 제목 줄 오른쪽에 조건 변경·지도로 돌아가기, 설정 패널의 '통계 만들기'는 패널 아래에 고정,
표의 값과 행 이름은 밑줄 없는 글자(hover·focus 때만 강조), '이 항목으로 좁히기' 바는 화면 아래 떠 있는 바로 바꿔
표의 고정 첫 열에 가려 글자가 잘리던 문제를 없앴다.
실제 검증과 fixture/운영 한계는 [리팩터링 보고서](refactoring/map-performance/REPORT.md)와 [Muse 검수](refactoring/map-performance/MUSE-FINAL-REVIEW.md)를 따른다.
