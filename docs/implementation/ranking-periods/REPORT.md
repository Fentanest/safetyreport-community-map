# 유저 랭킹 기간 확장 · 2026-10-03

기준 `dev` 6132e4b, 작업 `feat/ranking-periods`. 기존 main 8cfacb2와 이전 랭킹/월간 개선을 보존했다.
제품 후보는 97605a5다. 이번 변경은 로컬 구현이며 운영 SQL·Edge·Pages 적용, push, 계정 설정 변경은 하지 않았다.

## 화면과 지표

기존 ‘유저 랭킹’ 페이지에 다음 진입점을 제공한다.

| 누적 · 기간별 | 월별 |
|---|---|
| 최다 신고자 | 월별 최다 신고자 |
| 최다 과태료 수용자 | 월별 최다 과태료 수용자 |
| 최다 불운자 | 월별 불운자 |

세 테마 모두 전체 기간·직접 범위·월별을 지원한다. 월별 기본은 KST 이번 달이며 집계 중이라고 표시한다.
2023년 7월을 선택하면 제목도 해당 연월로 바뀌고 월별 테마를 바꿔도 선택월·날짜 기준·분류·표본을 유지한다.
기간 제한이나 임의 최소 10/30/100건 조건은 추가하지 않았다. 열람 gate의 고유 공유 10건과 순위 표본 기본 1건은 별개다.
월별 조회는 현재 접근 가능한 공유 완료 신고를 조회하며 당시 전체 활동이나 철회된 공유 자료를 복원하지 않는다.

| 지표 | 정의 |
|---|---|
| 신고 건수 | N = 선택 날짜·분류의 사용자별 중복 제거 완료 신고 수 |
| 과태료 건수 / 처분율 | F = 수용·일부수용 중 실제 disposition=fine; F / N × 100 |
| 불수용 건수 / 비율 | R = rejected; R / N × 100 |
| 일부수용 건수 / 비율 | P = partial; P / N × 100 |

N은 accepted/partial/rejected/completed_unknown을 포함한다. 단순 수용·경고·벌점·추정 금액은 F가 아니다.
금액 없는 실제 과태료는 F에 포함한다. 모든 분자와 분모는 같은 선택 날짜 기준의 같은 신고 집합을 사용한다.
기본 답변일, 신고일 선택 가능. 비율 옆에 분자/분모를 표시하고 결과 미상·선택 날짜 결측·처분 모순 진단을 유지한다.
완료 0건은 비율 참가자가 아니며 `me=null`이다. 정확한 분수 정렬, 공동순위, 큰 분모·UUID 보조 정렬도 유지한다.

실제 화면: [과거월 PC](evidence/browser/july-fines-rate.png), [모바일 light](evidence/browser/390-light-july.png),
[모바일 dark](evidence/browser/390-dark-july.png), [누적 불운자](evidence/browser/cumulative-unlucky.png),
[글꼴 200%](evidence/browser/390-light-font200.png).
확대 화면에서 제목의 고정 px 줄 간격이 좁아지는 것을 확인해 상대 줄 간격으로 수정했다.

## 실제 데이터 경로와 API

기존 ingest가 `private.community_report_facts`에 저장한 관측을 사용한다.
활성 `community_consent_grants`, contributor_profiles, auth.users/identities를 확인한 뒤
`private.ranking_representatives()`가 **사용자 범위 → report identity → 대표 관측**을 선출한다.
같은 사용자의 PC·모바일·복원·재업로드는 같은 identity당 1건이며 다른 사용자가 같은 신고를 공유하면 각자의 기여에 1건이다.
다른 사람의 결과로 덮지 않으며 주소·차량번호·좌표로 서로 다른 신고를 합치지 않는다.

대표를 먼저 선출한 뒤 선택 날짜·분류를 적용하고 사용자별 N/F/R/P/unknown을 집계한다.
`public.internal_user_rankings(uuid,uuid,jsonb)`가 전체 후보 정렬·공동순위·페이지·JWT 사용자의 전역 내 순위를 반환한다.
브라우저/Edge 전량 원문 로딩, 기존 fact-loader 상한, 월별 TOP 합치기를 사용하지 않는다.

정본 [API 계약](../../../contracts/user-rankings/README.md):
`GET /functions/v1/user-rankings`, 기존 세 theme와 일곱 metric, `period=all|range|month`,
month/start/end/date_basis/category/min_reports/page/page_size≤50/expected_version.
기존 `user-rankings-v1` DTO와 whitelist는 유지한다. 누적 불운자는 `theme=unlucky&period=all`,
2023년 7월은 세 theme 모두 `period=month&month=2023-07`로 조회한다.

