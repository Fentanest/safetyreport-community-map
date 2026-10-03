# 최근 한 달 검토·수정 · 2026-10-03

대상 `Fentanest/safetyreport-community-map`. 검토 기간 2026-09-03~2026-10-03 (KST).
`origin/main` fetch 결과 `8cfacb2`, 시작 `feat/user-rankings`의 `49c4c6d`는 main보다 5커밋 앞서고 뒤처짐0이었다.
최초 미커밋 변경 없음. 기존 랭킹 작업을 보존한 `fix/monthly-audit-20261003`에서 수정했다.
1차 제품 후보 `c99bee6`, 교차 표 접근성 보완을 포함한 최종 제품 후보 `27de7f3`. 증거·문서 추가 커밋은 후보의 제품 소스를 바꾸지 않는다.

## 검토 범위와 수정

지난달의 단일 날짜 집계·내 신고/공개 경계, 기관·담당자/법규 목록과 정렬, 지도 범위/장소 패널,
맞춤 통계·기간 이력·테마·반응형 UI, 최근 유저 랭킹을 살폈다. 모든 과거 커밋을 전수 검증했다는 뜻은 아니다.
AGENTS/PROJECT_RULES/SOL/MUSE, MASTER_PROMPT, 최신 product decisions, public-api-contract, my-reports,
UI/screen/reference와 관련 계약·보안·브라우저·Muse·release 스킬을 확인했다.

| 문제 | 재현/영향 | 수정 및 검증 |
|---|---|---|
| 한글 조합 확정 후 검색 누락 | 조합 중 입력된 최종값과 compositionend 값이 같으면 상태 변경이 없어 검색0회 | 조합 여부도 React 상태/효과 의존성으로 관리. 기관/법규/범위 목록/선택창에서 조합 중0회, 확정 후1회 |
| 새 기관/담당자 헤더 아래 이전 종류·수치 | 전체보기에서 종류·필터/정렬/페이지를 변경, 지연/503 시 이전 행과 합계 유지 | 범위·버전·종류·질의·페이지크기·재시도 키가 일치하는 응답만 표시. 미완료 합계를0으로 확정하지 않음 |
| 법규 검색·범위 변경 때 이전 행 | 응답에 key가 있었으나 표시할 때 무시 | 응답 key와 현재 요청 key 대조; 재조회 시작 시 이전 행 제거 |
| 좁은 범위에서 이전 페이지 유지 | 담당자6쪽에서 범위를 축소하면 `6 / 1쪽`과 거짓 빈 결과 | 범위/버전 변경 때 첫 페이지로 조정한 뒤 요청. 검색·정렬 설정은 유지 |
| 오류를 빈 결과로 표시/재시도 부재 | 법규503 뒤 ‘맞는 법규 없음’ 표시 | 오류·로딩·성공0건 분리, 법규와 선택창에 같은 질의 재시도 |
| 선택창 키보드 포커스 이탈·복귀 누락 | Tab으로 배경 진입, Esc 후 body로 포커스 이동 | Tab/ShiftTab 순환, IME 중 Esc 무시, 닫힐 때 호출 버튼 포커스 복원 |
| 선택창 요청 변경 때 구 후보 사용 | 검색·종류/범위 변경 중 구 목록/분류 수치 사용 가능 | 후보·합계·다음커서·선택 진단 수치를 재조회 시작 시 비움; 적용 전 선택 초안 유지 |
| 범위 패널에서 구 서버 목록 사용 | 새 범위/검색에 이전 페이지 응답 섞임 | 같은 범위·버전·종류·검색의 행만 재사용. 같은 모집단의 ‘더 보기’ 로딩은 이전 행 유지 |
| 통계 숫자 셀의 마우스 전용 좁히기 | 클릭 가능한 td가 키보드로 조작되지 않음 | 행·열·지표·수치를 설명하는 실제 button; Enter/Space로 동일한 좁히기 동작 |
| 통계 정렬 ARIA 위치 오류/페이지 잔류 | button에 aria-sort, 새 결과에도 이전 페이지 | 실제 열 머리글에 aria-sort, 결과/정렬 변경은 첫 페이지부터 |
| 큰 정수 분수 정렬의 거짓 동률 | 1000000000/1000000001과999999999/1000000000의 교차곱 차이1이 Number에서 손실 | 안전한 정수 피연산자의 큰 교차곱은 BigInt로 비교. 작은 교차곱/소수 중앙값·평균은 기존 숫자 경로. 양방향·진짜 동률·null·소수 회귀 |

