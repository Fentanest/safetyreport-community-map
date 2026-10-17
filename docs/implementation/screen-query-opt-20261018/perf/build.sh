#!/usr/bin/env bash
# Usage: build.sh SIZE extra.sql > run.sql  (synthetic fixture inside BEGIN..ROLLBACK; MIGS=extra migration files applied before the seed)
# Then: docker exec -i supabase_db_ci0926-int psql -X -U supabase_admin -d postgres -qAt -v ON_ERROR_STOP=1 < run.sql
set -euo pipefail
cd "$(dirname "$0")/../../../.."
SIZE=$1; EXTRA=$2
echo "begin;"
for n in $(ls supabase/migrations | grep -E '^202610060[1-9]00_' | grep -v 0800_ | sort) 202610061000_screen_aggregate_opt.sql 202610110100_five_categories.sql 202610121200_fine_estimate_columns.sql 202610121201_fine_estimate_ingest_aggregate.sql 202610121300_screen_result_cache.sql 202610121400_screen_cache_stale.sql 202610130100_screen_plate_normalization.sql 202610131000_motorcycle_plate.sql 20261014132612_remove_analytics_row_limit.sql ${MIGS:-}; do
  sed -E 's/^(begin|commit);\s*$//' supabase/migrations/$n
done
sed -e "s/__SIZE__/$SIZE/g" \
 -e "s/37.0+(k%50)\*0.01/37.0+(k%5000)*0.0001/; s/127.0+(k%50)\*0.01/127.0+(k%4999)*0.0001/" \
 -e "s/'합성 주소', 'point-'||k%50, null/case when k%23=0 then null else '경기 수원시 장안구 정자동 '||(k%20000)||'-1 앞' end, 'point-'||k%50, case when g%9=0 then null when g%5=0 then '경기'||(10+k%89)||'자'||lpad((k%9999)::text,4,'0') else (100+k%899)||'가'||lpad((k%9999)::text,4,'0') end/" \
 tests/integration/helpers/cohort-timeout-seed.sql
echo "update private.analytics_state set ready=true,data_min=null,data_max=null;"
cat "$EXTRA"
echo "rollback;"
