# 로컬 재현

기존 `supabase_*_ci0926-int` PostgreSQL 17.6 / Kong 56321만 사용한다. 운영 접속값은 받지 않는다. 실행 전 이 로컬 스택을 별도로 백업하고 다른 DB 테스트와 **순차 실행**한다. benchmark/RLS/regression은 트랜잭션을 롤백하지만 기존 통합 테스트는 계정·세션·전역 상태를 변경한다. 전체 검사 뒤 원본 백업으로 복구하고 스키마/행 해시/시퀀스/공개 publication/컨테이너 상태를 대조한다. 이 감사의 비밀값 포함 백업은 무시된 `.agent-runtime`에만 보관했다.

```bash
node scripts/integration/compose_supabase.mjs check --auth ../auth-perf
# 현재 설치 스키마를 읽기만 할 때 --installed. 감사 기준 catalog-before.json을 덮어쓰지 않는다.
python3 scripts/query-audit/catalog.py --auth ../auth-perf --installed --out /tmp/query-audit-current.json
python3 scripts/query-audit/regression.py
python3 scripts/query-audit/performance_test.py
python3 scripts/query-audit/rls_benchmark.py
for phase in before after; do
  python3 scripts/query-audit/benchmark.py --phase "$phase"
  python3 scripts/query-audit/benchmark.py --phase "$phase" --concentrated
  python3 scripts/query-audit/benchmark.py --phase "$phase" --plans
  python3 scripts/query-audit/write_benchmark.py --phase "$phase"
  python3 scripts/query-audit/write_benchmark.py --phase "$phase" --concentrated
  python3 scripts/query-audit/write_benchmark.py --phase "$phase" --plans
done
python3 scripts/query-audit/benchmark.py --phase parity
python3 scripts/query-audit/filter_benchmark.py
python3 scripts/query-audit/report.py
python3 scripts/query-audit/inventory.py
```

두 규모(3,000/30,000)와 `force_custom_plan`/`force_generic_plan`을 기본값으로 실행한다. Python의 AUTH 경로는 이 작업에 승인된 `auth-perf` worktree다. 다른 체크아웃에서는 해당 상수를 명시적으로 변경한다. `before`는 보관된 기존 함수/트리거 정의를 해당 트랜잭션에 복원하며 TASK1의 `060100`은 포함한다. 사용자/동의/기기/relay/rate/ingest 원장도 합성한다. 운영 분포·p95·동시성 부하를 재현한 수치는 아니다.

`*-plans.txt`에는 루트 EXPLAIN JSON, `*-plans-stderr.txt`에는 함수 내부 auto_explain ANALYZE/BUFFERS가 있다. 시간은 별도의 비계측 호출을 사용한다. 일반 읽기 nested 최소 5ms, 짧은 Auth·helper 쓰기는 0ms를 기록한다. 외부 statement 진단 한도 8초와 기존 함수별 한도를 그대로 구분한다. `57014`는 성공값으로 바꾸지 않는다.

Map 통합 검사는 로컬 Deno wrapper로 실제 7개 Edge 엔트리를 실행한다. 기존 stack의 mock Kakao secret을 사용하는 **map용 A–L mock**이 필요하다. Auth용 mock(A/B)과 동시에 띄우지 않는다. Deno CA는 이 호스트에서 `DENO_CERT=/etc/ssl/certs/ca-certificates.crt`를 사용했다.

```bash
DENO_CERT=/etc/ssl/certs/ca-certificates.crt node scripts/integration/deno_functions.mjs --stack .integration-stack --deno /home/better0101/.local/bin/deno
# 별도 터미널. optional 측정 출력은 이번 evidence 아래에 지정한다.
COMMUNITY_STACK=1 COMMUNITY_STACK_DIR=.integration-stack \
  COMMUNITY_API_URL=http://127.0.0.1:56999 COMMUNITY_MOCK_KAKAO_HOST=127.0.0.1 \
  QUERY_AUDIT_PERF=1 npx vitest run --no-file-parallelism --maxWorkers=1
```

기존 `user-rankings-edge.test.ts`는 56999에 자체 Deno 서버를 띄우므로 위 wrapper 종료 후 그 파일을 단독 실행한다. 기존 선택적 검사도 이번에 `MAP_PERF`, `MY_REPORTS_MEASURE`, `RANKINGS_MEASURE`, `ROLLUP_PERF`, `HTTP_PERF`, `VIEWER_MEASURE`를 1로 켜 실행했다. `HTTP_PERF`는 57098/57099에 public-analytics wrapper를 각각 필요로 한다. 두 wrapper는 동일 Edge 소스와 후보 DB를 사용하므로 이 HTTP 결과는 전후 SQL 개선율의 근거가 아니다. 전후 SQL 비교는 위 Python 결과를 사용한다.

지역 rollup 후보의 50만 건 재검사는 `ROLLUP_PERF=1 ROLLUP_SOURCE_MIGRATION=202610060500_rollup_region_inputs.sql`로 계획 원문도 현재 후보와 맞춘다. 기본 10회 반복과 모든 건수 assertion은 유지한다.

Auth 검사는 auth 저장소 `docs/verification.md`의 composed 절차를 따른다. 실제 GoTrue/PostgREST와 mock Kakao를 사용하고 browser 결과의 screenshot/행동/console/network를 검사한다. hosted Kakao·운영 DB·Pages smoke는 실행하지 않는다.
