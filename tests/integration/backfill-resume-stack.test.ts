// 2026-10-22 backfill-resume: SQL of map 202610220200 + auth 202610220100 on the REAL composed local Supabase stack, plus
// HTTP smoke of the public app-announcements function and the 503 maintenance answer of community-ingest.
// Synthetic users are written straight into auth.* / private.* (local stack only). Run:
//   COMMUNITY_STACK=1 COMMUNITY_DB_CONTAINER=supabase_db_<project> COMMUNITY_API_URL=http://127.0.0.1:<api> \
//   STACK_WORKDIR=<composed dir> npx vitest run tests/integration/backfill-resume-stack.test.ts
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = process.env.COMMUNITY_STACK === '1';
const API = process.env.COMMUNITY_API_URL ?? 'http://127.0.0.1:56321';
const DB = process.env.COMMUNITY_DB_CONTAINER ?? 'supabase_db_ci0926-int';
const WORKDIR = process.env.STACK_WORKDIR ?? '.integration-stack';
type Json = Record<string, any>;

const psql = (user: string) => ['exec', '-i', DB, 'psql', '-X', '-U', user, '-d', 'postgres', '-tAq', '-v', 'ON_ERROR_STOP=1'];
const sql = (q: string, user = 'postgres'): string => execFileSync('docker', psql(user), { input: q, encoding: 'utf8', maxBuffer: 16 << 20 }).trim();
const json = (q: string): any => JSON.parse(sql(q));
/** Error text of a failing statement (first line only), or '' when it succeeded. */
function sqlError(q: string, user = 'postgres'): string {
  try { sql(q, user); return ''; } catch (e) { return String((e as { stderr?: string }).stderr ?? e).split('\n').find(l => l.includes('ERROR')) ?? String(e); }
}
const lit = (v: unknown) => { const t = `$j${randomBytes(4).toString('hex')}$`; return `${t}${typeof v === 'string' ? v : JSON.stringify(v)}${t}`; };
const pseudo = (u: string) => createHash('sha256').update(u, 'utf8').digest('hex').slice(0, 8);
const progressVectors = JSON.parse(readFileSync('contracts/community-ingest-v2/vectors/progress.json', 'utf8'));
const versionVectors = JSON.parse(readFileSync('contracts/community-ingest-v2/version-vectors.json', 'utf8'));
const linkVectors = JSON.parse(readFileSync('contracts/app-announcements/vectors/links.json', 'utf8'));

interface Person { user: string; session: string; grant: string | null; conn: string | null; dataset: string }
let currentPolicy = '', currentHash = '', oldPolicy = '', oldHash = '';
let admin = '';
const created: string[] = [];

/** One synthetic Kakao user with a session, profile, optional grant (current/outdated) and optional connection. */
function person(opts: { grant?: 'current' | 'outdated' | null; conn?: { app: 'pc' | 'mobile'; platform?: string } | null } = {}): Person {
  const user = randomUUID(), session = randomUUID(), dataset = createHash('sha256').update(randomUUID()).digest('hex');
  const grant = opts.grant === null ? null : randomUUID();
  const g = opts.grant ?? 'current';
  const conn = opts.conn ? randomUUID() : null;
  created.push(user);
  sql(`insert into auth.users(id, instance_id, aud, role, email, created_at, updated_at)
         values ('${user}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${user}@example.invalid',now(),now());
       insert into auth.identities(provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
         values ('${BigInt('0x' + user.replace(/-/g, '').slice(0, 12)).toString()}','${user}','{"sub":"x"}','kakao',now(),now(),now());
       insert into auth.sessions(id, user_id, created_at, updated_at) values ('${session}','${user}',now(),now());
       insert into private.contributor_profiles(user_id, consent_version, privacy_policy_version) values ('${user}','x','x');
       ${grant ? `insert into private.community_consent_grants(grant_id, lineage_id, user_id, policy_version, consent_text_sha256, granted_via, granted_session_id)
         values ('${grant}','${grant}','${user}','${g === 'current' ? currentPolicy : oldPolicy}','${g === 'current' ? currentHash : oldHash}','mobile_standalone','${session}');` : ''}
       ${conn ? `insert into private.community_connections(connection_id, user_id, bound_session_id, connection_secret_sha256, source_app, source_mode, platform, device_label, dataset_key)
         values ('${conn}','${user}','${session}','${'a'.repeat(64)}','${opts.conn!.app === 'pc' ? 'safetyreport' : 'safetyreport-mobile'}',
                 '${opts.conn!.app === 'pc' ? 'server' : 'standalone'}','${opts.conn!.platform ?? (opts.conn!.app === 'pc' ? 'windows' : 'android')}','합성 기기','${dataset}');` : ''}`);
  return { user, session, grant, conn, dataset };
}
const progressBody = (p: Person, over: Json = {}, backfill: Json = {}) => {
  const b = structuredClone(progressVectors.cases[0].body);
  delete b.protocol; delete b.connection_id;
  return { ...b, ...over, backfill: { ...b.backfill, ...backfill } };
};
const progress = (p: Person, report: Json, session = p.session, conn = p.conn) =>
  json(`select public.internal_community_progress('${p.user}','${session}','${conn}',${lit(report)}::jsonb)::text`);
