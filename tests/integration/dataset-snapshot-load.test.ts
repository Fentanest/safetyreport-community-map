import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from '../../server/ingest/observation';

const enabled = process.env.COMMUNITY_STACK === '1';
const API = process.env.COMMUNITY_API_URL ?? 'http://127.0.0.1:56321';
const DB_CONTAINER = process.env.COMMUNITY_DB_CONTAINER ?? 'supabase_db_ci0926-int';
const MOCK_KAKAO_HOST = process.env.COMMUNITY_MOCK_KAKAO_HOST ?? '172.17.0.1';
const REDIRECT = 'http://127.0.0.1:56480/callback.html';
const vectors = JSON.parse(readFileSync(new URL('../../contracts/community-ingest/vectors/observations.json', import.meta.url), 'utf8'));
const payloadOf = (name: string) => structuredClone(vectors.cases.find((c: { name: string }) => c.name === name).expected_payload);

type Json = Record<string, any>;
interface Keys { PUBLISHABLE_KEY: string; ANON_KEY: string; SERVICE_ROLE_KEY: string; JWT_SECRET: string }
let keys: Keys;

function sql(query: string): string {
  return execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAq', '-v', 'ON_ERROR_STOP=1'],
    { input: query, encoding: 'utf8' }).trim();
}
const count = (table: string, where = 'true') => Number(sql(`select count(*) from ${table} where ${where};`));

async function call(method: string, path: string, { token, body, headers = {}, apikey }: { token?: string | null; body?: unknown; headers?: Record<string, string>; apikey?: string | null } = {}) {
  const h: Record<string, string> = { ...headers };
  if (apikey !== null) h.apikey = apikey ?? keys.PUBLISHABLE_KEY;
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h['content-type'] = h['content-type'] ?? 'application/json';
  const base = /\/functions\/v1\/(public-analytics|my-analytics|user-rankings)/.test(path) ? process.env.SNAPSHOT_READ_API ?? API : API;
  const res = await fetch(`${base}${path}`, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json, headers: res.headers };
}
const account = (action: string, token: string | null, body: Json = {}) =>
  call('POST', `/functions/v1/community-account/${action}`, { token, body: { protocol: 1, ...body } });

// 동의문은 중앙 `policy` 로 받는다(2026-09-27) — 받은 본문의 해시를 직접 계산해 그 버전·해시로 동의한다(앱과 같은 방식).
// 계약 폴더에 동의문 사본을 두지 않는다. beforeAll 이 채운다.
let POLICY = '';
let CONSENT_HASH = '';
async function loadPolicy() {
  const s = await kakaoSession('A');
  const r = await account('policy', s.access);
  expect(r.status).toBe(200);
  const p = r.json.policy as { version: string; consent_text_sha256: string; consent_text: string };
  expect(createHash('sha256').update(p.consent_text, 'utf8').digest('hex')).toBe(p.consent_text_sha256);
  POLICY = p.version;
  CONSENT_HASH = p.consent_text_sha256;
}
const ingestRaw = (body: unknown, token: string | null, headers?: Record<string, string>) =>
  call('POST', '/functions/v1/community-ingest', { token, body, headers });
const SCOPE = 'date_basis=completed_date&start=2024-01-01&end=2028-12-31&category=all';
// The map is contributor-only (2026-09-28): statistics are read as E, a Kakao user with an active share consent
// and at least 10 distinct publicly-listed reports on the map.
let viewerToken: string | null = null;
async function viewer(): Promise<string> {
  if (!viewerToken) {
    const w = await writerFor('E');
    const events = await Promise.all(Array.from({ length: 10 }, () => event(w, `VIEW-${rid()}`)));
    const r = await ingest(w, events);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.results, JSON.stringify(r.json)).toHaveLength(10);
    expect(r.json.results.every((result: Json) => result.projection_status === 'published')).toBe(true);
    viewerToken = w.session.access;
  }
  return viewerToken;
}
const publicApi = async (route: string) =>
  call('GET', `/functions/v1/public-analytics/${route}${route === 'meta' ? '' : `?${SCOPE}`}`, { apikey: null, token: await viewer() });

