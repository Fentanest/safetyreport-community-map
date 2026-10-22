// Raw JSON ingest (v2) + Python parser worker on the REAL composed local Supabase stack (project ci0926-int).
// Real Postgres + GoTrue + community-account Edge (consent/connection/revoke) + the psycopg worker process.
// v2 events are sent to the SQL RPC public.internal_community_ingest_v2 directly (psql), the same call the Edge makes
// after validation; v1 uses the community-ingest Edge where HTTP behaviour matters, psql where per-statement counts do.
// Run (stack + mock Kakao as in community-stack.test.ts):
//   PARSER_REPO=<safetyreport-community-parser checkout> PARSER_PYTHON=<python with psycopg 3> COMMUNITY_STACK=1 npx vitest run tests/integration/raw-ingest-stack.test.ts
// Local stack only: gives the NOLOGIN community_parser role a random password for the test, then removes LOGIN again.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalJson, deriveFact, sha256Hex, sourceReportKey } from '../../server/ingest/observation';

const stackOn = process.env.COMMUNITY_STACK === '1';
// 파서 워커 코드는 비공개 레포로 옮겼다(2026-10-22). 워커를 띄우는 이 시험은 PARSER_REPO(그 checkout)가 있어야 돈다.
const PARSER_REPO = process.env.PARSER_REPO ?? '';
const WORKER = PARSER_REPO ? `${PARSER_REPO.replace(/\/+$/, '')}/worker.py` : '';
if (stackOn && !PARSER_REPO) console.warn('SKIP raw-ingest-stack: PARSER_REPO(파서 레포 checkout 경로)가 없어 워커를 띄울 수 없습니다.');
const enabled = stackOn && !!PARSER_REPO;
const API = process.env.COMMUNITY_API_URL ?? 'http://127.0.0.1:56321';
const DB_CONTAINER = process.env.COMMUNITY_DB_CONTAINER ?? 'supabase_db_ci0926-int';
const DB_PORT = process.env.COMMUNITY_DB_PORT ?? '56322';
const PY = process.env.PARSER_PYTHON ?? 'python3';
const MOCK_KAKAO_HOST = process.env.COMMUNITY_MOCK_KAKAO_HOST ?? '172.17.0.1';
const REDIRECT = 'http://127.0.0.1:56480/callback.html';
const RAW_POLICY = '2026-09-28.2'; // below the stack's current 2026-09-28.3: exercises the parsed (date,N) >= rule
const run = promisify(execFile);
type Json = Record<string, any>;

const PSQL = ['exec', '-i', DB_CONTAINER, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-tAq', '-v', 'ON_ERROR_STOP=1'];
const sql = (query: string): string => execFileSync('docker', PSQL, { input: query, encoding: 'utf8', maxBuffer: 16 << 20 }).trim();
async function sqlAsync(query: string): Promise<string> {
  const child = execFile('docker', PSQL, { encoding: 'utf8', maxBuffer: 16 << 20 });
  const done = new Promise<string>((resolve, reject) => {
    let out = '', err = '';
    child.stdout!.on('data', d => { out += d; });
    child.stderr!.on('data', d => { err += d; });
    child.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(`psql exit ${code}: ${err.slice(0, 400)}`)));
  });
  child.stdin!.end(query);
  return done;
}
const tag = () => `$j${randomBytes(4).toString('hex')}$`;
const lit = (v: unknown) => { const t = tag(); return `${t}${typeof v === 'string' ? v : JSON.stringify(v)}${t}`; };
const num = (q: string) => Number(sql(q));
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

// ── sessions / account API (same flows as community-stack.test.ts) ─────────────────────────────────────────────
interface Keys { PUBLISHABLE_KEY: string; SERVICE_ROLE_KEY: string }
let keys: Keys;
async function call(method: string, path: string, { token, body }: { token?: string; body?: unknown } = {}) {
  const h: Record<string, string> = { apikey: keys.PUBLISHABLE_KEY };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}
const account = (action: string, token: string, body: Json = {}) =>
  call('POST', `/functions/v1/community-account/${action}`, { token, body: { protocol: 1, ...body } });