카카오·현재 동의/공유 자격·고유 공유 10건을 매 요청 서버에서 확인한다. 본인 UUID/세션은 검증 JWT에서만 가져온다.
UUID와 허용 집계만 응답하며 원문·신고번호·identity·dataset key·차량번호·좌표·카카오 ID·연락처·토큰은 반환하지 않는다.
타인의 my-reports나 비공개 상세 진입은 추가하지 않았고 private 직접 권한도 유지한다.
RPC는 SECURITY DEFINER, 빈 search_path, 입력 검증, service_role만 실행, 기존 work_mem/timeout 설정이다.

영구 캐시 없이 한 DB snapshot에서 집계한다. 전체 후보·scope·진단·page_size의 버전이 바뀌면 후속 페이지는
409 DATASET_CHANGED로 거절한다. 철회·삭제·정지·대표 갱신은 다음 요청에 반영된다.
HTTP no-store와 logout/pagehide/복귀 재검증, 400/401/403/409/429/503 오류 및 rate limit 정책은 그대로다.
`rk_*` URL 상태는 지도·다른 통계와 분리하고 직접 진입·새로고침·라우트 이력에서도 유지한다.

## 실행한 검증

모두 **로컬 Supabase/GoTrue/PostgREST 및 합성 fixture**다. 운영 자료를 조회하지 않았다.
[명령·결과 기록](evidence/verification.json)과 아래 증거를 제공한다.

| 검사 | 결과 |
|---|---|
| 전체 Vitest, maxWorkers=2 | 609 PASS / 100 조건부 skipped |
| 실제 DB 집계·권한 | 13 PASS: 기존 중복/계보/처분/동률/삭제 검사와 2023-07 공통 모집단, 누적 불운자, 대표가 다른 달로 이동, 범위 동등성, 날짜 기준, 월말·연말·윤년·버전 경계 |
| 실제 Edge index → GoTrue/PostgREST | 2 PASS: 세 월별 테마·누적 불운자·JWT/gate·whitelist·no-store |
| 최종 계약·기간 단위 | 17 PASS |
| 실제 Chrome 확장 동작 | 89 PASS: 1440/1920/2560/390 × light/dark, 동일 월·각 지표·분수·페이지·내 순위·현재/과거 제목·날짜 기준·이력·키보드·실제 글꼴 200%; [기록](evidence/browser/result.json) |
| 기존 랭킹 회귀 | 43 PASS: UUID 복사·표본 1건·빈 상태·429/503/409·철회·게이트 등; [기록](evidence/regression/result.json) |
| 대비·포커스·보호 응답 | 7 PASS: 실제 대비≥4.5, 텍스트200%, 익명 테마, 로그아웃 후 서비스 이력 back에서 표 제거; [기록](evidence/accessibility/result.json) |
| Pages 하위 경로 | 과거월 fine_rate 직접 진입·refresh·자산·본인 행·너비 PASS; [기록](evidence/subpath/result.json) |
| build/scan/Deno/manifest | PASS, 정본 migration33 / function7, auth 저장소 읽기만 함 |

일반 병렬 실행에서 기존 인증 클라이언트 검사 두 개가 5초 제한에 걸렸다. 같은 전체 suite를 maxWorkers=2로 다시 실행해
609개가 통과했고 제한 시간을 늘리거나 검사를 삭제하지 않았다. 100 skipped는 해당 로컬 환경 변수를 요구하는 기존 통합 등이며 운영 통과가 아니다.
회귀 검사의 의도한 429/503/409/403 콘솔 메시지는 JS 오류와 구분했다. 확장 검사의 JS/콘솔 오류는 0이다.
지도 인접 화면은 합성 map facts/모의 Kakao SDK다. 기존 숨겨진 ECharts 초기화의 경고를 실제 지도 연동 성공으로 해석하지 않는다.
하위 경로에서 외부 광고 iframe의 두 net::ERR_ABORTED는 인증 전환/새로고침 취소로 별도 기록했다. 자산·랭킹 오류는 제외하지 않았다.

