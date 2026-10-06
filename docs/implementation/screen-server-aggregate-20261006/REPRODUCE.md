# 로컬 재현

기준 HEAD `1d846aa`, 미커밋 candidate. 운영 URL/DSN/`--linked`를 받는 옵션이 없다. 고정 `supabase_db_ci0926-int`만 사용한다. 기존 컨테이너·볼륨은 중지/삭제하지 않는다. DB 검사는 직렬 실행하며, 대량 측정 동안 Node 테스트·빌드·브라우저를 병행하지 않는다.

## 보존

```bash
mkdir -p .agent-runtime/screen-aggregate
chmod 700 .agent-runtime/screen-aggregate
docker exec supabase_db_ci0926-int pg_dump -U supabase_admin -d postgres -Fc > .agent-runtime/screen-aggregate/before.dump
chmod 600 .agent-runtime/screen-aggregate/before.dump
```

현재 로컬 설치는 040800까지다. benchmark/새 integration suite는 060100–060700 및 060900을 **BEGIN/ROLLBACK** 안에서 적용한다. 060800 role timeout 변경은 새 집계 의미와 무관하여 이 local runner는 적용하지 않는다. SQL 측정은 세션 work_mem=2MB로 운영과 같은 작업 메모리 크기를 사용한다. 각 쿼리 측정용 deadline도 해당 세션에만 지정하고 rollback한다. 테스트 source·덤프는 ignored `.agent-runtime/` 안에만 저장한다.

## SQL 및 PostgREST 모양 쿼리

```bash
python3 scripts/benchmark/screen_server_aggregate.py --size 30000 --iterations 3 --plans
python3 scripts/benchmark/screen_server_aggregate.py --size 60000 --iterations 3
python3 scripts/benchmark/screen_server_aggregate.py --size 30000 --iterations 3 --window all
python3 scripts/benchmark/screen_server_aggregate.py --size 60000 --iterations 3 --window all
```

합성 전체 fact 30,000/60,000. 기존 fixture의 계정·동의·중복·날짜·기관·담당자 분포에 257개 주소와 400개 원시 차량 후보를 추가한 `diverse`가 기본이다. `--profile original`은 과거 단일 주소/차량 결측 fixture를 그대로 재현한다. 두 경로는 같은 transaction의 동일 state/viewer/자료를 읽는다. 최근 12개월은 `2025-10-07..2026-10-06`, 전체기간은 `2019-04-23..2026-10-06`; 대표 선출은 양쪽 모두 기간 이전 전체 적격 이력에서 수행한다.

`direct`는 RPC 함수 반환까지, `postgrest`는 `coalesce((json_agg(t.s)->0)::text,'null')`까지 측정한다. HTTP 서버/실제 PostgREST 프로세스/네트워크 측정이 아니다. `--plans`는 별도 호출에만 nested auto_explain을 켜므로 JSON 측정 표본에는 plan 수집 비용을 넣지 않는다. 총괄이 제공한 운영 PostgreSQL 17.6 aarch64 절대시간과 비교하지 않는다.

## 패킷 parity 및 Node에서 Edge 핸들러 재생

```bash
COMMUNITY_STACK=1 node_modules/.bin/vitest run tests/integration/screen-server-aggregate.test.ts --configLoader runner --no-cache --no-file-parallelism --maxWorkers=1
SCREEN_AGG_MEASURE=1 SCREEN_AGG_SIZE=30000 node_modules/.bin/vitest run tests/integration/screen-server-aggregate.test.ts --configLoader runner --no-cache --maxWorkers=1
SCREEN_AGG_MEASURE=1 SCREEN_AGG_SIZE=60000 node_modules/.bin/vitest run tests/integration/screen-server-aggregate.test.ts --configLoader runner --no-cache --maxWorkers=1
SCREEN_AGG_MEASURE=1 SCREEN_AGG_SIZE=30000 SCREEN_AGG_WINDOW=all node_modules/.bin/vitest run tests/integration/screen-server-aggregate.test.ts --configLoader runner --no-cache --maxWorkers=1
SCREEN_AGG_MEASURE=1 SCREEN_AGG_SIZE=60000 SCREEN_AGG_WINDOW=all node_modules/.bin/vitest run tests/integration/screen-server-aggregate.test.ts --configLoader runner --no-cache --maxWorkers=1
```

SQL native JSON를 실제 `JSON.parse`→`createScreenHandler`→DTO validation/whole-packet deep equality로 검사한다. auth/RPC만 stub이며 hosted Edge 측정은 아니다. `source_parse_calls`와 handler 내부 관찰된 `JSON.parse` 호출 수(검사용 최종 packet parse 포함), 실제 fact 행/34열 decode 작업량을 따로 기록한다. 대량 source에는 원시 합성 관측이 있으므로 git/Pages에 포함하지 않는다.

검사 패널은 기관/담당자·법규·지도 bbox·확장 prefix·compare·주소 상세/없어진 주소다. 날짜축·분류·지역·기관/담당자·bbox·법규·빈/전체 범위, mixed 상태/공개 정책/0원/동명이인/중복 dataset/대표 동률/generic·custom plan/1,000개 초과 주소, Unicode·마스킹 충돌을 포함한다. 기대값은 기존 경로 전체 packet 그대로다. SQL 배열이나 공개 배열을 재정렬하여 차이를 숨기지 않는다.

## 기존 검사와 산출물

```bash
COMMUNITY_STACK=1 node_modules/.bin/vitest run tests/integration/screen-transport.test.ts --configLoader runner --no-cache --no-file-parallelism --maxWorkers=1
npm test -- --configLoader runner --no-cache
npm run build -- --configLoader runner
npm run scan
python3 -m unittest discover -s tests/blueprint
python3 -m unittest discover -s tests/product
node scripts/integration/compose_supabase.mjs check --auth /home/better0101/projects/worktree/auth-perf
```

전체 설치형 DB suite는 기존 스택에 그대로 실행하지 않는다. 위 명시된 integration만 rollback-only다. 기존 `cohort-timeout`은 과거 버전 간 동률 문제를 검사하는 별도 suite이며 직전 보고서의 실패와 이번 current-baseline parity를 구분한다.

## 브라우저

```bash
E2E_PORT=5197 node_modules/.bin/vite --config scripts/browser/vite.screen-aggregate.config.ts --configLoader runner
E2E_PORT=5197 node scripts/browser/verify_screen_aggregate.mjs
```

위 Node replay가 만든 공개 packet과 실제 SQL aggregate source를 사용한다. URL scope가 fixture와 다르면 서버가 거절한다(다른 범위의 숫자를 재라벨하지 않음). 실제 Chrome/프런트/screen handler, 합성 인증, MOCK Kakao다. 운영 UI/실제 지도/독립 Muse 검수가 아니다. 검수 후 이 작업이 띄운 Vite/Chrome만 종료한다.

## 원복 확인

작업 뒤 같은 방식으로 `after.dump`를 만들고 `pg_restore -f -` 결과에서 `\restrict`/`\unrestrict`의 랜덤 nonce만 제외하여 before/after 전체 SQL SHA-256을 비교한다. schema/data/sequence/ACL/ledger 모두 포함한다. `evidence/local-restoration.json`에 실제 결과를 기록한다. dump를 덮어써 복구하는 방식은 쓰지 않는다.
