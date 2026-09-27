# UI/UX 검수 보고서 · 과태료 금액 / 답변까지 걸린 기간 / 행정구역 경계
- request_mode / policy_version: review / cm-2026-09-27
- 실제 model/provider / 확인 근거: Muse Spark contributor (OpenCode 구독 경로, provider·variant ID는 호스트에서 확인 — 본 검수 bare-metal 확인 생략)
- worktree / commit / dirty: /home/better0101/projects/safetyreport-community-map-dab-review (detached, 검수 전용) / 1566e6a / clean (node_modules만 untracked 심볼릭 링크). 제품 파일 변경 없음.
- 시작·종료 / URL / data_mode / dataset_version: 2026-09-27 검수 / http://safemap.worklazy.net/ (Chrome 인자 `--host-resolver-rules=MAP safemap.worklazy.net 127.0.0.1:4176` 로 로컬 4176 서버에 연결. 주소에 포트를 붙이면 카카오 출처 불일치로 SDK 401 → 반드시 포트 없이 연다) / demo (합성 fixture, DEMO_VERSION synthetic-2026-09-27. 화면 표기 "2026.09.24 기준") / 실데이터·운영 인증은 범위 밖 (Sol이 로컬 스택 27건으로 별도 확인)
- browser/MCP/Playwright 버전: Google Chrome 154.0.8037.57 / playwright-core 1.63.0 (`/home/better0101/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.mjs`, executablePath=/usr/bin/google-chrome) / 빌드: `VITE_DATA_MODE=demo VITE_BASE_PATH=/ VITE_KAKAO_MAP_JS_KEY=e5932698f8514f560335ed7b24ec4da7 npx vite build --outDir .agent-runtime/demo-dist` + `python3 -m http.server 4176` (검수 중 1회 중단되어 재기동, 자기 PID만 사용)
- 지도 상태: 실제 카카오 지도 로드 확인 — `window.kakao` YES, `dapi.kakao.com sdk.js` 200, 타일 200 (수백 건). 목록 대체 상태 아님.

## 결과표 (viewport × theme × view)
매트릭스 24샷 모두 `documentElement.scrollWidth-clientWidth = 0` (가로 스크롤 0). 직접 열어본 샷은 ★, 나머지는 파일 존재+overflow 수치로만 확인.

| viewport | theme | view | screenshot | console/network | result |
|---|---|---|---|---|---|
| 1920×1080 | dark | 지도+통계 | 1920x1080-dark-지도plus통계.png | clean | PASS (overflow 0; 00-base.png ★ 카카오 지도·경계·클러스터 정상) |
| 1920×1080 | dark | 지도 크게 | 1920x1080-dark-지도 크게.png ★ | clean | PASS (지역 목록 병행 표시, 겹침 없음) |
| 1920×1080 | dark | 통계 크게 | 1920x1080-dark-통계 크게.png | clean | PASS (overflow 0) |
| 1920×1080 | light | 지도+통계/크게/통계크게 | 1920x1080-light-*.png (3) | clean | PASS (overflow 0) |
| 1440×900 | dark/light | 3 views | 1440x900-*.png (6) | clean | PASS (overflow 0) |
| 2560×1440 | dark/light | 3 views | 2560x1440-*.png (6) | clean | PASS (overflow 0) |
| 390×844 | dark | 3 views | 390x844-dark-*.png (3) | clean | PASS (overflow 0) |
| 390×844 | light | 지도+통계 | 40-mobile-light.png ★ | clean | PASS (읽기 가능, 하단 내비, 칩 줄바꿈 정상. 헤더 타이틀 말줄임은 허용 범위) |
| 1920×1080 | dark | 통계 상세 | 05-stats-detail.png ★ | clean | PASS (새 행·설명문구·추이표 과태료/답변까지 열·출처문구 가독) |
| 1920×1080 | dark | 비교 켜짐 | 64-me-signed-on.png ★ | clean | PASS (비교표·%p·몫%·평균차이 가독) |
| 1920×1080 | dark | hover 시도 | 54-hover.png / 70-hover-h*.png ★ | clean | 부분 (DAB-01: 하이라이트는 보이나 이름·신고수 카드 미확인) |

추가 샷: 12-interest(★ 유지), 13-after-list-select, 20-boundary-off, 21-boundary-abort(안내문구), 50-filter-drawer, 51-filter-busan, 53-region-picked, 54/70-hover-h*(hover 하이라이트), 55/56/62/63/64 me 상태, 60-sido-busan, 61-sgg-haeundae. 스크린샷 dir: `docs/reviews/screenshots/dab-review/` (52개. 1차 실패 로드의 잔여물은 삭제함).

