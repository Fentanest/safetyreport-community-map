// Isolated PostgreSQL execution: actual my-reports SQL, synthetic dependency tables/auth only.
// 실행: npm run test:sql (devDependency @electric-sql/pglite). 다른 PGlite 빌드를 쓸 때만 PGLITE_MODULE=<경로>로 바꾼다.
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
// 저장소 기준 상대 경로(supabase/migrations, contracts, tests/fixtures)를 어느 작업 폴더에서 실행해도 같게 읽는다.
process.chdir(fileURLToPath(new URL('../..', import.meta.url)));
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const root = 'supabase/migrations/';
const base = readFileSync(root + '202610020100_my_reports.sql', 'utf8');
const migration = readFileSync(root + '202610131500_my_reports_vehicle_min4.sql', 'utf8');
// Fail if a later definition changes the behavior under test.
for (const file of readdirSync(root).filter(f => f > '202610020100_my_reports.sql' && f.endsWith('.sql'))) {
  if (file === '202610131500_my_reports_vehicle_min4.sql') continue;
  assert.doesNotMatch(readFileSync(root + file, 'utf8'), /create or replace function (?:private\.my_reports_(?:check_query|own|matches|gate)|public\.internal_my_reports_(?:search|numbers))\s*\(/i, file);
}
const columns = base.match(/create type private\.my_reports_row as \(([\s\S]*?)\n\);/)[1];
await db.exec(`
  create schema private;
  create role anon; create role authenticated; create role service_role;
  create table private.community_report_facts (${columns}, contributor_id uuid, dataset_key text,
    source_report_key text, consent_grant_id uuid, public_state text, payload_sha256 text,
    answer_accepted_at timestamptz, first_accepted_at timestamptz,
    primary key(contributor_id, dataset_key, source_report_key));
  create table private.contributor_profiles(user_id uuid primary key, status text);
  create table private.community_consent_grants(grant_id uuid primary key, user_id uuid, revoked_at timestamptz);
  create table private.test_sessions(user_id uuid, session_id uuid);
  create function private.community_lineage_active(g uuid) returns boolean language sql stable as $$
    select exists(select 1 from private.community_consent_grants where grant_id=g and revoked_at is null) $$;
  create function private.community_identity_state(u uuid, s uuid) returns jsonb language sql stable as $$
    select jsonb_build_object('user_ok', true, 'kakao', true, 'session',
      exists(select 1 from private.test_sessions where user_id=u and session_id=s)) $$;
`);
await db.exec(base);
const props = async () => (await db.query(`select proowner, proacl::text, prosecdef, provolatile, proparallel, proconfig
  from pg_proc where oid='private.my_reports_check_query(text,text)'::regprocedure`)).rows[0];
const before = await props();
await assert.rejects(db.query("select private.my_reports_check_query('vehicle','5902')"), /INVALID_QUERY/);
await db.exec(migration);
assert.deepEqual(await props(), before, 'owner, ACL, security, volatility, parallel and search_path preserved');
await db.exec(migration);
assert.deepEqual(await props(), before, 'reapplying preserves attributes');
for (const [kind, raw, expected] of [
  ['vehicle', '5902', '5902'], ['vehicle', ' 5\t9\u30000\u00a02\n', '5902'],
  ['vehicle', '12\u1100\u11613456', '12가3456'], ['vehicle', '59021', '59021'],
  ['vehicle', '𠀀'.repeat(4), '𠀀'.repeat(4)], ['vehicle', 'x'.repeat(64), 'x'.repeat(64)],
  ['address', ' 12\t345 ', '12 345'], ['address', 'x'.repeat(200), 'x'.repeat(200)],
]) {
  assert.equal((await db.query('select private.my_reports_check_query($1,$2) as q', [kind, raw])).rows[0].q, expected);
}
for (const [kind, raw] of [
  ['vehicle', '590'], ['vehicle', ' 5 9 0 '], ['vehicle', '𠀀'.repeat(3)], ['vehicle', 'x'.repeat(65)],
  ['vehicle', '5902\u0007'], ['vehicle', null], ['address', '1234'], ['address', 'x'.repeat(201)],
]) await assert.rejects(db.query('select private.my_reports_check_query($1,$2)', [kind, raw]), /INVALID_QUERY/);

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const revoked = '33333333-3333-4333-8333-333333333333';
for (const u of [A, B]) {
  await db.query('insert into private.contributor_profiles values($1,\'active\');', [u]);
  await db.query('insert into private.community_consent_grants values($1,$1,null)', [u]);
  await db.query('insert into private.test_sessions values($1,$1)', [u]);
}
await db.query('insert into private.community_consent_grants values($1,$2,now())', [revoked, A]);
for (const [u, key, plate, grant, dataset, answer] of [
  [A, 'one', '12가5902', A, 'pc', '2026-10-13'],
  [A, 'one', '12가9999', A, 'old', '2026-10-12'], // superseded own plate
  [A, 'two', '34나59027', A, 'pc', '2026-10-13'], // literal substring, not just suffix
  [A, 'revoked', '12가5902', revoked, 'pc', '2026-10-13'],
  [B, 'foreign-same', '12가5902', B, 'pc', '2026-10-13'],
  [B, 'foreign-only', '12가7777', B, 'pc', '2026-10-13'],
]) await db.query(`insert into private.community_report_facts
  (contributor_id,dataset_key,source_report_key,consent_grant_id,public_state,status,vehicle_raw,
   report_number,source_report_id,payload_sha256,answer_accepted_at,first_accepted_at,completed_date,category,disposition,amount_kind)
  values($1,$2,$3,$4,'completed','accepted',$5,$6,'123',$7,$8,'2026-10-01','2026-10-13','parking','none','unknown')`,
  [u, dataset, key, grant, plate, `SPP-2610-${key}`, dataset, answer]);
const search = async (q, u = A, session = u) => (await db.query(`select public.internal_my_reports_search(
  $1,$2,'vehicle',$3,true,0,1,0,1,null) as result`, [u, session, q])).rows[0].result;
const numbers = async (q, max = 10000, u = A, session = u) => (await db.query(`select public.internal_my_reports_numbers(
  $1,$2,'vehicle',$3,0,1,$4,null) as result`, [u, session, q, max])).rows[0].result;
for (const run of [search, numbers]) {
  await assert.rejects(run('590'), /INVALID_QUERY/);
  const r = await run(' 5 9\u30000 2 ');
  assert.equal(r.query_normalized, '5902');
  assert.equal(r.reports?.total ?? r.matched_reports, 2);
  assert.equal((r.reports?.items ?? r.items).length, 1, 'page limit still applies');
  assert.doesNotMatch(JSON.stringify(r), /foreign|revoked|9999/);
  for (const q of ['7777', '9999', '%%%%', '____']) {
    const empty = await run(q);
    assert.equal(empty.reports?.total ?? empty.matched_reports, 0);
  }
}
assert.equal((await search('5902', B)).reports.total, 1, 'B sees only its own matching row');
assert.equal((await numbers('5902', 10000, B)).matched_reports, 1);
assert.equal((await search('5902', A, B)).error, 'SESSION_EXPIRED');
assert.equal((await numbers('5902', 10000, A, B)).error, 'SESSION_EXPIRED');
assert.equal((await numbers('5902', 1)).error, 'NUMBERS_LIMIT_EXCEEDED');
for (const signature of [
  'public.internal_my_reports_search(uuid,uuid,text,text,boolean,integer,integer,integer,integer,text)',
  'public.internal_my_reports_numbers(uuid,uuid,text,text,integer,integer,integer,text)',
]) {
  for (const [role, allowed] of [['anon', false], ['authenticated', false], ['service_role', true]]) {
    assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') as allowed', [role, signature])).rows[0].allowed, allowed);
  }
}
for (const role of ['anon', 'authenticated']) {
  assert.equal((await db.query("select has_function_privilege($1,'private.my_reports_check_query(text,text)','execute') as allowed", [role])).rows[0].allowed, false);
}
console.log('PASS: SQL 3/4 boundary, numeric/Unicode/whitespace, search+numbers, own/foreign/revoked/superseded scope, page/copy caps, session gate, ACL and attributes');
console.log('Synthetic in-memory PGlite; auth/consent dependencies are fixtures, not live Supabase authentication.');
await db.close();
