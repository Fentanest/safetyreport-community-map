# UUID 유저 랭킹 구현 결과 · 2026-10-03

대상 `Fentanest/safetyreport-community-map`, 기준 main `8cfacb2`, 작업 브랜치 `feat/user-rankings`.
최초 미커밋 변경 없음. main fetch 및 `git pull --ff-only origin main` 완료(Already up to date).
추가형 DB migration, 실제 원천에 연결한 집계 RPC, 인증 Edge API, 페이지, 테스트를 구현했다.
운영 SQL 적용·Edge/Pages 배포·계정 설정 변경·push는 실행하지 않았다.

## 화면과 지표

기존 내비게이션 **유저 랭킹**, 직접 경로 `?screen=rankings`. 기존 라이트/다크 토큰·인증·라우팅을 사용한다.
지도와 통계의 조건을 유지하면서 독립된 `rk_*` URL 조건으로 테마·지표·날짜·분류·기간·최소 표본을 적용한다.
본인 전체 순위 요약, 공동 순위, UUID 전체 확인/복사, 본인 ‘나’ 강조, 20행 페이지 조회를 제공한다.
모바일에서는 UUID를 줄이고 전체 UUID는 펼쳐 확인한다. 다른 사람 원문 상세 링크는 없다.
로그인·공유 자격 미충족, 로딩, 결과 없음, 본인 표본 없음, 429 대기, 오류·재시도·자료 변경 재시작을 구분한다.

| 테마 | 지표 |
|---|---|
| 최다 신고자 | 완료 신고 N |
| 최다 과태료 수용자 | 실제 과태료 F 건수, F/N 비율 |
| 이달/선택 월의 불운자 | 불수용 R 건수·R/N 비율, 일부수용 P 건수·P/N 비율 |

N은 **이 서비스에 공유된 중복 제거 완료 신고**(accepted, partial, rejected, completed_unknown)다.
처리중·보완·취하·이송은 제외한다. 결과 미상은 N에 포함하고 행/기준 설명에 건수를 제공한다.
F는 결과 accepted/partial이며 disposition=fine인 신고다. 일부수용 과태료, 금액 미상 과태료를 포함한다.
단순 수용·경고·계도·범칙금·처분 미상·추정 금액·벌점은 과태료로 추론하지 않는다.
모순 자료는 diagnostics로 반환하며 결과를 임의 보정하지 않는다.
비율은 표시 옆에 분자/N을 함께 제공한다. N=0은 순위 제외, 본인은 `me=null`이다.
기본 표본 1건, 사용자 선택 최소 표본은 열람 자격의 전체 공유 10건과 별개다.
공동 순위는 1,1,3 방식이다. 비율은 반올림 전 정확한 분수 순서로 비교하고 동률 표시 순서만 큰 N→UUID로 고정한다.
신고자 인품·능력·위반 확정이나 가중 점수는 평가하지 않는다.

기본 날짜는 답변일(completed_date), 신고일 선택 시 모든 분자와 N이 함께 바뀐다(single-date-v1).
전체/날짜 범위에는 임의 기간 상한이 없다. 불운자는 KST 현재 월 기본, 집계 중 표시, 이전 월 제목을 제공한다.
선택 날짜 결측은 다른 날짜로 대체하지 않고 제외 건수를 반환한다(결측은 특정 기간에 귀속시킬 수 없음).

## 실제 데이터 경로와 보안

업로드·기여 원천 `private.community_report_facts`와 `community_consent_grants`, `contributor_profiles`,
`auth.users/identities`를 읽는다. 기존 ingest가 관측을 저장하며 랭킹은 별도 샘플 원천을 사용하지 않는다.
`private.ranking_representatives()`는 최신 my-reports의 **본인 범위→report identity→대표 관측** 선출을
사용자 전체에 set-wise로 적용한다. 사용자별 key/신고번호 보완과 payload 그룹 최신 답변 수신→답변일→최초 수신→dataset
순서를 사용한다. 다른 사용자의 관측으로 결과를 덮지 않는다. 같은 사용자의 PC·모바일·복원 관측은 한 건,
서로 다른 사용자의 같은 신고는 각각 한 건이다. 주소·좌표·차량번호로 별개 신고를 합치지 않는다.

대표 선정 **후** 날짜·분류→사용자별 N/F/R/P/unknown→전체 후보 정렬/공동순위→요청 페이지와 본인 전역 순위 순이다.
원문 전량을 브라우저/Edge에 가져오지 않으며 기존 100k fact-loader 상한을 사용하지 않는다.
좌표·담당자 결측 때문에 제외하지 않는다. 활성 공유 계보와 동의·정지·삭제 상태를 매 요청 확인한다.

추가 migration: [202610030100_user_rankings.sql](../../../supabase/migrations/202610030100_user_rankings.sql).
RPC `public.internal_user_rankings(uuid,uuid,jsonb)`는 기존 `internal_analytics_viewer`의 카카오·세션·동의·10건 gate를 재사용한다.
SECURITY DEFINER, 빈 search_path, SQL 입력 검증, service_role만 실행 권한, 함수 statement_timeout 20초다.
기존 private 직접 권한을 풀지 않았다. Edge는 검증 JWT의 UUID/세션을 넘기며 클라이언트 user_id를 받지 않는다.
랭킹 DTO는 UUID와 허용 집계값·범위·진단만 strict whitelist로 통과시킨다. 원문·번호·identity·dataset key·토큰·연락처는 제외한다.

