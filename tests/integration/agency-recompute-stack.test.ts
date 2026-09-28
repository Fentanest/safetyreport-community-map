// Composed local Supabase stack only. Set COMMUNITY_STACK_DIR to the compose --out
// directory and run with COMMUNITY_STACK=1 after start (default: .integration-stack).
// Exercises the public service-role bridge without exposing the private schema.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { planUpdate } from '../../scripts/recompute-agency-keys.mjs';

const enabled = process.env.COMMUNITY_STACK === '1';
const API = process.env.COMMUNITY_API_URL ?? 'http://127.0.0.1:56321';
const DB_CONTAINER = process.env.COMMUNITY_DB_CONTAINER ?? 'supabase_db_ci0926-int';
const STACK_DIR = process.env.COMMUNITY_STACK_DIR ?? '.integration-stack';
let keys: { ANON_KEY: string; SERVICE_ROLE_KEY: string };

function sql(query: string): string {
  return execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAq', '-v', 'ON_ERROR_STOP=1'],
    { input: query, encoding: 'utf8' }).trim();
}
function run(mode: '--dry-run' | '--apply', batch = 2) {
  return JSON.parse(execFileSync(process.execPath,
    ['--experimental-strip-types', '--no-warnings', 'scripts/recompute-agency-keys.mjs', mode, `--limit=${batch}`],
    { encoding: 'utf8', env: { ...process.env, SUPABASE_URL: API, SUPABASE_SERVICE_ROLE_KEY: keys.SERVICE_ROLE_KEY } }));
}

