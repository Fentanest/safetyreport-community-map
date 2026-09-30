# 정렬 메뉴·그래프 유형 선택 UX 후속 (2026-09-30)

코드 커밋 `7cce87f` (브랜치 `claude/gallant-darwin-7ldkbl`, main 병합 전). 집계·서버 정렬 의미는 바꾸지 않았다.

## 1. 차트 사용 가능/불가 이유 — 계산 위치와 표시

- 계산: `src/state/statistics.ts` `chartAvailability(spec, catalog)` → 차트 유형마다 `{ ok, reason, fix, supported }`.
  - `reason`(첫 줄): 지금 설정에서 막는 것. 카탈로그 이름으로 실제 고른 항목을 적는다. 예: "기관·시도·위반법규, 총 3개 기준으로 나누고 있습니다."
  - `fix`(둘째 줄): 바꿀 방법 또는 제공하지 않는 조합이라는 안내. 예: "막대는 2개 기준까지 지원합니다. 항목을 2개 이하로 줄이거나 표·히트맵으로 보세요."
- `planChart()`는 `compatible`과 거절 문구(`refusal`)를 **이 결과에서만** 만든다(규칙 한 곳). 단위 테스트가 모든 유형에서
  `availability[t].ok === compatible.includes(t)`를 확인한다.
- 표시: `src/components/stats/ChartTypePicker.tsx`(native select 대체).
  - "사용할 수 있음"에는 자동·가능한 유형을 둔다.
  - "현재 설정에서는 사용할 수 없음"에는 유형마다 이유를 둔다. 여러 유형이 같은 이유면 그 이유를 한 번만 쓰고, 유형별로는 해결 방법만 쓴다.
  - 불가 항목을 누르면 해결 방법만 안내한다. 행·열·지표·전체/내 신고 설정은 바꾸지 않고, 요청도 없다.
- 내부 용어(dims, metric, partition, population)와 "지금 설정에선 못 씀"은 화면 문구에 없다(단위 테스트로 확인).

### planChart 제한 검토 (보고만, 이번에 확장하지 않음)

| 현재 규칙 | 표현 가능성 | 비고 |
|---|---|---|
| 누적·100% 누적은 분류 기준 1개만 | 기준 2개(두 번째를 쌓는 조각)로 그릴 수 있음 | 막대(묶음)는 2개를 허용하므로 비대칭 |
| 가로 막대는 기준 1개만 | 막대와 같이 2개(묶음 가로 막대) 가능 | 긴 기관명 목록에 유용 |
| 산점도는 기준 1개만 | 2개 기준을 합친 이름("기관·시도")으로 점 표시 가능 | |
| 3개 이상은 히트맵(앞의 두 기준)만 | 작은 여러 그래프(facet)로 확장 가능 | 규모가 큰 확장 |

확장할 때는 `chartAvailability`의 해당 분기만 바꾸면 선택기 문구와 차트가 함께 따라간다.

## 2. SortHeader와 floating layer 구조

- `src/components/FloatingMenu.tsx`: `<body>`로 portal, `position: fixed`. 위치는 헤더 버튼의 `getBoundingClientRect()` 바로 아래다.
  - 오른쪽 끝을 넘으면 버튼 오른쪽에 맞추고, 그래도 넘으면 화면 안으로 옮긴다. 아래 공간이 부족하면 위에 연다.
  - 스크롤(모든 조상, capture)과 창 크기 변경 때 다시 배치한다.
  - 바깥 클릭, Esc(포커스는 헤더로 복귀), 항목 선택, Tab으로 닫힌다.
  - `role=menu` / `menuitemradio`이고, 방향키·Home·End로 이동한다.
- `src/components/SortHeader.tsx`: 모든 정렬 가능한 열은 같은 세로 메뉴를 쓴다(값이 하나인 열은 2항목, 복합 열은 4항목).
  - 헤더에 현재 정렬을 글자로 적는다. 예: 라벨 아래 작게 "건수 많은 순"(`word-break: keep-all`, 최대 7.5em에서 줄바꿈).
  - `aria-label`: "과태료 정렬, 지금 건수 많은 순". `aria-sort`는 유지한다.
- CSS: `src/styles/redesign.css`의 `.floating-menu*`, `th.sortable .sort-head` 등. 기존 토큰(surface, border, raised, filter-active)만 쓴다.
  - 항목 높이 38px, 최소 너비 176px, 선택 항목은 반전 강조한다.
  - 이전 메뉴는 CSS가 전혀 없어 표 흐름 안에 가로로 들어가 헤더를 밀어냈다.

## 3. 복합 열별 정렬 기준 (메뉴 = 셀에 보이는 값)