API [정본 계약](../../../contracts/user-rankings/README.md), [query schema](../../../contracts/user-rankings/query.schema.json),
[response schema](../../../contracts/user-rankings/response.schema.json).
`GET /functions/v1/user-rankings`: theme/metric/period/date_basis/category/min_reports/page/page_size(≤50)/expected_version.
응답은 전체 참가자 수, 전역 rank/tie_count, N/F/R/P/unknown, 분자/분모/value, 본인 전역 me,
dataset_version/generated_at/scope/결측·모순 진단이다. 안정적인 400/401/403/409/429/503 오류와 사용자별 60회/분 제한을 제공한다.

영구 랭킹 캐시 없이 한 DB statement snapshot을 읽는다. 전체 후보·범위·진단·page_size를 묶은 버전이 바뀌면
후속 페이지는 409 DATASET_CHANGED로 거절하고 1페이지부터 다시 읽는다. 철회·삭제·정지·대표 갱신은 다음 요청에 반영된다.
HTTP private/no-store, 브라우저 logout/pagehide/hidden 시 보호 응답 제거, 복귀·포커스 시 재검증한다.
현재 열려 있는 DOM을 서버 push로 갱신하는 기능은 없으며, 영구 브라우저 캐시·정적 UUID 목록은 만들지 않는다.

## 실행한 검증과 증거

모든 DB/브라우저 자료는 **로컬 Supabase + 합성 fixture**다. 운영 자료를 조회하거나 운영에 SQL을 적용하지 않았다.
현재 실제 선행 auth/map 스키마 위에 신규 migration을 적용했으며 sibling auth 저장소는 읽기만 했다.

| 실행 | 결과 / 범위 |
|---|---|
| `npm test` | 599 통과, 96 환경 조건부/기존 검사 skipped; 전체 운영 통합 통과를 뜻하지 않음 |
| SQL+Edge 통합 | 11 통과: 실제 DB/GoTrue/PostgREST, 동일/다른 사용자 중복, 대표 변경 선후, 날짜/분류, fine/partial/unknown/경고/미완료, 최소 표본/0, 정확 분수·반올림 동률, 페이지/전역 me, 월말/연말/KST, 철회/삭제/정지/version, JWT/gate/직접 권한 |
| 실제 Deno Edge | 배포 index 그대로 로컬 Deno 실행(serve bind만 loopback), HTTP 200/401/400/403, F5/N10=50%, no-store 확인; [증거](evidence/deno-edge.json) |
| 50만 고유 신고 성능 | 사용자1000, 중복 관측10만을 추가한60만 관측. 전체 공동순위·두 페이지100개 UUID·비율 공동1위20명/다음21위·페이지 밖 본인1001위·철회 후980명 정확성 통과 |
| 실제 Chrome UI | 43검사 통과, 1440/1920/2560/390 라이트·다크, 정렬/월/페이지/me/UUIDcopy/표본1/빈상태/키보드/오류/재시도/직접진입/새로고침/뒤로가기/지도 조건 보존/철회; [행동·network·console](evidence/browser/result.json) |
| Pages 하위 경로 | 로컬 정적 live build `/safetyreport-community-map/`, 직접 진입·refresh·자산·내 행·모바일 너비 통과, JS·자산·랭킹API 오류0; 외부 광고 iframe의 인증 전환/새로고침 취소는 별도 기록; [증거](evidence/subpath/result.json) |
| build/scan/계약 | TypeScript/Vite build, 공개 산출물 scan, composed migration/function import closure, Deno check 통과 |

브라우저는 Google Chrome 154.0.8037.92 + 설치된 Playwright-core다. 지도 인접 테스트는 합성 facts와 MOCK Kakao SDK이며,
랭킹 자체는 실제 로컬 RPC/JWT를 사용했다. 의도한 429/503/409/403 응답과 실제 JS 오류를 구분했다.
[모바일 light](evidence/browser/390-light.png), [모바일 dark](evidence/browser/390-dark.png),
[PC](evidence/browser/1920-dark.png), [비율](evidence/browser/fine-rate.png), [표본1/지난 월](evidence/browser/prior-month-single-sample.png).

50만 성능 원본 [측정](evidence/500k-measurements.json), [EXPLAIN/auto_explain](evidence/500k-plans.txt).
페이지 RPC 총 실행 시간 7.85–8.52초, DB→Edge JSON 약5.5–13KB, DB backend 최대 RSS329392KiB(약322MiB).
RSS는 shared page/cache를 포함하므로 쿼리 독점 메모리로 해석하지 않는다.
work_mem32MB는 연산별 제한이며 sort가 약98–166MiB 디스크에 spill, hash 약59MB를 사용했다.
계보 grant/user, owner, fact PK, profile/auth 기존 인덱스 사용을 계획에서 확인했고 새 인덱스는 추가하지 않았다.
대량 fixture는 트랜잭션 rollback했고 테스트 로그인 계정은 정리한다. 이 수치는 운영 동시성/응답 시간 보증이 아니다.

