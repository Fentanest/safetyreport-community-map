# 화면 결과 캐시 + 기본 범위 사전 계산 (2026-10-12)

로컬 구현 후보다. 기준 HEAD `1125e516d3b8834ffb3bd7c4fdf475a7f0d68473`, 브랜치 `astra/perf-cache`.
커밋·push·배포·운영 DB 접속/쓰기는 하지 않았다. 기존 migration 파일도 수정하지 않았다.
`node_modules`는 처음부터 있던 외부 경로 symlink이며 변경하지 않았다.

## 설계와 보안 경계

- 저장 대상은 DB→Edge의 완성 집계(sufficient statistics)다. 기존 `screen-v1` 응답 DTO는 유지한다.
  JSON 정렬·페이지·검색 투영은 Edge에서 계속 수행하며, 원시 facts를 캐시에 저장하거나 브라우저로 보내지 않는다.
- 공개 키: `analytics_state` 전체 행의 SHA-256 revision(따라서 dataset_version 포함) + null을 정규화한 scope +
  집계에 필요한 focused-place 패널 집합 + `screen-v1 / screen-aggregate-v2 / fine-estimate-v1 / split-v1 / single-date-v1`.
  패널 ID/순서/목록 검색·정렬·페이지는 집계 결과를 바꾸지 않으므로 공유한다. 새 집계/DTO 의미를 도입할 때 key 버전도 올려야 한다.
- 개인 키: 위 키 + compare + 검증된 사용자 UUID + 사용자 자료 버전.
  사용자 자료 버전은 **전역 revision + 해당 사용자 dataset별 manifest generation**의 digest다.
  manifest는 모든 payload 수정에 증가하지 않으므로 전역 revision을 함께 사용한다. 안전하지만 타 사용자 변경도 개인 캐시를 무효화하는 보수적 설계다.
- `full_counts.shared`와 개인 장소별 full counts까지 개인 부분에 둔다. 공개 캐시의 full은 전체/명시적 focus만 포함하고 shared는 false다.
  공개 캐시에 사용자 ID/개인 side/개인 장소 집합은 들어가지 않는다. 금액·법규·별점 동의 projection은 최신 집계 SQL 그대로 사용한다.
- 실제 `getUser` 인증·JWT/session 일치·rate-limit는 Edge에서 매번 수행한다. SQL도 매 요청 사용자 존재·Kakao·세션·활성 동의·10건을 재확인한다.
  로그인/자격 결과는 캐시하지 않는다. 계정 전환 시 UUID 키가 다르고, 세션 삭제는 버전 변경 없이도 거부된다.
- 기존 fact INSERT/UPDATE/DELETE 버전 트리거를 유지한다. consent grants / contributor profiles / policy disclosures 변경 및 관련 TRUNCATE에는
  **문장당 version bump만** 추가한다. 철회·삭제·금액 공개 정책 변경 후 옛 키는 즉시 조회 불가능하다. ingest에서 집계를 실행하지 않는다.
- STABLE `screen_cache_resolve` 안에서 gate·revision·metadata·캐시 조회·미스 집계를 **한 MVCC 스냅샷**으로 읽는다.
  VOLATILE RPC는 그 뒤 optional cache write만 한다. 계산 도중 버전이 바뀌면 저장을 건너뛴다.
  이미 시작한 요청의 스냅샷은 기존 계약대로 유지하지만 다음 요청은 반드시 새 버전/자격을 본다.
- 외부 응답은 계속 `private, no-store`. 내부 cache hit 정보와 별도 aggregate parts는 Edge 바깥으로 보내지 않는다.
  private table은 RLS + PUBLIC/anon/authenticated/service_role 직접 접근 revoke. 내부 helper도 revoke, 외부 RPC 두 개만 service_role 실행을 허용한다.

최신 집계 기준은 `202610121201_fine_estimate_ingest_aggregate.sql`이다. 신규 `analytics_screen_parts`는 그 함수를 복사해
공개/개인 side 선택과 JSON 포장만 분리했다. **all + traffic/parking/safety/living/other**, 과태료 추정치,
대표 선출·날짜 기준·정확 좌표·번호 마스킹은 유지한다. 원래 v2와 read_snapshot 함수는 비교/되돌리기용으로 그대로 남긴다.