| 열 | 메뉴 |
|---|---|
| 수용 · 일부 수용 · 불수용 | 건수 많은/적은 순, 비율 높은/낮은 순 (비율 = ÷ 결과가 나온 신고) |
| 과태료 · 계도 · 범칙금 | 건수 많은/적은 순, 비율 높은/낮은 순 (비율 = ÷ 답변 완료) |
| 평균 별점 | 별점 높은/낮은 순, 평가 많은/적은 순 |
| 수용률 · 불수용률 (비율만 표시) | 비율 높은/낮은 순 |
| 답변(건) | 건수 많은/적은 순 |
| 답변까지 (중앙값만 표시) | 기간 긴/짧은 순 |
| 과태료 금액 (합계만 표시) | 금액 많은/적은 순 |

- 계산 건수·확인 건수 정렬은 셀에 보이지 않으므로 메뉴에서 뺐다. 서버의 `sort_value=count` 키는 그대로 유효하다(공유 링크 호환).
- 정렬 계산은 기존 `compareRows`(정확한 분수 비교, 계산 불가는 양방향 모두 마지막)를 그대로 쓴다.

## 4. 화살표

메뉴 항목·헤더·표 caption에서 ↑↓▼▲를 모두 없앴다. 스크린리더도 보이는 문구와 같게 읽는다("건수 많은 순").

## 5. filter → sort → page (서버 전체 결과)

- 단위: A 10건/50%, B 6건/100%, C 20건/20%.
  - 건수 많은 순 C,A,B / 건수 적은 순 B,A,C / 비율 높은 순 B,A,C / 비율 낮은 순 C,A,B.
  - 반올림하면 같은 33.3%인 333/1000 · 1/3 · 3333/10000도 원 값 순서다.
  - 실제 0%는 값으로 정렬하고, 분모 0·미확인은 0%보다 뒤다. 평균 별점과 평가 수는 따로 정렬된다.
- 서버(`dateBasisHandler.test.ts`): 32개 기관, page_size 20에서 네 선택마다 1쪽+2쪽이 32개 전부(중복·누락 없음)이고 단조 정렬이다.
- 브라우저(SM-FULL): 네 선택마다 표 첫 행이 같은 API로 받은 전체 목록의 최댓값·최솟값과 일치했다.
- 브라우저(SM-REQ): 2쪽에서 선택해도 요청은 1건이고, `sort=fine&sort_value=…&dir=…&page=1`이다.

## 6. 요청이 없어야 하는 조작의 실제 요청 수

| 조작 | 요청 |
|---|---|
| 정렬 메뉴 열기(10개 뷰포트·테마 조합 모두) | 0 |
| 그래프 유형 선택기 열기·닫기·불가 항목 클릭 | 0 |
| 사용 가능한 유형 선택 | 0 |
| 표↔그래프 전환, 공유 패널 열기 | 0 |
| 정렬 항목 선택 | 1 (entities, page=1) |

## 7. 브라우저 검수 (로컬 Vite + 실제 server/publicHandler.ts, 합성 데이터, MOCK Kakao SDK — 운영 아님)

`scripts/browser/verify_sort_chart_ux.mjs` → `evidence/latest.json` (17/17 PASS, commit 7cce87f, clean tree).

- 1920 / 1440 / 1280 / 768 / 390 × light / dark:
  - 메뉴는 세로 4항목이고 `<body>` 안에 있다.
  - 헤더 열 위치·너비, 헤더 높이, 표 너비, 행 높이의 변화 0, 페이지 가로 overflow 0이다.
  - 메뉴는 viewport 안에 있고, 항목 높이 36~40px이다. 맨 오른쪽 열도 viewport 안에 연다.
- 바깥 클릭·Esc(포커스 복귀), 열 A→B 전환, 표 가로 스크롤·페이지 세로 스크롤·창 크기 변경 중 위치 추종을 확인했다.
- 콘솔 오류·React 경고 0 (단계마다 검사).
- 스크린샷: `evidence/shots/`(정렬 메뉴 light/dark 1440·390, 정렬 적용, 선택기 3종·light/dark).

회귀 브라우저 스위트(같은 코드, 스크립트만 새 DOM에 맞춤):
- `verify_date_basis` 40/40
- `verify_scope_statistics` 60/60
- `verify_finalization` 51/51 (공유 링크·Excel 포함)

## 8. test / build / scan

- `npm test` 567 passed (84 skipped = 스택 필요한 통합), `npx tsc -b` 통과
- `npm run build` 통과, `npm run scan` issues 0, Python blueprint/product 테스트 OK
