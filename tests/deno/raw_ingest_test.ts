import { validateRaw, rawEventFingerprint } from '../../server/ingest/raw.ts';
import { canonicalJson, canonicalJsonLiteralEscapes, sha256Hex } from '../../server/ingest/observation.ts';
import { createIngestHandler, gunzipLimited, type IngestDeps } from '../../server/ingest/handler.ts';
const v=JSON.parse(await Deno.readTextFile(new URL('../../contracts/community-ingest-v2/vectors/wire.json',import.meta.url)));
function check(x:boolean, what='synthetic vector mismatch') { if(!x) throw new Error(what); }
Deno.test('raw UTF-8, supplement and DTO bytes match shared vectors',async()=>{
  const e=v.envelope.events[0];await validateRaw(e);
  check(await sha256Hex(canonicalJson(e.supplement))===e.supplement_sha256);
  check(await sha256Hex(canonicalJson(e.client_observation))===e.client_observation_sha256);
  for(const c of v.raw_hash_cases) check(await sha256Hex(c.body)===c.sha256);
});
Deno.test('immutable fingerprint includes fetch/source metadata',async()=>{
  const e=v.envelope.events[0];const first=await rawEventFingerprint(e);
  check(first!==await rawEventFingerprint({...e,raw:{...e.raw,source:'recovery'}}));
});

// gzip bomb (리뷰 High): 300MB 의 0 을 gzip 한 ~300KB 본문은 전송 상한(512KiB) 안이다. Deno 런타임의 DecompressionStream 은
// 입력 조각 하나의 출력을 한 덩어리로 내므로, 통째로 넣으면 RSS 가 수백 MB 늘었다(실측 +307MB). 조각 투입으로 묶여야 한다.
async function zerosGzip(mb: number): Promise<Uint8Array> {
  const zeros = new Uint8Array(1024 * 1024);
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter();
  const out = new Response(cs.readable).arrayBuffer();
  for (let i = 0; i < mb; i++) await w.write(zeros);
  await w.close();
  return new Uint8Array(await out);
}
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const uid = '11111111-1111-4111-8111-111111111111';
const token = `${b64({})}.${b64({ sub: uid, session_id: uid, role: 'authenticated', aud: 'authenticated' })}.sig`;
function deps(v2: boolean, calls: string[]): IngestDeps {
  return { enabled: true, v2Enabled: v2, allowedOrigins: [], jwtIssuer: null,
    getUser: async () => { calls.push('getUser'); return { id: uid, isAnonymous: false }; },
    rpc: async name => { calls.push(name); return name.endsWith('rate_limit') ? true : { results: [] }; } };
}
function gzipRequest(body: Uint8Array): Request {
  return new Request('https://fixture.invalid/functions/v1/community-ingest', { method: 'POST', body: body as Uint8Array<ArrayBuffer>,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-encoding': 'gzip' } });
}

Deno.test('v2 handler accepts both control-character hash forms and rejects neither', async () => {
  for (const c of [...v.supplement_hash_cases, ...v.canonical_hash_cases]) {
    for (const [form, encode] of [['server', canonicalJson], ['literal', canonicalJsonLiteralEscapes]] as const) {
      const encoded = encode(c.supplement ?? c.value);
      check(encoded === c[form].canonical, `${c.name}/${form} canonical bytes`);
      check(await sha256Hex(encoded) === c[form].sha256, `${c.name}/${form} SHA-256`);
    }
  }
  for (const c of v.supplement_hash_cases) {
    for (const form of ['server', 'literal', 'invalid']) {
      const env = structuredClone(v.envelope), e = env.events[0];
      e.supplement = c.supplement;
      e.supplement_sha256 = form === 'invalid' ? '0'.repeat(64) : c[form].sha256;
      e.client_observation.address = c.supplement.list.title;
      e.client_observation_sha256 = await sha256Hex((form === 'literal' ? canonicalJsonLiteralEscapes : canonicalJson)(e.client_observation));
      const calls: string[] = [];
      const request = new Request('https://fixture.invalid/functions/v1/community-ingest', { method: 'POST',
        body: JSON.stringify(env), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
      const response = await createIngestHandler(deps(true, calls))(request);
      check(response.status === (form === 'invalid' ? 422 : 200), `${c.name}/${form} response`);
      if (form === 'invalid') {
        check((await response.json()).error.code === 'supplement_hash_mismatch');
        check(!calls.includes('internal_community_ingest_v2'), 'no invalid hash stored');
      } else check(calls.includes('internal_community_ingest_v2'), 'valid hash reaches storage');
    }
  }
});

Deno.test('gzip bomb: 300MB of zeros is rejected with 413 without large RSS growth (Deno runtime)', async () => {
  const bomb = await zerosGzip(300);
  check(bomb.byteLength < 512 * 1024, 'bomb must fit the 512KiB wire cap');
  const before = Deno.memoryUsage().rss;
  let peak = before;
  const timer = setInterval(() => { peak = Math.max(peak, Deno.memoryUsage().rss); }, 1);
  try {
    check(await gunzipLimited(bomb, 1024 * 1024) === null, 'bounded inflate must stop at the cap');
    const calls: string[] = [];
    const r = await createIngestHandler(deps(true, calls))(gzipRequest(bomb));
    peak = Math.max(peak, Deno.memoryUsage().rss);
    check(r.status === 413, `expected 413, got ${r.status}`);
    check((await r.json()).error.code === 'payload_too_large');
    check(calls[0] === 'getUser', 'inflation happens only after authentication');
  } finally { clearInterval(timer); }
  const growthMb = (peak - before) / 1048576;
  check(growthMb < 64, `RSS grew ${growthMb.toFixed(1)}MB while rejecting the bomb`);
});

Deno.test('gzip with v2 disabled fails fast with 415 before auth and before inflating', async () => {
  const bomb = await zerosGzip(300);
  const calls: string[] = [];
  const before = Deno.memoryUsage().rss;
  const r = await createIngestHandler(deps(false, calls))(gzipRequest(bomb));
  check(r.status === 415 && (await r.json()).error.code === 'unsupported_media_type', 'v2 off → 415 unsupported_media_type');
  check(calls.length === 0, 'no getUser/RPC before the 415');
  check((Deno.memoryUsage().rss - before) / 1048576 < 64, 'no inflation when v2 is off');
});

Deno.test('bounded inflate returns exact bytes up to the cap', async () => {
  const text = new TextEncoder().encode('{"a":"' + 'x'.repeat(200000) + '"}');
  const cs = new CompressionStream('gzip');
  const gz = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(cs)).arrayBuffer());
  const out = await gunzipLimited(gz, text.byteLength);
  check(!!out && out.byteLength === text.byteLength && new TextDecoder().decode(out) === new TextDecoder().decode(text), 'round trip');
  check(await gunzipLimited(gz, text.byteLength - 1) === null, 'one byte over the cap is rejected');
  let threw = false;
  try { await gunzipLimited(gz.slice(0, gz.byteLength - 4), text.byteLength); } catch { threw = true; }
  check(threw, 'truncated gzip throws');
});