## 미스, 동시 요청, 만료와 사전 계산

모두 미스면 전처리·집계를 한 번만 실행하여 두 부분을 만든다. 공개 적중/개인 미스면 개인 side만 집계하고 차량 정규화도 생략한다.
모두 적중하면 권한 확인과 고정 슬롯 읽기만 한다. 새로운 scope에서 전체 집계를 두 번 실행하는 경로는 없다.
캐시 저장에는 슬롯별 `pg_try_advisory_xact_lock`을 사용한다. 겹친 요청은 기다리지 않고 자기 결과를 반환한다.
동시 미스의 중복 계산 자체는 허용한다(single-flight 대기 없음). 4 vCPU에서 큰 동시 cold burst는 여전히 CPU 경쟁 위험이다.

고정 슬롯은 공개 32개(각 16 MiB), 개인 128개(각 4 MiB), metadata 1개(64 KiB)다.
**살아 있는 비압축 payload 상한은 1 GiB + 64 KiB**, TTL은 생성 후 15분이다. 크기 초과는 저장만 생략한다.
기본 범위용 슬롯 4개를 예약하고, 나머지 슬롯 충돌은 full SHA key 비교 후 미스로 처리한다.
이 상한은 파일 전체 크기나 WAL/TOAST dead tuples까지의 절대 상한이 아니다. autovacuum threshold를 낮췄으며
`pg_total_relation_size`와 WAL을 운영에서 확인해야 한다. 철회 후 옛 payload는 조회할 수 없고 TTL 청소/슬롯 교체로 물리 삭제된다.

`screen_cache_maintain()`은 매분 실행할 준비가 되어 있다. 만료 슬롯 청소 후, 기본 **답변일·전국·전체 분류 × 최근12개월/전체기간**의
공개 부분만 미리 계산한다. 최근12개월은 KST 오늘 및 윤일 clipping을, 전체기간은 해당 date basis의 min/max를 사용한다.
사용자별 전수 사전 계산은 하지 않는다. 같은 버전의 적중 결과는 다시 만들지 않고, 작업 중복은 try-lock으로 건너뛴다.
55초 statement timeout, 최근 5초 내 자료 변경 시 speculative 계산 생략, 계산 중 버전 변경 시 저장 생략으로 업로드 burst의 낭비를 제한한다.

**이전 버전 허용 지연은 사용하지 않는다.** 철회/동의 변경과 공개·개인 비교의 동일 버전 계약을 우선했다.
따라서 기존 source/generated/published 시각 표시가 정확하며 별도 UI 시각 변경은 필요 없다.
반면 자료가 매번 바뀌는 지속 ingest에서는 적중률을 보장하지 못한다. 이 상황을 오래된 결과로 숨기지 않는다.
주기 작업은 안정된 버전에 다음 분부터 효과가 있고, 계속 변하는 기간에는 정확한 미스로 동작한다.
버전 churn 자체를 없애는 설계는 아니며, 그 상태에서도 5초를 보장해야 한다면 사용자별/공개 정규화 전처리 재사용이 다음 과제다.

## 실제 검증과 성능

`evidence/benchmark-90k.json`: 로컬 PostgreSQL 17, 합성 90,000행·10,000개 주소·30계정, 각 조건 2회 중앙값.
운영 장비/자료가 아니며 baseline과 변경 후 모두 같은 rollback 트랜잭션 안에서 실행했다.
실측에 auth HTTP·PostgREST·외부 전송·브라우저 렌더는 포함되지 않는다. 캐시 hit에도 SQL viewer 검사는 포함된다.

| SQL 경로 | 최근12개월 | 전체기간 |
|---|---:|---:|
| 기존 v2 | 3.209초 | 5.995초 |
| 새 캐시 미스 | 3.240초 | 6.091초 |
| 공개+개인 적중 | 0.017초 | 0.019초 |
| 공개 적중/개인 미스 | 1.722초 | 3.265초 |