// ── sessions ──────────────────────────────────────────────────────────────────
const b64url = (b: Buffer) => b.toString('base64url');
const rid = () => randomBytes(8).toString('hex'); // source_report_id is ^[0-9A-Za-z_-]{1,40}$
interface Session { access: string; refresh: string; userId: string; sessionId: string }

async function kakaoSession(choice: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H'): Promise<Session> {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const authorize = `${API}/auth/v1/authorize?${new URLSearchParams({ provider: 'kakao', redirect_to: REDIRECT, code_challenge: challenge, code_challenge_method: 's256' })}`;
  const step1 = await fetch(authorize, { redirect: 'manual' });
  const kakao = new URL(step1.headers.get('location')!);
  kakao.hostname = MOCK_KAKAO_HOST; // the browser-facing host.docker.internal is not resolvable from the host
  const decide = new URL('/oauth/decide', kakao);
  decide.search = new URLSearchParams({ state: kakao.searchParams.get('state')!, choice }).toString();
  const step2 = await fetch(decide, { redirect: 'manual' });
  const step3 = await fetch(step2.headers.get('location')!, { redirect: 'manual' });
  const landed = new URL(step3.headers.get('location')!);
  const code = landed.searchParams.get('code');
  if (!code) throw new Error(`no auth code: ${landed}`);
  const token = await call('POST', '/auth/v1/token?grant_type=pkce', { body: { auth_code: code, code_verifier: verifier } });
  expect(token.status).toBe(200);
  return toSession(token.json);
}

function toSession(j: Json): Session {
  const claims = JSON.parse(Buffer.from(j.access_token.split('.')[1], 'base64url').toString('utf8'));
  return { access: j.access_token, refresh: j.refresh_token, userId: claims.sub, sessionId: claims.session_id };
}

async function emailSession(): Promise<Session> {
  const email = `int-${randomUUID()}@example.invalid`, password = `Pw-${randomUUID()}`;
  const created = await call('POST', '/auth/v1/admin/users', { token: keys.SERVICE_ROLE_KEY, apikey: keys.SERVICE_ROLE_KEY, body: { email, password, email_confirm: true } });
  expect(created.status).toBe(200);
  const login = await call('POST', '/auth/v1/token?grant_type=password', { body: { email, password } });
  expect(login.status).toBe(200);
  return toSession(login.json);
}

function hs256(payload: Json, secret: string) {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' }), body = enc(payload);
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}

// ── writer / events ───────────────────────────────────────────────────────────
const datasetKey = (login: string) => createHash('sha256').update(`safetyreport-dataset|v1|${login}`).digest('hex');
interface Writer { session: Session; connectionId: string; epoch: number; grantId: string; dataset: string; secret: string; revision: number }

async function consent(s: Session) {
  const r = await account('consent', s.access, { policy_version: POLICY, consent_text_sha256: CONSENT_HASH, via: 'safetyreport_server', accepted: true });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json.grant_id as string;
}

async function register(s: Session, dataset: string, takeover = false, mode: 'server' | 'standalone' = 'server') {
  const secret = b64url(randomBytes(32));
  const r = await account('connections', s.access, { source_app: mode === 'server' ? 'safetyreport' : 'safetyreport-mobile', source_mode: mode,
    platform: 'linux', device_label: '통합 테스트', dataset_key: dataset, connection_secret: secret, takeover });
  return { r, secret };
}

async function writerFor(choice: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H', login = `int-${randomUUID()}`): Promise<Writer> {
  const session = await kakaoSession(choice);
  const grantId = await consent(session);
  const dataset = datasetKey(login);
  const { r, secret } = await register(session, dataset);
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return { session, connectionId: r.json.connection_id, epoch: r.json.writer_epoch, grantId, dataset, secret, revision: 0 };
}