50만 고유 신고(중복 관측 포함 60만, 합성 사용자1000)의 확장 기간 재측정 **PASS**.
월별 신고자/과태료는 동일 범위 조회와 일치했고 월별·누적 일부수용 비율의 상위 분수/순위도 일치했다.
건수 공동1위1000명, 두 페이지 UUID100개 중복 없음, 비율491/500 공동1위20명과 다음21위,
페이지 밖 본인1001위, 동의 철회 후 해당 월980명을 확인했다. 누적 참가자1005명은 fixture1000명·검수 로그인1명·기존 로컬4명이며
기존 계정은 삭제하지 않았다. 첫 실행의 새 고정 참가자 수 assertion 실패(1005/1001)를 기록하고 같은 누적 모집단 비교로 수정해 재실행했다.

[측정값](evidence/500k-measurements.json), [EXPLAIN/auto_explain](evidence/500k-plans.txt).
RPC 시간7.28–8.25초(신규 네 조회7.53–8.25초), 응답5.5–13.2KB, DB backend 최대RSS330528KiB(약323MiB).
RSS는 shared page/cache를 포함해 쿼리 독점 메모리가 아니다. work_mem32MB는 연산별이며 sort는 약96–163MiB temp disk,
hash는 약57MiB를 사용했다. grant/owner/fact PK/profile/auth 기존 인덱스 경로를 확인했고 신규 인덱스는 추가하지 않았다.
고유 신고50만과 중복 관측10만은 트랜잭션 rollback했고 검수 로그인 계정도 정리했다. 기존 로컬 자료는 보존한다.
운영 동시성이나 지연 보증이 아니며 SQL 계획에 로컬 검수 UUID/세션도 남기지 않도록 치환했다.

## Muse와 적용 절차

Muse 구현은 별도 worktree에서 소유 UI 두 파일과 증거만 변경했다. 구현31fc690을 e9e5d65로 통합했다.
구독 OpenCode `opencode-go/muse-spark-1.3-contributor`, high, 세션 `ses_eff7738d8ffe2LslA7uTOJKZFh` export에서
실제 provider/model/variant와 directory를 확인했다. [구현·실제 브라우저 40검사](../../reviews/ranking-periods-muse-implementation.md).
최종 고정 후보97605a5 검수는 별도 detached worktree에서 **89/89 PASS**, JS/콘솔 오류0, 12개 화면 실제 열람을 확인했다.
[최종 Muse 보고](../../reviews/ranking-periods-muse-final.md), [network/행동 증거](evidence/muse-final/result.json).
세션 `ses_eff5d5bbaffedxhWL95CjfsFJt` export에서 실제 provider/model/high/directory를 확인했다.
초기 보고의 ‘12개 모두 열람’은 실제 10개 열람이어서 그대로 승인하지 않고 같은 세션의 후속 검수로 나머지 두 개를 열었다.
수정 보고와 export에서 실제 12/12 열람을 확인했고 소스 변경 없이 회수했다. Muse는 수치 대비 검사를 했다고 주장하지 않으며
수치 대비·로그아웃 등은 위 Sol의 7검사로 별도 확인했다.
원시 세션 export/credentials는 커밋하지 않는다.

추가 migration [202610030200_user_ranking_periods.sql](../../../supabase/migrations/202610030200_user_ranking_periods.sql)은
기존 RPC를 CREATE OR REPLACE하고 불운자의 월 전용 조건만 해제한다. 대표 선출/집계/권한·기존 원문 구조는 바꾸지 않는다.
**로컬 DB에는 적용했으며 운영에는 적용하지 않았다.** 새 Edge 함수 이름을 추가할 필요는 없고 기존 user-rankings를 갱신해야 한다.

운영 반영 순서(준비만 함): 선행 composed migrations → 202610030100(미적용 시) → 202610030200 →
갱신 user-rankings Edge 계약 → 게이트/숫자/철회·버전 smoke → Pages live build·scan·배포.
기간 확장만 롤백할 때는 이전 Pages/Edge와 030100의 RPC 정의·grant만 복원한다. 030100 전체 재실행이나 자료 초기화는 하지 않는다.
세부 재현과 적용 안내는 [docs/user-rankings.md](../../user-rankings.md)에 있다.

운영 데이터·SQL/EXPLAIN/동시 부하, 실제 Kakao OAuth/SDK, hosted Edge/Pages, 스크린리더·실기기/OS 큰 글꼴은 미검증이다.
로컬 Chrome154 검사나 합성 부하를 운영 배포 성공·운영 성능 보증으로 주장하지 않는다.

검수용 계정/서버를 정리하고 임시 Muse 구현·검수 worktree의 로그/스크래치는 ignored `.agent-runtime/archive/`에 보존한다.
제품 소스는 고정 검수 커밋과 동일하며 뒤의 커밋은 문서·증거 정리다.