미스는 추가 집계 없이 동급이지만 이 표의 중앙값은 각각 **약 1.0% / 1.6% 느리다**. 실행 간 변동과 겹치는 작은 차이지만,
사용자 요구인 “미스도 절대 느려지지 않음”을 확정 통과로 표기하지 않는다. 운영 rollback 반복 측정이 필요하다.
초기 복제본에서 보였던 4~8% 추가 비용은 JSON side를 재파싱하지 않고 side별로 한 번 포장하도록 고쳐 줄였다.

기존 운영 12개월 10~13초, SQL 7~8.5초 및 이전 검토의 전체기간 SQL 약 8.8~9.3초를 기준으로 한 **예상치**:

| 실제 화면(내 신고 포함) | 최근12개월 | 전체기간 |
|---|---:|---:|
| 공개+개인 적중 | 1~3초 | 1~3초 |
| 공개 사전 계산만 적중, 개인 첫 조회 | 4~7초 | 5~9초 |
| 모두 미스 | 기존 수준 약 10~13초 | 약 11~15초 |

부분 적중 추정은 로컬에서 원래 집계의 약 54%가 남은 점과 기존 운영 비용에 근거한 범위이며 운영 실측이 아니다.
**12개월 5초 / 전체기간 10초를 모든 요청에서 달성했다는 결론은 낼 수 없다.** 특히 첫 개인 조회·버전 churn·동시 미스가 남는다.

검사 결과:

- `npx vitest run --configLoader runner`: **67 files, 805 passed, 188 skipped**. 기존 opt-in DB/벤치 suite는 기본 실행에서 skipped.
- `SCREEN_CACHE_STACK=1 npx vitest run --configLoader runner tests/integration/screen-result-cache.test.ts`: **7 passed**, 실제 로컬 PostgreSQL rollback.
  cold/hit/다른 계정 partial hit의 전체 Edge packet deep equality, 두 date axes·5분류·빈/1일 범위·focus·패널 정규화,
  금액/추정치·차량 projection, payload/정책/삭제 무효화, 세션/Kakao/동의/10건, TTL/충돌/크기/ACL, default prewarm와 cron 설치를 검증했다.
- `python3 scripts/benchmark/screen_cache_concurrency.py`: 별도 `postgres:17.6` 일회용 컨테이너의 합성 fixture만 커밋.
  4개 동시 cold 요청·2계정 격리, 잠긴 슬롯의 nonblocking 반환(0.346초), 계산 중 실제 concurrent commit과 옛 결과 저장 생략 **PASS**.
  내부 SQL 배열은 ord 동률 순서가 달라질 수 있어 unordered collection만 정규화한다. 고정 위치 튜플은 그대로 비교한다.
  컨테이너는 종료/삭제했다. 기존 로컬 DB와 운영 DB에 커밋하지 않았다.
- Opus용 `verify-rollback.sql`도 로컬 합성 데이터에서 실행해 state/aggregate 비교 전부 true, 자격 거부와 무효화를 확인했다.
- `npx tsc -p . --noEmit`, `npx vite build --configLoader runner --outDir /tmp/cm-cache-dist`,
  `DENO_DIR=/tmp/cm-cache-deno deno check supabase/functions/my-analytics/index.ts supabase/functions/public-analytics/index.ts` **PASS**.
  Vite의 기존 chunk size/dynamic import 경고는 남는다. `scan_public_dist.py`도 **PASS**(issues=[]). 명령·집계 결과는 `evidence/verification.json`에 기록했다.
- Chrome 154.0.8037.92 / Playwright core 1.55.0, `http://127.0.0.1:5198`, 390/1440/1920/2560 × dark/light **PASS**.
  실제 캐시 RPC의 합성 export + 실제 Edge handler 재생이다. 인증은 fake, Kakao는 MOCK이며 hosted Edge/live Kakao 검증이 아니다.
  기간 변경·정렬·내 신고 비교·동일 버전·가로 overflow·console/network를 검사했고 desktop/mobile screenshot을 실제로 열어 확인했다.
  `evidence/browser.json`, `1440-dark-sorted-compare-all.png`, `390-light.png` 참조. 화면 코드/디자인은 수정하지 않았다.
  독립 Muse 검수와 운영 browser latency/p95는 **NOT_RUN**. commit 금지 지시 때문에 candidate는 base HEAD + migration SHA로 기록했다.

