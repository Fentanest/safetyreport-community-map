# 담당자별 처리 현황: 동명이인 표시와 다수 담당자 탐색 (2026-09-30)

- 코드 커밋: `400ab84`, `dbb7b90`. 브랜치는 `claude/dazzling-babbage-wdtbxv`이고 main에는 아직 병합하지 않았다.
- 바꾸지 않은 것: 담당자 identity(`agency_key:manager_key`), 기관·담당자 집계, 수용률·과태료 부과율 계산, 전체/내 신고, 날짜 기준, Excel 수식.
- 운영 DB 변경·Edge/Pages 배포·main 병합은 하지 않았다.

## 1. 기관명이 붙는 조건

담당자 행 A에 소속 기관이 붙는 것은 다음 조건을 모두 만족할 때다.

- **같은 조회 조건의 전체 담당자 목록**에 A와 **이름이 같은** 행이 있다.
  - 이름은 NFC로 정규화하고 앞뒤 공백을 뗀다. 이름이 없으면 '이름 없음'으로 본다.
  - 전체 목록은 페이지·검색·기관 유형 조건을 적용하기 전의 목록이다.
- 그 행의 **identity(row key)가 A와 다르다**.

같은 key의 행이 두 번 들어오면 한 사람으로 센다. 동명이인이 아니다.

데이터 모델 확인 결과(`server/ingest/observation.ts`)는 다음과 같다.

- `manager_key = hash(agency_key | NFC 이름)`이다. 그래서 **같은 agency_key 안의 같은 이름은 언제나 한 identity**다.
  - 같은 기관에 실제로 동명이인이 두 사람 있어도 이미 한 행으로 합쳐진다.
  - upstream에 담당자 ID가 없어서 생기는 데이터 한계다. UI에서는 나눌 수 없다.
- 기관 **표시명은 같은데 agency_key가 다른** 경우(registry 확인 `inst:` 키와 미확정 `src:`/`a1:` 이름 키)에는 같은 이름이 두 identity로 남는다.
  - 기관 정규화(미확정 코드) 문제다.
  - 이번 작업에서는 병합하지 않았다.
  - 기관명만으로는 구분할 수 없어서 row key 순서대로 번호를 붙인다. 예: `정민호 (서울마포경찰서 1번)`, `(… 2번)`.
  - tooltip과 안내에는 '같은 기관 이름 아래 따로 집계'라고 적는다.

## 2. duplicateNames / entityLabel 변경

- `duplicateNames`(이름 문자열 출현 횟수)는 삭제하고 `src/domain/managerNames.ts` 한 곳으로 모았다.
  - `computeSameNames(rows)`: 서로 다른 row key만 세어 이름별로 묶고, 2개 이상인 묶음에 `{count, label, peers, same_agency}`를 만든다.
  - `shortAgencyLabels`: 현행 기관 표시명의 **뒤쪽 공백 단위 구간** 중 묶음 안에서 구별되는 가장 짧은 것을 쓴다. 문자를 중간에서 자르지 않는다.
    - '서울특별시경찰청 서울강서경찰서' → '서울강서경찰서'
    - '서울특별시 강서구 교통행정과' → '강서구 교통행정과'. 부서(…과/팀/계/실/반/부/국)는 상위 구간을 붙인다.
    - '갑 경찰서' → 그대로. 4자 미만이면 구간을 늘린다.
    - '(구)…'는 표시를 유지한다.
  - `sameNameIndex(rows)`: 행마다 서버 메타(`same_name`)를 우선 쓴다. 없으면(구 서버) 불러온 행만으로 판정하고 화면에 '(불러온 담당자 기준)'이라고 적는다.
- `entityLabel(e, kind, same)`는 불린 대신 `SameNameInfo | null`을 받는다. 동명이인만 `이름 (짧은 기관)`이다. 동명이인이 아닌 담당자에게는 기관명을 붙이지 않는다.

## 3. 불러오지 않은 담당자까지 정확히 판정하는 방법

- 서버 `entityRows`(`server/aggregate.ts`)가 담당자 목록 **전체**를 만든 직후 `computeSameNames`를 적용해 행마다 `same_name`을 붙인다.
  - 값은 dashboard 첫 100명, `entities`의 모든 페이지·검색 결과, `places/:key` 목록에서 같다.
  - 계산 비용은 이미 메모리에 있는 목록을 한 번 도는 정도다. 전체 118명을 브라우저로 보낼 필요가 없다.
  - 응답 필드는 `docs/public-api-contract.md`에 적었다. 선택 필드라서 구 클라이언트와 호환된다.
