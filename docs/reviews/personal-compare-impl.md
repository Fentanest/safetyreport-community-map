# UI/UX 검수 보고서 — 전체×내 신고 비교 시각 구현 (Muse)
- request_mode / policy_version: implementation / cm-2026-09-27
- 실제 model/provider / 확인 근거: Muse Spark contributor (OpenCode 구독 경로). 정확한 provider/model ID는 호스트에서 확인할 것 — Sol 요청에 기록.
- worktree / commit / dirty: /home/better0101/projects/safetyreport-community-map-muse-compare, branch muse/personal-compare, base 9ab2631, 검수 후 로컬 commit (해시 아래). dirty 없음.
- 시작·종료 / URL / data_mode / dataset_version: 2026-09-27 / http://127.0.0.1:4174/ (build + preview, `VITE_DATA_MODE=demo ... --outDir .agent-runtime/demo-dist`) / demo 합성 fixture / demoEngine 결정적 집계.
- browser/MCP/Playwright 버전: Google Chrome 154.0.8037.57, playwright-core 1.63.0 (node 직접 실행, 스크립트 `.agent-runtime/` — 커밋 제외).

## 구현 범위 (소유 파일만 수정)
- `src/pages/Dashboard.tsx` — 레이아웃 JSX·표시 로직만: view별 3종 배치(both/map/stats) 조건부 렌더, `MapSummary` 한 줄 요약, view 전환 시 resize dispatch. 데이터·인증·버전 검사 로직(usePersonalCompare, consistentWithPublic, compareDisabledReason, briefingHidden, pushUrl/share, pickRegion) 의미 변경 없음.
- `src/components/**` — CompareKpis(내 열 skeleton), RegionList(2행 숫자 행·관심 그룹 라벨), MapPanel(compact fallback·범례 스트립·배지·오버레이 정리), ViewControls(스위치·비활성 사유 표시), TopBar(모바일 라벨 클래스), AccountMenu(이름 ellipsis).
- `src/styles/app.css` — 비교 레이아웃·뷰 모드·모바일·테이블·스위치 전량.
- `src/lib/kakao.ts` — 마커 표시만: 링 색을 `--brand-ink`/`--cyan`/`--partial` 토큰에서 읽음. SDK 로딩/좌표/이벤트 계약 유지.
- `docs/reviews/personal-compare-impl.md`, `docs/reviews/screenshots/personal-compare-impl/**`.

## 검수 결과표 (viewport × theme × view, 합성 fixture)
| viewport | theme | steps completed | screenshot | console/network | result |
|---|---|---|---|---|---|
| 1920×1080 | dark | both+토글on, 필터4종, 행클릭, 별, 추이표, 브리핑, 로그아웃 | both-dark-1920.png 外 state-* | error 0, 4xx/5xx 0 | PASS |
| 1920×1080 | light | both+토글on 전수 육안 | both-light-1920.png | error 0, 4xx/5xx 0 | PASS |
| 1920×1080 | dark | map 모드(요약 스트립·지도+지역 2열) | map-dark-1920.png | error 0 | PASS |
| 1920×1080 | dark/light | stats 모드(미니280+확대버튼·2열 그리드) | stats-dark-1920.png, stats-light-1920.png | error 0 | PASS |
| 1440×900 | dark | both 1.2/1 우min380 | both-dark-1440.png | error 0 | PASS |
| 2560×1440 | dark | both 1.5/1 | both-dark-2560.png | error 0 | PASS |
| 390×844 | dark/light | both/map/stats 가로스크롤 0, 토글·세그먼트·하단nav | both-dark-390.png, both-light-390.png, command-390.png, entity-table-390.png | error 0 | PASS |
| 1920×1080 | dark | 로그아웃 공개화면·미설정 토글비활성 | out-dark-1920.png, unconfigured-dark-1920.png | error 0 | PASS |