## 행동표 (작업서 검사 1~8)
| # | 검사 | 결과 | 근거 |
|---|---|---|---|
| 1 | 새 표 행·설명·지역 두 칸·hover·출처 가독성 | PASS (hover 카드 제외) | 05-stats-detail ★: `답변까지 걸린 기간 21.5일 / 평균 22.1일·90% 38일 이내·306건`, `과태료 3,490,000원 / 평균 56,290원·86건 중 62건 확인(일부만 합산)`, 설명문구(미기재 17·비동의 7·범칙금 7·0원 1건) 정상. 시도/시군구 두 칸(분류·시도·시군구 3 selects) ★ 50. 출처문구 지도 아래 표시 확인. |
| 2 | 금액·기간 숫자 대조 | PASS | 추이 월별 과태료 합 = 40+390+380+170+230+460+210+370+40+100+380+220+500 = 3,490,000원 = 주요 통계 합계 ✓. 월별 과태료 건수 합 86 = 본표 86 ✓. 기관표 과태료 건수 합 18+14+14+7+10+7+3+5+4+4=86 ✓, 금액 합 3,490,000원 ✓. `0원` 13건 전수: 금액 끝자리 0(3,490,000원 등) 또는 "0원으로 치지 않고" 설명문 — 가짜 0 표시 없음. 빈 달 ‘—’ 표기 문구 존재(데모 전월 자료 있음). |
| 3 | 지역 전국→시도→시군구→위→전국 3경로 | PASS (지도클릭 필터는 DAB-02) | 필터: 시도 select 17개(전남광주통합특별시 포함) → 부산 선택 시 URL `region_code=26`, 칩·표·지도 이동, 경계 단위 표시 `시군구 단위`로 전환 ✓. 시군구 17개(시도 전체·강서구·금정구…) → 해운대 `region_code=26350` + 본문 해운대 ✓. 역순 복원 전국 ✓ (61/60 샷). 목록: 서울특별시 클릭 → `region_code=11`, 시군구 2행·중구/강남구, `← 전국 보기` 크럼브 존재(코드 확인) ✓. `지역 미확인` 행 ✓. 옛 주소 `?region_code=부산 해운대구` → 해운대 표시 ✓. 옛 관심 `["서울 중구"]` → ★ 유지 + 목록 상단 고정 ✓. |
| 4 | 목록 선택 시 bbox 미생성 / 드래그 시 bbox | PASS (부분) | 자동새로고침 ON 상태에서 목록 서울 선택 → URL에 bbox 없음(`?start…&category=all&region_code=11`), 기존 bbox도 제거됨 ✓. 손 드래그 후 bbox 존재 ✓ (단, 초기 로드부터 bbox가 있어 드래그 증분 자체는 분리 미확인 — 기록용). |
| 5 | 경계 끄기/켜기·유지·abort | PASS | 체크박스 `행정구역 경계 보기 · 시도/시군구 단위` ✓. 끄기→켜기→새로고침 후 유지(localStorage) ✓. `**/boundaries/**` abort 시 "행정구역 경계선을 불러오지 못했습니다. 지도와 통계는 그대로 쓸 수 있습니다. 다시 시도" + 마커·통계 정상 ✓ (21 샷). abort 2건 외 네트워크 4xx/5xx 0. |
| 6 | 로그인 비교 금액/기간 차이, empty/error 가짜 0 | PASS | 주의: 유효 fixture는 `?me=signed`(작업서의 `demo`는 무효 → signed_out). signed+비교 ON: 기간 `23일/평균 24.5일/+1.5일`, 금액 `460,000원/평균 57,500원/13.2%(전체 중 내 몫)/평균 +1,210원` ✓ (64 샷, dab-signed-tables.txt). 지역행: 내 값·%p 차이, 없는 곳 `내 신고 없음` ✓. empty+비교 ON: 전부 `내 신고 없음`, 가짜 0 없음 ✓. error: `내 신고를 불러오지 못했습니다. 전체 통계는 그대로… 다시 시도`, 가짜 0 없음 ✓. 기관·담당자표 내 답변/내 수용률/차이 열 확인(예: 제주시청 +18.2%p). |
| 7 | 키보드·390·터치 | PASS | 상세필터 시도 select 포커스→ArrowDown→Enter 조작 ✓, 경계 체크박스 Space 토글 ✓, `← 보기` 버튼 button 요소(포커스 가능) ✓. 390 hScroll 0 (전 매트릭스), 버튼 40개 중 24px 미만 0 ✓. 단, 비교 체크박스는 getByRole name 조회 실패 — DAB-03. |
| 8 | console/network | PASS | 정상 로드에서 console error 0, warning 0, 4xx/5xx(카카오 타일 포함 전수) 0. 1차 실행의 error 2건은 본 검수의 의도적 abort(`sido.topo.json`, `meta.json`)에 한정됨. 카카오 SDK·타일 200. |

