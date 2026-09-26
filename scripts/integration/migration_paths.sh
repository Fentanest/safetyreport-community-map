#!/usr/bin/env bash
# Composed migration paths on the LOCAL integration stack (plan-final §20-1). Never run against a hosted project.
#   bash scripts/integration/migration_paths.sh
# Needs: composed .integration-stack running (project ci0926-int). Uses a sibling workdir with the same config and
# a controlled migrations/ directory; every path starts from `supabase db reset` (local DB only) and applies the
# remaining files with `supabase migration up --include-all`. At the end the stack is reset to the full history.
# Paths: empty → all | map first (map1,map2) | auth first (relay) | both (map1,map2,relay) | both + public legacy v2
# facts (the ingest migration must stop with LEGACY_SNAPSHOT_DATA_PRESENT and leave nothing half-applied).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
STACK="$ROOT/.integration-stack"
WORK="$ROOT/.integration-paths"
CLI="$ROOT/node_modules/.bin/supabase"
DB=supabase_db_ci0926-int
M="$STACK/supabase/migrations"
MAP1=202608150001_initial_schema.sql; MAP2=202609240001_analytics_v2.sql; RELAY=202609251200_community_auth_relay.sql
ACC=202609260100_community_account_registry.sql; ING=202609260200_community_ingest.sql
ALL=("$MAP1" "$MAP2" "$RELAY" "$ACC" "$ING")

psqlq() { docker exec -i "$DB" psql -U postgres -d postgres -tAq -v ON_ERROR_STOP=1 -c "$1"; }
prepare() {  # $@ = initial files
  rm -rf "$WORK"; mkdir -p "$WORK/supabase/migrations"
  cp "$STACK/supabase/config.toml" "$WORK/supabase/config.toml"; chmod 600 "$WORK/supabase/config.toml"
  for f in "$@"; do cp "$M/$f" "$WORK/supabase/migrations/"; done
  (cd "$WORK" && "$CLI" db reset --workdir . --no-seed >/dev/null 2>&1) || { echo "reset failed"; exit 1; }
}
add_rest() { for f in "${ALL[@]}"; do cp -n "$M/$f" "$WORK/supabase/migrations/" 2>/dev/null || true; done; }
up() { (cd "$WORK" && "$CLI" migration up --include-all --workdir . 2>&1); }
verify_full() {
  local n; n=$(psqlq "select count(*) from supabase_migrations.schema_migrations where version in ('202608150001','202609240001','202609251200','202609260100','202609260200');")
  [ "$n" = "5" ] || { echo "  FAIL: $n/5 migrations recorded"; return 1; }
  for obj in "public.internal_community_ingest(uuid,uuid,text,jsonb,jsonb)" "public.internal_account_status(uuid,uuid,uuid)"; do
    psqlq "select '$obj'::regprocedure;" >/dev/null 2>&1 || { echo "  FAIL: missing $obj"; return 1; }
  done
  [ "$(psqlq "select count(*) from information_schema.role_table_grants where table_schema='private' and grantee in ('anon','authenticated','PUBLIC');")" = "0" ] \
    || { echo "  FAIL: private grants to client roles"; return 1; }
  echo "  ok: 5/5 recorded, ingest/account RPCs present, no client grants on private"
}
fail=0
run_path() {  # name, initial files...
  local name=$1; shift
  echo "== path: $name (initial: ${*:-none})"
  prepare "$@"; add_rest
  if out=$(up); then verify_full || fail=1; else echo "  FAIL: migration up"; echo "$out" | tail -5; fail=1; fi
}

run_path empty
run_path map-first "$MAP1" "$MAP2"
run_path auth-first "$RELAY"
run_path both "$MAP1" "$MAP2" "$RELAY"

echo "== path: both + public legacy v2 facts (guard)"
prepare "$MAP1" "$MAP2" "$RELAY" "$ACC"
psqlq "insert into auth.users(id, instance_id, aud, role, email, created_at, updated_at) values ('00000000-0000-4000-8000-00000000c0de','00000000-0000-0000-0000-000000000000','authenticated','authenticated','legacy@example.invalid',now(),now());
insert into private.contributor_profiles(user_id, consent_version, privacy_policy_version) values ('00000000-0000-4000-8000-00000000c0de','legacy','legacy');
insert into private.upload_snapshots(id, user_id, schema_version, source_mode, state, client_generated_at, expected_point_count, payload_sha256)
  values ('00000000-0000-4000-8000-0000000051a9','00000000-0000-4000-8000-00000000c0de',2,'safetyreport_server','active',now(),1,repeat('a',64));
insert into private.report_facts_v2(snapshot_id, fact_identity, report_date, category, status, disposition, point_key, lat, lng)
  values ('00000000-0000-4000-8000-0000000051a9','legacy-1','2026-09-01','parking','accepted','fine','p1',37.5,127.0);" >/dev/null
add_rest
if out=$(up); then echo "  FAIL: ingest migration applied over public legacy facts"; fail=1
elif echo "$out" | grep -q LEGACY_SNAPSHOT_DATA_PRESENT; then
  recorded=$(psqlq "select count(*) from supabase_migrations.schema_migrations where version='202609260200';")
  exists=$(psqlq "select to_regclass('private.community_ingest_events') is not null;")
  if [ "$recorded" = "0" ] && [ "$exists" = "f" ]; then echo "  ok: stopped with LEGACY_SNAPSHOT_DATA_PRESENT, nothing half-applied"; else echo "  FAIL: partial apply ($recorded, $exists)"; fail=1; fi
  # operator decision (deployment-and-rollback.md): retire the legacy snapshot, then the migration applies
  psqlq "update private.upload_snapshots set state='superseded', superseded_at=now() where id='00000000-0000-4000-8000-0000000051a9';" >/dev/null
  if up >/dev/null; then verify_full || fail=1; echo "  ok: applies after the legacy snapshot is retired"; else echo "  FAIL: up after retire"; fail=1; fi
else echo "  FAIL: unexpected error"; echo "$out" | tail -5; fail=1; fi

echo "== restore the integration stack to the full composed history"
(cd "$STACK" && "$CLI" db reset --workdir . --no-seed >/dev/null 2>&1) && echo "  ok" || { echo "  FAIL: restore"; fail=1; }
rm -rf "$WORK"
[ $fail = 0 ] && echo "MIGRATION PATHS: PASS" || { echo "MIGRATION PATHS: FAIL"; exit 1; }
