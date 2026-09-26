# UI/UX 검수 보고서 — 전체×내 신고 비교 통합 commit 재검수 (Muse)
- request_mode / policy_version: review / cm-2026-09-27
- 실제 model/provider / 확인 근거: Muse Spark contributor (OpenCode 구독 경로). 정확한 provider/model ID는 호스트에서 확인할 것 — Sol 요청에 기록 (MODEL_UNVERIFIED 유지).
- worktree / commit / dirty: /home/better0101/projects/safetyreport-community-map-compare-review (detached, 검수 전용) / ec5a847 (Sol 통합 commit, `git rev-parse HEAD` 일치) / 제품 파일 무변경. dirty는 검수 전부터 있던 `M docs/tasks/muse-personal-compare-review.md` 1건만(본 검수에서 손대지 않음).
- 시작·종료 / URL / data_mode / dataset_version: 2026-09-27 / http://127.0.0.1:4175/ (`VITE_DATA_MODE=demo` build → `.agent-runtime/demo-dist` preview, PID 파일 `.agent-runtime/preview-4175.pid`) / demo 합성 fixture / synthetic-2026-09-27 (화면 푸터 표기).
- browser/MCP/Playwright 버전: Google Chrome 154.0.8037.57, playwright-core 1.63.0 (`/home/better0101/projects/safetyreport-community-auth/node_modules/playwright-core`), node 직접 실행 스크립트 `.agent-runtime/final-*.mjs`, `*-repro*.mjs` (커밋 제외). 시각 판정은 스크린샷을 직접 열어 수행.
- 통합 변경점 반영: Sol 통합(ec5a847)이 Muse 구현 branch에서 바꾼 점 — 패널 view별 단일 인스턴스, 테이블 폭 규칙, 390 브랜드 말줄임/차이 한 줄/12px, 지역 행 `내 신고 없음` 문구, 담당자 카드 5행+펼치기, 마커 토큰 1회 읽기 — 을 포함해 통합본 그대로 검수함.

| viewport | theme | steps completed | screenshot | console/network | result |
|---|---|---|---|---|---|
| 1920×1080 | dark | both+토글on, 공개대조, 지역행, 별, 필터4종, 추이표, 브리핑, 로그아웃, 공유, 키보드 | both-dark-1920.png, vp-both-dark-1920.png, state-*.png | error 0, warn 0, 4xx/5xx 0, overflowX 0 | PASS |
| 1920×1080 | light | both 육안 (비교표·담당자·추이·TOP5·표 가독성) | both-light-1920.png, vp-both-light-1920.png | error 0, overflowX 0 | PASS |
| 1920×1080 | dark/light | map 모드 (한 줄 요약 전체/내, 지도+지역 2열) | map-dark-1920.png, map-light-1920.png | error 0, overflowX 0 | PASS |
| 1920×1080 | dark/light | stats 모드 (미니지도+지도 크게, 2열 그리드) | stats-dark-1920.png, stats-light-1920.png | error 0, overflowX 0 | PASS |
| 1440×900 | dark/light | both/map/stats (좌 1.2fr·우 min 380) | both-dark-1440.png 外 | error 0, overflowX 0 | PASS |
| 2560×1440 | dark/light | both/map/stats (좌 1.5fr·우 1fr) | both-dark-2560.png 外 | error 0, overflowX 0 | PASS |
| 390×844 | dark/light | both/map/stats, 토글·세그먼트·하단nav(96×56), 터치 44px, 페이지 가로스크롤 0 | both-dark-390.png, vp-both/map/stats-dark-390.png, vp-both-light-390.png | error 0, overflowX 0 | PASS |

겹침·잘림 판정: 24 매트릭스 전수 `overflowX=0`, `section` 수준 viewport 밖 요소 없음(단, 390 기관·담당자 전체 표는 `.table-scroll` 내부 스크롤 + sticky 첫 열 — 페이지 스크롤 0, 설계대로). 390 상단 브랜드·계정명은 말줄임(인식 가능). 라이트 테마 토큰·차트·팝업 이상 없음.

