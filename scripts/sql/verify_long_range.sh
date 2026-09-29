#!/usr/bin/env bash
# LOCAL check of supabase/migrations/202609300100_long_range_bounds.sql on a throwaway PostgreSQL (never a hosted DB).
#   PGHOST=/var/tmp/cmpg PGPORT=55432 bash scripts/sql/verify_long_range.sh
# The full migration chain needs the community-auth repository (consent lineage objects), which is not in this
# repository, so this script creates a MINIMAL stub of only the objects the two redefined functions read, then
# applies the real migration file and asserts the behaviour: 12-year range, 1826/1827-day boundaries, whole-history
# data_min/data_max, and the row budget refusing (not truncating) an over-budget scope.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DB=cm_long_range
Q() { psql -U postgres -v ON_ERROR_STOP=1 -qtA "$@"; }
Q -d postgres -c "drop database if exists $DB" >/dev/null
Q -d postgres -c "create database $DB" >/dev/null
Q -d $DB <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema private;
create table private.analytics_state (singleton boolean primary key default true, dataset_version text, ready boolean,
  source_updated_at timestamptz, generated_at timestamptz, published_at timestamptz, data_min date, data_max date,
  coverage_note text, dedupe_policy_version text);
insert into private.analytics_state values (true, 'v-local', true, null, now(), null, null, null, 'local', 'x');
create table private.contributor_profiles (user_id uuid primary key, status text not null default 'active');
create table private.community_consent_grants (grant_id uuid primary key, lineage_id uuid, revoked_at timestamptz, policy_version text);
create table private.community_policy_disclosures (version text primary key, amounts_public boolean, violation_law_public boolean, rating_public boolean);
create function private.community_lineage_active(uuid) returns boolean language sql stable as $f$
  select exists(select 1 from private.community_consent_grants g where g.grant_id = $1 and g.revoked_at is null) $f$;
create table private.community_report_facts (
  contributor_id uuid, dataset_key text, source_report_key text, consent_grant_id uuid, payload_sha256 text,
  public_state text, report_date date, completed_date date, category text, status text, disposition text,
  amount_kind text, amount_confirmed_won bigint, vehicle_raw text, lat double precision, lng double precision,
  address text, region_code text, point_key text, agency_key text, agency_name text, agency_current_name text,
  manager_key text, manager_name text, first_accepted_at timestamptz default now(), report_number text,
  violation_law text, rating integer, answer_accepted_at timestamptz default now());
insert into private.contributor_profiles values ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
insert into private.community_policy_disclosures values ('p', true, true, true);
insert into private.community_consent_grants values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', null, 'p');
-- one completed report per quarter from 2014-10 to 2026-09 (48 reports over 12 years) + 1 not completed
insert into private.community_report_facts (contributor_id, dataset_key, source_report_key, consent_grant_id, payload_sha256,
  public_state, report_date, completed_date, category, status, disposition, amount_kind, address)
select '00000000-0000-4000-8000-000000000001', 'd', md5(i::text), '00000000-0000-4000-8000-0000000000a1', 'h',
       'completed', date '2014-10-01' + (i * 91), date '2014-10-01' + (i * 91) + 10, 'parking', 'accepted', 'fine', 'fine', 'addr'
  from generate_series(0, 47) i;
insert into private.community_report_facts (contributor_id, dataset_key, source_report_key, consent_grant_id, payload_sha256,
  public_state, report_date, category, status, disposition, amount_kind)