Muse 구현은 구독 OpenCode `opencode-go/muse-spark-1.3-contributor`, high variant로 실행했고 session
`ses_f00a80068ffeFkJvmIvVDgwSYi` export에서 실제 provider/model/worktree를 확인했다.
소유 파일 전용 worktree의 구현 commit46ca939를 root로 cherry-pick744663e 후 Sol이 통합했다.
최종 Muse 검수는 제품 후보 `26b120c`의 별도 detached worktree에서 수행했다.
[검수 보고](../../reviews/user-rankings-muse-final.md), [추가 동작 증거](evidence/muse/independent-check.json).
정확 모델/provider/high와 worktree는 session `ses_f0087fee8ffeCGOH8qi01EObWB` export에서 확인했다.
초기 로컬 서버 복구 과정에 Muse의 서버 재시작/kill 시도가 있었으므로 원 보고서의 ‘검수 중 프로세스 조작 없음’은
**Sol 중단 후 복구 턴에 한정**된다. 운영/다른 저장소/호스트 설정 변경은 없었다. 모델 export/credentials는 커밋하지 않았다.

Muse가 찾은 비로그인 light 테마 누락은 공통 테마 함수를 App 진입에 적용한 `055b304`에서 수정했다.
뒤로가기 blank 후보는 최초 브라우저 about:blank로 돌아간 검사였으며, 실제 서비스 내 지도→랭킹 이력을 만든 뒤
로그아웃→back 검사에서 게이트·라이트 테마·저장 JWT 없음·랭킹 표 없음이 확인됐다.
투명 배경을 black으로 계산한 대비 FAIL은 측정기 문제로 분리하고 실제 불투명 page/panel 토큰으로 재측정했다.
[접근성/로그아웃 7검사](evidence/accessibility/result.json): 실제 computed px 텍스트200%(13→26px), 모바일 페이지 너비,
2px 포커스, light/dark 텍스트 대비(최소4.548, 선택 버튼4.501), 익명 테마·실제 이력 back 통과.
최종 수정본에서 브라우저43·전체 단위599·build/scan을 다시 통과했다.
초기 테스트 계정156개 누적분을 해당 fixture email prefix로만 정리했다. 나머지 로컬 자료는 보존했다.
최종 Muse 재검수는 `055b304`에서 **7/7 PASS**, ISSUE1/2 closed.
[최종 재검수 보고](../../reviews/user-rankings-muse-recheck.md), [증거](evidence/muse-recheck/result.json).
새 고정 worktree와 session `ses_f006bebb5ffecaBvVQakeReTg7`의 실제 provider/model/high를 export 확인했다.
설치된 OpenCode fork는 기존 directory를 유지하여 해당 시도를 중단했고, 새 worktree의 새 세션으로 정확히 실행했다.
CLI 첫 exit0은 읽기만 끝낸 상태여서 성공으로 처리하지 않고 같은 세션을 이어 결과/스크린샷/보고서를 모두 회수했다.

## 미검증과 적용 순서

운영 원천 숫자, 실제 Kakao OAuth, 호스팅 Edge gateway, 실제 Pages, 운영 동시 부하·EXPLAIN은 **미검증**이다.
로컬 Deno/정적 하위 경로 검증을 운영 배포 성공으로 주장하지 않는다.
스크린리더/실기기 터치/운영체제 큰 글꼴 설정은 미검증이다. 큰 글꼴은 실제 브라우저 computed px 확대/zoom으로 확인했다.

1. composed manifest에 따른 선행 auth/map 스키마와 최신 my-reports 계약 확인.
2. 신규 migration202610030100 적용. 기존 원문 재구성/초기화 없음.
3. `user-rankings` Edge 배포, verify_jwt=true, 기존 서버 secret/issuer/salt/origin 정책 재사용. 프런트 secret 추가 없음.
4. 운영에서 비로그인/10건gate, 숫자 대조, 페이지/me, 철회/정지/삭제 시 노출 제거/version smoke.
5. Pages live build·scan 후 배포. UUID/랭킹 데이터 정적 파일 포함 금지.
6. 운영 쿼리 시간·메모리·동시 부하 관찰. 필요하면 대표 선출 캐시/증분 구조를 별도 검증하며 철회 정책 유지.

이번 작업에서 이 운영 순서는 실행하지 않았다. 재현 명령과 롤백은 [적용 안내](../../user-rankings.md)에 있다.

최종 하위 경로 검수는 helper에서 VITE_BASE_PATH를 명시하고 소유 정적 서버를 검사 동안만 실행/정리하도록 재현 경로를 보완했다.
외부 ads-partners.coupang.com/widgets.html document의 net::ERR_ABORTED만 생명주기 취소로 분리해 원본에 기록했으며,
랭킹/자산 오류를 제외하지 않았다. 최종 일반 live build/scan을 복원했다. 본 작업 합성 계정은 최종 cleanup으로 제거했다.