기본 Vite config loader는 외부 node_modules symlink 아래 `.vite-temp`에 쓰려다 EROFS가 발생해 `--configLoader runner`로 검증했다.
Supabase CLI도 홈 telemetry 쓰기가 EROFS라 migration new가 실행되지 않았다. 호스트 권한/설정을 바꾸지 않고 신규 파일만 만들었다.

## 바뀐 파일

- `supabase/migrations/202610121300_screen_result_cache.sql`: parts 집계, bounded private cache, 무효화, 인증 snapshot RPC, metadata cache, prewarm/cleanup.
- `supabase/migrations/202610121301_screen_cache_cron.sql`: pg_cron extension 및 1분 job.
- `server/screenHandler.ts`, `server/screenAggregate.ts`: 새 RPC 및 같은 snapshot의 두 부분 결합/검증.
- `supabase/functions/public-analytics/index.ts`: metadata cache RPC 사용.
- `tests/product/screenSnapshot.test.ts`, `tests/integration/screen-result-cache.test.ts`: Edge/DB 경계와 동등성.
- `scripts/benchmark/screen_result_cache.py`, `screen_cache_concurrency.py`: 재현 가능한 합성 성능/동시성 검사.
- `scripts/browser/vite.screen-result-cache.config.ts`, `verify_screen_result_cache.mjs`: 실제 browser 재생.
- `docs/public-api-contract.md`, `docs/deployment.md`, 이 폴더의 보고서·검증 SQL·증거.

## Opus 배포 절차

1. 운영 함수 백업 및 현재 기준 확인: `202610121201`(추정 과태료)와 5분류가 적용돼 있어야 한다.
   **폐기된 `202610061200_ingest_precompute.sql`을 새로 적용하지 않는다.** 본 캐시는 그 테이블/트리거에 의존하지 않는다.
2. 아래 rollback 검증을 실행한다. SQL miss/hit/partial-hit 최소 5회와 실제 공개 DTO 일치, 세션/철회/마스킹을 확인한다.
   미스 성능이 허용 범위를 넘으면 배포 전에 개선하거나 이 변경의 적용을 보류한다.
3. `202610121300_screen_result_cache.sql` 적용. 기존 함수가 유지되므로 아직 옛 Edge도 동작한다.
4. `select name,default_version,installed_version from pg_available_extensions where name='pg_cron';`
   및 `show shared_preload_libraries;`로 사전 조건을 확인한다. 조건이 맞으면 `202610121301_screen_cache_cron.sql` 적용.
   **pg_cron을 설치하는 migration을 준비했지만 이번 작업에서는 운영에 설치하지 않았다.** preload가 없으면 운영자의 별도 설정/재시작이 필요하다.
   자동으로 호스트 설정을 바꾸지 않는다. scheduler 없이 1300만 적용하면 요청 캐시는 동작하지만 사전 계산·주기 청소는 운영 완료가 아니다.
5. `select private.screen_cache_maintain();`를 별도 짧은 트랜잭션으로 한 번 실행해 default slots를 확인한다.
6. Edge 두 함수 **my-analytics, public-analytics** 배포. 포함 파일:
   `supabase/functions/my-analytics/index.ts`(entrypoint 자체 변경 없음), `server/screenHandler.ts`, `server/screenAggregate.ts`와 기존 import 의존 파일;
   `supabase/functions/public-analytics/index.ts` 및 기존 server 의존 파일. 새 Edge 함수 이름/환경변수/verify_jwt 변경은 없다.
   Pages·community-ingest·user-rankings·앱 배포는 필요 없다.
7. 실제 로그인+내 신고 비교로 두 기본 범위의 cold/hit/다른 사용자 첫 조회를 측정한다.
   cron job의 active뿐 아니라 `cron.job_run_details`의 **최근 성공 시각/실행 시간**, 캐시 created_at 및 실제 버전 적중을 확인한다.
   source_updated_at이 계속 변하는 시간대의 적중률도 별도로 측정한다. 현재 동작 중이라고 가정하지 않는다.