values ('00000000-0000-4000-8000-000000000001', 'd', 'x', '00000000-0000-4000-8000-0000000000a1', 'h', 'not_completed', '2010-01-01', 'parking', 'processing', 'unknown', 'unknown');
SQL
fail=0
# BEFORE: the currently active definition (202609281800_rating.sql) must refuse the 12-year range (root cause)
python3 - "$ROOT/supabase/migrations/202609281800_rating.sql" > /tmp/cm_old_facts.sql <<'PY'
import sys
s = open(sys.argv[1]).read()
a = s.index("create or replace function public.internal_analytics_v2_facts(")
b = s.index("revoke all on function public.internal_analytics_v2_facts(date, date, text, text, text, text, double precision[])", a)
print(s[a:b])
PY
Q -d $DB -f /tmp/cm_old_facts.sql >/dev/null
out=$(Q -d $DB -c "select public.internal_analytics_v2_facts('2014-09-30','2026-09-29','all',null,null,null,null)" 2>&1 || true)
case "$out" in *INVALID_QUERY*) echo "  ok: BEFORE — active RPC refuses 2014-09-30..2026-09-29 with INVALID_QUERY (root cause, SQL layer)";; *) echo "  FAIL: before: $out"; fail=1;; esac
Q -d $DB -f "$ROOT/supabase/migrations/202609300100_long_range_bounds.sql" >/dev/null
check() { if [ "$2" = "$3" ]; then echo "  ok: $1 ($2)"; else echo "  FAIL: $1 expected $3 got $2"; fail=1; fi; }
n=$(Q -d $DB -c "select jsonb_array_length(public.internal_analytics_v2_facts('2014-09-30','2026-09-29','all',null,null,null,null))")
check "12-year range returns every completed fact" "$n" 48
n=$(Q -d $DB -c "select jsonb_array_length(public.internal_analytics_v2_facts('2021-01-01', date '2021-01-01' + 1826,'all',null,null,null,null)) >= 0")
check "1826-day span accepted" "$n" t
n=$(Q -d $DB -c "select jsonb_array_length(public.internal_analytics_v2_facts('2021-01-01', date '2021-01-01' + 1827,'all',null,null,null,null)) >= 0")
check "1827-day span accepted (old cap removed)" "$n" t
st=$(Q -d $DB -c "select public.internal_analytics_v2_state()->>'data_min' || '..' || (public.internal_analytics_v2_state()->>'data_max')")
check "state data_min..data_max = whole listed history (not-completed 2010 row excluded)" "$st" "2014-10-01..$(Q -d $DB -c "select (date '2014-10-01' + 47*91 + 10)::text")"
Q -d $DB -c "update private.analytics_state set data_min='2020-01-01'" >/dev/null
st=$(Q -d $DB -c "select public.internal_analytics_v2_state()->>'data_min'")
check "a maintained data_min still wins" "$st" 2020-01-01
out=$(Q -d $DB -c "select public.internal_analytics_v2_facts('2026-01-01','2025-01-01','all',null,null,null,null)" 2>&1 || true)
case "$out" in *INVALID_QUERY*) echo "  ok: reversed range refused";; *) echo "  FAIL: reversed range: $out"; fail=1;; esac
# budget: 100001 candidate rows → RESULT_TOO_LARGE (refused as a whole, not truncated)
Q -d $DB -c "insert into private.community_report_facts (contributor_id, dataset_key, source_report_key, consent_grant_id, payload_sha256,
  public_state, report_date, completed_date, category, status, disposition, amount_kind)
  select '00000000-0000-4000-8000-000000000002', 'e', md5('b'||i), '00000000-0000-4000-8000-0000000000a1', 'h', 'completed',
         '2026-01-02', '2026-01-03', 'traffic', 'rejected', 'none', 'unknown' from generate_series(1, 100001) i" >/dev/null
out=$(Q -d $DB -c "select jsonb_array_length(public.internal_analytics_v2_facts('2026-01-01','2026-01-31','parking',null,null,null,null))" 2>&1 || true)
case "$out" in *RESULT_TOO_LARGE*) echo "  ok: over-budget candidate set refused with RESULT_TOO_LARGE (even though the filtered result would be small)";; *) echo "  FAIL: budget: $out"; fail=1;; esac
Q -d postgres -c "drop database $DB" >/dev/null
[ $fail = 0 ] && echo "LONG RANGE SQL: PASS" || { echo "LONG RANGE SQL: FAIL"; exit 1; }
