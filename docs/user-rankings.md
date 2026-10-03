# 유저 랭킹 구현 및 적용 안내

로컬 구현. 화면: 기존 내비게이션 ‘유저 랭킹’, 직접 진입 `?screen=rankings` (Pages 하위 경로에서도 동일).
지도/맞춤 통계 필터를 재설정하지 않고 독립 `rk_*` 조건을 유지한다. 라이트/다크·UUID 전체 확인/복사·내 행 ‘나’·
전체 기준 내 순위 요약·공동 순위·페이지 조회·기본 표본1·결과 없음·본인 자료 없음·거절·재시도 상태를 제공한다.
최다 신고자=신고 N, 과태료=F 건수/비율, 불운자=R/P 각각 건수/비율. 모든 숫자는 서비스에 공유된 완료 신고 기준이다.
세 테마 모두 전체 기간·직접 범위·월별 조회를 지원한다. 누적 세 진입점과 월별 세 진입점을 제공하며,
월별 테마를 바꿔도 선택월을 유지한다. 예를 들어 2023년 7월의 신고·과태료·불운자 순위를 같은 기간으로 비교할 수 있다.

정본 계약은 [contracts/user-rankings/README.md](../contracts/user-rankings/README.md), 기계 계약은 types.ts와 query/response schema다.
기존 수용률의 결과확정 분모와 랭킹 N(결과 미상 포함)을 같은 지표로 취급하지 않는다. 기본 답변일이며 신고일을 고르면
전체 분자/분모가 함께 바뀐다. 과태료 금액을 추정하지 않는다. 월별 세 테마 모두 KST 현재 월이 기본이며 집계 중임을 표시한다.
이전 월 제목은 해당 연월이다. 과거월에 공유 자료가 없으면 빈 상태이며 과거의 전체 안전신문고 활동을 재구성하지 않는다.

## 원천과 집계

실제 `private.community_report_facts`의 (contributor_id,dataset_key,source_report_key) 관측을 읽는다.
`private.community_consent_grants`, `contributor_profiles`, `auth.users/identities`로 활성 공유 계보·계정 상태를 확인한다.
새 `private.ranking_representatives()`는 최신 my-reports의 본인→identity→대표 선출을 전체 사용자에 set-wise로 실행한다.
사용자별 source key 최초 번호도 사용자 범위 안에서만 보완하며 답변 payload 그룹 최신 수신→답변일→최초 수신→dataset 순이다.
대표 확정 뒤 날짜·분류, 사용자별 N/F/R/P/unknown, 전체 정렬/공동순위, 페이지와 내 순위 순으로 집계한다.
`public.internal_user_rankings(uuid,uuid,jsonb)`는 service_role만 실행할 수 있으며 search_path를 비운다.
private 직접 권한은 추가하지 않는다. 금액·차량·담당자·좌표 결측은 랭킹 제외 사유가 아니다.

별도 snapshot/daily cache 없이 매 요청 현재 집계를 읽는다. 철회·삭제·정지·대표 갱신이 즉시 다음 요청과 version에 반영된다.
외부 사용자 UUID로 my-reports를 조회하는 경로는 없다. Edge는 검증한 JWT의 UUID/세션만 RPC로 넘긴다.

## 재현

- `python3 scripts/integration/apply_rankings_local.py --auth ../safetyreport-community-auth`: 기존 로컬 Docker 테스트 스택에만
  미적용 정본 migration을 순서대로 적용. auth 레포 읽기 전용. reset·운영 DSN·클라우드 변경 없음.
- `npm run build && npx vitest run tests/product && npm run scan`
- `COMMUNITY_STACK=1 npx vitest run tests/integration/user-rankings.test.ts tests/integration/user-rankings-edge.test.ts`
- `COMMUNITY_STACK=1 RANKINGS_MEASURE=1 npx vitest run tests/integration/user-rankings-measure.test.ts`: 고유 신고50만,
  관측60만, 사용자1000 fixture. 대량 fixture는 트랜잭션 rollback, 생성 로그인 계정은 정리.
