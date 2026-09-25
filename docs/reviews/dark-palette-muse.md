# Dark palette final review · Muse Spark contributor
- request_mode: review / policy_version: cm-2026-09-24
- 실제 model/provider / 확인 근거: Muse 자체 보고 시점에는 MODEL_UNVERIFIED였으나, Sol이 종료 후 `opencode export ses_f28e733feffelfdoBWD1jm9igq`로 `info.model={providerID:opencode-go,id:muse-spark-1.3-contributor,variant:default}`와 이 검수 worktree 경로를 확인했다.
- worktree / commit / dirty: /home/better0101/projects/safetyreport-community-map-dark-palette-review / b66c8ca8b843d1c3b5659f6b56510e94d9b5b76c / clean (git status 무출력)
- URL / data_mode: http://127.0.0.1:4182/ / synthetic demo fixture (demo · 합성 데이터, KPI 9건/7건/83.3%/2건/3곳/4개)
- browser/tool: Google Chrome 154.0.8037.57 (실기동, playwright-core 1.63.0 launch, executablePath /usr/bin/google-chrome), node v22.17.1
- 범위: deep-dark 팔레트 정렬 커밋 b66c8ca (safetyreport dev 2f20f2e contracts/dark-palette.json 대응). 제품·패키지·호스트 파일 미수정. 본 보고서와 docs/reviews/screenshots/dark-palette-muse/**만 작성.
- 기준 문서: AGENTS.md, MUSE.md, PROJECT_RULES.md, docs/ui-spec.md, docs/screen-by-screen.md, design/reference-ui/index.html(브라우저 실확인), .agents/skills/cm-browser-review/SKILL.md, design/references/family-pc-dark.png(열람).

## Palette verification (computed, dark)
| token | spec (ui-spec §4 / tokens.json) | browser computed | match |
|---|---|---|---|
| --bg | #0b0b0c | #0b0b0c (body rgb 11,11,12) | PASS |
| --surface | #131314 | #131314 (.cm-panel bg rgb 19,19,20) | PASS |
| --raised / --raised-high | #1b1b1c / #232324 | #1b1b1c / #232324 | PASS |
| --border | #2d2d2f | #2d2d2f | PASS |
| --text / --text-secondary / --muted | #f3f3f4 / #c7c8ca / #9ea0a4 | 동일 | PASS |
| --link / --brand-ink / --brand(fill) | #60a5fa / #60a5fa / #2563eb | 동일 (차트 신고선·legend dot·KPI top accent에 적용 확인) | PASS |
| rail --sidebar-bg/active/text/muted | #050505 / #1e1e20 / #e2e2e4 / #84868a | rgb(5,5,5) / rgb(30,30,32) / #e2e2e4 / #84868a | PASS |
| light theme (회귀 확인) | bg #F8FAFC 등 | #f8fafc/#fff/#f1f5f9/#0F172A, rail 흰색 | PASS |

## Viewport × theme
| viewport | theme | steps | screenshot | console/network | result |
|---|---|---|---|---|---|
| 1920×1080 | dark | 로드·KPI6·fallback 목록·인사이트·차트·표·TOP5目视 | vp-1920x1080-dark(-full).png | console 0, ≥400 0 | PASS |
| 1440×900 | dark | KPI 6열 유지, 제목/분모 잘림 없음 | vp-1440x900-dark(-full).png | 0 / 0 | PASS |
| 2560×1440 | dark | 6 KPI, 지도+우측패널, 하단 3카드+표 | vp-2560x1440-dark(-full).png | 0 / 0 | PASS |
| 390×844 | dark | 상단56·bottom nav·KPI 2열·지도420계열·bottom sheet | vp-390x844-dark(-full).png | 0 / 0 | PASS |
| 1920×1080 | light | 전체 밝기 전환, 잔류 dark 없음 | vp-1920x1080-light(-full).png | 0 / 0 | PASS |
| 1440×900 | light | 동상 | vp-1440x900-light(-full).png | 0 / 0 | PASS |
| 2560×1440 | light | 6 KPI·지도+우측384·하단카드, 흰 rail, 토큰 light 일치, scrollW==clientW==2560 | vp-2560x1440-light(-full).png | 0 / 0 | PASS |
| 390×844 | light | 동상 | vp-390x844-light(-full).png | 0 / 0 | PASS |
| reference-ui | dark/light | 기준판 실렌더링, 후보와 팔레트 일치 | reference-ui-dark/light-1920.png | — | PASS (참조용) |

## Interactions (1920 dark, 실브라우저)
| 기능 | 재현 | evidence | result |
|---|---|---|---|
| 테마 토글 | dark→(클릭)→light 확인. 버튼은 dark→light→system 3순환(TopBar.tsx:15)이므로 2번째 클릭은 system(헤드리스=light 상당). 오동작 아님 | interact-theme-toggled.png | PASS |
| 상세필터 drawer | 열림(400×1080, bg #131314, 입력·셀렉트 가독) → Esc에 dialogs 0/drawers 0/backdrop 해제 | dark-drawer-1920.png, dark-drawer-after-esc.png, dark-followup.json | PASS |
| 기간 선택 | 기간 버튼→퀵레인지+date input 2개+적용 popover, draft 분리 문구 표시 | interact-period.png(라이트 상태에서 취득, dark 동일 컴포넌트) | PASS |
| 차트 툴팁 | sweep hover → "2026.09 / 신고 접수 4 / 처리완료 3" dark 툴팁 표시. 선 #60a5fa+cyan, 축 muted 가독 | dark-chart-tooltip2.png | PASS |
| 차트/표 전환 | 표로 보기 → 월·신고접수·처리완료·과태료·데이터범위 표(결측 '—' 캡션) | interact-chart-table.png | PASS |
| 키보드 포커스 | Tab 이동 시 버튼에 파란 focus 링(다시 시도/차량02 기준 버튼) | dark-keyboard-focus2.png, interact-keyboard-focus.png | PASS |
| 가로 오버플로 | 전 viewport scrollW==clientW. 390 표는 내부 스크롤(sw805>cw356, page 390=390) — spec §3 패턴대로 | viewport-results.json, mobile-overflow.json, mobile-table 로그 | PASS |

## 결함
| id | severity | 재현 | expected | actual | evidence | owner | 판정 |
|---|---|---|---|---|---|---|---|
| DP-01 | — | 실지도 로드 시도 (Kakao JS 키 미설정) | 실제 Kakao 지도 | "실지도를 불러오지 못했습니다" 카드 + 지점 목록 대체 탐색, 타 통계 정상 | vp-*-dark.png, interaction-log.json mapState | Sol (키/도메인 승인 필요) | BLOCKED (기존 known, 테마 회귀 아님. live Kakao 미검증 주장 안 함) |

테마 회귀 FAIL 없음. 위 표 이외에 기록할 렌더링·가독성·조작 결함이 없다면 "없음"을 명시한다: 없음.

## 통계·공개 경계 (fixture 기준)
- 마스킹: TOP5 `1*가*4*6` 형태, 캡션 "지역명 제외 후 2·4·6번째 글자 마스킹" 유지. 충돌 행 분리 표기(r1~r4) 확인.
- 원좌표: 지점 목록에 6자리 좌표 + "원좌표 그대로" 표기, URL·노출 이상 없음(네트워크 ≥400 0건, 외부 스크립트 호출 없음).
- 1건 표본: 제주 예시 지점 "신고 1건" 행·카드 유지. 가짜 0 없음. 결측월 '—' + "선을 연결하지 않습니다" 캡션.
- 분모·날짜기준: 신고=신고일 / 처리·처분=처리완료일 칩이 KPI·차트·표에 유지. 비교기간 문구 유지.

## 최종 판정
- dark-palette 범위: PASS (8셀 전부: 4 viewport × dark/light, 토글·drawer·기간·툴팁·표전환·포커스·Esc, 토큰 일치, console/network 무결함)
- live Kakao 지도: BLOCKED (키 미설정 — 기존 사유, 본 커밋과 무관)
- 실행하지 않은 것: 브리핑 모드 전환, 실제 백엔드/live 데이터, 실기기 터치 — NOT_RUN

## Sol 결과 회수
- `opencode export ses_f28e733feffelfdoBWD1jm9igq`의 `info.directory`는 `/home/better0101/projects/safetyreport-community-map-dark-palette-review`, 모델은 위의 실제 provider/model/variant였다. 두 번째 누락 셀 검수도 같은 세션 `-s`로 재개했다.
- 제품 후보는 고정 커밋 `b66c8ca`다. 현재 주 작업트리의 이번 테마 관련 8개 파일이 후보와 byte 단위로 같음을 `cmp`로 확인했다. 주 작업트리에 먼저 존재하던 API·문서 변경은 이 UI 후보의 범위 밖이다.
- 실 Kakao 키와 운영 API가 없는 fixture 검수다. 이번 배색의 브라우저 판정은 PASS, 실지도와 운영 데이터는 기존 BLOCKED 상태다.
