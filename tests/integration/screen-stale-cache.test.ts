/** Real local PostgreSQL 17. Each test rolls schema + synthetic fixtures back; never accepts a DSN. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diffOf } from '../../server/compare';
import { createScreenHandler } from '../../server/screenHandler';
import { dashboardResponseSchema } from '../../src/data/schema';
import { consistentWithPublic, personalCompareSchema } from '../../src/data/personal';
import { placeKeyOf } from '../../server/places';
const migrations = [...readdirSync('supabase/migrations').filter(n => /^202610060[1-9]00_/.test(n) && !n.includes('0800_')).sort(),
  '202610061000_screen_aggregate_opt.sql', '202610110100_five_categories.sql', '202610121200_fine_estimate_columns.sql',
  '202610121201_fine_estimate_ingest_aggregate.sql', '202610121300_screen_result_cache.sql', '202610121400_screen_cache_stale.sql']
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
  `public.internal_analytics_screen_stale(${quote(s)},${quote(ps)},${user},${session})`;
const baseline = (s = scope, ps: unknown = panels) => `public.internal_analytics_read_snapshot(${quote(s)},true,p_user=>u.id,p_session=>u.session_id,p_options=>${quote({ screen_encoding: 'screen-aggregate-v2', panels: ps })})`;
const read = (expr: string, idx = 1) => `select ${expr} from cohort_users u where idx=${idx};`;
const user = (idx = 1) => createHash('md5').update(`cohort-timeout-user-${idx}`).digest('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
async function replay(source: any, s = scope, ps = panels, idx = 1) {
  const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user(idx), role: 'authenticated', aud: 'authenticated', session_id: '11111111-2222-4333-8444-555555555555' })).toString('base64url')}.sig`;
  const handler = createScreenHandler({ enabled: true, allowedOrigins: [], jwtIssuer: null, getUser: async () => ({ id: user(idx), isAnonymous: false }),
    rpc: async name => name.endsWith('rate_limit') ? true : source });
  const response = await handler(new Request(`https://local.invalid/my-analytics/screen?${new URLSearchParams({ ...s, panels: JSON.stringify(ps) })}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json; screen-cache=stale-v2' } }));
  return { status: response.status, body: await response.json() };
}
function strict(packet: any) {
  dashboardResponseSchema.parse(packet.dashboard);
  personalCompareSchema.parse(packet.panels.find((p: any) => p.id === 'compare').body);
  expect(JSON.stringify(packet)).not.toMatch(/SPP-2026-|cohort-key-|vehicle_raw|report_identity|contributor_id/);
  expect(JSON.stringify(packet)).not.toContain(user());
}

describe.skipIf(process.env.SCREEN_CACHE_STACK !== '1')('bounded stale cache (local rollback)', () => {
  it('hits through unrelated uploads; own payload refreshes immediately while public stays fixed', async () => {
    const packets = sql(`${read(cached())}
      update private.community_report_facts set status='accepted' where contributor_id=(select id from cohort_users where idx=2);
      ${read(cached())}
      update private.community_report_facts set status='rejected' where contributor_id=(select id from cohort_users where idx=1);
      ${read(cached())}${read(cached())}`);
    expect(packets[1].cache.public_hit).toBe(true); expect(packets[1].cache.personal_hit).toBe(true);
    expect(packets[2].cache.public_hit).toBe(true); expect(packets[2].cache.personal_hit).toBe(false);
    expect(packets[3].cache.personal_hit).toBe(true);
    expect(packets[2].snapshots.comparable).toBe(false);
    expect(packets[2].public_aggregate).toEqual(packets[0].public_aggregate);
    expect(packets[2].snapshots.public_at).toBe(packets[0].snapshots.public_at);
    const result = await replay(packets[2]); expect(result.status).toBe(200); strict(result.body);
    const compare = result.body.panels.find((p:any)=>p.id==='compare').body;
    expect(consistentWithPublic(compare,result.body.dashboard.overview)).toBe(true);
    expect(compare.diff).toEqual(diffOf(compare.all,compare.mine));
    expect(compare.diff.accept_rate_pp).toBeCloseTo(-compare.all.accept_rate);
    expect(compare.mine.accepted).toBe(0);
    expect(result.body.dashboard.overview.contributor_count).toEqual((await replay(packets[0])).body.dashboard.overview.contributor_count);
  }, 180000);

  it('30 successive unrelated fact uploads keep both parts reusable',()=>{
    const rounds=Array.from({length:30},(_,i)=>`update private.community_report_facts set status='${i%2?'accepted':'rejected'}' where contributor_id=(select id from cohort_users where idx=2);${read(cached())}`).join('\n');
    const rows=sql(read(cached())+rounds);
    expect(rows).toHaveLength(31);
    expect(rows.slice(1).every(r=>r.cache.public_hit&&r.cache.personal_hit)).toBe(true);
  },180000);

  it('resend heartbeat does not invalidate own cache; mine may exceed stale all without a schema error', async () => {
    const small={...scope,start:'2026-10-12',end:'2026-10-12'};
    const packets=sql(`${read(cached(small))}
      update private.community_report_facts set updated_at=clock_timestamp(),source_revision=source_revision+1 where contributor_id=(select id from cohort_users where idx=1);
      ${read(cached(small))}
      update private.community_report_facts set completed_date='2026-10-12',report_date='2026-10-01' where contributor_id=(select id from cohort_users where idx=1);
      ${read(cached(small))}`);
    expect(packets[1].cache.personal_hit).toBe(true);
    expect(packets[2].cache.personal_hit).toBe(false); expect(packets[2].cache.public_hit).toBe(true);
    const result=await replay(packets[2],small);strict(result.body);
    const c=result.body.panels.find((p:any)=>p.id==='compare').body;
    expect(c.mine.report_count).toBeGreaterThan(c.all.report_count);expect(c.diff.report_share).toBe(c.all.report_count ? c.mine.report_count/c.all.report_count*100 : null);
    expect(c.monthly.find((m:any)=>m.month==='2026-10').mine_report_count).toBe(c.mine.report_count);
  },180000);

  it('another contributor on the same source key invalidates my election-dependent cohort',()=>{
    const rows=sql(`update private.community_report_facts set source_report_key=(select source_report_key from private.community_report_facts where contributor_id=(select id from cohort_users where idx=1) limit 1)
      where contributor_id=(select id from cohort_users where idx=2) and source_report_id=(select source_report_id from private.community_report_facts where contributor_id=(select id from cohort_users where idx=2) limit 1);
      ${read(cached())}
      update private.community_report_facts set completed_date=completed_date+1 where contributor_id=(select id from cohort_users where idx=2);
      ${read(cached())}`);
    expect(rows[1].cache.personal_hit).toBe(false);expect(rows[1].cache.public_hit).toBe(true);
  },180000);

  it('180 second hard bound, expiry, collision, 60 second refresh during continuous uploads', () => {
    const packets = sql(`${read(cached())}
      update private.screen_result_cache set created_at=statement_timestamp()-interval '179 seconds' where slot<32;
      ${read(cached())}
      update private.screen_result_cache set created_at=statement_timestamp()-interval '181 seconds' where slot<32;
      ${read(cached())}
      update private.screen_result_cache set cache_key=repeat('f',64) where slot<32;
      ${read(cached())}
      update private.screen_result_cache set expires_at=statement_timestamp()-interval '1 second';
      ${read(cached())}
      update private.analytics_state set source_updated_at=clock_timestamp();
      select json_build_object('warm',private.screen_cache_maintain());
      select json_build_object('warm',private.screen_cache_maintain());
      update private.screen_result_cache set created_at=statement_timestamp()-interval '61 seconds' where slot in(0,1);
      update private.analytics_state set source_updated_at=clock_timestamp();
      select json_build_object('warm',private.screen_cache_maintain());`);
    expect(packets[1].cache.public_hit).toBe(true); expect(packets[2].cache.public_hit).toBe(false);
    expect(packets[3].cache.public_hit).toBe(false); expect(packets[4].cache.public_hit).toBe(false);
    expect(packets[5].warm).toBe(2); expect(packets[6].warm).toBe(0); expect(packets[7].warm).toBe(2);
  }, 180000);

  it('deletion, masking, disclosure, consent, suspension invalidate immediately; live sessions still gate', async () => {
    const mutations = [
      "update private.community_report_facts set vehicle_raw='12가4444' where contributor_id=(select id from cohort_users where idx=2)",
      "delete from private.community_report_facts where contributor_id=(select id from cohort_users where idx=2)",
      "update private.community_policy_disclosures set amounts_public=not amounts_public",
      "update private.community_consent_grants set revoked_at=now() where user_id=(select id from cohort_users where idx=2)",
      "update private.contributor_profiles set status='suspended' where user_id=(select id from cohort_users where idx=2)",
    ];
    for(const mutation of mutations) {
      const rows=sql(`${read(cached())}${mutation};${read(cached())}${read(cached())}`);
      expect(rows[1].cache.public_hit).toBe(false); expect(rows[1].cache.personal_hit).toBe(false);
      expect(rows[2].cache.public_hit).toBe(true);
    }
    const denied=sql(`${read(cached())}delete from auth.sessions where user_id=(select id from cohort_users where idx=1);${read(cached())}`)[1];
    expect(denied.viewer.session).toBe(false); expect(denied.public_aggregate).toBeNull();
    expect((await replay(denied)).status).toBe(401);
  }, 180000);

  it('same-key co-contributor election invalidates personal; v1 remains exact and service ACL stays closed', () => {
    const rows=sql(`${read(cached())}
      update private.community_report_facts set completed_date=completed_date+1 where contributor_id=(select id from cohort_users where idx=1);
      ${read(cached())}
      select json_build_object('anon',has_function_privilege('anon','public.internal_analytics_screen_stale(jsonb,jsonb,uuid,uuid)','execute'),
       'auth',has_table_privilege('authenticated','private.screen_user_revision','select'),
       'service',has_function_privilege('service_role','public.internal_analytics_screen_stale(jsonb,jsonb,uuid,uuid)','execute'));
      ${read(cached().replace('screen_stale','screen_cached'))}
      update private.community_report_facts set status='accepted' where contributor_id=(select id from cohort_users where idx=2);
      ${read(cached().replace('screen_stale','screen_cached'))}`);
    expect(rows[1].cache.personal_hit).toBe(false);
    expect(rows[2]).toEqual({anon:false,auth:false,service:true});
    expect(rows[3].cache_encoding).toBe('screen-cache-v1'); expect(rows[4].cache.public_hit).toBe(false);
  },180000);
});