최소 표본·분모·날짜 축은 기존 계약에 따라 계산한다. 공개 응답과 본인 원문 권한은 기존 서버 경계를 사용한다.
DB/RPC/Edge API 변경은 없고 migration이 필요하지 않은 UI·공통 비교기 수정이다.
실제 집계 경로는 기존 private 계보/대표 선정을 사용하는 서버와 랭킹 RPC이며, UI에서 원문 전체를 재집계하지 않는다.

## 실행 결과

- 기준선 전체 단위: 599 PASS /96 SKIP, build PASS.
- 수정 후 기본 전체 단위: 601 PASS /96 SKIP. 반복 실행1회에서 기존 동명이인 API 테스트의5초 timeout이 발생했다(600 PASS/1 FAIL).
  브라우저·build·다수 테스트 worker가 겹친 실행이며, 최종 `npx vitest run --maxWorkers=2`:601 PASS/96 SKIP(51파일PASS/11파일SKIP). 최종27de7f3에서도601 PASS/96 SKIP,37.62초. timeout을 늘리거나 실패를 삭제하지 않았다.
- [수정 전 재현](evidence/before/results.json): 14검사 중9실패. 빈 결과/오류와 포커스/IME가 코드 읽기만의 추측이 아님을 확인했다.
- [수정 후 브라우저](evidence/after/results.json): 최종27de7f3에서도39 PASS. Google Chrome154, 실제 React와 publicHandler/personalHandler over 합성 facts, MOCK Kakao SDK.
  1920/1440/2560/390 × light/dark, 390px 실제 computed font2배, 검색/페이지/재시도/좁은 범위/Tab/Esc/Enter.
  의도한503 콘솔2건, 예상 밖 JS/콘솔 오류0. 최초 확대 검사에서 문자열 앞 공백 때문에 페이지2 assertion이 실패해 wait/trim으로 검사기를 보정했다.
- [랭킹 회귀](evidence/rankings-regression/result.json): c99bee6에서43 PASS. 이후27de7f3의 변경은 통계 교차 표 머리글뿐이다. 실제 로컬 Postgres 테이블/RPC 및 GoTrue JWT, 생성한 합성 사용자/신고, Node의 실제 handler.
  전역 내 순위·페이지·과태료/일부수용·표본1·이전 달·UUID 복사·429/503/409/403·철회·익명·refresh/back·지도 필터 보존.
  의도한4개 HTTP 오류만 콘솔에 남았고 local fixture 계정은 cleanup했다. 운영 사용자 자료로 검증한 결과가 아니다.
- [통계 페이징·Space·ARIA](evidence/pivot-paging/result.json):6 PASS, 담당자118명2쪽→정렬1쪽→새 작은 결과1쪽, Space좁히기, 교차 표 합계 열의 단일 정렬 ARIA, JS/콘솔 오류0.
- 실제 public-analytics Deno import/type check PASS(기존 user-rankings의zod import-map 사용).
- 최종27de7f3 TypeScript/Vite build PASS, 공개 dist scan PASS. 기존 >500kB chunk 및 ineffective dynamic import 경고는 남아 있다.
- 원본 [검사 요약](evidence/verification.json), 기본병렬 재실행 timeout도 기록했다.

