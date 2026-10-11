# 로컬 재현

기준 `c53d44e`, `perf/ingest-precompute`, 미커밋 후보. 운영 URL/DSN/`--linked`/push/deploy를 사용하지 않는다.

## 제한 PostgreSQL

```bash
python3 scripts/benchmark/ingest_precompute.py --sizes 35000 100000 --iterations 3
```

고정 이름 `astra-precompute-pg`가 이미 있으면 재사용/삭제하지 않고 실패한다. 자체 생성한 컨테이너만 finally에서 제거한다. 이미지 PostgreSQL 17.6, `--cpus=1 --memory=1g --shm-size=256m`, shared_buffers=224MB, work_mem=2MB, max_parallel_workers_per_gather=1, max_connections=60, jit=off다.

ci0926에서는 `/tmp/ci0926-db.lock`을 잡고 schema-only dump만 읽는다. 이미 확보한 dump가 있으면 ignored runtime cache를 재사용하며 SHA를 기록한다. cache가 없고 잠금이 30초 이상 점유되면 실패한다. 사용자 데이터·credentials를 복제하지 않는다. 정책 식별자는 synthetic이고 공개 플래그는 저장소 정책 migration과 같다. SQL 지역 사전 4개 테이블은 `202610040300_analytics_rollups.sql`의 체크인된 데이터를 넣고 `서울 중구 → 11140`을 확인한다. 합성 입력은 기존 seed에 장소 4,507·기관 127·담당자 1,016·법규 31·차량 8,000 후보를 적용한다. 각 측정에는 실제 distinct 수를 기록한다. 두 규모 모두 동일한 다양성 상한이므로 distinct가 fact와 함께 무한히 늘어나는 최악 분포 검증은 아니다.

화면 SQL 타이머에는 `select coalesce((json_agg(t.s)->0)::text,'null') from (select …) t` 및 반환 text 직렬화를 포함한다. bytes 산출과 ACK 검증은 타이머 밖이다. 첫 요청은 컨테이너 재시작 직후이며 PostgreSQL shared buffers만 비운 조건이다. **호스트 OS page cache는 통제하지 않았다.** 전후 각각 12개월/전체기간, 첫 요청 1회+warm 3회를 기록한다. 1건/20건 쓰기는 실제 `internal_community_ingest` RPC를 실행하고 durable accepted ACK 및 증가한 fact 수를 검증한 뒤 ROLLBACK한다. 타이머를 멈추기 전에 SET CONSTRAINTS ALL IMMEDIATE로 커밋 전 rollup flush 비용도 포함한다. Edge HTTP·앱 동기화 시간과 구분한다.

backfill은 250 key 또는 1 dirty month를 별도 트랜잭션에서 처리한다. 전체 시간/배치 시간/처리량과 파생 저장 크기를 기록한다. `dataset_version`이 backfill 전후 동일한지도 검사한다. raw SQL source는 ignored `.agent-runtime/ingest-precompute/`에만 저장하고 문서/Pages에는 넣지 않는다. schema 덤프 파일을 공개하지 않는다.

## DB·계약·빌드

```bash
flock -w 30 /tmp/ci0926-db.lock env COMMUNITY_STACK=1 node_modules/.bin/vitest run tests/integration/ingest-precompute.test.ts tests/integration/cohort-timeout.test.ts tests/integration/screen-transport.test.ts tests/integration/screen-server-aggregate.test.ts --configLoader runner --no-cache --no-file-parallelism --maxWorkers=1
python3 scripts/benchmark/verify_ingest_precompute_isolated.py
python3 scripts/benchmark/verify_ingest_precompute_concurrency.py
PRECOMPUTE_FULL_MEASURE=1 node_modules/.bin/vitest run tests/integration/ingest-precompute.test.ts --configLoader runner --no-cache --maxWorkers=1
npm test -- --configLoader runner --no-cache
npm run build -- --configLoader runner
npm run scan
python3 -m unittest discover -s tests/blueprint
python3 -m unittest discover -s tests/product
node scripts/integration/compose_supabase.mjs check --auth /home/better0101/projects/worktree/auth-perf
```

제한 DB의 전체 suite는 현재 38 PASS / 1 FAIL / 7 SKIP이며 동일 identity 100,001개 관측 갱신 timeout이 재발한다. 실패를 예상하더라도 검사/timeout/fixture를 낮추지 않는다.

ci0926 검사는 BEGIN/ROLLBACK 안에서 migration·fixture·변경을 모두 되돌린다. SQL 검사는 flock으로 직렬화하고 성능 측정과 빌드/브라우저를 겹치지 않는다. 공유 잠금 점유 시 isolated script는 같은 schema와 reference를 자체 컨테이너에 복원하고 네 suite를 그대로 실행한다. 이 script와 benchmark/concurrency는 같은 고정 이름을 사용하므로 순차 실행한다. 기존 테스트의 기대값·검사 수·budget을 낮추거나 삭제하지 않는다.

## Chrome

```bash
E2E_PORT=5198 node_modules/.bin/vite --config scripts/browser/vite.ingest-precompute.config.ts --configLoader runner
E2E_PORT=5198 node scripts/browser/verify_ingest_precompute.mjs
```

제한 DB에서 내보낸 3.5만 fact 집계 → 실제 handler/decoder → 실제 Chrome. auth/RPC 운반과 Kakao는 합성/MOCK이며 운영 Edge나 실제 Kakao 검증이 아니다. eight viewport/theme, 법규 정렬, 개인 비교, 전체 기간 적용, heatmap 표, console/network/overflow 및 screenshot을 수집한다. 이 실행에서 생성한 Vite/Chrome만 종료한다. 사용자 commit 금지로 commit 고정 대신 후보 파일 SHA를 기록하며 독립 Muse 승인은 별도 미실행이다.