const b64url = (b: Buffer) => b.toString('base64url');
interface Session { access: string; userId: string; sessionId: string }
async function kakaoSession(choice: string): Promise<Session> {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const step1 = await fetch(`${API}/auth/v1/authorize?${new URLSearchParams({ provider: 'kakao', redirect_to: REDIRECT, code_challenge: challenge, code_challenge_method: 's256' })}`, { redirect: 'manual' });
  const kakao = new URL(step1.headers.get('location')!);
  kakao.hostname = MOCK_KAKAO_HOST;
  const decide = new URL('/oauth/decide', kakao);
  decide.search = new URLSearchParams({ state: kakao.searchParams.get('state')!, choice }).toString();
  const step2 = await fetch(decide, { redirect: 'manual' });
  const step3 = await fetch(step2.headers.get('location')!, { redirect: 'manual' });
  const code = new URL(step3.headers.get('location')!).searchParams.get('code');
  const token = await call('POST', '/auth/v1/token?grant_type=pkce', { body: { auth_code: code, code_verifier: verifier } });
  expect(token.status).toBe(200);
  const claims = JSON.parse(Buffer.from(token.json.access_token.split('.')[1], 'base64url').toString('utf8'));
  return { access: token.json.access_token, userId: claims.sub, sessionId: claims.session_id };
}
let POLICY = '', CONSENT_HASH = '';
interface Writer { s: Session; connectionId: string; epoch: number; grantId: string; dataset: string; revision: number }
const used = new Set<string>();
async function writerFor(choice: string): Promise<Writer> {
  used.add(choice);
  const s = await kakaoSession(choice);
  const c = await account('consent', s.access, { policy_version: POLICY, consent_text_sha256: CONSENT_HASH, via: 'safetyreport_server', accepted: true });
  expect(c.status, JSON.stringify(c.json)).toBe(200);
  // A Kakao user is bound to one official account (dataset); reruns reuse the bound dataset and take its writer over.
  let dataset = sha(`safetyreport-dataset|v1|raw-it-${randomUUID()}`);
  const register = () => account('connections', s.access, { source_app: 'safetyreport', source_mode: 'server', platform: 'linux',
    device_label: '원본 통합 테스트', dataset_key: dataset, connection_secret: b64url(randomBytes(32)), takeover: true });
  let r = await register();
  if (r.status === 409 && r.json.error?.bound_dataset_key) { dataset = r.json.error.bound_dataset_key; r = await register(); }
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return { s, connectionId: r.json.connection_id, epoch: r.json.writer_epoch, grantId: c.json.grant_id, dataset, revision: 0 };
}

// ── v2 raw events (synthetic detail from the pinned PC parser vectors; no real report) ──────────────────────────
const vectors = JSON.parse(readFileSync(new URL('../../contracts/parser/parser-vectors.json', import.meta.url), 'utf8'));
const BASE = vectors.cases.find((c: Json) => c.name.startsWith('traffic accepted with amount')).detail;
const observations = JSON.parse(readFileSync(new URL('../../contracts/community-ingest/vectors/observations.json', import.meta.url), 'utf8'));
const dto = () => structuredClone(observations.cases.find((c: Json) => c.name === 'accepted_fine').expected_payload);
const rid = () => `RAWIT-${randomBytes(6).toString('hex')}`;
const numberFor = (id: string) => `SPP-2610-${String(parseInt(createHash('sha256').update(id).digest('hex').slice(0, 10), 16) % 10_000_000).padStart(7, '0')}`;
async function rawEvent(w: Writer, reportId: string, { revision, answer = 'PRIVATE_CANARY_ANSWER', observation = dto() as Json | null, mutate }
  = {} as { revision?: number; answer?: string; observation?: Json | null; mutate?: (r: Json) => void }) {
  if (revision === undefined) { w.revision += 1; revision = w.revision; }
  const result = structuredClone(BASE);
  result.C_NO = reportId; result.STTEMNT_NO = numberFor(reportId);
  result.C_A_CONTENTS = `PRIVATE_CANARY_BODY ${result.C_A_CONTENTS}`;
  result.answers[1].C_MANAGE_CONTENTS = `${result.answers[1].C_MANAGE_CONTENTS} ${answer}`;
  mutate?.(result);
  const body = JSON.stringify({ result });
  const supplement = { rating: 4, rating_cause: null, survey_state: '참여 완료', photo_first_at: null, photo_last_at: null, photo_count: null,
    list: { title: '신호위반', report_date: '2026-09-01', status: '답변완료', entry_value: null, ssnpc_cd: null, ssnpc_type: null } };
  const e: Json = { event_id: randomUUID(), event_type: 'completed_observation', source_system: 'safetyreport', source_report_id: reportId,
    source_report_key: await sourceReportKey(reportId), report_number: result.STTEMNT_NO, source_revision: revision, writer_epoch: w.epoch,
    captured_at: new Date().toISOString(),
    raw: { body, sha256: sha(body), size: Buffer.byteLength(body, 'utf8'), fetched_at: new Date().toISOString(), source: 'crawl' },
    supplement, supplement_sha256: sha(canonicalJson(supplement)) };
  if (observation) { e.client_observation = observation; e.client_observation_sha256 = sha(canonicalJson(observation)); }
  e.payload_sha256 = sha(canonicalJson({ raw: e.raw.sha256, supplement: e.supplement_sha256, observation: e.client_observation_sha256 ?? null }));
  return e;
}
const envelope = (w: Writer, contract: string, parser = 'pc-parser-13') => ({ connection_id: w.connectionId, consent_grant_id: w.grantId,
  source_app: 'safetyreport', source_mode: 'server', trigger: 'manual', contract, client_version: 'it-raw', parser_version: parser });
