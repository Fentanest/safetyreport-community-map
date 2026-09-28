// Registry-update recompute for stored facts (handoff §5/§9, migration 202609290100).
//
// Re-derives (agency_key, agency_current_name, manager_key) for stored
// community_report_facts from their untouched source columns
// (source_agency_code, agency_name, manager_name) with the CURRENT bundled
// snapshot — no re-upload, no identity/count/answer changes.
//
// Rules (same as the ingest path, incl. REVIEW4 preservation):
// - Row WITH source code: take the fresh derivation unconditionally (the code
//   is authoritative). Content-identical rows are a no-op.
// - Row WITHOUT code: keep the stored triple, EXCEPT a safe upgrade — stored
//   a1: key + fresh derivation resolves to an institution for the same name
//   (unique alias hit) → take the fresh triple. This never regresses an
//   inst: key back to a1: (the REVIEW4 split bug).
// - manager_key always follows the final agency_key with the ingest hash rule.
// - The DB trigger stamps derived-value updates; version-only updates explicitly
//   set agency_registry_version. Ordinary writes leave stale rows stale.
//
// Usage (service role; public internal_* RPCs access private facts).
// Node 22 type-stripping runs the edge's own TypeScript (no duplicate logic):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node --experimental-strip-types --no-warnings scripts/recompute-agency-keys.mjs --dry-run [--limit=N]
//   node --experimental-strip-types --no-warnings scripts/recompute-agency-keys.mjs --apply [--limit=N]
// --limit is the batch size (default 5000), not a total-row cap. Both modes
// continue until every stale row has been visited.
//
// Pure planning (planUpdates) is unit-tested in tests/product/recomputeAgencyKeys.test.ts
// without any database.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { deriveFact } from '../server/ingest/observation.ts';

const SNAP = new URL('../shared/agency-region-registry/manifest.json', import.meta.url);
const CURRENT_VERSION = JSON.parse(readFileSync(SNAP, 'utf8')).registry_version;

/** Minimal observation for derivation (only agency fields matter here). */
function observationOf(fact) {
  return {
    address: null,
    agency_name: fact.agency_name ?? null,
    amount: { confirmed_won: null, kind: 'unknown', penalty_points: null },
    category: 'other',
    completed_date: null,
    disposition: 'unknown',
    location: { lat: null, lng: null, source: 'none' },
    manager_name: fact.manager_name ?? null,
    report_date: null,
    status: 'accepted',
    status_raw: '수용',
    vehicle_raw: null,
    violation_law: null,
    source_agency_code: fact.source_agency_code ?? null,
    rating: null,
  };
}

/** Decide the new derived triple for one stored fact. Pure (tested). */
export async function planUpdate(fact) {
  const d = await deriveFact(observationOf(fact));
  const stored = {
    agency_key: fact.agency_key ?? null,
    agency_current_name: fact.agency_current_name ?? null,
    manager_key: fact.manager_key ?? null,
  };
  const fresh = {
    agency_key: d.agency_key,
    agency_current_name: d.agency_current_name,
    manager_key: d.manager_key,
  };
  const hasCode =
    fact.source_agency_code !== null && fact.source_agency_code !== undefined;
  let next = fresh;
  let reason = 'code-present';
  if (!hasCode) {
    const storedIsNameHash =
      typeof stored.agency_key === 'string' && stored.agency_key.startsWith('a1:');
    const freshIsInstitution =
      typeof fresh.agency_key === 'string' && fresh.agency_key.startsWith('inst:');
    if (storedIsNameHash && freshIsInstitution) {
      reason = 'codeless-alias-upgrade';
    } else {
      next = stored;
      reason = 'codeless-keep';
    }
  }
  const changed =
    next.agency_key !== stored.agency_key ||
    next.agency_current_name !== stored.agency_current_name ||
    next.manager_key !== stored.manager_key;
  return { next, changed, reason, version: CURRENT_VERSION };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 5000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) throw new Error('--limit must be an integer from 1 to 5000');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required');
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: state, error: stateError } = await db.rpc('internal_agency_recompute_state');
  if (stateError) throw stateError;
  if (state !== CURRENT_VERSION) {
    throw new Error(`Database registry ${state} differs from bundle ${CURRENT_VERSION}`);
  }
  let scanned = 0;
  let changed = 0;
  let kept = 0;
  let applied = 0;
  let skipped = 0;
  let cursor = null;
  const examples = [];
  while (true) {
    const { data, error } = await db.rpc('internal_agency_recompute_page', {
      p_version: CURRENT_VERSION,
      p_limit: limit,
      p_after_contributor_id: cursor?.contributor_id ?? null,
      p_after_dataset_key: cursor?.dataset_key ?? null,
      p_after_source_report_key: cursor?.source_report_key ?? null,
    });
    if (error) throw error;
    if (!data?.length) break;
    scanned += data.length;
    const updates = [];
    for (const fact of data) {
      const plan = await planUpdate(fact);
      if (plan.changed) {
        changed++;
        if (examples.length < 5) examples.push({
          agencyName: fact.agency_name,
          before: fact.agency_current_name,
          after: plan.next.agency_current_name,
          reason: plan.reason,
        });
      } else kept++;
      updates.push({
        contributor_id: fact.contributor_id,
        dataset_key: fact.dataset_key,
        source_report_key: fact.source_report_key,
        source_agency_code: fact.source_agency_code,
        agency_name: fact.agency_name,
        manager_name: fact.manager_name,
        expected_agency_key: fact.agency_key,
        expected_agency_current_name: fact.agency_current_name,
        expected_manager_key: fact.manager_key,
        expected_agency_registry_version: fact.agency_registry_version,
        ...plan.next,
      });
    }
    if (!dryRun) {
      const { data: result, error: applyError } = await db.rpc('internal_agency_recompute_apply', {
        p_version: CURRENT_VERSION, p_updates: updates,
      });
      if (applyError) throw applyError;
      applied += result.applied;
      skipped += result.skipped;
    }
    cursor = data.at(-1);
  }
  console.log(JSON.stringify(dryRun
    ? { mode: 'dry-run', scanned, changed, versionStampOnly: kept, examples }
    : { mode: 'apply', scanned, changed, versionStampOnly: kept, applied, skipped, registryVersion: CURRENT_VERSION }));
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  await main();
}