function rawRow(p: Person) {
  const receipt = randomUUID(), key = createHash('sha256').update(randomUUID()).digest('hex');
  sql(`insert into private.community_ingest_events(receipt_id, contributor_id, event_id, request_id, connection_id, consent_grant_id, dataset_key,
         writer_epoch, source_system, source_report_key, source_report_id, source_revision, event_type, trigger, payload, payload_sha256, captured_at, result, contract)
       values ('${receipt}','${p.user}','${randomUUID()}','it-backfill-resume','${p.conn}','${p.grant}','${p.dataset}',1,'safetyreport','${key}','SYN${randomBytes(3).toString('hex')}',1,
         'completed_observation','raw_backfill',null,'${'b'.repeat(64)}',now(),'stored','community-ingest-v2');
       insert into private.community_report_raw(contributor_id, dataset_key, source_report_key, source_report_id, consent_grant_id, latest_receipt_id,
         event_type, captured_at, raw_text, raw_sha256, raw_size, fetched_at, raw_source, supplement, supplement_sha256, client_parser_version,
         writer_epoch, source_revision)
       values ('${p.user}','${p.dataset}','${key}','SYN1','${p.grant}','${receipt}','completed_observation',now(),'{"result":{}}','${'c'.repeat(64)}',13,now(),
         'raw_backfill','{}'::jsonb,'${'d'.repeat(64)}','pc-parser-13',1,1);`);
}
const seen = (p: Person, app: string, platform: string, version: string, daysAgo = 0) =>
  sql(`insert into private.community_client_seen(user_id, app, platform, version, last_seen_at) values ('${p.user}','${app}','${platform}','${version}',now() - interval '${daysAgo} days')
       on conflict (user_id, app, platform) do update set version = excluded.version, last_seen_at = excluded.last_seen_at;`);
const opsCall = (q: string) => json(`select ${q}::text`);

