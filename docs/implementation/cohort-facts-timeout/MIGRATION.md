# 운영자가 실행할 SQL 적용 순서

이번 작업은 로컬 검증과 커밋까지다. 아래 운영 명령은 **실행하지 않았다**.

1. 운영자는 공유 프로젝트의 migration 이력에서 선행 `202610010100`과 `202610040500`을 확인한다. 2026-10-04 배포 기록에는 지도 `202610040800`까지 적용돼 있다. 이 작업에서 운영의 현재 상태를 직접 확인하지 않았다. Auth `202610050100`은 manifest에 등록돼 있지만 이 수정의 의존성은 아니다.
2. 기존 함수의 정의·권한을 보관한다. DB 접속값은 운영자 환경에만 둔다. 이 쿼리는 함수 정의만 내보내고 사실 자료를 내보내지 않는다.

```bash
psql "$COMMUNITY_MAP_DB_URL" -X -v ON_ERROR_STOP=1 -Atc \
  "select pg_get_functiondef('public.internal_analytics_cohort_facts(text,date,date,boolean,text,text,text,text,double precision[])'::regprocedure)" \
  > cohort-facts-before.sql
```

3. 아래 **한 파일만** 실행한다. 기존 migration을 수정하거나 전체 공유 DB 이력을 재적용하지 않는다. CREATE OR REPLACE FUNCTION과 기존 grants 재확인만 있으며 테이블·인덱스·자료 변경은 없다.

```bash
psql "$COMMUNITY_MAP_DB_URL" -X -v ON_ERROR_STOP=1 \
  -f supabase/migrations/202610060100_cohort_facts_setwise.sql
```

4. 성공 후 공유 migration 이력에 버전/이름을 등록한다. SQL Editor로 실행할 경우도 파일 전체를 한 번에 적용한 뒤 같은 이력 등록을 수행한다. 비어 있는 `statements`는 이 저장소의 로컬 apply 스크립트와 같은 방식이다.

```sql
insert into supabase_migrations.schema_migrations(version, name, statements)
values ('202610060100', 'cohort_facts_setwise', array[]::text[]);
```

5. 함수의 `STABLE`, `SECURITY DEFINER`, 빈 `search_path`, `enable_nestloop=off`, service_role 전용 실행 권한을 확인한다. 기존 인증된 지도에서 전체 기간·연도·월·기관/담당자·지도 범위와 개인 비교를 두 날짜 기준으로 조회하고 응답/DB 실행시간을 확인한다. 100,000행 초과는 여전히 `RESULT_TOO_LARGE`다. 운영 측정은 이번 로컬 수치를 대신할 수 없다.

**Edge·Pages·Auth·앱 재배포는 필요 없다.** 기존 public-analytics/my-analytics가 같은 RPC 이름·인자로 수정된 함수를 호출한다. `internal_my_analytics_cohort_source`의 인증/메타데이터/행 의미를 바꾸지 않는다. 타임아웃을 늘리거나 전역 planner 설정을 바꾸지 않는다.

되돌리기는 보관한 함수 정의와 기존 권한을 새 forward migration으로 복원한다. 원본 정의는 `202610010100_single_date_cohort.sql`의 **첫 함수만**이다. 그 파일 전체를 실행하면 이미 개선된 cohort state까지 되돌리므로 금지한다. 자료/동의/version을 롤백하거나 RPC를 drop할 필요가 없다.

기존 관련 통합 검사는 로컬 스택에서 후보 SQL을 일시 적용하고 다음을 실행한 뒤 보관한 기존 함수 정의를 복원한다. 테스트의 합성 사용자 정리 후 projection 메타데이터도 백업값으로 복원했고 전체 54개 private/auth 테이블의 해시를 대조했다. 운영 DB에서 실행하지 않는다.

```bash
COMMUNITY_STACK=1 COMMUNITY_STACK_DIR=.integration-stack npx vitest run \
  tests/integration/date-basis-sql.test.ts \
  tests/integration/analytics-rollups.test.ts \
  tests/integration/gate-state-refactor-equivalence.test.ts \
  --maxWorkers=1 --no-file-parallelism
```

신규 rollback-only 검사·성능 재현:

```bash
npm ci
node scripts/integration/compose_supabase.mjs check --auth /path/to/safetyreport-community-auth
COMMUNITY_STACK=1 npx vitest run tests/integration/cohort-timeout.test.ts --maxWorkers=1
python3 scripts/benchmark/cohort_timeout.py --sizes 3000 30000 --plan-mode force_custom_plan --out .agent-runtime/cohort-recheck
python3 scripts/benchmark/cohort_timeout.py --sizes 3000 --plan-mode auto --out .agent-runtime/cohort-recheck
python3 scripts/benchmark/cohort_timeout.py --timeout-probe --out .agent-runtime/cohort-recheck
```

위 신규 테스트·벤치마크는 고정된 로컬 Docker `supabase_db_ci0926-int`만 사용한다. 매 실행의 BEGIN/ROLLBACK 안에서 합성 자료·함수 정의를 설치하고 복원한다. 같은 DB의 다른 테스트와 동시에 실행하지 않는다. `ANALYZE`/시퀀스/물리 통계는 원래 값으로 되감지 않으며, 제품 자료·함수·migration 이력은 유지한다.
