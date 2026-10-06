# 로컬 Chrome 검수

- request_mode: 구현 후보 검증. 공개 `screen-v1` DTO 유지.
- 도구: parent Codex의 shell/Playwright-core 1.63.0 (`/tmp/cm-live-browser/node_modules/playwright-core`) + 실제 Chrome 154.0.8037.92. 별도 Muse provider/model 호출은 NOT_RUN이다.
- worktree: `/home/better0101/projects/safetyreport-community-map-precompute`, HEAD `c53d44e`, dirty. 사용자 지시대로 커밋하지 않았다. 후보 파일 SHA는 `evidence/candidate.json`에 기록한다.
- 실행 증거 시각: 2026-10-06 19:25:45~19:26:06 KST (첫 screenshot~최종 results 파일). URL `http://127.0.0.1:5198/`.
- data_mode: 제한 DB의 합성 3.5만 fact SQL export → 실제 screen handler/decoder → Chrome. 인증/RPC 운반/Kakao SDK는 MOCK이다. 운영 Edge·실제 Kakao·Pages 배포 검증이 아니다.

| viewport | theme | steps | screenshot | console/network | 기능 결과 |
|---|---|---|---|---|---|
| 390×844 | dark/light | 최초 로드, KPI 14,643, overflow | `evidence/browser/390-{dark,light}.png` | error 0 / screen 200 | PASS |
| 1440×900 | dark/light | 최초 로드, KPI, overflow | `evidence/browser/1440-{dark,light}.png` | error 0 / screen 200 | PASS |
| 1920×1080 | dark/light | 최초 로드, KPI, overflow | `evidence/browser/1920-{dark,light}.png` | error 0 / screen 200 | PASS |
| 2560×1440 | dark/light | 최초 로드, KPI, overflow | `evidence/browser/2560-{dark,light}.png` | error 0 / screen 200 | PASS |
| 1440×900 | dark | 법규 건수 오름차순, 개인 비교, 전체기간, 패널 버전 일치 | `evidence/browser/1440-dark-sorted-compare-all.png` | error 0 / screen 200 | PASS |
| 1440×900 | dark | heatmap 펼침, 40행×16법규/640 cell, 표 대체 | `evidence/browser/1440-dark-heatmap-table.png` | error 0 / screen 200 | 기능 PASS / 가독성 FAIL |

원 행동 assertions/응답 status는 [results.json](evidence/browser/results.json)에 있다. screen 응답 13개 모두 200이고 콘솔/pageerror는 0개다. 1440 dark, 390 light, heatmap 표 screenshot은 이미지 도구로 직접 열어 확인했다. 전체 화면의 가로 overflow는 없고 KPI/마스킹/차트가 표시된다. 전체 키보드·스크린리더 접근성 및 모든 브라우저 조합은 NOT_RUN이다.

## 결함

| id | severity | 재현 | expected | actual / evidence | owner |
|---|---|---|---|---|---|
| UI-01 | P2 | 1440 dark → 전체기간 → 그래프 펼치기 → 기관×법규 더 넓게 보기 → 표로 보기 | 16법규와 수치가 읽을 수 있는 폭/스크롤로 표시 | 법규명·퍼센트가 한두 글자씩 세로로 줄바꿈됨. `1440-dark-heatmap-table.png` | 기존 heatmap 표 UI 후속 검토 |

이 작업은 UI/CSS를 수정하지 않았다. 동일 데이터의 legacy/v1/new 공개 패킷 일치는 별도 테스트로 확인했으나, 위 가독성 문제의 baseline screenshot 비교는 하지 않았다. 신규 회귀라고 단정하지 않으며 별도 UI 품질 문제로 남긴다.

## 통계·공개 경계와 판정

실제 DOM에서 합성 contributor UUID 및 원 차량번호가 나타나지 않는지 검사했다. 마스킹 충돌/n=1/0분모/날짜 결측/공개 자격은 DB·패킷 테스트 증거를 따르며 이 screenshot만으로 승인하지 않는다.

범위 내 기능 smoke PASS, heatmap 표 가독성 FAIL. 실제 운영 연동과 독립 Muse 검수 NOT_RUN. 이 기록은 포괄적인 UI 승인이나 성능 채택 승인이 아니다.