## 행동 검사표 (Playwright 실측, 1920 dark 기준 + 390)
| # | 행동 | 결과 |
|---|---|---|
| B1–B3 | 비로그인 공개(핵심 지표 전체만, 288/306/74.7%/25.3%/28.1%/31/15) → 토글 → 로그인 안내+카카오로 로그인 → 합성 로그인(합성 사용자·합성). **전체 열 7행 전수 일치(equal:true)** | PASS |
| B3-sub | 건수 행 내≤전체 (31≤288, 32≤306, 10≤31). 비율은 관측값이라 초과 가능(90.0% vs 74.7%) — 부분집합 규칙은 건수 기준 | PASS |
| B4 | 지역 행(서울 중구) 클릭 → URL `region_code=서울 중구`, `적용 중` 태그, KPI·지역·내 값 동시 변경(60/9건 등), 건수 내≤전체 | PASS |
| B4-star | 별 → localStorage `cm-interest-regions` 저장 → 새로고침 후 관심 그룹 고정+★유지 (`#interest-label` 대기 시 PINNED_OK; 고정 1200ms 스냅샷 1회 미렌더는 로드 레이스, 재검증 통과) | PASS |
| B4b | 담당자 행 클릭 → `agency_key+managers_key` URL 적용. 김하늘 2행 분리(서울중부경찰서 39건 vs 수원시청 17건) | PASS |
| B5 | 지점 필터 4종 라벨(전체 지점·내 신고 포함·함께 기록한 지점·관심 지역). 필터 전환 시 KPI 전체 불변(invariantOk:true). 목록 뱃지 텍스트 구분(내 신고 n건·함께 기록한 지점, 색 외 텍스트+aria) | PASS |
| B5b | 관심 지역 설정 시 필터 활성화 → `3 / 31곳 표시`, KPI 288 유지(통계 불변 문구 `표시 필터 · 통계 범위는 그대로`) | PASS |
| B6 | 추이 범례 `신고 접수·처리완료·내 신고 접수(점선)`, 내 점선 다이아몬드 시리즈, 표 보기 → 내 신고/내 처리완료 열, `결측 월은 '—'` 캡션. 기본 범위 결측 월 없음 → '—' 렌더는 NOT_RUN(코드는 `fmtInt(null)→'—'`) | PASS(범위 내) |
| B7 | 브리핑: 내 열 숨김(핵심 지표로 복귀)+계정명 `내 계정 · 합성` → 내 데이터 표시(해당 브리핑만) → Esc 종료 후 토글on·내 열·계정명 복원 | PASS |
| B8 | 로그아웃: 공개 화면 유지(288), 내 셀 `—`, 로그인 안내+CTA, 계정 메뉴 `앱·서버 자동 업로드와 별개/계속됩니다` 문구 | PASS |
| B9-me | `?me=` 9종 문구 §6 일치: out 로그인 안내 / unconfigured 토글 비활성+사유 / empty 공유없음+업로드 안내 / expired 만료+재로그인 / kakao 카카오 요구 / suspended 공유중지 / error+재시도(공개 유지) / rate 60초+재시도 / stale 409+재조회. 전부 공개 288 유지 | PASS |
| B9-fx | `?fixture=` one 표본1건 배지+비교 버전가드 / empty 초기화 유도+버전가드 / offline·rate·stale 공개 오류+재시도, 가짜 0 없음 | PASS |
| B10-share | 공유 클립보드 `?start&end&category&region_code` — 비교/me/계정/view 없음. 토스트 `차량·계정정보는 포함되지 않습니다` | PASS |
| B10-kb | Tab 55회로 switch 도달(네이티브 체크박스), Space 토글 on→off, 보기 버튼 Enter 전환(`view=map`), Esc 드로어 종료, switch focus outline 2px | PASS |
| B10-touch | 390: 토글 44·보기 44·필터 44·지역행 62~85·별 44×44·하단nav 96×56. 페이지 가로스크롤 0 | PASS |
| B11 | console error 0 / warning 0 / 4xx·5xx 0 (매트릭스 24 + 행동 전 세션). 차이 셀 전수 동일색(`rgb(243,243,244)`), `관측값 비교이며 평가가 아닙니다`+`별·메달·우수 판정 없음` — 중립 | PASS |
| CMP04-c | localStorage 키 `cm-theme`·`cm-compare`만(개인·토큰 없음), DOM에 원번호·UUID·토큰·이메일 없음 | PASS |