- 조건(날짜 기준·기간·지역·기관·법규·분류·지도 범위)이 바뀌면 서버가 그 조건의 목록으로 다시 계산한다.
  - 차트는 scope|version key로 다시 마운트되므로 이전 판정이 남지 않는다.
  - 늦게 도착한 이전 요청은 abort하고 key를 비교해서 버린다.
- 검증 결과는 다음과 같다.
  - 105번째 김지원(양천): 첫 100명만 받은 상태에서도 4번째 김지원이 '김지원 (서울강서경찰서)'로 표시됐다(단위 테스트, MC-NAME-FIRST).
  - 서울강서경찰서만 남긴 조건: '김지원'으로만 표시됐다(MC-SCOPE-RESET).

## 4. `담당자 1–8 / N명` 계산

- ECharts dataZoom의 `startValue`/`endValue`를 0-based 포함 범위로 읽어 `start+1`–`end+1`로 표시한다.
  - 값이 없으면 퍼센트로 환산한다.
  - 계산은 `windowFromZoom`이 한다.
- 전체보다 적게 불러왔으면 `담당자 97–100 / 불러온 100명 · 전체 118명`, 다 불러왔으면 `담당자 97–100 / 118명`으로 표시한다.
- 8명 이하이고 더 불러올 것이 없으면 탐색 줄이 없다. 이때 설명 끝에 `담당자 N명.`을 적는다.
- 표 보기에서는 `표: 불러온 100명 · 전체 118명`으로 표시하고 더 불러오기만 남긴다.

## 5. 이전/다음과 dataZoom

- React는 별도 index를 갖지 않는다. 버튼은 `chart.dispatchAction({type:'dataZoom', startValue, endValue})`만 보낸다.
- 화면 문구는 `useEChart`가 인스턴스마다 한 번 붙인 `datazoom` 리스너와 `setOption` 직후 호출이 차트 옵션을 **다시 읽어** 만든다.
  - 버튼, slider drag, inside 이동이 같은 경로를 쓴다.
  - drag 뒤 '다음'은 drag한 범위 바로 다음부터 시작한다(MC-NAV-SLIDER, 예: 45–52 → 53–60).
- 수용률 ↔ 과태료 모드, 테마 변경, 목록 확장에서는 마지막으로 읽은 범위로 옵션을 다시 만든다. 그래서 범위가 유지된다.
- 발견해서 고친 버그: dataZoom 창 안에서는 axisLabel formatter의 index가 보이는 tick 기준이었다. 그래서 101–108 구간에 1–8번 이름이 그려졌다.
  - 이제 category **값**으로 줄바꿈 이름을 찾는다.
  - 브라우저 검사가 ECharts가 실제로 그리는 라벨(`getViewLabels`)을 대조한다.

## 6. 미로드 담당자 추가 조회

- 불러온 목록의 마지막 구간에서는 '다음 ›' 자리에 `나머지 18명 불러오기`가 나온다.
  - 한 번에 추가되는 수보다 많이 남았으면 `다음 100명 불러오기`로 표시한다.
  - 사용자가 눌렀을 때만 요청한다. 자동 preload는 없다(MC-LOAD-NOAUTO).
- 범위 차트는 기존 `ScopeEntities` 서버 페이지(`entities` page_size 100)를 그대로 쓴다.
  - 실패 뒤 '다시 시도'는 같은 페이지를 다시 요청한다. 한 페이지 더 넘어가지 않는다.
- 주소 차트는 기존 `places/:key?entity_limit=`를 쓴다.
  - 이전에는 `placeLimit` state 변경으로 상세 전체가 loading으로 바뀌어 차트가 사라졌다.
  - 이제 별도 요청으로 받아 성공할 때만 교체한다.
- 요청 중에는 `불러오는 중…`을 표시하고 차트와 현재 범위를 유지한다.
- 실패하면 `담당자를 더 불러오지 못했습니다. 지금 보이는 100명은 그대로입니다.`와 `다시 시도`를 표시한다.
- 성공하면 목록이 100명에서 118명으로 늘어나고 범위 97–100은 그대로다. 다음을 누르면 101–108이다.

## 7. 차트·표·Excel 이름