```sql
select jobid, schedule, active from cron.job where jobname='screen-result-cache-v1';
select status, start_time, end_time, return_message
from cron.job_run_details where jobid in (select jobid from cron.job where jobname='screen-result-cache-v1')
order by start_time desc limit 10;
select slot, created_at, expires_at, octet_length(payload::text) as bytes
from private.screen_result_cache order by slot;
select pg_total_relation_size('private.screen_result_cache');
```

cron 실행 이력 보존은 기존 운영 정책을 따른다(예: 이 job의 7일 초과 job_run_details만 매일 삭제).
전역 cron 이력을 지우거나 다른 job의 설정을 바꾸지 않는다.

## 운영 DB rollback 검증 방법

`verify-rollback.sql`은 operator가 실행할 SQL이며 이 에이전트는 운영에서 실행하지 않았다.
**migration의 BEGIN/COMMIT을 그대로 `\i`하면 바깥 rollback을 깨뜨린다.** 먼저 본문 파일을 만든다:

```bash
python3 - <<'PY'
from pathlib import Path
import re
p = Path('supabase/migrations/202610121300_screen_result_cache.sql')
Path('/tmp/cm-cache-migration-body.sql').write_text(re.sub(r'^(begin|commit);\s*$', '', p.read_text(), flags=re.M))
PY
```

자격 있는 기존 계정 UUID와 그 계정의 활성 session UUID를 `cache_viewer`, `cache_session` psql 변수로 지정한다.
연결 비밀은 기존 운영자의 안전한 연결 방법을 사용하고 명령 출력/보고에 쓰지 않는다.

```text
psql -X -v ON_ERROR_STOP=1 -v cache_migration=/tmp/cm-cache-migration-body.sql \
  -v cache_viewer=<eligible UUID> -v cache_session=<active session UUID> \
  -f docs/implementation/screen-result-cache-20261012/verify-rollback.sql
```

스크립트는 BEGIN → 새 함수/table 설치 → baseline/miss/hit/partial-hit 시간 → 동일성 → 잘못된 세션 → 금액 동의 변경 →
동의 철회 → prewarm/ACL/크기 확인 → ROLLBACK 순서다. DML도 모두 되돌리지만 해당 트랜잭션 동안 row/schema locks가 생기므로
운영자가 부하가 낮은 시간에 실행해야 한다. cron migration은 이 검증에 포함하지 않는다.
동시성 재현은 별도 일회용 로컬 DB script에서 완료했다. 운영 두 세션에서 변경 commit을 동반하는 시험은 이 rollback script의 범위가 아니다.

## 되돌리기와 남은 위험

먼저 두 Edge를 baseline `1125e51` 파일로 되돌리면 보존된 `internal_analytics_read_snapshot` / `internal_analytics_cohort_state`로 복귀한다.
그 다음 해당 job만 `cron.unschedule('screen-result-cache-v1')`로 중지한다. 다른 cron job/extension은 지우지 않는다.
캐시 테이블과 신규 함수는 사용하지 않는 채 둘 수 있고, 제거는 의존성/trigger 확인 후 별도 forward migration으로 한다.
**dataset_version이나 삭제/철회 데이터를 과거로 되돌리지 않는다.**

주요 잔여 위험은 지속 ingest의 낮은 적중률, 큰 동시 cold 요청의 CPU 경쟁, 작은 미스 추가 비용, 논리 상한 외 TOAST/WAL 공간,
optional cache write 실패 시 계속 미스로 보이는 현상이다. 공개만 warm인 첫 개인 요청에는 대표 선출/정규화가 여전히 필요하다.
운영 결과와 cold p95를 확인하기 전에는 5초/10초 달성 또는 release-ready로 표시하지 않는다.

근거 문서: [PostgreSQL MVCC](https://www.postgresql.org/docs/17/transaction-iso.html),
[Supabase Cron 설치](https://supabase.com/docs/guides/cron/install).
