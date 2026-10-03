# 월간 UI 검수 보고서 · Muse contributor (initial)
- request_mode: review / policy_version: cm-2026-09-24
- 실제 model/provider: 호스트 확인済 `opencode-go/muse-spark-1.3-contributor` (high subscription, 별도 API 과금 fallback 없음)
- worktree / commit / dirty: dedicated monthly-review-muse worktree / `49c4c6d` (fixed) / 제품 소스 변경 없음 (승인 경로만 기록)
- URL / data_mode / dataset: `http://127.0.0.1:5140/` (root 소유, THIS worktree 서빙) / LOCAL e2e fixture (synthetic + managers) + MOCK Kakao SDK. production/real Kakao/DB 아님
- browser: `/usr/bin/google-chrome 154.0.8037.92` (playwright-core drive, headless, ko-KR)
- JWT: openPage()가 seed한 UNSIGNED synthetic JWT는 로컬 fixture 전용이며 출력·저장하지 않음
- Ranking API: legacy E2E fixture에 없음 — 제품 버그로 기록하지 않음 (사용자 랭킹 7/43 실제 LOCAL DB 검증은 이전 task 완료, root 별도 회귀)

## viewport × theme (실제 스크린샷 열람済)
| viewport | theme | steps | screenshot | console/network | result |
|---|---|---|---|---|---|
| 1920×1080 | dark | KPI·지도·scope·법규·기관·추이·지역 섹션 | R1-*, R2-1920-dark-top | console 0 (part2·probe), routes 정상 | PASS |
| 1440×900 | dark/light | top + entities | R2-1440-{dark,light}-* | 페이지 x-overflow 없음 | PASS |
| 2560×1440 | dark | top + entities | R2-2560-dark-* | x-overflow 없음 | PASS |
| 1920×1080 | light | top + entities | R2-1920-light-top | x-overflow 없음 | PASS |
| 390×844 | dark/light | top + entities, 하단내비 7탭 | R2-390-*-* | 7 tabs 54~56px, overflow 없음 | PASS |
| 360×740 | dark | 하단내비 | R2-360-dark-* | 7 tabs 49/…/56px, overflow 없음 | PASS (타이트, 아래 참고) |

## 통과한 동작 (재현 확인)
- 기간 draft/적용/back: draft 중 KPI 불변 → 적용 시 URL 변경 → back 복원 (R3). 날짜기준 답변일↔신고일 전환 시 추이 제목 변경 (R3-basis)
- 표 종류/검색/정렬/페이징/열선택: 기관→담당자 헤더 전환, `경찰` 검색 (담당자 116명), 정렬 aria-sort 5셀, 1/6→2/6쪽, 열선택 Esc 닫힘 (R4)
- 법규 표 검색·정렬·확장, scope 패널 전국, 지도 핀→장소 패널, 주소 복사 클립보드 (`경기도 수원시 예시로 1길`), 복사 후 포커스 유지 (R7·R8)
- 추이 처리결과 비율 전환, 동명이인 구분 표기 (`같은 이름의 담당자… 김하늘 2명`, R5b 샷에서 확인 — 별도 이슈 없음)
- 맞춤통계 picker: role=dialog·aria-modal=true·labelledby 정상, 검색→체크→적용 칩 반영, 취소 시 파기, export 버튼 존재·통계만들기 잠금 문구 정상 (R10)
- 진짜 0건 scope(세종窄)는 1쪽에서 정확한 empty 메시지 (E3)

