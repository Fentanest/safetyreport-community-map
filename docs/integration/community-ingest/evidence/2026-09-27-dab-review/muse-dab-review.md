# Muse 작업서 · 과태료 금액 · 답변까지 걸린 기간 · 행정구역 경계 검수
request_mode=review / policy_version=cm-2026-09-27
WORKTREE: /home/better0101/projects/safetyreport-community-map-dab-review (detached, 검수 전용, node_modules는 본 레포 심볼릭 링크)
BASE_COMMIT: 1566e6a (branch feat/duration-amount-boundaries)
DATA_MODE: demo (합성 fixture). 실데이터·운영 인증은 이번 검수 범위가 아니다(Sol이 로컬 스택 27건으로 따로 확인).

이번은 **검수**다. 제품 파일을 고치지 말고 증거와 이슈만 쓴다. 작성 허용: docs/reviews/dab-review.md,
docs/reviews/screenshots/dab-review/**, .agent-runtime/**.

## 서버 (실제 카카오 지도 포함)
카카오 JS 키는 등록 도메인(safemap.worklazy.net)에서만 SDK를 준다. 호스트 설정은 바꾸지 말고, **브라우저 인자로만**
그 도메인을 로컬 서버로 보낸다.
```bash
VITE_DATA_MODE=demo VITE_BASE_PATH=/ VITE_KAKAO_MAP_JS_KEY=e5932698f8514f560335ed7b24ec4da7 \
  npx vite build --outDir .agent-runtime/demo-dist
cd .agent-runtime/demo-dist && python3 -m http.server 4176 --bind 127.0.0.1   # 자기 PID만 종료
```
Playwright: `/home/better0101/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.mjs` (1.63.0), Chrome `/usr/bin/google-chrome`.
`chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--host-resolver-rules=MAP safemap.worklazy.net 127.0.0.1:4176'] })`
후 `http://safemap.worklazy.net/` 로 연다. 지도가 `카카오 지도`로 뜨지 않으면 BLOCKED로 적고 이유(콘솔·네트워크)를 남긴다.

## 바뀐 것 (검수 대상)
- 주요 통계 표: `답변까지 걸린 기간`(중앙값, 평균·90%·건수 보조), `답변에 적힌 과태료 금액`(합계·평균·확인 건수, 일부만 합산 표시),
  수용률·일부수용률 분리, 표 아래 설명 문구(금액 미기재·공개 동의 안 한 자료·범칙금 등).
- 로그인 비교(`?me=` 합성 로그인): 위 두 행의 내 신고 값과 차이(일수 차이, 금액은 전체 중 내 몫 %·평균 차이 원).
- 기관·담당자 표: `답변까지` 열, 과태료 칸 아래 금액 합계. 추이 `표로 보기`: 과태료 금액·답변까지 열.
- 지역: 필터가 `시도` → `시군구` 두 단계(2026-07-01 행정구역, 전남광주통합특별시 등). 지역 목록은 전국에서 시도, 시도를 고르면
  그 안의 시군구, `← … 보기`로 한 단계 위. `지역 미확인` 행.
- 지도: 행정구역 경계(기본 켜짐, `행정구역 경계 보기` 체크박스, 이 기기에 저장). 넓게 보면 시도, 확대하거나 시도를 고르면 시군구.
  경계 위에 마우스를 올리면 지역 이름·신고 수 카드, 누르면 그 지역만 보기(다시 누르면 한 단계 위). 목록/필터로 고르면 지도가 그 지역으로 이동
  (이 이동은 `지도를 움직이면 통계도 바꾸기`가 켜져 있어도 ‘보이는 지역’ 조건으로 바뀌면 안 된다). 경계 출처 문구가 지도 아래에 보여야 한다.
- 옛 주소 `?region_code=부산 해운대구` → 부산 해운대구로 열려야 한다. 옛 관심 지역(localStorage `cm-interest-regions`에 `["서울 중구"]`) → ★ 유지.

## 검사
1. 1920×1080·1440×900·2560×1440·390×844 × dark/light, view both/map/stats 스크린샷을 열어 겹침·잘림·가독성(특히 새 표 행, 금액 설명, 지역 선택 두 칸, 지도 hover 카드·경계 출처 문구).
2. 금액·기간 숫자 대조: 표 합계와 기관 표·추이 표가 서로 모순되지 않는지(예: 추이 표 월별 과태료 금액 합 = 주요 통계 합계), 금액이 없는 곳이 0원으로 보이지 않는지.
3. 지역: 전국 → 시도 선택(필터·목록·지도 클릭 세 경로) → 시군구 → 한 단계 위 → 전국. 각 단계에서 URL `region_code`, 칩, 표, 지도 위치, 경계 단위가 맞는지.
4. 자동 새로고침 켠 상태에서 목록으로 지역 선택 → URL에 `bbox`가 생기지 않는지. 그 뒤 손으로 지도를 끌면 그때는 bbox가 적용되는지.
5. 경계 끄기/켜기, 새로고침 후 유지. 경계 파일 요청을 막았을 때(route abort `**/boundaries/**`) 안내 문구+다시 시도, 마커·통계는 정상.
6. 로그인 비교 켠 상태에서 지역 목록 내 값·금액/기간 차이 표시, `?me=empty|error` 상태에서 새 행이 가짜 0을 보이지 않는지.
7. 키보드: 시도/시군구 select, 지역 목록 버튼, `← 보기` 버튼, 경계 체크박스 도달·조작. 390 가로 스크롤 0, 터치 44px.
8. console error/warning, 4xx/5xx(카카오 타일 제외 표기) 0.

## 제출
docs/reviews/REPORT_TEMPLATE.md 형식으로 docs/reviews/dab-review.md. 검수 commit, URL, browser/tool 버전, 결과표(viewport×theme×view),
행동표 PASS/FAIL, console/network, 이슈(id·severity·재현·기대/실제·스크린샷·file hint), BLOCKED와 최종 판정.