const v2Query = (w: Writer, events: Json[]) => `select public.internal_community_ingest_v2('${w.s.userId}','${w.s.sessionId}','it-${randomUUID()}',`
  + `${lit(envelope(w, 'community-ingest-v2'))}::jsonb,${lit(events)}::jsonb);`;
const v2 = (w: Writer, events: Json[]): Json => JSON.parse(sql(v2Query(w, events)));
const v2Async = async (w: Writer, events: Json[]): Promise<Json> => JSON.parse(await sqlAsync(v2Query(w, events)));
async function v1Event(w: Writer, reportId: string, revision: number, payload = dto()) {
  return { event_id: randomUUID(), event_type: 'completed_observation', source_report_id: reportId, report_number: numberFor(reportId),
    source_report_key: await sourceReportKey(reportId), source_revision: revision, writer_epoch: w.epoch, captured_at: new Date().toISOString(),
    payload, payload_sha256: await sha256Hex(canonicalJson(payload)), quarantine_reason: null, rejection_code: null, derived: await deriveFact(payload) };
}
const v1Query = (w: Writer, events: Json[]) => `select public.internal_community_ingest('${w.s.userId}','${w.s.sessionId}','it-${randomUUID()}',`
  + `${lit(envelope(w, 'community-ingest-v1'))}::jsonb,${lit(events)}::jsonb)`;

// ── worker ────────────────────────────────────────────────────────────────────────────────────────────────────
let DSN = '';
const workerEnv = () => ({ ...process.env, COMMUNITY_PARSER_DSN: DSN, TZ: 'Asia/Seoul', PYTHONDONTWRITEBYTECODE: '1' });
async function worker(args: string[] = ['--once', '--batch', '200']): Promise<string> {
  const { stderr } = await run(PY, [WORKER, ...args], { env: workerEnv(), timeout: 120_000, maxBuffer: 16 << 20 });
  return stderr;
}
const userQueue = (w: Writer) => num(`select count(*) from private.community_parse_queue where contributor_id='${w.s.userId}';`);
async function drain(w: Writer): Promise<string> {
  let log = '';
  for (let i = 0; i < 20 && userQueue(w) > 0; i++) {
    sql(`update private.community_parse_queue set next_attempt_at=now() where contributor_id='${w.s.userId}' and lease_token is null;`);
    log += await worker();
  }
  expect(userQueue(w)).toBe(0);
  return log;
}
const deadlocks = () => num(`select pg_stat_force_next_flush(); select deadlocks from pg_stat_database where datname='postgres';`);
const BAD = /DeadlockDetected|LockNotAvailable|worker_failed|fail_record_failed|release_failed|Traceback/;