## 결함 (재현 가능, 소스 수정 없음 — 이슈만)
| id | severity | 재현 | expected | actual | evidence | file hint |
|---|---|---|---|---|---|---|
| R-STALE-ROWS | medium | 기관·담당자 표 [전체 보기] + `delay(entities 3s)` + 기관→담당자, 로딩 중 캡처 | 로딩 중에는 스켈레톤/이전 조건 표시 유지 (새 헤더 아래 구 종류 행 금지) | 새 헤더·새 캡션(담당자 10명) 아래 구(기관) 종류 행이 `이름 없음`으로 렌더 (stale total + stale rows) — 상단 로딩문구는 표시됨 | E1-midload.png (results3 E1) | `src/components/EntityTable.tsx:165` `rows = list?.items ?? []`, caption total도 동일 원인 |
| R-PAGE-OOB | medium | 담당자탭 `경찰` 검색→전체 보기→마지막 6/6쪽→지역 세종으로 축소 | scope 변경 시 page를 1(또는 끝)로 clamp | pager `6 / 1쪽` + 오해성 문구 `조건에 맞는 기관·담당자가 없습니다` (실제로는 OOB 페이지 요청) | E3b-oob.png (results4) | `src/components/EntityTable.tsx` — scopeKey 변경 시 page reset 없음 (`LawTable.tsx:40`은 reset 있음) |
| R-PICKER-FOCUS | medium | 비교 대상 선택 dialog 열고 search에서 Tab 반복 (≈7회 이내) | `role=dialog aria-modal=true` 안에 포커스 순환 | 포커스가 dialog 밖(body/배경)으로 탈출 — trap 없음 (autofocus만 있음) | E2b-focus-leak.png (results3 E2b) | `src/components/stats/MemberPicker.tsx` (Esc는 :98-107 정상 동작) |
| R-PICKER-IME | medium | picker 검색에 IME 조합 (`compositionstart`→중간 `input`→`compositionend`, 최종값=마지막 중간값과 동일) | 확정된 검색어로 candidates 요청 1건 | 요청 0건: `compositionend`의 `setInput`이 동일값 no-op → debounce effect 재실행 안 됨. 이후 일반 타이핑에는 요청 정상 (=composing 플래그는 해제됨, 핸들러 자체는 동작) | results3 E2 (`during=0 afterCommit=0 afterTyping=1`), R10-picker-search.png | `src/components/stats/MemberPicker.tsx:68-72` — 동일 패턴 `EntityTable.tsx:123-128`, `LawTable.tsx:41-45`도 잠재 동일 (picker만 실증, 표는 코드 리딩) |
| R-PICKER-ESC-FOCUS | low | picker에서 Esc로 닫기 | 포커스가 `비교 대상 선택` 트리거로 복귀 | 포커스가 body로 이동 | results2 R10-esc, R10-picker.png | `src/components/stats/MemberPicker.tsx:98-107` (닫기 시 트리거 focus 복원 없음) |

## 통계·공개 경계
- 1건 표본·0분모·partial month: 기존 스위트 범위이며 이번 회귀에서 깨진 표시 없음. 마스킹 충돌 안내·Excel 다운로드 버튼 존재 확인 (R5b 샷 `엑셀 다운로드`)
- raw/secret 노출: fixture 응답·DOM에서 원번호·토큰·UUID 비노출 (JWT 미출력 준수). `MOCK 지도 · 실제 카카오 지도 아님` 명시 확인

## 작은 UI 개선 제안 (결함 아님)
- 360px 하단내비 7탭(49px/탭, 12px 라벨): 잘림은 없으나 타이트 — ≤360에서 `유저 랭킹` 라벨 단축 또는 아이콘 간격 축소 여지
- 법규 표도 scope 변경 로딩 중 구 total 캡션을 유지 (기관표와 동급 경미 — 헤더가 고정이라 영향은 작음)
- 로딩 중 stale 캡션(`담당자 10명`처럼 새 단위+구 숫자)은 R-STALE-ROWS 수정 시 함께 해결 (구 캡션 유지 또는 스켈레톤)

## 최종 판정
- PASS (범위): viewports/themes/overflow, 기간 draft·apply·back, 날짜기준, 표 기본 조작, scope/place/복사, picker 적용·취소·export affordance, 동명이인, 안내 문구
- FAIL (범위, 수정 불필요·이슈 기록): 위 5건 (medium 4 + low 1). 소스 수정은 하지 않았으며 root/통합 담당으로 넘김
- NOT_RUN: 429/offline/stale-dataset Menus (기존 LD 스위트 커버), 실제 Kakao SDK·운영 Supabase (BLOCKED 아님, fixture 범위 명시)
- 실행하지 않은 테스트를 PASS로 표기하지 않음. 증거: `docs/implementation/monthly-review-20261003/evidence/muse-initial/` (review.mjs·review2.mjs·probe3.mjs·probe4.mjs, results{,2,3,4}.json, shots/ 40+)

## Sol 통합 주석
실제 세션 export에서 worktree 및 provider/model/high를 확인했다. 초기 2560 light는 Muse 미실행이며 Sol이 별도로 실행한다. ‘UUID 비노출’ 문장은 앱 계정 UUID chip까지 확인한 증거가 아니며, 익명화 전체 보증으로 해석하지 않는다. 표시용 본인 UUID는 기존 계약상 허용된다. API의 원문/secret whitelist 경계는 별도 단위 검사를 기준으로 한다. R5/R5b 및 E3 최초 탐색의 ok 값은 결함 미재현이므로 PASS 승인 근거로 쓰지 않는다. 최종 분리 probe3/probe4와 root before 결과가 결함 근거다.
