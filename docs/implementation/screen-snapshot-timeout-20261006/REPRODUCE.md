# 로컬 재현 r3

지정 worktree의 기존 `supabase_db_ci0926-int`만 사용. 운영 DSN/URL/`--linked` 인자 없음.
현재 ledger는 040800까지다. 매 검사마다 060100–060600과 후보 060700을 transaction 안에서 적용하고 ROLLBACK한다.
DB 검사는 직렬 실행한다. 비교 benchmark와 Node replay 중에는 다른 테스트/빌드/브라우저를 실행하지 않는다.
원래 컨테이너·볼륨을 정지/삭제하지 않는다. 전체 설치형 integration suite를 원본 DB에 그대로 실행하지 않는다.

## 백업·원복

```bash
mkdir -p .agent-runtime/screen-r3
chmod 700 .agent-runtime/screen-r3
docker exec supabase_db_ci0926-int pg_dump -U supabase_admin -d postgres -Fc > .agent-runtime/screen-r3/before.dump
chmod 600 .agent-runtime/screen-r3/before.dump
```

작업 후 after.dump를 같은 방식으로 만들고 pg_restore의 plain SQL에서 무작위 `\restrict`/`\unrestrict` nonce만 제외해
전체 schema/data/sequence/ACL/ledger SHA-256을 비교한다. 이 비공개 dump와 합성 private-shaped source는 git에 넣지 않는다.
`evidence/r3/local-restoration.json`이 실제 결과다. 모든 시드·SQL 변경은 롤백되므로 데이터 덮어쓰기 복원은 필요 없다.

## 3만 건 전후 SQL과 실행계획

```bash
python3 scripts/benchmark/screen_snapshot_timeout.py --phase before --size 30000 --plans --iterations 6 --source-out .agent-runtime/screen-r3/source-before.json --out docs/implementation/screen-snapshot-timeout-20261006/evidence/r3
python3 scripts/benchmark/screen_snapshot_timeout.py --phase after --size 30000 --plans --iterations 6 --source-out .agent-runtime/screen-r3/source-after.json --out docs/implementation/screen-snapshot-timeout-20261006/evidence/r3
```

30,000개 합성 fact 중 27,332개 반환. `completed_date`, 2025-10-07..2026-10-06 + 이전 동기간.
각 phase는 direct/no-viewer/viewer 각 6회 =18개 sample. `sqlstate=00000`, `parity=true` 전부 확인한다.
최종 JSON을 받은 직후 타이머를 멈추고, 길이·패리티 변환은 밖에서 수행한다.
result/source는 json 변수이므로 후보 JSON을 jsonb로 변환하는 비용을 재도입하지 않는다.
기준 jsonb의 text 직렬화는 포함하므로 r2 시간과 단순 동일 조건으로 비교하지 않는다.
source는 Node 실제 파서/handler에 전달한다. `--plans`는 별도 호출에서만 EXPLAIN ANALYZE BUFFERS와 nested auto_explain을 켠다.
`.json`은 성공 표본/시간/문자/bytes/행수/패리티, `.txt`는 외부 EXPLAIN, `-plans.txt`는 내부 실행계획이다.
`--plan-mode force_generic_plan --concentrated`도 지원한다(r2에서 측정, r3 대량 성능 표에는 미포함).
양 plan mode의 r3 수치 패리티는 아래 integration suite가 검사한다.
첫 after 측정이 단위검사·빌드와 일부 겹쳐 `initial-overlapped/`에 보존하고, 대표 표는 직렬 재측정만 사용한다.

## 검사

```bash
COMMUNITY_STACK=1 node_modules/.bin/vitest run tests/integration/screen-transport.test.ts --configLoader runner --no-cache --no-file-parallelism --maxWorkers=1
COMMUNITY_STACK=1 node_modules/.bin/vitest run tests/integration/cohort-timeout.test.ts --configLoader runner --no-cache --no-file-parallelism --maxWorkers=1
SCREEN_SQL_MEASURE=1 node_modules/.bin/vitest run tests/integration/screen-handler-measure.test.ts tests/product/screenSnapshot.test.ts --configLoader runner --no-cache --maxWorkers=1
npm test -- --configLoader runner --no-cache
npm run build -- --configLoader runner
npm run scan
python3 -m unittest discover -s tests/blueprint
python3 -m unittest discover -s tests/product
node scripts/integration/compose_supabase.mjs check --auth /home/better0101/projects/worktree/auth-perf
```

screen-transport는 9개 검사: native json 파싱/34키 유일성/숫자 표기·한글·escape/null,
48개 날짜·필터·previous·동률 조합, generic/custom, viewer, 개인 compare, rollup4종, rankings, ACL/type,
forward rollback 및 SQL caller catalog, 함수 내부 timeout 설정의 실제 효과를 확인한다.
cohort-timeout의 기존 구 버전 대비 완전 동률 배열 순서 검사는 이번에도 실패했다. REPORT의 제한과 r2 tie-diagnosis를 읽고
기대값 완화/정렬로 실패를 지우지 않는다. screen-transport는 현재 HEAD 060100 기준을 그대로 비교한다.
Node 재생은 실제 SQL 합성 source + auth/RPC stub이며 hosted Edge 성능 검사가 아니다.
`SCREEN_SOURCE_DIR`/`SCREEN_HANDLER_OUT`으로 Node replay 입력·결과 경로를 바꿀 수 있다.
auth manifest 경로는 읽기 전용 검증이며 그 프로젝트는 수정하지 않는다.

## 브라우저

```ts
// .agent-runtime/screen-r3/vite.config.ts
import config from '../../scripts/browser/vite.e2e.config.ts';
export default { ...config, cacheDir: '.agent-runtime/screen-r3/vite-cache' };
```

```bash
E2E_PORT=5197 node_modules/.bin/vite --config .agent-runtime/screen-r3/vite.config.ts --configLoader runner
# 별도 터미널
E2E_PORT=5197 SCREEN_BROWSER_OUT=docs/implementation/screen-snapshot-timeout-20261006/evidence/r3/browser node scripts/browser/verify_screen_timeout.mjs
```

실제 Chrome/Playwright, 합성 HTTP/auth, MOCK Kakao SDK다. 390×844 / 1440·1920·2560×1080 dark 화면.
26초 지연을 주고 20초 deadline 표시, 자동 retry 없음, 수동 복구와 가로 overflow를 확인한다.
실제 screenshot을 열어 timeout의 이전 범위 안내와 복구 후 수치 표시를 확인한다. 운영 UI/실제 Kakao/Muse 승인이 아니다.
종료 후 자신이 시작한 Vite/Chrome만 종료한다.

## 운영과의 구분

운영 측정은 사용자 r3 작업지시서에 제공된 총괄의 읽기 전용 실측을 REPORT에 인용했다.
이 스크립트가 운영 aarch64/실제 데이터에서 돌았다고 표기하지 않는다. 운영 재측정은 배포 후 총괄이 수행한다.