- 차트 축(두 줄), 차트 표 보기, Excel 담당자 칸이 같은 `entityLabel`+`sameNameIndex`를 쓴다(MC-TABLE, MC-EXCEL).
- Excel '소속 기관' 칸은 정식 현행 기관명 그대로다. 짧은 기관명을 붙인 이유는 통계표 주석에 적었다. 서로 다른 row key는 합치지 않는다.
- 주소/범위 패널 목록(`EntityMetricRow`)도 같은 라벨을 쓴다. 이름 버튼의 title에 동명이인 설명을 넣었다.
- 하단 기관·담당자 표는 모든 담당자 아래에 기관을 적고 있어서 바꾸지 않았다.

## 8. 브라우저 증거

실행 환경은 다음과 같다.

- 로컬 e2e 스택: 실제 프런트엔드(Vite dev) + 실제 `server/publicHandler.ts`
- 합성 자료: dataset `managers`, 118명, 한 주소
- **MOCK 카카오 SDK**
- chromium 141

실행 명령:

```
E2E_PORT=5190 npx vite --config scripts/browser/vite.e2e.config.ts
LANG=C.UTF-8 node scripts/browser/verify_manager_chart.mjs docs/implementation/manager-chart-2026-09-30/evidence
```

결과: `evidence/runs/manager-chart-2026-09-30T05-06-08-638Z.json` — commit `dbb7b90`, working tree clean, **22/22 PASS**.

| ID | 확인 |
|---|---|
| MC-NAME-FIRST / FAR / ORDINAL | 4번째 김지원(서울강서경찰서), 105번째(서울양천경찰서), 같은 기관명 두 identity는 1번·2번 |
| MC-TIP-BAR / AXIS / TOUCH | 막대 hover, 축 이름 hover, 390px 탭에서 정식 기관명·'동명이인 구분을 위해…'·같은 이름 목록 표시 |
| MC-NAV-FIRST / STEP / SLIDER / SMALL | 1–8 → 9–16 → 1–8, slider drag가 45–52로 바뀌고 문구·그려진 라벨이 일치, 14명 기관은 1–8 → 9–14 |
| MC-LOAD-SCOPE / PLACE / FAIL / NOAUTO | 범위·주소 차트 나머지 불러오기, 로딩 중 차트 유지, 실패 시 100명 유지 + 재시도, 자동 요청 없음 |
| MC-MODE-KEEP | 과태료↔수용률 전환에서 25–32 유지 |
| MC-SCOPE-RESET / LATE | 새 조건이면 1–8, 동명이인 재계산, 이전 조건의 늦은 페이지가 새 목록을 덮지 않음 |
| MC-TABLE / MC-EXCEL | 표 118행 이름 = 축 이름, xlsx 이름·기관 칸·주석 |
| MC-LEAK | 다음/이전 30회 이상 + 모드 20회 + 조건 10회: 차트 인스턴스·ResizeObserver·datazoom 리스너 수 7 → 7 → 7 |
| MC-ESC | tooltip 열린 채 Esc 입력 시 오류 없음 |
| MC-LAYOUT | 1920/1440/1280/768/390 × dark/light: 가로 넘침 없음, 탐색 줄이 카드 안 차트 아래, 버튼 높이 32px 이상 |

스크린샷은 `evidence/shots/`에 있다. 주요 파일:

- `first-window-1440-dark.png`
- `tooltip-bar-kim-1440-dark.png`
- `tooltip-axis-kim-1440-dark.png`
- `far-namesake-101-108-1440-dark.png`
- `ordinal-25-32-1440-dark.png`
- `loading-more-1440-dark.png`
- `load-failed-1440-dark.png`
- `table-118-1440-dark.png`
- `tap-tooltip-390-dark.png`
- `card-{width}-{theme}.png`

모든 증거는 fixture 기준이다. 실제 카카오 SDK와 운영 데이터로는 확인하지 않았다(NOT_RUN). Muse 교차 검수도 실행하지 않았다.

## 9. 검사 결과

- `npx vitest run`: 585 passed, 84 skipped. skip된 것은 DB가 필요한 integration 테스트로, 기존과 같다.
  - 신규 `tests/product/managerNamesNav.test.tsx` 18개가 필수 fixture 1–5와 3/8/9/100/118명 탐색을 다룬다.
- `npm run build`: 성공.
- `npm run scan`: `passed: true, issues: []`.

## 참고

- 데모 모드에서는 `?fixture=managers`로 같은 118명 합성 자료를 볼 수 있다. dashboard가 서버처럼 첫 100명만 준다.
- `scripts/browser/verify_followup.mjs` R3_crowd는 예전 문구 '나머지 담당자 불러오기'를 누른다. 이 흐름은 이제 마지막 구간의 `나머지 N명 불러오기`이고, MC-LOAD-PLACE가 대체한다.
