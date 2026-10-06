# 로컬 재현

기준 `0964d90`, 미커밋 후보. 고정 `supabase_db_ci0926-int`만 사용한다. 운영 URL/DSN/`--linked` 옵션은 없다. 모든 신규 SQL·시드는 BEGIN/ROLLBACK 안에서만 적용한다. 다른 컨테이너/볼륨은 변경하지 않는다. DB 검사를 직렬로 실행하고 성능 측정 중 테스트·빌드·브라우저 부하를 병행하지 않는다.

## 보존

```bash
mkdir -p .agent-runtime/screen-aggregate-opt
chmod 700 .agent-runtime/screen-aggregate-opt
docker exec supabase_db_ci0926-int pg_dump -U supabase_admin -d postgres -Fc > .agent-runtime/screen-aggregate-opt/before.dump
chmod 600 .agent-runtime/screen-aggregate-opt/before.dump
```

끝에 같은 방식으로 after.dump를 만들고 `docker exec -i supabase_db_ci0926-int pg_restore -f -`에 각 dump를 전달한다. 랜덤 `\restrict`/`\unrestrict` nonce 행만 제외한 전체 SQL SHA-256을 비교한다. 복구를 위해 dump를 DB에 덮어쓰지 않는다.

## 전/후 SQL 및 핸들러

```bash
python3 scripts/benchmark/screen_aggregate_opt.py --size 30000 --iterations 3 --plans
python3 scripts/benchmark/screen_aggregate_opt.py --size 30000 --iterations 3 --window all --plans
python3 scripts/benchmark/screen_aggregate_opt.py --size 60000 --iterations 3 --window all
python3 scripts/benchmark/screen_aggregate_opt.py --size 30000 --iterations 3 --memory 2MB --plans
SCREEN_AGG_MEASURE=1 SCREEN_AGG_SIZE=30000 node_modules/.bin/vitest run tests/integration/screen-aggregate-opt.test.ts --configLoader runner --no-cache --maxWorkers=1
SCREEN_AGG_MEASURE=1 SCREEN_AGG_SIZE=30000 SCREEN_AGG_WINDOW=all node_modules/.bin/vitest run tests/integration/screen-aggregate-opt.test.ts --configLoader runner --no-cache --maxWorkers=1
SCREEN_AGG_MEASURE=1 SCREEN_AGG_SIZE=60000 SCREEN_AGG_WINDOW=all node_modules/.bin/vitest run tests/integration/screen-aggregate-opt.test.ts --configLoader runner --no-cache --maxWorkers=1
```

`production`은 **운영 유사 다양성의 합성 profile 이름**이며 운영 자료가 아니다. 장소 4,507·기관 127·기관+담당자 1,016·법규 31·원번호 8,000 후보를 기존 날짜/동의/계정 시드에 적용한다. 실제 distinct 건수는 SQL evidence의 diversity에 기록한다. 각 phase는 legacy facts→0964d90 screen v1→후보 screen v2 순서로 동일 transaction/자료를 사용한다. 직접 함수 호출과 `json_agg(t.s)->0` 직렬화 쿼리를 각각 측정한다. 세션 work_mem=2MB, 새 함수의 별도 설정은 evidence의 function_work_mem이다. auto_explain ANALYZE/BUFFERS는 측정 표본 밖 호출에만 켠다. HTTP/운영 Edge 시간은 포함하지 않는다.

대량 replay는 실제 source JSON.parse와 실제 createScreenHandler를 실행하며 auth/RPC만 stub한다. 세 경로의 전체 공개 packet을 배열 순서까지 deep-equal로 검사한다. 원시 source/dump는 ignored `.agent-runtime/`에만 보관하며 공개 DTO가 아닌 원시 자료를 evidence/Pages에 넣지 않는다.

## 검사

```bash
COMMUNITY_STACK=1 node_modules/.bin/vitest run tests/integration/screen-server-aggregate.test.ts --configLoader runner --no-cache --no-file-parallelism --maxWorkers=1
COMMUNITY_STACK=1 node_modules/.bin/vitest run tests/integration/cohort-timeout.test.ts --configLoader runner --no-cache --no-file-parallelism --maxWorkers=1
COMMUNITY_STACK=1 node_modules/.bin/vitest run tests/integration/screen-transport.test.ts --configLoader runner --no-cache --no-file-parallelism --maxWorkers=1
npm test -- --configLoader runner --no-cache
npm run build -- --configLoader runner
npm run scan
python3 -m unittest discover -s tests/blueprint
python3 -m unittest discover -s tests/product
node scripts/integration/compose_supabase.mjs check --auth /home/better0101/projects/worktree/auth-perf
```

지정한 integration은 rollback-only이며 기존 스택에 전체 설치형 suite를 실행하지 않는다. 과거 cohort oracle에는 새로 명시한 dataset_key 최종 tie key만 적용하고 나머지 기대값을 보존한다. a/b dataset 동률의 winner는 a로 명시한다.

## Chrome

```bash
E2E_PORT=5197 node_modules/.bin/vite --config scripts/browser/vite.screen-aggregate-opt.config.ts --configLoader runner
E2E_PORT=5197 node scripts/browser/verify_screen_aggregate_opt.mjs
```

실제 SQL export→실제 handler→실제 Chrome/프런트. 인증은 합성, 카카오는 MOCK. 390/1440/1920/2560 dark/light, 법규 정렬·개인 비교·전체기간 변경·console/network/overflow 및 스크린샷을 기록한다. 이 작업이 시작한 Vite 세션만 Ctrl-C로 종료하며 Chrome은 finally에서 닫는다. 독립 Muse·고정 커밋·실제 카카오·운영 검수는 별도다.