- `deno check --config supabase/functions/user-rankings/deno.json supabase/functions/user-rankings/index.ts`
- `RANKINGS_PORT=5192 npx vite --config scripts/browser/vite.rankings.config.ts`, 별도 터미널
  `node scripts/browser/verify_rankings.mjs`와 `node scripts/browser/verify_ranking_periods.mjs`;
  완료 후 `/__rankings/cleanup`과 서버 종료. 동시 실행 서버는 같은 DB 후보를 공유하므로 검수는 순차 실행한다.
  운영 도메인과 무관한 루프백 전용 서버다. 실제 로컬 DB/RPC·GoTrue JWT + 합성 사용자/신고로 검수한다.
- 하위 경로 검증: 위 서버 실행 중 `node scripts/browser/build_rankings_subpath.mjs`,
  `node scripts/browser/verify_rankings_subpath.mjs` (검사 동안만5193 정적 서버를 자체 실행·정리). LOCAL GoTrue56321의 공개 키만 런타임에서 읽으며
  별도 origin인 정적 서버가 개발용 인증 프록시를 공유하지 않도록 한다. 확인 후 `VITE_DATA_MODE=live npm run build && npm run scan`으로
  일반 빌드를 복원한다. service_role은 프런트에 넣지 않는다.
- 접근성/로그아웃: `node scripts/browser/verify_rankings_accessibility.mjs` (마지막에 실제 로그아웃하므로
  다음 검수는 `/__rankings/cleanup` 후 시작).

증거: docs/implementation/user-rankings/evidence/ (측정·EXPLAIN·브라우저), docs/reviews/user-rankings-*.
완료 결과: [REPORT.md](implementation/user-rankings/REPORT.md). 실제 Edge index를 로컬 Deno로 실행하고
실제 GoTrue/PostgREST HTTP까지 확인했다. 실제 운영 자료/운영 키/실제 Kakao OAuth/호스팅된 Edge gateway는 **미검증**이며,
로컬 Deno/Node 검증을 호스팅 Edge 검증으로 주장하지 않는다.

## 운영 적용 준비 (이번 작업에서는 실행하지 않음)

1. 운영 선행 스키마/정책 확인: 정본 composed manifest의 auth/map migrations 및 최신 my-reports 202610020100.
2. 추가 migration `202610030100_user_rankings.sql` → `202610030200_user_ranking_periods.sql` 순서로 적용.
   이미 적용한 버전은 다시 실행하지 않는다. 030200은 기존 RPC의 기간 허용 조건만 갱신하며 원문 재구성·자료 초기화 없음.
3. `user-rankings` Edge 배포 (`verify_jwt=true`, 함수별 deno.json 포함). 기존 SUPABASE_URL, 서버 전용 secret,
   AUTH_JWT_ISSUER, ANALYTICS_RATE_SALT, ANALYTICS_ALLOWED_ORIGINS 재사용. 프런트 새 secret/계정 설정 변경 없음.
4. 비로그인401, 공유자10건 gate, 실제 운영 집계와 숫자 비교, 철회/정지/삭제409/제거, 페이지와 내 순위 smoke.
5. Pages live 빌드·scan 후 배포. UI만 공개하고 UUID/랭킹 snapshot/data 파일은 포함하지 않는다.
6. 운영 EXPLAIN과 동시 부하를 관찰한다. 50만 로컬 합성 측정은 운영 지연·동시성 보증이 아니다.

기간 확장만 롤백: 이전 Pages와 `user-rankings` Edge 계약을 복원하고 030100의
`public.internal_user_rankings` 정의·grant만 재적용한다. 030100 전체를 다시 실행하지 않는다
(대표 선출 함수가 이미 존재한다). 기존 원문·대표 선출 함수·private 권한은 보존한다.

랭킹 전체 도입 롤백: Pages 이전 인증 전용 버전 → 새 Edge 비활성/삭제 → 필요 시
`drop function public.internal_user_rankings(uuid,uuid,jsonb); drop function private.ranking_representatives();`.
새 인덱스가 있으면 workload 검토 후 별도 제거. private 권한을 풀거나 철회된 자료 캐시를 복원하지 않는다.