describe.skipIf(!enabled)('agency registry recompute RPCs on local stack', () => {
  beforeAll(() => {
    keys = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json', '--workdir', STACK_DIR], { encoding: 'utf8' }));
  });

  it('rejects anon/authenticated, preserves source fields, and converges after apply', async () => {
    const svc = createClient(API, keys.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const email = `agency-recompute-${randomUUID()}@example.invalid`;
    const password = `Pw-${randomUUID()}`;
    const { data: created, error: createError } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    expect(createError).toBeNull();
    const uid = created.user!.id;
    const dataset = createHash('sha256').update(randomUUID()).digest('hex');
    const reports = Array.from({ length: 3 }, () => createHash('sha256').update(randomUUID()).digest('hex'));
    const uuid = () => randomUUID();
    try {
      const version = (await svc.rpc('internal_agency_recompute_state')).data;
      expect(version).toBe('2026-09-29.2');
      const insert = reports.map((report, i) => `
        ('${uid}', '${dataset}', '${report}', 'local-${i}', '${uuid()}', '${uuid()}', 1, 1,
         '${'a'.repeat(64)}', 'completed', 'other', 'accepted', 'none', 'unknown', 'none',
         ${i === 2 ? 'null' : "'1812314'"}, '${i === 2 ? '어딘가구청' : '광주광역시경찰청'}', '김담당',
         'a1:oldseedhash00000000000000', '광주광역시경찰청', 'm1:oldseedhash00000000000000', '2026-09-28.1')`).join(',');
      sql(`insert into private.community_report_facts (
        contributor_id, dataset_key, source_report_key, source_report_id, latest_receipt_id,
        consent_grant_id, writer_epoch, source_revision, payload_sha256, public_state,
        category, status, disposition, amount_kind, coord_source, source_agency_code,
        agency_name, manager_name, agency_key, agency_current_name, manager_key, agency_registry_version)
        values ${insert};
        -- INSERT trigger stamps the singleton; emulate facts derived by an older bundle.
        update private.community_report_facts set agency_registry_version='2026-09-28.1'
         where contributor_id='${uid}';`);

      // PostgREST must not offer private directly, and all three bridge RPCs deny both roles.
      const userClient = createClient(API, keys.ANON_KEY, { auth: { persistSession: false } });
      const { data: signedIn, error: loginError } = await userClient.auth.signInWithPassword({ email, password });
      expect(loginError).toBeNull();
      for (const token of [keys.ANON_KEY, signedIn.session!.access_token]) {
        for (const [name, args] of [
          ['internal_agency_recompute_state', {}],
          ['internal_agency_recompute_page', { p_version: version, p_limit: 1 }],
          ['internal_agency_recompute_apply', { p_version: version, p_updates: [] }],
        ] as const) {
          const res = await fetch(`${API}/rest/v1/rpc/${name}`, { method: 'POST', headers: {
            apikey: keys.ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json',
          }, body: JSON.stringify(args) });
          expect([401, 403, 404]).toContain(res.status);
        }
      }
      const privateDirect = await fetch(`${API}/rest/v1/community_report_facts?select=source_report_key&limit=1`, {
        headers: { apikey: keys.SERVICE_ROLE_KEY, authorization: `Bearer ${keys.SERVICE_ROLE_KEY}`,
          'accept-profile': 'private' },
      });
      expect(privateDirect.status).toBe(406);
      expect((await privateDirect.json()).code).toBe('PGRST106');
      const { data: page, error: pageError } = await svc.rpc('internal_agency_recompute_page', {
        p_version: version, p_limit: 5000,
      });
      expect(pageError).toBeNull();
      const readRow = page!.find((row: { contributor_id: string }) => row.contributor_id === uid);
      expect(readRow).toBeDefined();
      const plan = await planUpdate(readRow);
      // A derived value changed after page read must make the old proposal skip.
      sql(`update private.community_report_facts set agency_current_name='경합 수정'
        where contributor_id='${uid}' and source_report_key='${readRow.source_report_key}';
        update private.community_report_facts set agency_registry_version='2026-09-28.1'
        where contributor_id='${uid}' and source_report_key='${readRow.source_report_key}';`);
      const proposal = { ...readRow, expected_agency_key: readRow.agency_key,
        expected_agency_current_name: readRow.agency_current_name,
        expected_manager_key: readRow.manager_key,
        expected_agency_registry_version: readRow.agency_registry_version, ...plan.next };
      const { data: conflict, error: conflictError } = await svc.rpc('internal_agency_recompute_apply', {
        p_version: version, p_updates: [proposal],
      });
      expect(conflictError).toBeNull();
      expect(conflict).toEqual({ applied: 0, skipped: 1 });
      const { error: mismatch } = await svc.rpc('internal_agency_recompute_apply', {
        p_version: 'wrong-bundle-version', p_updates: [],
      });
      expect(mismatch).not.toBeNull();
      const before = sql(`select json_agg(row_to_json(x)) from (
        select source_report_key, source_agency_code, agency_name, manager_name,
               agency_key, agency_current_name, manager_key, agency_registry_version
        from private.community_report_facts where contributor_id='${uid}' order by source_report_key) x`);
      const expected = await Promise.all(JSON.parse(before).map((f: Record<string, unknown>) => planUpdate(f)));
      const dry = run('--dry-run');
      expect(dry.mode).toBe('dry-run');
      expect(dry.changed).toBeGreaterThanOrEqual(2);
      expect(dry.examples.length).toBeGreaterThan(0);
      expect(sql(`select json_agg(row_to_json(x)) from (
        select source_report_key, source_agency_code, agency_name, manager_name,
               agency_key, agency_current_name, manager_key, agency_registry_version
        from private.community_report_facts where contributor_id='${uid}' order by source_report_key) x`)).toBe(before);

      const applied = run('--apply');
      expect(applied.applied).toBeGreaterThanOrEqual(3);
      expect(applied.skipped).toBe(0);
      const after = JSON.parse(sql(`select json_agg(row_to_json(x)) from (
        select source_report_key, source_agency_code, agency_name, manager_name,
               agency_key, agency_current_name, manager_key, agency_registry_version
        from private.community_report_facts where contributor_id='${uid}' order by source_report_key) x`));
      JSON.parse(before).forEach((old: Record<string, unknown>, i: number) => {
        expect(after[i]).toMatchObject({ source_report_key: old.source_report_key,
          source_agency_code: old.source_agency_code, agency_name: old.agency_name,
          manager_name: old.manager_name, ...expected[i].next,
          agency_registry_version: version });
      });
      const again = run('--apply');
      expect(again).toMatchObject({ scanned: 0, changed: 0, applied: 0, skipped: 0 });
    } finally {
      sql(`delete from private.community_report_facts where contributor_id='${uid}';`);
      await svc.auth.admin.deleteUser(uid);
    }
  }, 120_000);
});
