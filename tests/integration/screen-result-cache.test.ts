/** Real local PostgreSQL 17. Each test rolls schema + synthetic fixtures back; never accepts a DSN. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createScreenHandler } from '../../server/screenHandler';
import { dashboardResponseSchema } from '../../src/data/schema';
import { personalCompareSchema } from '../../src/data/personal';
import { placeKeyOf } from '../../server/places';
const migrations = [...readdirSync('supabase/migrations').filter(n => /^202610060[1-9]00_/.test(n) && !n.includes('0800_')).sort(),
  '202610061000_screen_aggregate_opt.sql', '202610110100_five_categories.sql', '202610121200_fine_estimate_columns.sql',
  '202610121201_fine_estimate_ingest_aggregate.sql', '202610121300_screen_result_cache.sql']
  .map(n => readFileSync(`supabase/migrations/${n}`, 'utf8').replace(/^(begin|commit);\s*$/gm, '')).join('\n');
const seed = readFileSync('tests/integration/helpers/cohort-timeout-seed.sql', 'utf8').replaceAll('__SIZE__', '1200');
const setup = `begin;${migrations}\n${seed}\nupdate private.analytics_state set ready=true,data_min=null,data_max=null;`;
const sql = (body: string) => execFileSync('docker', ['exec', '-i', 'supabase_db_ci0926-int', 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'],
  { input: `${setup}\n${body}\nrollback;`, encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024 })
  .split('\n').filter(s => s.startsWith('{')).map(s => JSON.parse(s));
const scope = { date_basis: 'completed_date', start: '2023-01-01', end: '2026-10-12', category: 'all' };
const panels = [{ id: 'entities', path: 'entities', params: { kind: 'agency' } }, { id: 'laws', path: 'laws', params: {} },
  { id: 'compare', path: 'compare', params: {} }, { id: 'focus', path: `places/${placeKeyOf('합성 주소')}`, params: {} }];
const quote = (v: unknown) => `'${JSON.stringify(v).replaceAll("'", "''")}'`;
const cached = (s = scope, ps: unknown = panels, user = 'u.id', session = 'u.session_id') =>
  `public.internal_analytics_screen_cached(${quote(s)},${quote(ps)},${user},${session})`;
const baseline = (s = scope, ps: unknown = panels) => `public.internal_analytics_read_snapshot(${quote(s)},true,p_user=>u.id,p_session=>u.session_id,p_options=>${quote({ screen_encoding: 'screen-aggregate-v2', panels: ps })})`;
const read = (expr: string, idx = 1) => `select ${expr} from cohort_users u where idx=${idx};`;
const user = (idx = 1) => createHash('md5').update(`cohort-timeout-user-${idx}`).digest('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
async function replay(source: any, s = scope, ps = panels, idx = 1) {
  const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user(idx), role: 'authenticated', aud: 'authenticated', session_id: '11111111-2222-4333-8444-555555555555' })).toString('base64url')}.sig`;
  const handler = createScreenHandler({ enabled: true, allowedOrigins: [], jwtIssuer: null, getUser: async () => ({ id: user(idx), isAnonymous: false }),
    rpc: async name => name.endsWith('rate_limit') ? true : source });
  const response = await handler(new Request(`https://local.invalid/my-analytics/screen?${new URLSearchParams({ ...s, panels: JSON.stringify(ps) })}`,
    { headers: { Authorization: `Bearer ${token}` } }));
  return { status: response.status, body: await response.json() };
}
function strict(packet: any) {
  dashboardResponseSchema.parse(packet.dashboard);
  personalCompareSchema.parse(packet.panels.find((p: any) => p.id === 'compare').body);
  expect(JSON.stringify(packet)).not.toMatch(/SPP-2026-|cohort-key-|vehicle_raw|report_identity|contributor_id/);
  expect(JSON.stringify(packet)).not.toContain(user());
}

describe.skipIf(process.env.SCREEN_CACHE_STACK !== '1')('exact-version split result cache (local rollback)', () => {
  it('cold, warm, different-account partial hit equal the current fine-estimate/five-category baseline', async () => {
    const rows = sql(`
      update private.community_report_facts set vehicle_raw='경기76자3623',amount_confirmed_won=null,
        fine_estimate_won=40000,fine_estimate_rule='parking',fine_estimate_rule_version='fixture-v1' where disposition='fine';
      ${read(baseline())}${read(cached())}${read(cached())}${read(baseline(), 2)}${read(cached(), 2)}
      select json_build_object('shared',payload) from private.screen_result_cache where slot<32;`);
    expect(rows[1].cache).toEqual({ state_hit: false, public_hit: false, personal_hit: false });
    expect(rows[2].cache).toEqual({ state_hit: true, public_hit: true, personal_hit: true });
    expect(rows[4].cache).toEqual({ state_hit: true, public_hit: true, personal_hit: false });
    const expected = await replay(rows[0]); strict(expected.body);
    expect(await replay(rows[1])).toEqual(expected); expect(await replay(rows[2])).toEqual(expected);
    expect(await replay(rows[4], scope, panels, 2)).toEqual(await replay(rows[3], scope, panels, 2));
    expect(rows[5].shared.stats.every((s: any) => s.side === 'all')).toBe(true);
    expect(rows[5].shared.full.every((f: any) => f[4] === false)).toBe(true);
    expect(JSON.stringify(rows[5])).not.toContain(user());
    expect(JSON.stringify(expected.body)).not.toContain('경기76자3623');
  }, 180000);

  it('preserves date axes, five categories, empty/single-day scopes and parameter canonicalization', async () => {
    const cases = ['completed_date', 'report_date'].flatMap(date_basis => ['all', 'traffic', 'parking', 'safety', 'living', 'other'].map(category => ({ ...scope, date_basis, category })));
    cases.push({ ...scope, start: '2023-01-03', end: '2023-01-03' }, { ...scope, start: '2040-01-01', end: '2040-01-31' });
    const rows = sql(`update private.community_report_facts set category=case when category='other' then 'safety' when category='traffic' then 'living' else category end;
      ${cases.map(s => read(baseline(s)) + read(cached(s)) + read(cached(s))).join('\n')}`);
    for (let i = 0; i < cases.length; i++) {
      expect(await replay(rows[i * 3 + 1], cases[i])).toEqual(await replay(rows[i * 3], cases[i]));
      expect(rows[i * 3 + 2].cache.public_hit).toBe(true);
    }
    const canonical = sql(read(cached()) + read(cached(Object.fromEntries(Object.entries(scope).reverse()) as typeof scope,
      [...panels].reverse().map(p => ({ ...p, id: `x-${p.id}`, params: { page: '2' } })))));
    expect(canonical[1].cache).toEqual({ state_hit: true, public_hit: true, personal_hit: true });
  }, 180000);

  it('invalidates payload updates, other-user deletion and disclosure policy changes without stale amount leaks', async () => {
    const rows = sql(`${read(cached())}
      update private.community_report_facts set amount_kind='fine',amount_confirmed_won=777777,status='accepted',disposition='fine' where contributor_id=(select id from cohort_users where idx=1);
      ${read(cached())}${read(baseline())}
      update private.community_policy_disclosures set amounts_public=false;
      ${read(cached())}${read(baseline())}
      delete from private.community_report_facts where contributor_id=(select id from cohort_users where idx=2);
      ${read(cached())}${read(baseline())}`);
    for (const i of [1, 3, 5]) {
      expect(rows[i].cache.public_hit).toBe(false); expect(rows[i].cache.personal_hit).toBe(false);
      expect(await replay(rows[i])).toEqual(await replay(rows[i + 1]));
      expect(rows[i].state.dataset_version).not.toBe(rows[0].state.dataset_version);
    }
    const hidden = (await replay(rows[3])).body;
    expect(hidden.dashboard.overview.fine_amount).toMatchObject({ confirmed_count: 0, sum_won: null, mean_won: null });
    expect(hidden.panels.find((p: any) => p.id === 'compare').body.mine.fine_amount.sum_won).toBeNull();
  }, 180000);

  it('rechecks sessions, Kakao, active consent and ten-report eligibility on an already warm cache', async () => {
    for (const mutation of [
      `delete from auth.sessions where user_id=(select id from cohort_users where idx=1)`,
      `delete from auth.identities where user_id=(select id from cohort_users where idx=1)`,
      `update private.contributor_profiles set status='suspended' where user_id=(select id from cohort_users where idx=1)`,
      `update private.community_consent_grants set revoked_at=now() where user_id=(select id from cohort_users where idx=1)`,
      `delete from private.community_report_facts where contributor_id=(select id from cohort_users where idx=1)`,
    ]) {
      const rows = sql(`${read(cached())}${mutation};${read(cached())}`);
      expect(rows[0].public_aggregate).toBeTruthy(); expect(rows[1].public_aggregate).toBeNull();
      expect(rows[1].personal_aggregate).toBeNull(); expect((await replay(rows[1])).status).toBeGreaterThanOrEqual(400);
    }
  }, 180000);

  it('enforces TTL, slot collisions, maximum payload, ACL and nonblocking cache writes', () => {
    const rows = sql(`${read(cached())}
      update private.screen_result_cache set expires_at=now()-interval '1 second';${read(cached())}
      update private.screen_result_cache set cache_key=repeat('f',64);${read(cached())}
      select json_build_object('oversize',private.screen_cache_put(32,repeat('a',64),to_json(repeat('x',4194305)),now()),
        'entries',(select count(*) from private.screen_result_cache),
        'anon',has_function_privilege('anon','public.internal_analytics_screen_cached(jsonb,jsonb,uuid,uuid)','execute'),
        'authenticated',has_function_privilege('authenticated','public.internal_analytics_screen_cached(jsonb,jsonb,uuid,uuid)','execute'),
        'table',has_table_privilege('service_role','private.screen_result_cache','select'),
        'helper',has_function_privilege('service_role','private.screen_cache_resolve(jsonb,jsonb,uuid,uuid,boolean)','execute'));
      select json_build_object('stable',provolatile='s') from pg_proc where oid='private.screen_cache_resolve(jsonb,jsonb,uuid,uuid,boolean)'::regprocedure;`);
    expect(rows[1].cache.public_hit).toBe(false); expect(rows[2].cache.public_hit).toBe(false);
    expect(rows[3]).toEqual({ oversize: false, entries: 3, anon: false, authenticated: false, table: false, helper: false });
    expect(rows[4]).toEqual({ stable: true });
  }, 180000);

  it('prewarms exact browser defaults without enumerating users; keeps compare=false shared', async () => {
    const rows = sql(`update private.analytics_state set source_updated_at=now()-interval '1 minute';
      select json_build_object('built',private.screen_cache_maintain());
      select json_build_object('built',private.screen_cache_maintain());
      select json_build_object('slots',json_agg(slot order by slot)) from private.screen_result_cache;
      ${read(cached(scope, []))}${read(baseline(scope, []))}${read(cached(scope, panels.filter(p => p.path !== 'compare')))}`);
    expect(rows[0].built).toBe(2); expect(rows[1].built).toBe(0); expect(rows[2].slots).toEqual([0, 1, 160]);
    expect(rows[3].personal_aggregate).toBeNull();
    expect(await replay(rows[3], scope, [])).toEqual(await replay(rows[4], scope, []));
  }, 180000);
  it('installs the optional cron job transactionally with a bounded execution time', () => {
    const cron = readFileSync('supabase/migrations/202610121301_screen_cache_cron.sql', 'utf8').replace(/^(begin|commit);\s*$/gm, '');
    const rows = sql(`${cron}
      select json_build_object('schedule',schedule,'active',active,'command',command) from cron.job where jobname='screen-result-cache-v1';`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ schedule: '* * * * *', active: true });
    expect(rows[0].command).toContain("statement_timeout='55s'");
    expect(rows[0].command).toContain('private.screen_cache_maintain()');
  }, 180000);

});