describe.skipIf(!enabled)('raw JSON ingest v2 + parser worker on the composed local stack', () => {
  let A: Writer;
  beforeAll(async () => {
    keys = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json', '--workdir', process.env.STACK_WORKDIR ?? '.integration-stack'], { encoding: 'utf8' }));
    sql('delete from private.rate_limits; delete from private.community_auth_rate_limits;');
    sql('update private.analytics_state set ready = true, published_at = coalesce(published_at, now()) where singleton;');
    const s = await kakaoSession('C');
    const p = await account('policy', s.access);
    expect(p.status).toBe(200);
    POLICY = p.json.policy.version; CONSENT_HASH = p.json.policy.consent_text_sha256;
    const password = randomBytes(18).toString('hex');
    sql(`alter role community_parser login password '${password}';`);
    DSN = `postgresql://community_parser:${password}@127.0.0.1:${DB_PORT}/postgres?sslmode=disable`;
    sql(`update private.community_ingest_config set v2_enabled=true, raw_policy_version='${RAW_POLICY}', client_notice=null;`);
    A = await writerFor('C');
  }, 120_000);
  afterAll(async () => {
    if (!enabled) return;
    sql(`update private.community_ingest_config set v2_enabled=false, raw_policy_version='2026-10-21.1', client_notice=null;`);
    sql('alter role community_parser nologin password null;');
    // Leave the shared stack reusable: release each Kakao user's official-account binding (community-stack's viewer
    // and writers bind fresh datasets) by deleting this suite's shared reports through the account API.
    for (const choice of used) {
      const s = await kakaoSession(choice);
      const r = await account('contributions-delete', s.access, { confirm: 'DELETE_MY_SHARED_REPORTS' });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
    }
  }, 60_000);

  it('stores raw, parses private columns, projects fact_source=raw, records the diff and empties the queue', async () => {
    const report = rid();
    const e = await rawEvent(A, report);
    const r = v2(A, [e]);
    expect(r.results[0], JSON.stringify(r)).toMatchObject({ status: 'stored', durable: true, projection_status: 'parse_pending' });
    const key = e.source_report_key;
    expect(JSON.parse(sql(`select to_jsonb(r) from (select raw_sha256, raw_size, parse_state from private.community_report_raw where source_report_key='${key}') r;`)))
      .toEqual({ raw_sha256: e.raw.sha256, raw_size: e.raw.size, parse_state: 'pending' });
    expect(sql(`select raw_text from private.community_report_raw where source_report_key='${key}';`)).toBe(e.raw.body);
    const log = await drain(A);
    expect(log).not.toMatch(BAD);
    const parsed = JSON.parse(sql(`select to_jsonb(p) from private.community_report_parsed p where source_report_key='${key}';`));
    expect(parsed.report_content).toContain('PRIVATE_CANARY_BODY');      // 신고내용
    expect(parsed.processing_content).toContain('PRIVATE_CANARY_ANSWER'); // 처리내용
    expect(parsed.rating).toBe(4);
    expect(parsed.parser_version).toMatch(/^pc-parser-\d+\+map\d+$/);
    const fact = JSON.parse(sql(`select to_jsonb(f) from private.community_report_facts f where source_report_key='${key}';`));
    expect(fact).toMatchObject({ fact_source: 'raw', raw_sha256: e.raw.sha256, fact_parser_version: parsed.parser_version,
      consent_grant_id: A.grantId, status: 'accepted', public_state: 'completed', rating: 4 });
    expect(JSON.stringify(fact)).not.toContain('PRIVATE_CANARY');
    const diff = JSON.parse(sql(`select differences from private.community_parse_diffs where source_report_key='${key}';`));
    expect(Object.keys(diff).length).toBeGreaterThan(0); // client DTO (vector) differs from the server's parse of this body
    expect(num(`select count(*) from private.community_parse_queue where source_report_key='${key}';`)).toBe(0);
    expect(sql(`select parse_state from private.community_report_raw where source_report_key='${key}';`)).toBe('parsed');
  }, 120_000);

  it('same (epoch, revision): raw beats the DTO fact; a newer v1 DTO wins afterwards', async () => {
    const report = rid();
    const ev1 = await v1Event(A, report, 50);
    const first = JSON.parse(sql(v1Query(A, [ev1]) + ';'));
    expect(first.results[0].status, JSON.stringify(first)).toBe('accepted');
    const key = ev1.source_report_key;
    expect(sql(`select fact_source from private.community_report_facts where source_report_key='${key}';`)).toBe('dto');
    const e = await rawEvent(A, report, { revision: 50 });
    expect(v2(A, [e]).results[0].status).toBe('stored');
    await drain(A);
    expect(sql(`select fact_source||'|'||raw_sha256 from private.community_report_facts where source_report_key='${key}';`)).toBe(`raw|${e.raw.sha256}`);
    const newer = JSON.parse(sql(v1Query(A, [await v1Event(A, report, 51)]) + ';'));
    expect(newer.results[0].status).toMatch(/^(accepted|no_change)$/);
    expect(sql(`select fact_source from private.community_report_facts where source_report_key='${key}';`)).toBe('dto');
  }, 120_000);

  it('v1 no_change runs one fact UPDATE statement and does not invalidate the personal cache for transport columns', async () => {
    const report = rid();
    const accepted = sql(`begin; ${v1Query(A, [await v1Event(A, report, 60)])};
      select n_tup_ins||'|'||n_tup_upd from pg_stat_xact_user_tables where relid='private.community_report_facts'::regclass;
      select n_tup_upd from pg_stat_xact_user_tables where relid='private.analytics_state'::regclass; commit;`).split('\n');
    expect(JSON.parse(accepted[0]).results[0].status).toBe('accepted');
    expect(accepted.slice(1)).toEqual(['1|0', '1']); // one INSERT, one projection bump (no extra transport UPDATE)
    const key = await sourceReportKey(report);
    // Make only transport columns differ, then send a content-identical newer revision (no_change).
    sql(`update private.community_report_facts set fact_parser_version='older', fact_source='raw', raw_sha256=repeat('0',64) where source_report_key='${key}';`);
    const before = sql(`select coalesce((select revision from private.screen_user_revision where user_id='${A.s.userId}'),0);`);
    const same = sql(`begin; ${v1Query(A, [await v1Event(A, report, 61)])};
      select n_tup_ins||'|'||n_tup_upd from pg_stat_xact_user_tables where relid='private.community_report_facts'::regclass;
      select n_tup_upd from pg_stat_xact_user_tables where relid='private.analytics_state'::regclass; commit;`).split('\n');
    expect(JSON.parse(same[0]).results[0].status).toBe('no_change');
    expect(same.slice(1)).toEqual(['0|1', '1']); // exactly one UPDATE statement, one projection bump
    expect(sql(`select coalesce((select revision from private.screen_user_revision where user_id='${A.s.userId}'),0);`)).toBe(before);
    expect(sql(`select fact_source||'|'||fact_parser_version||'|'||coalesce(raw_sha256,'null') from private.community_report_facts where source_report_key='${key}';`))
      .toBe('dto|pc-parser-13|null');
  }, 60_000);

  it('concurrent ingest of the same reports while the worker runs: no deadlock, converges to the newest raw', async () => {
    const reports = Array.from({ length: 30 }, rid);
    const latest = new Map<string, Json>();
    for (const chunk of [reports.slice(0, 15), reports.slice(15)]) {
      const events = await Promise.all(chunk.map(r => rawEvent(A, r, { revision: 100 })));
      expect(v2(A, events).results.every((x: Json) => x.status === 'stored')).toBe(true);
      events.forEach(e => latest.set(e.source_report_id, e));
    }
    const dl = deadlocks();
    const seen: string[] = [];
    for (let round = 0; round < 4; round++) {
      const rev = 101 + round;
      const fresh = await Promise.all(reports.map(r => rawEvent(A, r, { revision: rev, answer: `ROUND${round}` })));
      fresh.forEach(e => latest.set(e.source_report_id, e));
      sql(`update private.community_parse_queue set next_attempt_at=now() where contributor_id='${A.s.userId}' and lease_token is null;`);
      // Two workers (SKIP LOCKED split) race v2 re-sends of the same reports (raw->fact->queue) and stale v1 sends (fact locks).
      const v1Stale = await Promise.all(reports.slice(0, 10).map(r => v1Event(A, r, 99)));
      const [log1, log2, ...acks] = await Promise.all([
        worker(['--once', '--batch', '200']), worker(['--once', '--batch', '7']),
        ...Array.from({ length: 6 }, (_, i) => v2Async(A, fresh.slice(i * 5, i * 5 + 5))),
        ...v1Stale.map(e => sqlAsync(v1Query(A, [e]) + ';').then(JSON.parse).then((j: Json) => ({ v1: true, ...j }))),
      ]);
      expect(log1).not.toMatch(BAD); expect(log2).not.toMatch(BAD);
      seen.push(...`${log1}\n${log2}`.split('\n').filter(l => l.includes('batch_complete')).map(l => l.replace(/.*outcomes=([^ ]*).*/, '$1')));
      // v1 rev 99 is 'accepted' when it wins the race before the first raw projection, else 'stale_ignored'.
      for (const ack of acks as Json[]) expect(ack.results.every((x: Json) => ack.v1 ? ['accepted', 'stale_ignored'].includes(x.status) : x.status === 'stored'),
        JSON.stringify(ack)).toBe(true);
      seen.push(`v1:${(acks as Json[]).filter(a => a.v1).map(a => a.results[0].status).join(',')}`);
    }
    console.info(`[raw-ingest] concurrent worker outcomes per batch: ${seen.join(' | ')}`);
    expect(await drain(A)).not.toMatch(BAD);
    expect(deadlocks()).toBe(dl);
    for (const e of latest.values()) {
      expect(sql(`select r.raw_sha256||'|'||r.parse_state||'|'||f.fact_source||'|'||f.raw_sha256||'|'||f.source_revision
        from private.community_report_raw r join private.community_report_facts f using(contributor_id,dataset_key,source_report_key)
        where r.source_report_key='${e.source_report_key}';`)).toBe(`${e.raw.sha256}|parsed|raw|${e.raw.sha256}|${e.source_revision}`);
    }
  }, 300_000);

  it('deterministic interleavings: held ingest blocks finish (superseded), held finish blocks ingest and revoke; no deadlock', async () => {
    const W = await writerFor('E');
    const registry = sql('select version from private.community_registry_state;');
    const derived = { ...(await deriveFact(dto())), agency_registry_version: registry };
    const finishQuery = (job: Json, e: Json) => `select private.finish_raw_parse('${job.contributor_id}','${job.dataset_key}','${job.source_report_key}',`
      + `'${job.lease_token}','${e.raw.sha256}','${e.supplement_sha256}','it-key',${lit({ status: 'accepted' })}::jsonb,repeat('0',64),`
      + `${lit(derived)}::jsonb,'{}'::jsonb,null);`;
    const claimFor = (e: Json): Json => {
      const rows = sql(`select to_jsonb(j) from private.claim_raw_parse_jobs(200,300) j;`).split('\n').filter(Boolean).map(l => JSON.parse(l));
      for (const other of rows.filter(r => r.source_report_key !== e.source_report_key))
        sql(`select private.release_raw_parse_job('${other.contributor_id}','${other.dataset_key}','${other.source_report_key}','${other.lease_token}');`);
      const job = rows.find(r => r.source_report_key === e.source_report_key);
      expect(job).toBeTruthy();
      return job!;
    };
    const dl = deadlocks();
    // 1) ingest of new bytes holds report lock + raw + queue; the worker's finish (claimed on old bytes) waits, then 'superseded'.
    const report = rid();
    const old = await rawEvent(W, report, { revision: 10 });
    expect(v2(W, [old]).results[0].status).toBe('stored');
    const job = claimFor(old);
    const newer = await rawEvent(W, report, { revision: 11, answer: 'NEWER_BYTES' });
    const held = sqlAsync(`begin; ${v2Query(W, [newer])} select pg_sleep(2); commit;`);
    await new Promise(r => setTimeout(r, 500));
    const t0 = Date.now();
    const finished = await sqlAsync(finishQuery(job, old));
    expect(finished).toBe('superseded');
    expect(Date.now() - t0).toBeGreaterThan(1000); // it really waited for the ingest's locks
    expect(JSON.parse((await held).split('\n').find(l => l.startsWith('{'))!).results[0].status).toBe('stored');
    expect(sql(`select (lease_token is null)||'|'||attempts from private.community_parse_queue where source_report_key='${old.source_report_key}';`)).toBe('true|0');
    // 2) the worker's finish transaction held open: a concurrent ingest and a consent withdrawal wait, then complete.
    const job2 = claimFor(newer);
    const heldFinish = sqlAsync(`begin; ${finishQuery(job2, newer)} select pg_sleep(2); commit;`);
    await new Promise(r => setTimeout(r, 500));
    const t1 = Date.now();
    const [ingested, revoked] = await Promise.all([
      v2Async(W, [await rawEvent(W, report, { revision: 12, answer: 'THIRD_BYTES' })]),
      new Promise(r => setTimeout(r, 100)).then(() => account('consent-revoke', W.s.access, { grant_id: W.grantId })),
    ]);
    expect((await heldFinish).split('\n').filter(Boolean)).toContain('accepted');
    expect(Date.now() - t1).toBeGreaterThan(1000);
    expect(['stored', undefined]).toContain(ingested.results?.[0]?.status); // stored, or refused after the withdrawal won
    expect(revoked.status, JSON.stringify(revoked.json)).toBe(200);
    expect(num(`select count(*) from private.community_report_raw where contributor_id='${W.s.userId}';`)).toBe(0);
    expect(num(`select count(*) from private.community_parse_queue where contributor_id='${W.s.userId}';`)).toBe(0);
    expect(deadlocks()).toBe(dl);
  }, 120_000);

  it('consent withdrawal deletes raw/parsed/diffs/queue, also while the worker is running, without deadlock', async () => {
    const W = await writerFor('D');
    const events = await Promise.all(Array.from({ length: 12 }, () => rawEvent(W, rid())));
    expect(v2(W, events.slice(0, 6)).results.every((x: Json) => x.status === 'stored')).toBe(true);
    await drain(W);
    expect(num(`select count(*) from private.community_report_parsed where contributor_id='${W.s.userId}';`)).toBe(6);
    expect(v2(W, events.slice(6)).results.every((x: Json) => x.status === 'stored')).toBe(true);
    const dl = deadlocks();
    const [log, revoked] = await Promise.all([worker(['--once', '--batch', '200']),
      new Promise(r => setTimeout(r, 150)).then(() => account('consent-revoke', W.s.access, { grant_id: W.grantId }))]);
    expect(revoked.status, JSON.stringify(revoked.json)).toBe(200);
    expect(log).not.toMatch(BAD);
    expect(deadlocks()).toBe(dl);
    for (const t of ['community_report_raw', 'community_report_parsed', 'community_parse_diffs', 'community_parse_queue'])
      expect(num(`select count(*) from private.${t} where contributor_id='${W.s.userId}';`), t).toBe(0);
    // Facts keep the existing revoke semantics (hidden by lineage), and the map client state reports the withdrawal.
    expect(JSON.parse(sql(`select public.internal_map_client_state('${W.s.userId}');`)).consent).toBe('revoked');
  }, 180_000);

  it('30-day payload purge (pg_cron function) keeps v1 duplicate ACKs; the cron job is scheduled', async () => {
    expect(sql(`select schedule from cron.job where jobname='community-ingest-payload-prune';`)).toBe('17 18 * * *');
    const ev = await v1Event(A, rid(), 70);
    expect(JSON.parse(sql(v1Query(A, [ev]) + ';')).results[0].status).toBe('accepted');
    sql(`update private.community_ingest_events set received_at=now()-interval '31 days' where event_id='${ev.event_id}';`);
    expect(num(`select private.prune_community_ingest_payloads(5000, interval '20 seconds');`)).toBeGreaterThanOrEqual(1);
    expect(sql(`select payload is null from private.community_ingest_events where event_id='${ev.event_id}';`)).toBe('t');
    const again = JSON.parse(sql(v1Query(A, [ev]) + ';'));
    expect(again.results[0]).toMatchObject({ status: 'duplicate', durable: true, original_status: 'accepted' });
  }, 60_000);

  it('internal_map_client_state: consent/contract/v1 count/v2 flag/notice, no identifiers, service_role only', async () => {
    const st = JSON.parse(sql(`select public.internal_map_client_state('${A.s.userId}');`));
    // 2026-10-22: upload_pause (2-9 banner) and update_gate (2-10 required version) joined the map web's own state.
    expect(Object.keys(st).sort()).toEqual(['consent', 'last_contract', 'notice', 'update_gate', 'upload_pause', 'v1_connections', 'v2_enabled']);
    expect(st).toMatchObject({ consent: 'active', v2_enabled: true, notice: null });
    expect(['community-ingest-v1', 'community-ingest-v2']).toContain(st.last_contract);
    expect(typeof st.v1_connections).toBe('number');
    for (const id of [A.dataset, A.grantId, A.connectionId, A.s.userId]) expect(JSON.stringify(st)).not.toContain(id);
    const notice = { level: 'warning', message: '업데이트가 필요합니다.', min_version: { pc: '3.6.0', mobile: '2.5.0' },
      url: { pc: 'https://example.invalid/pc', mobile: null }, deadline: '2026-12-31T00:00:00+09:00' };
    sql(`update private.community_ingest_config set client_notice=${lit(notice)}::jsonb;`);
    expect(JSON.parse(sql(`select public.internal_map_client_state('${A.s.userId}');`)).notice).toEqual(notice);
    expect(() => sql(`update private.community_ingest_config set client_notice=${lit({ ...notice, level: 'urgent' })}::jsonb;`)).toThrow(/notice_shape/);
    sql('update private.community_ingest_config set client_notice=null;');
    const outdated = sql(`begin; insert into private.community_policies(version, consent_text_sha256) values ('2099-01-01.1', repeat('0',64));
      update private.community_policy_current set version='2099-01-01.1'; select public.internal_map_client_state('${A.s.userId}')->>'consent'; rollback;`);
    expect(outdated).toBe('outdated');
    expect(JSON.parse(sql(`select public.internal_map_client_state('${randomUUID()}');`))).toEqual(
      { consent: 'none', last_contract: null, v1_connections: 0, v2_enabled: true, notice: null,
        upload_pause: { paused: false, message: null, resume_at: null }, update_gate: null });
    for (const role of ['anon', 'authenticated', 'community_parser'])
      expect(sql(`select has_function_privilege('${role}','public.internal_map_client_state(uuid)','EXECUTE');`)).toBe('f');
    expect(sql(`select has_function_privilege('service_role','public.internal_map_client_state(uuid)','EXECUTE');`)).toBe('t');
  }, 60_000);

  it('finish_raw_parse refuses a worker whose registry differs from the singleton (55P03, no projection); requeue_dead_raw is owner-only', async () => {
    const W = A;
    const report = rid();
    const e = await rawEvent(W, report, { revision: 30 });
    expect(v2(W, [e]).results[0].status).toBe('stored');
    const rows = sql(`select to_jsonb(j) from private.claim_raw_parse_jobs(200,300) j;`).split('\n').filter(Boolean).map(l => JSON.parse(l));
    for (const other of rows.filter(r => r.source_report_key !== e.source_report_key))
      sql(`select private.release_raw_parse_job('${other.contributor_id}','${other.dataset_key}','${other.source_report_key}','${other.lease_token}');`);
    const job = rows.find(r => r.source_report_key === e.source_report_key)!;
    const derived = { ...(await deriveFact(dto())), agency_registry_version: 'not-the-singleton' };
    expect(() => sql(`select private.finish_raw_parse('${job.contributor_id}','${job.dataset_key}','${job.source_report_key}','${job.lease_token}',`
      + `'${e.raw.sha256}','${e.supplement_sha256}','it-key',${lit({ status: 'accepted' })}::jsonb,repeat('0',64),${lit(derived)}::jsonb,'{}'::jsonb,null);`)).toThrow(/registry_version_mismatch/);
    expect(num(`select count(*) from private.community_report_facts where source_report_key='${e.source_report_key}';`)).toBe(0);
    sql(`select private.release_raw_parse_job('${job.contributor_id}','${job.dataset_key}','${job.source_report_key}','${job.lease_token}');`);
    for (const role of ['anon', 'authenticated', 'service_role', 'community_parser'])
      expect(sql(`select has_function_privilege('${role}','private.requeue_dead_raw(timestamptz,text)','EXECUTE');`)).toBe('f');
    expect(num(`select private.requeue_dead_raw(now(), 'no-such-error');`)).toBe(0);
  }, 60_000);

  it('a permanently failing body is retried with backoff, then marked dead and leaves the queue; the fact is kept', async () => {
    const report = rid();
    const ok = await rawEvent(A, report, { revision: 200 });
    expect(v2(A, [ok]).results[0].status).toBe('stored');
    await drain(A);
    const key = ok.source_report_key;
    const factBefore = sql(`select payload_sha256 from private.community_report_facts where source_report_key='${key}';`);
    const bad = await rawEvent(A, report, { revision: 201, mutate: r => { r.answers = [r.answers[0]]; r.C_NOW = 2; } }); // '처리중': not final
    expect(v2(A, [bad]).results[0].status).toBe('stored');
    const log = await worker();
    expect(log).toContain('parse_failed');
    expect(log).not.toMatch(BAD);
    expect(sql(`select r.parse_state||'|'||r.parse_error||'|'||q.attempts||'|'||(q.lease_token is null)||'|'||(q.next_attempt_at>now()+interval '20 seconds')
      from private.community_report_raw r join private.community_parse_queue q using(contributor_id,dataset_key,source_report_key)
      where r.source_report_key='${key}';`)).toBe('failed|ValueError|1|true|true');
    sql(`update private.community_parse_queue set attempts=7, next_attempt_at=now() where source_report_key='${key}';`);
    await worker();
    expect(sql(`select parse_state from private.community_report_raw where source_report_key='${key}';`)).toBe('dead');
    expect(num(`select count(*) from private.community_parse_queue where source_report_key='${key}';`)).toBe(0);
    expect(sql(`select payload_sha256 from private.community_report_facts where source_report_key='${key}';`)).toBe(factBefore);
    // identical bytes stay dead (no_change); new bytes revive the row
    const resend = { ...bad, event_id: randomUUID() };
    expect(v2(A, [resend]).results[0].status).toBe('no_change');
    expect(v2(A, [await rawEvent(A, report, { revision: 202 })]).results[0].status).toBe('stored');
    await drain(A);
    expect(sql(`select parse_state from private.community_report_raw where source_report_key='${key}';`)).toBe('parsed');
  }, 120_000);

  it('SIGTERM stops a running worker gracefully', async () => {
    const child = execFile(PY, [WORKER, '--pause', '1'], { env: workerEnv() });
    let err = '';
    child.stderr!.on('data', d => { err += d; });
    const exited = new Promise<number | null>(resolve => child.on('close', code => resolve(code)));
    await new Promise(r => setTimeout(r, 2500));
    const started = Date.now();
    child.kill('SIGTERM');
    expect(await exited).toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(err).toContain('worker_stopped');
    expect(err).not.toMatch(BAD);
  }, 30_000);

  it('worker refuses privileged logins and holds no write grants on private tables', async () => {
    const out = await run(PY, [WORKER, '--once'], {
      env: { ...workerEnv(), COMMUNITY_PARSER_DSN: `postgresql://postgres:postgres@127.0.0.1:${DB_PORT}/postgres?sslmode=disable` },
    }).then(() => 'started', (e: { stderr?: string; message: string }) => e.stderr ?? e.message);
    expect(out).toContain('refusing to start');
    for (const t of ['community_report_raw', 'community_report_parsed', 'community_parse_diffs', 'community_parse_queue', 'community_report_facts'])
      expect(sql(`select has_table_privilege('community_parser','private.${t}','INSERT') or has_table_privilege('community_parser','private.${t}','UPDATE')
        or has_table_privilege('community_parser','private.${t}','DELETE');`), t).toBe('f');
    expect(sql(`select rolconfig::text from pg_roles where rolname='community_parser';`))
      .toBe('{lock_timeout=5s,statement_timeout=30s,idle_in_transaction_session_timeout=60s}');
  }, 60_000);
});