## 결함
| id | severity | 재현 | expected | actual | evidence | owner |
|---|---|---|---|---|---|---|
| DAB-01 | medium | 전국 지도에서 경계 폴리곤 3곳에 hover (70-hover-h1/h2/h3.png) | 지역 이름·신고 수 카드 표시 | 폴리곤 하이라이트(수도권 옅은 채움)는 보이나 이름·신고수 카드가 스크린샷에 안 보임. 합성 mousemove가 polygon 이벤트를 못 깨웠을 가능성 있어 실제 마우스 재확인 필요 | 70-hover-h*.png, 54-hover.png | Sol (지도/경계) |
| DAB-02 | medium | 전국에서 지도 캔버스 1회 클릭 | (폴리곤 명중 시) 그 지역만 보기 + region_code | URL 변화 없음. 명중 여부 불확실 — 폴리곤 클릭→필터 경로 미검증 | dab-results.json region-mapclick | Sol (지도/경계) |
| DAB-03 | low | `getByRole('checkbox', { name: /비교/ })` → 0건. 같은 요소를 `input[type=checkbox]`+label 텍스트로는 찾고 클릭·Space 조작은 됨 | 접근성 이름으로 조회·조작 가능해야 | role/name 계산과 label 래핑 불일치 의심 (스크린리더 실거동은 별도 확인 필요) | dab-signed-controls.json, src/components/MapPanel.tsx:484 부근 | Sol+Muse |
| DAB-04 | note | `?me=demo` (작업서 기재) 로 접속 | 합성 로그인 | 무효 값 → signed_out 프롬프트. 유효값은 signed/out/unconfigured/empty/expired/kakao/suspended/error/rate/stale (src/auth/mapAuth.ts:168). 작업서 `?me=` 예시 정정 필요, 제품 아님 | 30-me-*.png, mapAuth.ts:168-174 | Sol (문서) |

관찰 (결함 아님): 지역 목록은 자료 있는 시도만 나열(6+`더 보기·2곳`=8, `지역 미확인` 별도). 빈 시도는 목록에 없고 필터 select에서는 선택 가능(`counts` 표시). 의도된 동작으로 보임(계약 소유자 확인용 기록). 화면 표기 "2026.09.24 기준" vs DEMO_VERSION synthetic-2026-09-27 — 데모 스탬프 불일치로 보이나 실데이터 범위 밖이라 기록만 함.

## 통계·공개 경계
- 1건 표본: 데모 제주 1건 Geochart/표 정상(기존 보장 유지, 본 검수에서 별도 깨짐 없음). `내 신고 없음` 문구로 0과 구분 — raw/secret 노출 없음.
- 0분모: 과태료 86건 중 62건 금액 확인 표기, 나머지는 합산 제외 + 건수 공개(17/7/7/1) — 0원 치환 없음.
- partial month: 2026.09 `진행 중` 비고 ✓. completed_date 누락분이 답변 306 vs 신고 288 차이로 드러나고 기준일 문구(신고한 날/답변 받은 날) 병기 ✓.
- mask collision: 본 검수 범위(금액·기간·경계) 밖 — 기존 검수 유지.
- 경계 출처: "행정구역 경계: 국가데이터처(구 통계청) SGIS 「행정구역 통계 및 경계」(2025.6.30 기준), 공공누리 제1유형 — …(행안부 2026.7.1 기준으로 가공)" 지도 아래 표시 ✓ (attribution=boundaries meta.json).

## 최종 판정
- PASS (범위: 새 통계 행·설명문구, 숫자 정합, 지역 2단계 네비+레거시, bbox, 경계 토글/유지/abort, 로그인 비교 empty/error 포함, 키보드·모바일·콘솔).
- FAIL 없음. BLOCKED 없음 (카카오 실지도 로드됨).
- NOT_RUN / 조건부: DAB-01 (hover 이름·신고수 카드 시각 미확인), DAB-02 (지도 폴리곤 클릭→필터 경로 미검증) — 실제 마우스 또는 경계 클릭 테스트로 후속 확인 필요. DAB-03 (비교 체크박스 접근성 이름) 후속 확인.
- 재현: `.agent-runtime/dab-review.mjs`, `dab-review2.mjs`, `dab-review3.mjs`, `dab-review4.mjs`, `dab-proxy.py`(미사용 — 포트포워딩 방식 대신 resolver 규칙 사용으로 폐기, 삭제 금지·기록용), 결과 JSON/TXT (`dab-results*.json`, `dab-tables.json`, `dab-trend.txt`, `dab-signed-tables.txt`, `dab-me-*.txt`, `dab-*-opts.txt`, `dab-region-rows.txt`, `dab-zero-won.txt`, `dab-recon.json`, `dab-signed-controls.json`).
- 단순 스크린샷 존재나 exit 0으로 PASS하지 않았음 — 위 표의 수치 대조·URL·문구 전수 확인 기반.