async function event(w: Writer, reportId: string, payload: Json = payloadOf('accepted_fine'), opts: Partial<Json> = {}) {
  w.revision += 1;
  return { event_id: randomUUID(), event_type: 'completed_observation', source_system: 'safetyreport', source_report_id: reportId,
    report_number: 'SPP-2609-8000001', source_revision: w.revision, writer_epoch: w.epoch, captured_at: new Date().toISOString(), payload,
    payload_sha256: await sha256Hex(canonicalJson(payload)), ...opts };
}
const envelope = (w: Writer, events: unknown[], over: Partial<Json> = {}) => ({ protocol: 1, contract: 'community-ingest-v1',
  source_app: 'safetyreport', source_mode: 'server', connection_id: w.connectionId, consent_grant_id: w.grantId, policy_version: POLICY,
  client_version: 'it-1', parser_version: 'pc-parser-1', trigger: 'manual', events, ...over });
const ingest = (w: Writer, events: unknown[], over: Partial<Json> = {}, token = w.session.access) => ingestRaw(envelope(w, events, over), token);


// Opt-in sustained local ingest exercise. No operating/hosted URL is accepted.
const phase = process.env.SNAPSHOT_PHASE ?? 'before';
const duration = Number(process.env.SNAPSHOT_SECONDS ?? '180') * 1000;
const out = process.env.SNAPSHOT_OUT;
const runEnabled = enabled && !!out;
describe.skipIf(!runEnabled)('one screen during continuous real ingest', () => {
  it('records uploads, conflicts and complete-screen consistency', async () => {
    expect(API).toMatch(/^http:\/\/127\.0\.0\.1:5699[89]$/);
    expect(process.env.SNAPSHOT_READ_API ?? API).toMatch(/^http:\/\/127\.0\.0\.1:5699[89]$/);
    keys = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json', '--workdir', '.integration-stack'], { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }));
    sql('delete from private.rate_limits; delete from private.community_auth_rate_limits; update private.analytics_state set ready=true,published_at=now() where singleton;');
    await loadPolicy();
    const viewing = await writerFor('E'), uploading = await writerFor('G');
    for (const w of [viewing, uploading]) {
      const r = await ingest(w, await Promise.all(Array.from({length:10},()=>event(w, `SNAP-${rid()}`))));
      expect(r.status).toBe(200); expect(r.json.results.every((x:Json)=>x.projection_status==='published')).toBe(true);
    }
    if (process.env.SNAPSHOT_BROWSER_SESSION) {
      const w = await writerFor('H');
      const r = await ingest(w, await Promise.all(Array.from({length:10},()=>event(w, `BROW-${rid()}`))));
      expect(r.status).toBe(200);
      const user = await call('GET', '/auth/v1/user', { token: w.session.access });
      const file = process.env.SNAPSHOT_BROWSER_SESSION;
      expect(file).toMatch(/^\.agent-runtime\//);
      writeFileSync(file, JSON.stringify({access_token:w.session.access,refresh_token:w.session.refresh,token_type:'bearer',expires_in:3600,
        expires_at:Math.floor(Date.now()/1000)+3500,user:user.json}));chmodSync(file,0o600);
    }
    const statsSpec = { version:1,date_basis:'completed_date',population:'all',rows:['outcome'],columns:[],metrics:['completed_count'],filters:[],place_key:null };
    const rank = new URLSearchParams({theme:'reporters',metric:'reports_count',period:'all',date_basis:'completed_date',category:'all',min_reports:'1',page:'1',page_size:'20'});
    const get = (path:string)=>call('GET', '/functions/v1/'+path, {token:viewing.session.access,apikey:null});
    const started=Date.now(), samples:Json[]=[], uploads:Json[]=[];
    let stop=false;
    const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
    const uploadingJob=(async()=>{while(!stop){
      const at=Date.now();
      const r=await ingest(uploading,await Promise.all(Array.from({length:5},()=>event(uploading,`LIVE-${rid()}`))));
      uploads.push({at:Date.now()-started,status:r.status,published:r.json.results?.filter((x:Json)=>x.projection_status==='published').length??0});
      await sleep(Math.max(0,1250-(Date.now()-at)));
    }})();
    let version='';
    try { while(Date.now()-started<duration){
      const cycle=Date.now(), row:Json={at:cycle-started};
      const meta=await get('public-analytics/meta'); expect(meta.status).toBe(200);
      version=meta.json.dataset_version;
      await sleep(1500); // reproduce the real meta -> panel scheduling/network window while writes continue
      if(phase==='before') {
        const d=await get(`public-analytics/dashboard?${SCOPE}&expected_version=${version}`); row.dashboard=d.status;
        const fresh=await get('public-analytics/meta'); await sleep(1500);
        const retry=await get(`public-analytics/dashboard?${SCOPE}&expected_version=${fresh.json.dataset_version}`); row.retry=retry.status;
        const personal=await get(`my-analytics/compare?${SCOPE}&expected_version=${version}`); row.personal=personal.status;
      } else {
        const panels=[{id:'compare',path:'compare',params:{}},{id:'entities',path:'entities',params:{kind:'agency'}},{id:'laws',path:'laws',params:{}}];
        const d=await get(`my-analytics/screen?${SCOPE}&expected_version=${version}&panels=${encodeURIComponent(JSON.stringify(panels))}`);
        row.dashboard=d.status;
        expect(d.status).toBe(200);
        const v=d.json.meta.dataset_version;
        row.version=v; row.mixed=d.json.dashboard.dataset_version!==v || d.json.panels.some((p:Json)=>p.status!==200||p.body.dataset_version!==v);
        const c=d.json.panels.find((p:Json)=>p.id==='compare').body;
        row.countMismatch=d.json.dashboard.overview.report_count.value!==c.all.report_count || d.json.dashboard.overview.completed_count.value!==c.all.completed_count;
        row.publicCount=c.all.report_count;
        expect(row.mixed).toBe(false); expect(row.countMismatch).toBe(false);
      }
      const latest=phase==='before'?'':'&consistency=latest';
      const stats=await get(`public-analytics/statistics/query?${SCOPE}&expected_version=${version}${latest}&spec=${encodeURIComponent(JSON.stringify(statsSpec))}`);row.statistics=stats.status;
      const ownStats=await get(`my-analytics/statistics?${SCOPE}&expected_version=${version}${latest}&spec=${encodeURIComponent(JSON.stringify({...statsSpec,population:'compare'}))}`);row.personalStatistics=ownStats.status;
      const r=await get(`user-rankings?${rank}${latest}`);row.ranking=r.status;
      if(r.status===200){await sleep(1500); const page=new URLSearchParams(rank);page.set('page','2');page.set('expected_version',r.json.dataset_version);row.rankingPage=(await get(`user-rankings?${page}${latest}`)).status;}
      if(phase!=='before') for(const k of ['statistics','personalStatistics','ranking','rankingPage']) expect(row[k],k).toBe(200);
      samples.push(row);writeFileSync(out!,JSON.stringify({phase,started:new Date(started).toISOString(),elapsedMs:Date.now()-started,uploads,samples},null,2)+'\n');
      await sleep(Math.max(0,6500-(Date.now()-cycle)));
    }}finally{stop=true;await uploadingJob;writeFileSync(out!,JSON.stringify({phase,started:new Date(started).toISOString(),elapsedMs:Date.now()-started,uploads,samples},null,2)+'\n');}
    expect(uploads.every(x=>x.status===200&&x.published===5)).toBe(true);
    expect(uploads.reduce((n,x)=>n+x.published,0)).toBeGreaterThan(duration/1000*2);
    if(phase==='before') expect(samples.filter(x=>x.dashboard===409&&x.retry===409).length).toBeGreaterThan(0);
  },duration+120000);
});