## 행동 검사표 (27개, Playwright 실측)
| # | 행동 | 결과 |
|---|---|---|
| A1–A3 | 로그아웃 토글로 로그인 카드 → 합성 로그인 → 내 열 표시(31건) | PASS |
| B1 | 지역 행 클릭 → region_code 조건 URL 적용 | PASS |
| B2 | 별 토글 → 새로고침 후 유지(관심 고정) | PASS |
| C | 지점 필터 내 신고 포함 10곳 / 함께 기록 9곳 표시 | PASS |
| D1 | 담당자 행 클릭 → 기관·담당자 조건 칩 URL | PASS |
| D2 | 추이 표 보기 → 내 신고·내 처리완료 열 | PASS |
| D3–D5 | 브리핑 숨김→내 데이터 표시→Esc 복원, 계정명 숨김 | PASS |
| D6 | 로그아웃 → 공개 화면 유지 + 로그인 버튼 | PASS |
| E | `?me=` empty/expired/kakao/suspended/error/rate/stale 전부 공개 유지·문구 §6 일치 | PASS |
| F | `?fixture=one` 표본1건 배지 유지·버전가드, `empty` 렌더 | PASS |
| G1 | Tab으로 switch 도달·Esc | PASS |
| G2 | 390 both/map/stats 페이지 가로스크롤 0px | PASS |

`?me=` 상태 문구 실측: out 로그인 안내 / unconfigured 토글 비활성+사유(공개 정상) / empty 공유없음 안내 / expired 만료+재로그인 / kakao 카카오 요구 / suspended 공유중지 / error 재시도 / rate 60초 재시도 / stale 409 재조회.
console error 0, 4xx/5xx 네트워크 0 (전 매트릭스). 기존 suite: vitest 149 passed / 21 skipped — 회귀 없음.

## 결함 (검수 중 발견·수정 완료)
| id | severity | 재현 | expected | actual | evidence | owner |
|---|---|---|---|---|---|---|
| MUSE-01 | 중 | 390에서 보기 전환 버튼 텍스트 줄바꿈 | 한 줄 세그먼트 44px | 3버튼 찌그러짐 | command-390.png(수정 전) | Muse, 수정됨 |
| MUSE-02 | 중 | fallback에서 범례 스트립 없음 | 키 없이도 구분 표시 | map-bottom 통째 숨김 | legend-marks.png(수정 후) | Muse, 수정됨 |
| MUSE-03 | 중 | 390 기관표 첫 열 1자씩 세로 쌓임 | sticky 명칭열 2~3행 | min-content 압축 | entity-table-390.png(수정 후) | Muse, 수정됨 |
| MUSE-04 | 하 | light 스크린샷이 dark로 찍힘 | 테마별 촬영 | colorScheme만 지정 | 촬영 스크립트 수정, 재촬영 | Muse, 수정됨 |

## 통계·공개 경계
1건(`?fixture=one`): 공개 표본 1건 배지 유지, 개인 비교는 버전가드로 표시 차단+재조회 안내. 0분모: `—`+사유(내 결과 확인 0건). 마스킹: 기존 VehicleTop5 그대로(7*더*4*6 형식, 이번 작업 변경 없음). raw/secret 노출: 개인 응답 localStorage·스냅샷 미저장 유지, 공유 URL에 개인 모드 미포함 유지. 평가·순위 문구 없음(중립 %p). dual-axis 없음.

## 최종 판정
- 합성 fixture 범위: **PASS** (위 표).
- 실지도(Kakao 키 없음): **BLOCKED** — fallback 목록·배지·범례로 동등 탐색 제공, 실 SDK 위 링 표시는 키·운영 세션 없어 미검증.
- 운영 인증·실데이터 내 통계 대조: **BLOCKED** — 합성 로그인 범위만 판정.
- 실행하지 않은 테스트: 실 Kakao SDK 지도 렌더, 운영 Supabase 인증 플로우 — NOT_RUN.

## 남은 문제
없음(이번 작업 범위 내). 390 상단 브랜드명은 공간상 말줄임(인식 가능 수준).

## Sol 요청 (권한 밖 변경 필요 사항)
1. OpenCode 실제 연결 provider/model ID와 contributor variant를 호스트에서 확인·기록해 줄 것 (본문 `MODEL_UNVERIFIED` 상태).
2. 운영 Supabase `202609270100_my_analytics.sql` 적용·`my-analytics` 배포·`MY_ANALYTICS_ALLOWED_ORIGINS` 설정, Kakao provider 리다이렉트 허용, Pages 빌드 변수 — 승인 후 별도 작업.
3. 실 Kakao 지도 키 확보 후 링/점선 링/★ 마커 실측 검수 필요.
4. `community-map-personal-comparison-implementation-prompt.md` 첨부 원문이 호스트에 없어 docs/personal-comparison.md §8 결정 표 기준으로 구현함. 첨부 제공 시 대조 필요.