describe.skipIf(!enabled)('backfill-resume SQL and Edge on the composed local stack', { timeout: 120_000 }, () => {
  beforeAll(() => {
    const cur = sql(`select p.version || '|' || p.consent_text_sha256 from private.community_policies p join private.community_policy_current c using(version)`).split('|');
    [currentPolicy, currentHash] = cur;
    const old = sql(`select version || '|' || consent_text_sha256 from private.community_policies where version <> '${currentPolicy}' order by created_at desc limit 1`).split('|');
    [oldPolicy, oldHash] = old;
    admin = person({ grant: null }).user;
    sql(`insert into private.ops_admins(user_id, memo) values ('${admin}','합성 운영자');
         update private.community_ingest_config set uploads_paused=false, pause_resume_at=null, pause_message=null, client_requirement=null where singleton;`);
  });
  afterAll(() => {
    if (!created.length) return;
    sql(`update private.community_ingest_config set uploads_paused=false, pause_resume_at=null, pause_message=null, client_requirement=null where singleton;
         delete from private.app_announcements; delete from auth.users where id in (${created.map(u => `'${u}'`).join(',')});`);
  });

  it('version rule in SQL equals the contract vectors', () => {
    for (const c of versionVectors.cases) {
      const got = sql(`select coalesce(private.community_version_cmp(${c.a === null ? 'null' : lit(c.a)}, ${c.b === null ? 'null' : lit(c.b)})::text, 'null')`);
      expect(got, `${c.a} vs ${c.b}`).toBe(c.cmp === null ? 'null' : String(c.cmp));
    }
  });

  it('2-9: pause through ops, automatic resume decided by the reader, audit before → after', () => {
    const before = Number(sql(`select count(*) from private.community_ingest_config_audit`));
    const resume = new Date(Date.now() + 3600_000).toISOString();
    opsCall(`ops.pause_uploads('${admin}', '서버 점검', '${resume}')`);
    let c = json(`select public.internal_community_ingest_capabilities()::text`);
    expect(c).toMatchObject({ paused: true, pause_message: '서버 점검' });
    expect(Date.parse(c.resume_at)).toBe(Date.parse(resume));
    const a = json(`select row_to_json(x)::text from (select actor_user_id, actor_label, action, before->>'uploads_paused' b, after->>'uploads_paused' n
                    from private.community_ingest_config_audit order by audit_id desc limit 1) x`);
    expect(a).toEqual({ actor_user_id: admin, actor_label: 'ops:합성 운영자', action: 'pause_uploads', b: 'false', n: 'true' });
    // resume time passes: no cron, no operator — the switch stays on for the record, the readers say "not paused"
    sql(`update private.community_ingest_config set pause_resume_at = now() - interval '1 second' where singleton`);
    c = json(`select public.internal_community_ingest_capabilities()::text`);
    expect(c).toMatchObject({ paused: false, pause_message: null, resume_at: null });
    expect(sql(`select uploads_paused from private.community_ingest_config`)).toBe('t');
    expect(json(`select row_to_json(x)::text from (select actor_user_id, actor_label, action from private.community_ingest_config_audit order by audit_id desc limit 1) x`))
      .toEqual({ actor_user_id: null, actor_label: 'sql:postgres', action: 'sql_update' });
    opsCall(`ops.resume_uploads('${admin}')`);
    expect(Number(sql(`select count(*) from private.community_ingest_config_audit`))).toBe(before + 3);
    expect(sqlError(`select ops.pause_uploads('${admin}', null, now() - interval '1 minute')`)).toContain('invalid_resume_at');
    expect(sqlError(`select ops.pause_uploads('${admin}', null, now() + interval '8 days')`)).toContain('invalid_resume_at');
    expect(sqlError(`select ops.pause_uploads('${admin}', 'a' || chr(10) || 'b', null)`)).toContain('invalid_message');
    opsCall(`ops.pause_uploads('${admin}', null, null)`);
    expect(json(`select public.internal_community_ingest_capabilities()::text`)).toMatchObject({ paused: true, resume_at: null });
    opsCall(`ops.resume_uploads('${admin}')`);
  });

  it('2-10: requirement only while in force; validation; impact preview', () => {
    expect(sqlError(`select ops.set_client_requirement('${admin}', null, null, null, null, null, null)`)).toContain('invalid_requirement');
    expect(sqlError(`select ops.set_client_requirement('${admin}', '3.6.2-beta', null, null, null, null, null)`)).toContain('invalid_requirement');
    expect(sqlError(`select ops.set_client_requirement('${admin}', '3.6.2', null, 'http://x.example', null, null, null)`)).toContain('invalid_requirement');
    opsCall(`ops.set_client_requirement('${admin}', '3.6.2', '2.5.1', 'https://github.com/Fentanest/safetyreport/releases/latest', null, null, now() + interval '1 day')`);
    expect(json(`select public.internal_community_ingest_capabilities()::text`).client_requirement).toBeNull();
    sql(`update private.community_ingest_config set client_requirement = jsonb_set(client_requirement, '{enforce_from}', to_jsonb(now() - interval '1 minute')) where singleton`);
    expect(json(`select public.internal_community_ingest_capabilities()::text`).client_requirement)
      .toMatchObject({ min_version: { pc: '3.6.2', mobile: '2.5.1' }, url: { mobile: null } });

    const ok = person(), old = person(), stale = person(), unknown = person(), pcOnly = person();
    seen(ok, 'mobile', 'android', '2.5.1', 10);
    seen(old, 'mobile', 'android', '2.5.0', 1);
    seen(stale, 'mobile', 'android', '2.5.1', 31);
    seen(pcOnly, 'pc', 'docker', '3.6.2', 0);
    seen(pcOnly, 'mobile', 'android', '2.4.1', 0);
    const gate = (p: Person) => json(`select public.internal_map_client_state('${p.user}')::text`).update_gate;
    expect(gate(ok)).toMatchObject({ blocked: false, min_version: { pc: '3.6.2', mobile: '2.5.1' } });
    expect(gate(old).blocked).toBe(true);
    expect(gate(stale).blocked).toBe(true);
    expect(gate(unknown).blocked).toBe(true);
    expect(gate(pcOnly).blocked).toBe(false);
    // a platform without a requirement counts as satisfied
    opsCall(`ops.set_client_requirement('${admin}', '3.6.2', null, null, null, null, null)`);
    expect(gate(old).blocked).toBe(false);
    // impact preview counts distinct users per version, below = would be refused/locked
    const impact = opsCall(`ops.requirement_impact('${admin}', '3.6.2', '2.5.1')`);
    expect(impact.rows).toEqual(expect.arrayContaining([expect.objectContaining({ app: 'mobile', platform: 'android', version: '2.5.0', below: true })]));
    expect(impact.below_users.mobile).toBeGreaterThanOrEqual(2);
    expect(impact.map_web_blocked_users).toBeGreaterThanOrEqual(3);
    expect(sqlError(`select ops.requirement_impact('${admin}', 'abc', null)`)).toContain('invalid_version');
    // enforce_from in the future: map web open again
    opsCall(`ops.set_client_requirement('${admin}', '3.6.2', '2.5.1', null, null, null, now() + interval '1 hour')`);
    expect(gate(unknown)).toBeNull();
    opsCall(`ops.clear_client_requirement('${admin}')`);
    expect(json(`select public.internal_community_ingest_capabilities()::text`).client_requirement).toBeNull();
    expect(json(`select public.internal_map_client_state('${unknown.user}')::text`).upload_pause).toEqual({ paused: false, message: null, resume_at: null });
  });

  it('2-1: progress RPC accepts outdated consent, refuses revoked/unknown/mismatch, 1 per minute, history 200/30 days', () => {
    const p = person({ grant: 'outdated', conn: { app: 'pc' } });
    expect(progress(p, progressBody(p))).toEqual({ stored: true });
    expect(progress(p, progressBody(p)).error).toBe('rate_limited');
    const row = json(`select row_to_json(x)::text from (select last_progress->'backfill'->>'state' s, last_client_version v, last_seen_at is not null seen
                      from private.community_connections where connection_id='${p.conn}') x`);
    expect(row).toEqual({ s: 'uploading', v: '3.6.2', seen: true });
    expect(sql(`select version || '/' || platform from private.community_client_seen where user_id='${p.user}'`)).toBe('3.6.2/windows');
    // other state untouched: no facts, no raw, no ledger rows for this user
    expect(sql(`select (select count(*) from private.community_ingest_events where contributor_id='${p.user}') + (select count(*) from private.community_report_raw where contributor_id='${p.user}')`)).toBe('0');
    // history trimming: 210 old-but-recent rows + 1 row older than 30 days → at most 200 after the next report
    sql(`insert into private.community_progress_history(connection_id, user_id, received_at, progress)
           select '${p.conn}','${p.user}', now() - (g || ' minutes')::interval, '{}'::jsonb from generate_series(2, 211) g;
         insert into private.community_progress_history(connection_id, user_id, received_at, progress) values ('${p.conn}','${p.user}', now() - interval '31 days', '{}'::jsonb);
         update private.community_connections set last_progress_at = now() - interval '61 seconds' where connection_id='${p.conn}';`);
    expect(progress(p, progressBody(p, {}, { state: 'done' }))).toEqual({ stored: true });
    expect(Number(sql(`select count(*) from private.community_progress_history where connection_id='${p.conn}'`))).toBe(200);
    expect(sql(`select count(*) from private.community_progress_history where connection_id='${p.conn}' and received_at < now() - interval '30 days'`)).toBe('0');
    sql(`update private.community_connections set last_progress_at = now() - interval '61 seconds' where connection_id='${p.conn}'`);
    const other = randomUUID();
    sql(`insert into auth.sessions(id, user_id, created_at, updated_at) values ('${other}','${p.user}',now(),now())`);
    expect(progress(p, progressBody(p), other).error).toBe('connection_session_mismatch');
    expect(progress(p, progressBody(p), randomUUID()).error).toBe('session_revoked');
    expect(progress(p, progressBody(p), p.session, randomUUID()).error).toBe('connection_unknown');
    expect(progress(p, progressBody(p, { source_app: 'safetyreport-mobile' })).error).toBe('connection_mode_mismatch');
    sql(`update private.community_consent_grants set revoked_at = now(), revoke_reason = 'user' where grant_id = '${p.grant}'`);
    expect(progress(p, progressBody(p)).error).toBe('consent_revoked');
    const none = person({ grant: null, conn: { app: 'mobile' } });
    expect(progress(none, progressBody(none, { source_app: 'safetyreport-mobile' })).error).toBe('consent_missing');
  });

  it('2-7: setup progress (auth): one row per user, 1 per minute, shape checks, deleted on revoke but not on policy supersede', () => {
    const p = person({ grant: null });
    const report = { client_version: '2.5.1', source_app: 'safetyreport-mobile', platform: 'android', mode: 'standalone', stage: 'kakao_ok', reason: null, client: null };
    const call = (r: Json) => json(`select public.internal_account_setup_progress('${p.user}','${p.session}',${lit(r)}::jsonb)::text`);
    expect(call(report)).toEqual({ stored: true });
    expect(call(report).error).toBe('rate_limited');
    sql(`update private.community_setup_progress set updated_at = now() - interval '61 seconds' where user_id = '${p.user}'`);
    expect(call({ ...report, client: { server_reachable: true, server_version: '3.6.2', server_community_supported: true, server_logged_in: true,
      server_consent_active: true, account_match: true } }).error).toBe('invalid_request'); // client object only in Client mode
    expect(call({ ...report, mode: 'client', stage: 'client_server_checked', client: { server_reachable: true, fingerprint: 'x' } }).error).toBe('invalid_request');
    expect(call({ ...report, mode: 'client', stage: 'client_server_checked', client: { server_reachable: false, server_version: null,
      server_community_supported: null, server_logged_in: null, server_consent_active: null, account_match: null } })).toEqual({ stored: true });
    expect(sql(`select stage || '/' || mode from private.community_setup_progress where user_id = '${p.user}'`)).toBe('client_server_checked/client');
    expect(sql(`select version from private.community_client_seen where user_id = '${p.user}' and app = 'mobile'`)).toBe('2.5.1');
    expect(json(`select public.internal_account_client_seen('${p.user}','mobile','android','2.5.1 <script>')::text`)).toEqual({ recorded: false });
    // policy supersede keeps the row; a user revoke removes it
    const g = randomUUID();
    sql(`insert into private.community_consent_grants(grant_id, lineage_id, user_id, policy_version, consent_text_sha256, granted_via, granted_session_id)
         values ('${g}','${g}','${p.user}','${oldPolicy}','${oldHash}','mobile_client','${p.session}');
         update private.community_consent_grants set revoked_at = now(), revoke_reason = 'superseded_policy' where grant_id = '${g}';`);
    expect(sql(`select count(*) from private.community_setup_progress where user_id = '${p.user}'`)).toBe('1');
    const g2 = randomUUID();
    sql(`insert into private.community_consent_grants(grant_id, lineage_id, user_id, policy_version, consent_text_sha256, granted_via, granted_session_id)
         values ('${g2}','${g2}','${p.user}','${currentPolicy}','${currentHash}','mobile_client','${p.session}');
         update private.community_consent_grants set revoked_at = now(), revoke_reason = 'kakao_unlinked' where grant_id = '${g2}';`);
    expect(sql(`select count(*) from private.community_setup_progress where user_id = '${p.user}'`)).toBe('0');
  });

  it('2-14: console role can only execute ops functions; non-admins are refused', () => {
    const outsider = randomUUID();
    expect(sqlError(`select ops.overview('${outsider}')`)).toContain('not_ops_admin');
    expect(sqlError(`select ops.pause_uploads('${outsider}', null, null)`)).toContain('not_ops_admin');
    expect(json(`select ops.whoami('${outsider}')::text`)).toEqual({ admin: false, memo: null });
    // the migration role (postgres) is not a member of community_ops; the local superuser switches role for the test
    const asOps = (q: string) => sqlError(`set role community_ops; ${q}`, 'supabase_admin');
    expect(asOps(`update private.community_ingest_config set uploads_paused = true`)).toMatch(/permission denied/);
    expect(asOps(`insert into private.ops_admins(user_id, memo) values ('${outsider}','x')`)).toMatch(/permission denied/);
    expect(asOps(`select * from private.app_announcements`)).toMatch(/permission denied/);
    expect(asOps(`select private.community_version_cmp('1','2')`)).toMatch(/permission denied/);
    expect(asOps(`select public.internal_community_ingest_capabilities()`)).toMatch(/permission denied/);
    expect(asOps(`select ops.whoami('${admin}')`)).toBe('');
    expect(asOps(`select ops.overview('${outsider}')`)).toContain('not_ops_admin');
    expect(sql(`select rolcanlogin::text from pg_roles where rolname = 'community_ops_login'`)).toBe('false');
    expect(sql(`select pg_has_role('community_ops_login', 'community_ops', 'member')::text`)).toBe('true');
    // anon/authenticated reach nothing new
    expect(sql(`select count(*) from information_schema.role_table_grants where table_schema in ('private','ops') and grantee in ('anon','authenticated','PUBLIC')`)).toBe('0');
    expect(sql(`select count(*) from information_schema.routine_privileges where routine_schema = 'ops' and grantee <> 'community_ops' and grantee <> 'postgres'`)).toBe('0');
    const overview = opsCall(`ops.overview('${admin}')`);
    expect(overview).toHaveProperty('uploads.paused');
    expect(overview).toHaveProperty('rejections_last_hour.maintenance');
    expect(Array.isArray(overview.recent_changes)).toBe(true);
  });

  it('2-11: announcements — drafts only editable, publish/end, audience/version/priority filter, max 3, link allowlist', () => {
    sql(`delete from private.app_announcements`);
    const doc = (id: string, over: Json = {}, audience: Json = {}) => ({ id, title: '합성 공지', body: '첫 줄\n둘째 줄', primary_action: null, snooze_days: 7,
      starts_at: null, ends_at: null, priority: 0, ...over,
      audience: { apps: ['mobile'], modes: null, platforms: null, min_version: null, max_version: null, ...audience } });
    const save = (d: Json) => opsCall(`ops.announcement_save('${admin}', ${lit(d)}::jsonb)`);
    save(doc('it-client-new', { priority: 5 }, { modes: ['client'], min_version: '2.5.1' }));
    save(doc('it-all-mobile', { priority: 1 }));
    save(doc('it-pc', { primary_action: { label: '받기', url: 'https://github.com/Fentanest/safetyreport/releases/latest' } }, { apps: ['pc'], modes: ['server'] }));
    save(doc('it-top', { priority: 9, primary_action: { label: '바꾸기', app_action: 'open_mode_switch' } }));
    save(doc('it-low', { priority: -5 }));
    save(doc('it-future', { priority: 100, starts_at: new Date(Date.now() + 3600_000).toISOString() }));
    save(doc('it-ended', { priority: 100 }));
    save(doc('it-draft', { priority: 100 }));
    for (const id of ['it-client-new', 'it-all-mobile', 'it-pc', 'it-top', 'it-low', 'it-future', 'it-ended']) opsCall(`ops.announcement_publish('${admin}', '${id}')`);
    opsCall(`ops.announcement_end('${admin}', 'it-ended')`);
    expect(sqlError(`select ops.announcement_save('${admin}', ${lit(doc('it-top', { title: '바꾼 제목' }))}::jsonb)`)).toContain('announcement_published');
    expect(sqlError(`select ops.announcement_save('${admin}', ${lit(doc('it-bad', { primary_action: { label: '열기', url: 'https://evil.example/' } }))}::jsonb)`)).toContain('invalid_announcement');
    expect(sqlError(`select ops.announcement_save('${admin}', ${lit(doc('it-bad', { body: '<b>x</b>' + String.fromCharCode(7) }))}::jsonb)`)).toContain('invalid_announcement');
    expect(sqlError(`select ops.announcement_save('${admin}', ${lit(doc('it-bad', {}, { modes: ['tv'] }))}::jsonb)`)).toContain('invalid_announcement');
    expect(sqlError(`select ops.announcement_save('${admin}', ${lit({ ...doc('it-bad'), snooze_days: '7' })}::jsonb)`)).toContain('invalid_announcement');
    const ids = (app: string, mode: string, platform: string, version: string) =>
      (json(`select public.internal_app_announcements('${app}','${mode}','${platform}',${lit(version)})::text`) as Json[]).map(a => a.id);
    expect(ids('mobile', 'client', 'android', '2.5.1')).toEqual(['it-top', 'it-client-new', 'it-all-mobile']);
    expect(ids('mobile', 'client', 'android', '2.5.0')).toEqual(['it-top', 'it-all-mobile', 'it-low']);
    expect(ids('mobile', 'standalone', 'android', '2.5.1')).toEqual(['it-top', 'it-all-mobile', 'it-low']);
    expect(ids('mobile', 'client', 'android', 'dev-build')).toEqual(['it-top', 'it-all-mobile', 'it-low']);
    expect(ids('pc', 'server', 'windows', '3.6.2')).toEqual(['it-pc']);
    const list = opsCall(`ops.announcement_list('${admin}')`) as Json[];
    const state = Object.fromEntries(list.map(a => [a.id, a.state]));
    expect(state).toMatchObject({ 'it-draft': 'draft', 'it-ended': 'ended', 'it-future': 'scheduled', 'it-top': 'live' });
    expect(sqlError(`select ops.announcement_delete('${admin}', 'it-top')`)).toContain('announcement_published');
    expect(opsCall(`ops.announcement_delete('${admin}', 'it-draft')`)).toEqual({ deleted: 'it-draft' });
    const audit = json(`select json_agg(action order by audit_id)::text from private.app_announcements_audit where announcement_id = 'it-ended' and actor_user_id = '${admin}'`);
    expect(audit).toEqual(['announcement_save', 'announcement_publish', 'announcement_end']);
    for (const c of linkVectors.cases) {
      expect(sql(`select private.app_announcement_url_allowed(${lit(c.url)})::text`), c.url).toBe(String(c.allowed));
    }
  });

  it('2-15: overview puts each synthetic person in exactly one category (boundaries 23h/25h, version, outdated+v1)', () => {
    const ppl: Record<string, Person> = {};
    const report = (p: Person, backfill: Json, hoursAgo: number, over: Json = {}) => {
      expect(progress(p, progressBody(p, over, backfill))).toEqual({ stored: true });
      sql(`update private.community_connections set last_progress_at = now() - interval '${hoursAgo} hours', last_seen_at = now() - interval '${hoursAgo} hours'
           where connection_id = '${p.conn}'`);
    };
    ppl.reconsent = person({ grant: 'outdated', conn: { app: 'pc' } });
    sql(`update private.community_connections set last_contract = 'community-ingest-v1', last_client_version = '3.5.1', last_seen_at = now() where connection_id = '${ppl.reconsent.conn}'`);
    ppl.oldMobile = person(); seen(ppl.oldMobile, 'mobile', 'android', '2.4.1');
    ppl.v1Only = person({ conn: { app: 'pc' } });
    sql(`update private.community_connections set last_contract = 'community-ingest-v1', last_client_version = '3.6.1', last_seen_at = now() where connection_id = '${ppl.v1Only.conn}'`);
    ppl.noRecord = person();
    ppl.boundary = person(); seen(ppl.boundary, 'mobile', 'android', '2.5.0');
    ppl.loginFailed = person();
    sql(`insert into private.community_setup_progress(user_id, client_version, source_app, platform, mode, stage, reason)
         values ('${ppl.loginFailed.user}','2.5.1','safetyreport-mobile','android','standalone','official_login_failed','captcha_required')`);
    ppl.clientMismatch = person();
    sql(`insert into private.community_setup_progress(user_id, client_version, source_app, platform, mode, stage, reason, client)
         values ('${ppl.clientMismatch.user}','2.5.1','safetyreport-mobile','android','client','client_server_checked',null,
                 '{"server_reachable":true,"server_version":"3.6.2","server_community_supported":true,"server_logged_in":true,"server_consent_active":true,"account_match":false}')`);
    ppl.gap = person({ conn: { app: 'pc' } }); report(ppl.gap, { state: 'uploading' }, 25);
    ppl.fresh = person({ conn: { app: 'pc' } }); report(ppl.fresh, { state: 'uploading' }, 23);
    ppl.holds = person({ conn: { app: 'mobile' } }); report(ppl.holds, { state: 'holds', holds: 5 }, 1,
      { source_app: 'safetyreport-mobile', platform: 'android', client_version: '2.5.1', pace: { foreground_slices_today: 1, background_runs_today: 0 } });
    ppl.login = person({ conn: { app: 'pc' } }); report(ppl.login, { state: 'filling' }, 1, { official_login: 'manual_required' });
    ppl.doneLatest = person({ conn: { app: 'pc' } }); report(ppl.doneLatest, { state: 'done' }, 2);
    ppl.doneOld = person({ conn: { app: 'pc' } }); report(ppl.doneOld, { state: 'done' }, 2, { client_version: '3.6.1' });
    ppl.noReports = person({ conn: { app: 'pc' } }); rawRow(ppl.noReports);
    sql(`update private.community_connections set last_contract = 'community-ingest-v2', last_client_version = '3.6.1', last_seen_at = now() - interval '30 hours' where connection_id = '${ppl.noReports.conn}'`);
    ppl.recentNoReports = person({ conn: { app: 'pc' } }); rawRow(ppl.recentNoReports);
    sql(`update private.community_connections set last_contract = 'community-ingest-v2', last_client_version = '3.6.1', last_seen_at = now() - interval '2 hours' where connection_id = '${ppl.recentNoReports.conn}'`);

    const t0 = Date.now();
    const o = opsCall(`ops.upload_overview('${admin}', 24, '3.6.0', '2.5.0', '3.6.2', '2.5.1')`);
    const elapsed = Date.now() - t0;
    const byPseudo = Object.fromEntries((o.rows as Json[]).map(r => [r.pseudo_id, r]));
    const got = (name: string) => { const r = byPseudo[pseudo(ppl[name].user)]; return r && `${r.category}/${r.sub_reason}`; };
    expect({
      reconsent: got('reconsent'), oldMobile: got('oldMobile'), v1Only: got('v1Only'), noRecord: got('noRecord'), boundary: got('boundary'),
      loginFailed: got('loginFailed'), clientMismatch: got('clientMismatch'), gap: got('gap'), fresh: got('fresh'), holds: got('holds'),
      login: got('login'), doneLatest: got('doneLatest'), doneOld: got('doneOld'), noReports: got('noReports'), recentNoReports: got('recentNoReports'),
    }).toEqual({
      reconsent: 'reconsent/last_contract_v1', oldMobile: 'old_app/version_below_raw', v1Only: 'old_app/v1_only', noRecord: 'not_tried/no_record',
      boundary: 'not_tried/no_record', loginFailed: 'not_tried/official_login_failed', clientMismatch: 'not_tried/client_account_mismatch',
      gap: 'stuck/report_gap', fresh: 'uploading/reporting', holds: 'stuck/holds', login: 'stuck/official_login_required',
      doneLatest: 'done/done_latest', doneOld: 'done/done_old', noReports: 'stuck/no_progress_report', recentNoReports: 'uploading/no_progress_report',
    });
    expect(byPseudo[pseudo(ppl.loginFailed.user)].detail).toBe('captcha_required');
    expect(byPseudo[pseudo(ppl.holds.user)].detail).toBe('5');
    expect(byPseudo[pseudo(ppl.noReports.user)].raw_count).toBe(1);
    // one row per person, never the user id, dataset, device label or Kakao name
    expect(new Set((o.rows as Json[]).map(r => r.pseudo_id)).size).toBe((o.rows as Json[]).length);
    const text = JSON.stringify(o);
    for (const p of Object.values(ppl)) { expect(text).not.toContain(p.user); expect(text).not.toContain(p.dataset); }
    expect(text).not.toContain('합성 기기');
    expect(o.summary.categories.stuck).toBeGreaterThanOrEqual(4);
    expect(elapsed).toBeLessThan(5000);
    const d = opsCall(`ops.user_detail('${admin}', '${pseudo(ppl.holds.user)}')`);
    expect(d.connections[0]).toMatchObject({ source_app: 'safetyreport-mobile', status: 'active' });
    expect(d.progress_history.length).toBe(1);
    const dt = JSON.stringify(d);
    expect(dt).not.toContain(ppl.holds.user);
    expect(dt).not.toContain(ppl.holds.dataset);
    expect(dt).not.toContain('합성 기기');
    expect(sqlError(`select ops.user_detail('${admin}', 'zzzzzzzz')`)).toContain('invalid_pseudo_id');
    expect(sqlError(`select ops.upload_overview('${admin}', 0, '3.6.0', '2.5.0', null, null)`)).toContain('invalid_stale_hours');
  });

  it('daily prune removes 30-day progress history and 7-day refusal counters', () => {
    sql(`insert into private.community_ingest_rejections(minute, code, app, route, n) values (now() - interval '8 days', 'maintenance', 'pc', 'ingest', 3)
         on conflict do nothing`);
    const r = json(`select private.prune_backfill_resume_history()::text`);
    expect(r.rejections).toBeGreaterThanOrEqual(1);
  });

  it('Edge: public announcements without a user token; community-ingest answers 503 maintenance before any write', async () => {
    const env = execFileSync('node_modules/.bin/supabase', ['status', '-o', 'env', '--workdir', WORKDIR], { encoding: 'utf8' });
    const key = /^(?:PUBLISHABLE_KEY|ANON_KEY)="?([^"\n]+)"?$/m.exec(env)?.[1];
    expect(key, 'publishable key from supabase status').toBeTruthy();
    const r = await fetch(`${API}/functions/v1/app-announcements?app=pc&mode=server&platform=windows&version=3.6.2`, { headers: { apikey: key! } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.protocol).toBe(1);
    expect(body.announcements.map((a: Json) => a.id)).toEqual(['it-pc']);
    expect(r.headers.get('cache-control')).toContain('max-age=300');
    // an email-signup user: the pause answer comes before any identity/consent check
    const email = `br-${randomBytes(4).toString('hex')}@example.invalid`;
    const signup = await fetch(`${API}/auth/v1/signup`, { method: 'POST', headers: { apikey: key!, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: randomBytes(12).toString('base64url') }) });
    const s = await signup.json();
    expect(signup.status, 'email signup').toBe(200);
    created.push(s.user?.id ?? s.id);
    const resume = new Date(Date.now() + 1800_000).toISOString();
    opsCall(`ops.pause_uploads('${admin}', null, '${resume}')`);
    const before = Number(sql(`select coalesce(sum(n),0) from private.community_ingest_rejections where code = 'maintenance'`));
    const ingest = await fetch(`${API}/functions/v1/community-ingest/progress`, { method: 'POST',
      headers: { apikey: key!, authorization: `Bearer ${s.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify(progressVectors.cases[0].body) });
    expect(ingest.status).toBe(503);
    const e = (await ingest.json()).error;
    expect(e).toMatchObject({ code: 'maintenance', retryable: true });
    expect(Date.parse(e.resume_at)).toBe(Date.parse(resume));
    const retry = Number(ingest.headers.get('retry-after'));
    expect(retry).toBeGreaterThan(1700);
    expect(retry).toBeLessThanOrEqual(1800);
    expect(Number(sql(`select coalesce(sum(n),0) from private.community_ingest_rejections where code = 'maintenance'`))).toBe(before + 1);
    opsCall(`ops.resume_uploads('${admin}')`);
  });
});
