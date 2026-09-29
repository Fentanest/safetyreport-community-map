#!/usr/bin/env bash
# Reset shared community data on the LINKED Supabase project (testing only — not for a live service).
#
#   scripts/reset-community-data.sh                 # dry run: show what would be deleted (row counts)
#   scripts/reset-community-data.sh --apply         # delete uploaded data (asks you to type the project ref)
#   scripts/reset-community-data.sh --accounts      # dry run, also counting consent/connection/profile rows
#   scripts/reset-community-data.sh --accounts --apply
#   scripts/reset-community-data.sh --print-sql [--accounts]   # print the delete SQL only (no DB access)
#
# Default ("data") deletes what apps uploaded: report facts, ingest events, deletion tombstones/fences,
# the owner-transfer audit, legacy v2 upload tables and the rate-limit windows (so repeated tests are not throttled).
# --accounts also deletes share-consent grants, device connections, pending auth requests and contributor
# profiles (a profile is recreated at the next sign-in; apps then ask for consent again).
# Never deleted: policies, consent texts, disclosures, registry state, analytics state, auth.users, and
# manifest generations (the generation number must only grow — apps use it to notice server-side changes).
#
# Runs through `npx supabase db query --linked` (the project in supabase/.temp). Non-interactive runs can
# confirm with CONFIRM_PROJECT_REF=<ref>. After a reset, apps still remember what they already sent; use the
# app's re-share / initial crawl to upload again.
set -euo pipefail

cd "$(dirname "$0")/.."
apply=0
accounts=0
print_sql=0
for arg in "$@"; do
  case "$arg" in
    --apply) apply=1 ;;
    --accounts) accounts=1 ;;
    --print-sql) print_sql=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

ref_file=supabase/.temp/project-ref
[ -s "$ref_file" ] || { echo "no linked project ($ref_file missing): run 'npx supabase link' first" >&2; exit 1; }
ref=$(tr -d '[:space:]' < "$ref_file")

data_tables=(
  private.community_report_facts
  private.community_ingest_events
  private.community_fact_tombstones
  private.community_deletion_fences
  private.community_owner_transfer_audit
  private.report_facts_v2
  private.upload_points
  private.upload_chunks
  private.upload_snapshots
  private.abuse_events
  private.rate_limits
  private.community_auth_rate_limits
)
account_tables=(
  private.community_consent_grants
  private.community_connections
  private.community_auth_requests
  private.contributor_profiles
)
tables=("${data_tables[@]}")
[ "$accounts" = 1 ] && tables+=("${account_tables[@]}")

# Children before parents; one transaction so a failure leaves everything as it was.
sql="begin;"
for t in "${tables[@]}"; do
  sql+=" do \$\$ begin if to_regclass('$t') is not null then execute 'delete from $t'; end if; end \$\$;"
done
sql+=" commit;"
[ "$print_sql" = 1 ] && { echo "$sql"; exit 0; }

query() { npx --no-install supabase db query --linked -o json "$1" < /dev/null 2>/dev/null; }

counts_sql() {
  local parts=() t
  for t in "${tables[@]}"; do
    parts+=("select '$t' as tbl, (select count(*) from $t) as n where to_regclass('$t') is not null")
  done
  local IFS=$'\n'
  echo "${parts[*]/%/ union all}" | sed '$ s/ union all$//'
}

show_counts() {
  query "$(counts_sql)" | python3 -c '
import json, sys
t = sys.stdin.read()
if "{" not in t: sys.exit("no JSON from supabase db query (logged in? linked?):\n" + t)
# The CLI may print notices (e.g. an update hint) before or after the JSON: read the first object only.
rows = json.JSONDecoder().raw_decode(t[t.index("{"):])[0]["rows"]
for r in rows: print("  %-45s %8s" % (r["tbl"], r["n"]))
print("  %-45s %8d" % ("total", sum(int(r["n"]) for r in rows)))'
}

echo "project: $ref  mode: $([ "$accounts" = 1 ] && echo 'data + accounts' || echo data)"
echo "rows now:"
show_counts

if [ "$apply" = 0 ]; then
  echo "dry run — nothing deleted. Re-run with --apply to delete."
  exit 0
fi

confirm=${CONFIRM_PROJECT_REF:-}
if [ -z "$confirm" ]; then
  read -r -p "Type the project ref ($ref) to delete these rows: " confirm < /dev/tty
fi
[ "$confirm" = "$ref" ] || { echo "confirmation did not match — nothing deleted" >&2; exit 1; }

npx --no-install supabase db query --linked "$sql" < /dev/null > /dev/null || { echo "delete failed — the transaction was rolled back" >&2; exit 1; }
echo "deleted. rows now:"
show_counts
