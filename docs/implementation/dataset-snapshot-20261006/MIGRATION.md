# SQL → Edge → Pages 운영자 적용 절차

아래 명령은 이번 작업에서 **실행하지 않았다**. 운영 접속·배포·push 없이 로컬 검증과 저장소별 커밋만 수행한다. 공유 manifest가 auth/map SQL의 정본 순서와 해시를 제공한다.

1. 운영자가 실제 `supabase_migrations.schema_migrations`를 확인한다. 기존 map `202610040800`까지의 모든 선행 migration이 있어야 한다. 현재 운영 상태는 이 감사에서 확인하지 않았다.
2. 교체할 함수 정의·ACL, fact 트리거 정의와 relay FK를 별도 보관한다. 자료나 동의 상태를 롤백하지 않는다.
3. 아직 없을 때만 다음 순서로 적용한다: **auth `202610050100` → map `202610060100` → `202610060200` → `202610060300` → `202610060400` → `202610060500`**. auth hardening은 relay 기존 보완이며 새 map 성능 수정이 그 FK 변경에 의존하는 것은 아니다. 공유 이력의 시간 순서를 유지한다.

```bash
# 운영자 환경의 경로/접속값만 사용한다. 실제 운영 값은 문서나 로그에 넣지 않는다.
AUTH_REPO=/path/to/auth-perf
MAP_REPO=/path/to/map-cohort

# 미적용 버전에 대해서만 실행한다. AUTH 파일은 자체 BEGIN/COMMIT이 없어 -1로 묶는다.
psql "$COMMUNITY_MAP_DB_URL" -X -v ON_ERROR_STOP=1 -1 \
  -f "$AUTH_REPO/supabase/migrations/202610050100_relay_hardening.sql"
psql "$COMMUNITY_MAP_DB_URL" -X -v ON_ERROR_STOP=1 \
  -f "$MAP_REPO/supabase/migrations/202610060100_cohort_facts_setwise.sql"
psql "$COMMUNITY_MAP_DB_URL" -X -v ON_ERROR_STOP=1 \
  -f "$MAP_REPO/supabase/migrations/202610060200_query_read_paths.sql"
psql "$COMMUNITY_MAP_DB_URL" -X -v ON_ERROR_STOP=1 \
  -f "$MAP_REPO/supabase/migrations/202610060300_manifest_statement_batches.sql"
psql "$COMMUNITY_MAP_DB_URL" -X -v ON_ERROR_STOP=1 \
  -f "$MAP_REPO/supabase/migrations/202610060400_agency_recompute_batch.sql"
psql "$COMMUNITY_MAP_DB_URL" -X -v ON_ERROR_STOP=1 \
  -f "$MAP_REPO/supabase/migrations/202610060500_rollup_region_inputs.sql"
psql "$COMMUNITY_MAP_DB_URL" -X -v ON_ERROR_STOP=1 \
  -f "$MAP_REPO/supabase/migrations/202610060600_analytics_read_snapshot.sql"
```

각 파일이 성공한 직후 해당 버전 하나만 migration 이력에 등록한다. 이미 등록된 버전은 다시 적용하거나 덮어쓰지 않는다.

```sql
-- 예: 060200 성공 뒤 실행. 다른 버전도 파일 이름과 일치하는 name으로 개별 등록한다.
insert into supabase_migrations.schema_migrations(version,name,statements)
values ('202610060200','query_read_paths',array[]::text[]);
```

`060300`은 짧게 fact 테이블 DDL lock을 잡는다. 쓰기 트래픽이 낮은 시간에 적용하고 운영자 lock 대기를 확인한다. 새 인덱스 생성이나 테이블 재작성은 없다. bulk INSERT/DELETE는 transaction-local 전이 테이블을 쓰므로 큰 배치는 메모리/임시 파일 비용이 있다. 실제 ingest의 최대 20개 이벤트 흐름과 1건 INSERT도 별도로 측정한다.

**TASK2 쿼리 감사만은 SQL 변경이지만 TASK3 화면 스냅샷까지 적용할 때는 SQL → Edge → Pages를 모두 반영해야 한다.** 아래 후속 명령을 이어서 실행한다. auth worktree의 테스트 도구 변경도 제품에 배포하지 않는다. SQL 적용 후 기존 인증 경로로 meta·지도 전체/월·개인 통계·랭킹·업로드/manifest/삭제를 검증하고, 기관 재계산은 동일 CAS 조건의 작은 배치로 적용/건너뜀 수를 확인한다. 익명/일반 authenticated 역할에 service RPC 실행 권한을 추가하지 않는다.

되돌릴 경우 보관한 함수 및 fact trigger 정의를 **새 forward migration**으로 복원한다. 새 statement INSERT/DELETE 트리거를 먼저 제거하고 원래 단일 ROW 트리거를 복원한 뒤 batch trigger 함수 2개를 제거한다. 이미 진행한 generation·동의·삭제 fence·dataset version을 과거 값으로 되돌리지 않는다. auth `050100` 보완은 성능 변경과 별개이므로 이번 성능 롤백 때문에 되돌리지 않는다.


## TASK3까지 한 번에 반영할 Edge → Pages 명령

위 SQL이 모두 성공하고 이력이 등록된 뒤, 운영자가 최종 map 커밋에서 실행한다. `SUPABASE_PROJECT_REF`는 운영자가 지정한 공유 프로젝트 ref, `MAP_REPO`는 해당 최종 커밋 체크아웃이다. 이번 작업에서는 아래 명령을 실행하지 않았다.

```bash
cd "$MAP_REPO"
node scripts/integration/compose_supabase.mjs check --auth "$AUTH_REPO"
npx supabase functions deploy public-analytics --project-ref "$SUPABASE_PROJECT_REF"
npx supabase functions deploy my-analytics --project-ref "$SUPABASE_PROJECT_REF"
npx supabase functions deploy user-rankings --project-ref "$SUPABASE_PROJECT_REF"
# SQL과 Edge 확인 뒤 운영자가 최종 커밋을 main에 반영/push한 다음:
gh workflow run publish-pages.yml --repo Fentanest/safetyreport-community-map --ref main
gh run list --repo Fentanest/safetyreport-community-map --workflow publish-pages.yml --limit 1
```

기존 `verify_jwt=true`와 Origin·서버 비밀값은 그대로 사용한다. `--no-verify-jwt`나 DB 권한 확장은 하지 않는다. Pages workflow는 main에서만 실행되며 public URL/Kakao/로그인 설정은 기존 repository variables를 쓴다. 새 RPC와 서버 코드가 먼저 준비되어야 새 웹의 `my-analytics/screen`이 동작한다. 기존 public DTO/앱 API는 하위호환이다. 최종 보고서의 commit과 main SHA를 운영자가 대조한 후 실행한다.

화면 수정 롤백은 웹을 이전 main으로 먼저 돌리고 Edge를 이전 버전으로 돌린다. 추가 RPC/랭킹의 optional latest 모드는 구형 API를 깨지 않으므로 긴급 삭제할 필요가 없다. SQL 롤백이 필요하면 원래 함수/권한을 새 forward migration으로 복원한다. 자료·동의·version을 과거 값으로 되돌리지 않는다.