## 결함
| id | severity | 재현 | expected | actual | evidence | owner |
|---|---|---|---|---|---|---|
| FINAL-01 | 하 | 관심 지역 0개 상태에서 지점 필터 4번째 버튼 | 비활성 사유 표시(§5.3 표시 필터 안내 수준) | `disabled`만, `title` 없음 — 이유를 알 수 없음 | state-*.png(필터행), `src/components/MapPanel.tsx:199-204` | Sol (제품 수정은 별도 승인 후) |
| FINAL-02 | 하 | `?me=unconfigured` 토글 옆 문구 | 한 문장 안내 | `…그대로 볼 수 있습니다. 공개 화면은 그대로 볼 수 있습니다.` 중복 | state-me-unconfigured.png, `src/auth/mapAuth.ts:187`+`src/components/ViewControls.tsx:33` | Sol |
| FINAL-03 | 하 | `?me=expired` | §6 `앱 업로드 연결은 영향 없음` 문구 | 만료+재로그인만, 업로드 영향 문구 없음(해당 문구는 로그인 중 계정 메뉴에만) | `.agent-runtime/final-behaviors.json` `me_expired`, `src/auth/mapAuth.ts:206` | Sol |

## 통계·공개 경계
- 1건: `?fixture=one` 표본 1건 배지(`.sample-one` 1개) 유지, 개인 비교는 버전가드(`공개 데이터와 내 비교 자료의 기준이 달라…`) + 재조회. 담당자 행 `표본 1건` 뱃지 코드 유지(`ManagerCompare.tsx:61`).
- 0분모: 기여 계정 행 `—`(해당 없음), `fmtInt/fmtPercent/fmtPp(null)→'—'`(`format.ts`). 진성 내 0분모 KPI 케이스는 기본 fixture에 없음.
- partial month: 진행 중 월 `진행 중` 표기 + `같은 경과기간 비교` 캡션.
- completed_date 누락: 좌표 없는 7건 `통계에만 포함` 문구.
- 마스킹: Vehicle TOP5 `7*더*4*6`형 기존 유지, 공유 URL에 차량·계정 없음(클립보드 실측).
- raw/secret: localStorage·DOM에 개인 식별자·토큰·원번호 없음(위 CMP04-c).

## 최종 판정
- 합성 fixture 범위(본 검수 전부): **PASS** — CMP01/02/04(client)/06/07 plenary, CMP03·CMP05 demo 범위(서버·실세션은 Sol 로컬 스택 E2E가 담당), CMP08 PASS(P1).
- 실 Kakao 지도 SDK 위 링/점선 링/★: **BLOCKED** — 키 없음. fallback 목록·뱃지·범례 텍스트로 동등 탐색 확인, 지도 패널 문구 `실 Kakao 지도와 live 공개 API 연동은 키·백엔드인가 없이는 BLOCKED`와 일치.
- 운영 인증·실데이터 내 통계 대조·`private,no-store` 응답 헤더·RPC 권한: **BLOCKED/NOT_RUN** — 승인 전 미실행 영역(Sol E2E·서버 검수로 분리).
- 실행하지 않은 테스트: 실 SDK 지도 렌더, 운영 Supabase 인증 플로우, 추이 결측 월 '—' 렌더 — NOT_RUN.
- 제품 파일 변경 없음(본 검수는 review mode, 허용 경로만 기록). 미리보기 서버는 본 보고서 작성 후 자기 PID만 종료.