[Muse 초기 보고](../../reviews/monthly-review-muse-initial.md): 별도 고정49c4c6d worktree, OpenCode 구독
`opencode-go/muse-spark-1.3-contributor` high, session `ses_effb4025fffefAJzy4ll1Mr5da`.
export의 실제 provider/model/variant/worktree를 확인했다. 초기5이슈를 독립 재현했고 source는 root만 썼다.
원문 보고의 초기 probe ok는 전체 승인으로 보지 않으며 후속 probe3/4의 재현을 근거로 삼는다.
[Muse 재검수](../../reviews/monthly-review-muse-final.md): 고정c99bee6, session `ses_effa3f575ffeflFJt16gSvgBw7`, 같은 provider/model/high.
최초54검사에서52 PASS/2 FAIL. 후속 probe로 ‘없는 검색어의 재시도 후 결과>0’ assertion을 보정해 재시도 동작은 확인했다.
남은 실제 결함은 열 축이 있는 통계 표의 정렬 ARIA 미노출이었다. 행 합계 기준 정렬이므로27de7f3에서
선택 지표·주 모집단의 합계 열1개에 정렬 상태를 표시하고 합계 머리글에서도 정렬을 조작하도록 보완했다.
개별 교차 열에 같은 aria-sort를 반복하지 않는다. [Muse 최종 보완 검수](../../reviews/monthly-review-muse-aria.md): 고정27de7f3, session `ses_eff9c4a33ffeLwz7sJKtUd6Y1a`,
실제 provider/model/high/worktree export 확인. 단일 합계 열 ARIA·asc/desc 행순서·전체/내 비교·Enter/Space·합계 보존·2px키보드 focus,
1440/390 light/dark 실제 화면 검증으로 마지막 항목 CLOSED, 예상 밖 콘솔/JS오류0.
최초 probe의3 FAIL은 앞 표에서 이어진 정렬방향과 포인터 focus를 기대한 검사 오류였다. fresh+keyboard probe에서8/8 PASS,
원본 FAIL파일도 보존했다. 이 검수는 교차 표 보완 항목에 한정되며54개 전체를 다시 실행한 것처럼 보고하지 않는다.
초기 /tmp helper 쓰기는 도구가 거부해 승인된 evidence 경로로 복구했다. global permissions 변경은 하지 않았다.

## 미검증 및 적용 범위

운영 Supabase·호스팅 Edge·실제 Kakao SDK·Pages 운영 화면은 이번에 호출/배포하지 않았다.
96 SKIP은 opt-in 실제 통합/성능 검사이며 601 단위 PASS에 포함하지 않는다.
지난 랭킹 작업의50만 성능 측정은 이번에 재실행하지 않았다. 이번 랭킹43브라우저 검증은 실제 LOCAL DB이고
대시보드 지도/통계39검증은 synthetic/MOCK이다. 전체 서비스의 무결점·운영 성능 보증은 하지 않는다.

UI 코드는 기존 라이트/다크 토큰·레이아웃을 사용한다. Muse 최종 판정은 단계별 보고서·증거를 보존해 별도 첨부한다.
향후 승인된 릴리스는 이 커밋의 build/scan/하위 경로 검사 후 Pages를 올리는 순서다.
이번 수정 자체에 운영 SQL/Edge 적용 단계는 없으며 기존 미배포 랭킹 migration/Edge/Pages 순서는
[랭킹 적용 문서](../../user-rankings.md)를 따른다. 운영 SQL 적용·Edge/Pages 배포·계정 설정·push는 실행하지 않았다.

## 재실행

```sh
npm test
npx vitest run --maxWorkers=2
npm run build
python3 scripts/scan_public_dist.py --dir dist
# 로컬 fixture 서버 (운영 아님)
E2E_PORT=5190 npx vite --config scripts/browser/vite.e2e.config.ts
node scripts/browser/verify_monthly_review.mjs
node scripts/browser/verify_monthly_paging.mjs
# 실제 로컬 Supabase가 이미 구동·migration 적용된 경우만
npx vite --config scripts/browser/vite.rankings.config.ts
node scripts/browser/verify_rankings.mjs docs/implementation/monthly-review-20261003/evidence/rankings-regression
# 브라우저 종료 후 GET /__rankings/cleanup 로 해당 합성 계정만 정리
```

브라우저 helper 두 개는5190 fixture 컨트롤을 공유하므로 순차 실행한다. Muse 검수는 독립5140/5141 서버를 사용했다.
원문 사용자 자료·JWT·secret·session export는 evidence 또는 build에 저장하지 않는다.
