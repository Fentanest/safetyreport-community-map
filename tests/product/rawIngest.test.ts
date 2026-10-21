import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { createIngestHandler, type IngestDeps } from '../../server/ingest/handler';
import { validateRaw, rawEventFingerprint } from '../../server/ingest/raw';
import { canonicalJson, deriveFact, sha256Hex, type Observation } from '../../server/ingest/observation';
const wire=JSON.parse(readFileSync('contracts/community-ingest-v2/vectors/wire.json','utf8'));
const uid='11111111-1111-4111-8111-111111111111';
const b64=(o: unknown)=>Buffer.from(JSON.stringify(o)).toString('base64url');
const token=`${b64({})}.${b64({sub:uid,session_id:uid,role:'authenticated',aud:'authenticated'})}.sig`;
function setup(v2=true) {
  const calls: {name:string;args:Record<string,unknown>}[]=[];
  const logs: unknown[]=[];
  const deps: IngestDeps={enabled:true,v2Enabled:v2,allowedOrigins:[],jwtIssuer:null,log:e=>logs.push(e),
    getUser:async()=>{calls.push({name:'getUser',args:{}});return {id:uid,isAnonymous:false};},
    rpc:async(name,args)=>{calls.push({name,args});return name.endsWith('rate_limit')?true:{results:[{event_id:wire.envelope.events[0].event_id,status:'stored',durable:true,receipt_id:uid,projection_status:'parse_pending'}]};}};
  return {deps,calls,logs};
}
function post(body: unknown,compressed=false,path='/functions/v1/community-ingest') {
  const bytes=typeof body==='string'||Buffer.isBuffer(body)?Buffer.from(body as string):Buffer.from(JSON.stringify(body));
  return new Request(`https://fixture.invalid${path}`,{method:'POST',body:compressed?gzipSync(bytes):bytes,
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...(compressed?{'content-encoding':'gzip'}:{})}});
}
describe('private raw v2 reception',()=>{
  it('validates exact UTF-8 bytes and preserves original serialization',async()=>{
    for(const c of wire.raw_hash_cases){expect(await sha256Hex(c.body)).toBe(c.sha256);expect(Buffer.byteLength(c.body)).toBe(c.size);}
    await expect(validateRaw(wire.envelope.events[0])).resolves.toBeUndefined();
    expect(Buffer.from(wire.envelope.events[0].raw.body).toString('hex')).toBe(wire.raw_utf8_hex);
  });
  it.each([false,true])('stores+queues without Edge parsing, gzip=%s',async compressed=>{
    const {deps,calls,logs}=setup();const r=await createIngestHandler(deps)(post(wire.envelope,compressed));
    expect(r.status).toBe(200);expect((await r.json()).results[0].projection_status).toBe('parse_pending');
    const c=calls.find(x=>x.name==='internal_community_ingest_v2')!;
    expect(c.args.p_events).toHaveLength(1);expect((c.args.p_events as Record<string,unknown>[])[0]).not.toHaveProperty('derived');
    expect(JSON.stringify(logs)).not.toContain('합성 비공개');
  });
  it('is disabled by default and uses the shared capability switch',async()=>{
    const {deps}=setup(false);const off=await createIngestHandler(deps)(post(wire.envelope));
    expect(off.status).toBe(503);expect((await off.json()).error).toMatchObject({code:'service_unavailable',retryable:true});
    deps.capabilities=async()=>({contracts:[1,2]});expect((await createIngestHandler(deps)(post(wire.envelope))).status).toBe(200);
  });
  it('rejects content corruption, reporter keys and mismatched identities before storage',async()=>{
    const expected: Record<string,string>={hash:'raw_hash_mismatch',reporter:'raw_reporter_keys_present',identity:'raw_invalid',
      supplement:'supplement_invalid',dto:'client_observation_hash_mismatch'};
    for(const kind of Object.keys(expected)){
      const body=structuredClone(wire.envelope),e=body.events[0];
      if(kind==='hash')e.raw.sha256='0'.repeat(64);
      if(kind==='supplement')e.supplement.rating=6;
      if(kind==='dto')e.client_observation_sha256='0'.repeat(64);
      if(kind==='reporter'||kind==='identity'){
        const raw=JSON.parse(e.raw.body);if(kind==='reporter')raw.result.C_PHONE='SYNTHETIC';else raw.result.C_NO='OTHER';
        e.raw.body=JSON.stringify(raw);e.raw.size=Buffer.byteLength(e.raw.body);e.raw.sha256=await sha256Hex(e.raw.body);
      }
      const {deps,calls}=setup();const r=await createIngestHandler(deps)(post(body));expect(r.status,kind).toBe(422);
      expect((await r.json()).error.code,kind).toBe(expected[kind]);
      expect(calls.some(c=>c.name==='internal_community_ingest_v2')).toBe(false);
    }
  });
  it('rejects protocol coercion and decompression bombs',async()=>{
    const {deps}=setup();const coerced=await createIngestHandler(deps)(post({...wire.envelope,protocol:'2'}));
    expect(coerced.status).toBe(400);expect((await coerced.json()).error.code).toBe('invalid_request');
    const big=await createIngestHandler(deps)(post({...wire.envelope,padding:'x'.repeat(1024*1024)},true));
    expect(big.status).toBe(413);expect((await big.json()).error.code).toBe('payload_too_large');
  });

  // 리뷰 High: gzip 은 인증·v2 확인 뒤에만, 조각 단위 상한 안에서만 푼다.
  const bomb=gzipSync(Buffer.alloc(32*1024*1024));
  const gzRequest=(bytes: Buffer, path='/functions/v1/community-ingest')=>new Request(`https://fixture.invalid${path}`,{method:'POST',body:Uint8Array.from(bytes),
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json','content-encoding':'gzip'}});
  it('gzip with v2 disabled fails fast with 415 (same as any unsupported encoding) before auth and before reading',async()=>{
    const {deps,calls}=setup(false);
    for(const enc of ['gzip','br']){
      let pulled=0;
      const stream=new ReadableStream<Uint8Array>({pull(c){pulled++;c.enqueue(new Uint8Array(bomb));c.close();}},{highWaterMark:0});
      const r=await createIngestHandler(deps)(new Request('https://fixture.invalid/functions/v1/community-ingest',{method:'POST',body:stream,duplex:'half',
        headers:{authorization:`Bearer ${token}`,'content-type':'application/json','content-encoding':enc}} as RequestInit));
      expect(r.status,enc).toBe(415);expect((await r.json()).error,enc).toMatchObject({code:'unsupported_media_type',retryable:false});
      expect(pulled,enc).toBe(0);
    }
    expect(calls).toHaveLength(0);
    // manifest is v1-only: gzip there is the same 415, without auth or reading
    const {deps:on,calls:onCalls}=setup(true);
    expect((await createIngestHandler(on)(gzRequest(gzipSync(Buffer.from('{}')),'/functions/v1/community-ingest/manifest'))).status).toBe(415);
    expect(onCalls).toHaveLength(0);
  });
  it('gzip when the shared switch says v2 is off: auth → rate limit → capabilities → 503 retryable, never inflated',async()=>{
    const {deps,calls}=setup(false);
    deps.capabilities=async()=>{calls.push({name:'capabilities',args:{}});return {contracts:[1]};};
    const r=await createIngestHandler(deps)(gzRequest(bomb));
    expect(r.status).toBe(503);expect((await r.json()).error).toMatchObject({code:'service_unavailable',retryable:true});
    expect(calls.map(c=>c.name)).toEqual(['getUser','internal_community_ingest_rate_limit','capabilities']);
  });
  it('gzip bomb with v2 on is rejected 413 after auth; nothing is inflated for an unauthenticated caller',async()=>{
    const {deps,calls}=setup(true);
    const r=await createIngestHandler(deps)(gzRequest(bomb));
    expect(r.status).toBe(413);expect((await r.json()).error.code).toBe('payload_too_large');
    expect(calls.map(c=>c.name)).toEqual(['getUser','internal_community_ingest_rate_limit']);
    const anon=setup(true);anon.deps.getUser=async()=>null;
    const a=await createIngestHandler(anon.deps)(gzRequest(bomb));
    expect(a.status).toBe(401);expect((await a.json()).error.code).toBe('auth_required');
    // broken gzip → 400 invalid_request; a v1 body inside gzip → 415 (v1 never used gzip)
    const broken=await createIngestHandler(setup(true).deps)(gzRequest(Buffer.from('not gzip')));
    expect(broken.status).toBe(400);expect((await broken.json()).error.code).toBe('invalid_request');
    const v1=await createIngestHandler(setup(true).deps)(gzRequest(gzipSync(Buffer.from(JSON.stringify({...wire.envelope,protocol:1,contract:'community-ingest-v1'})))));
    expect(v1.status).toBe(415);expect((await v1.json()).error.code).toBe('unsupported_media_type');
  });
  it('identity v2 bodies keep the 256KiB cap (413 before auth); gzip wire is capped at 512KiB',async()=>{
    const {deps,calls}=setup(true);
    const big=await createIngestHandler(deps)(post({...wire.envelope,padding:'x'.repeat(300*1024)}));
    expect(big.status).toBe(413);expect((await big.json()).error.code).toBe('payload_too_large');
    const wireBig=await createIngestHandler(deps)(gzRequest(Buffer.alloc(513*1024)));
    expect(wireBig.status).toBe(413);expect((await wireBig.json()).error.code).toBe('payload_too_large');
    expect(calls).toHaveLength(0);
  });
  it('capabilities failure: v2 gets 503 service_unavailable (retryable), never 500',async()=>{
    const {deps,calls,logs}=setup(true);deps.capabilities=async()=>{throw new Error('rpc PGRST301 secret-detail');};
    for(const compressed of [false,true]){
      const r=await createIngestHandler(deps)(post(wire.envelope,compressed));
      expect(r.status).toBe(503);expect(r.headers.get('retry-after')).toBe('30');
      expect((await r.json()).error).toMatchObject({code:'service_unavailable',retryable:true});
    }
    expect(calls.some(c=>c.name==='internal_community_ingest_v2')).toBe(false);
    expect(JSON.stringify(logs)).not.toMatch(/secret-detail|PGRST301/);
  });
  it('rejects duplicate keys in raw.body (reporter-key bypass) as raw_invalid',async()=>{
    for(const body of ['{"result":{"C_NAME":"x"},"result":{}}','{"result":{"C_NO":"SYNTHETIC01","a":1,"a":2}}',
      '{"result":{"x":[{"k":1,"k":2}]}}','{"result":{"\\u0061":1,"a":2}}']){
      const env=structuredClone(wire.envelope),e=env.events[0];
      e.raw.body=body;e.raw.size=Buffer.byteLength(body);e.raw.sha256=await sha256Hex(body);
      const {deps,calls}=setup();const r=await createIngestHandler(deps)(post(env));
      expect(r.status,body).toBe(422);expect((await r.json()).error.code,body).toBe('raw_invalid');
      expect(calls.some(c=>c.name==='internal_community_ingest_v2')).toBe(false);
    }
    // the same keys in different objects, and keys equal to string values, are fine
    const ok='{"result":{"a":{"a":"a"},"b":[{"a":1},{"a":2}],"c":"a"}}';
    const env=structuredClone(wire.envelope),e=env.events[0];
    e.raw.body=ok;e.raw.size=Buffer.byteLength(ok);e.raw.sha256=await sha256Hex(ok);
    expect((await createIngestHandler(setup().deps)(post(env))).status).toBe(200);
  });
  it('rejects lone UTF-16 surrogates with 422 instead of letting Postgres jsonb fail with 500',async()=>{
    const cases: [string,(env: typeof wire.envelope)=>Promise<void>|void,string][]=[
      ['raw.body char',async env=>{const e=env.events[0];e.raw.body='{"result":{"t":"\ud800"}}';e.raw.size=Buffer.byteLength(e.raw.body);e.raw.sha256=await sha256Hex(e.raw.body);},'raw_invalid'],
      ['raw.body escape',async env=>{const e=env.events[0];e.raw.body='{"result":{"t":"\\udc00"}}';e.raw.size=Buffer.byteLength(e.raw.body);e.raw.sha256=await sha256Hex(e.raw.body);},'raw_invalid'],
      ['raw.source',env=>{env.events[0].raw.source='x\udbff';},'raw_invalid'],
      ['supplement',async env=>{const e=env.events[0];e.supplement.rating_cause='a\ud800b';e.supplement_sha256=await sha256Hex(canonicalJson(e.supplement));},'supplement_invalid'],
      ['client_observation',async env=>{const e=env.events[0];e.client_observation.address='\udc00';e.client_observation_sha256=await sha256Hex(canonicalJson(e.client_observation));},'schema_invalid'],
      ['client_version',env=>{env.client_version='3.6\ud800';},'schema_invalid'],
    ];
    for(const [name,mutate,code] of cases){
      const env=structuredClone(wire.envelope);await mutate(env);
      const {deps,calls}=setup();const r=await createIngestHandler(deps)(post(env));
      expect(r.status,name).toBe(422);expect((await r.json()).error.code,name).toBe(code);
      expect(calls.some(c=>c.name==='internal_community_ingest_v2'),name).toBe(false);
    }
    // a valid astral character (surrogate pair) is accepted
    const env=structuredClone(wire.envelope);env.events[0].supplement.rating_cause='😀';
    env.events[0].supplement_sha256=await sha256Hex(canonicalJson(env.events[0].supplement));
    expect((await createIngestHandler(setup().deps)(post(env))).status).toBe(200);
  });
  it('rejects NUL (literal or JSON-escaped) anywhere in raw.body, client_observation and supplement with 422', async () => {
    const setBody = async (env: typeof wire.envelope, body: string) => {
      const e = env.events[0]; e.raw.body = body; e.raw.size = Buffer.byteLength(body); e.raw.sha256 = await sha256Hex(body);
    };
    const cases: [string, (env: typeof wire.envelope) => Promise<void> | void, string][] = [
      ['raw.body escaped value', env => setBody(env, '{"result":{"t":"a\\u0000b"}}'), 'raw_invalid'],
      ['raw.body escaped key', env => setBody(env, '{"result":{"a\\u0000":"x"}}'), 'raw_invalid'],
      ['raw.body escaped nested', env => setBody(env, '{"result":{"l":[{"t":["\\u0000"]}]}}'), 'raw_invalid'],
      ['raw.body literal', env => setBody(env, '{"result":{"t":"a\u0000b"}}'), 'raw_invalid'],
      ['raw.source', env => { env.events[0].raw.source = 'x\u0000'; }, 'raw_invalid'],
      ['supplement', async env => { const e = env.events[0]; e.supplement.rating_cause = 'a\u0000b'; e.supplement_sha256 = await sha256Hex(canonicalJson(e.supplement)); }, 'supplement_invalid'],
      ['client_observation', async env => { const e = env.events[0]; e.client_observation.address = 'a\u0000b'; e.client_observation_sha256 = await sha256Hex(canonicalJson(e.client_observation)); }, 'schema_invalid'],
    ];
    for (const [name, mutate, code] of cases) {
      const env = structuredClone(wire.envelope); await mutate(env);
      const { deps, calls } = setup(); const r = await createIngestHandler(deps)(post(env));
      expect(r.status, name).toBe(422); expect((await r.json()).error.code, name).toBe(code);
      expect(calls.some(c => c.name === 'internal_community_ingest_v2'), name).toBe(false);
    }
  });
  it('drops an optional client_observation with invalid VALUES (raw is kept); hash mismatch still rejects', async () => {
    const env = structuredClone(wire.envelope); const e = env.events[0];
    e.client_observation.report_date = '2026-13-45';  // schema-shaped, not a calendar day
    e.client_observation_sha256 = await sha256Hex(canonicalJson(e.client_observation));
    const { deps, calls, logs } = setup(); const r = await createIngestHandler(deps)(post(env));
    expect(r.status).toBe(200);
    const sent = (calls.find(c => c.name === 'internal_community_ingest_v2')!.args.p_events as Record<string, unknown>[])[0];
    expect(sent).not.toHaveProperty('client_observation'); expect(sent).not.toHaveProperty('client_observation_sha256');
    expect(sent.raw).toEqual(e.raw);
    expect(sent.payload_sha256).toBe(await rawEventFingerprint({ ...e, client_observation: undefined, client_observation_sha256: undefined } as never));
    expect(JSON.stringify(logs)).toContain('client_observation_dropped'); expect(JSON.stringify(logs)).not.toContain('2026-13-45');
    // a mismatching hash on the same invalid observation is still an integrity failure
    const bad = structuredClone(env); bad.events[0].client_observation_sha256 = '0'.repeat(64);
    const b = await createIngestHandler(setup().deps)(post(bad));
    expect(b.status).toBe(422); expect((await b.json()).error.code).toBe('client_observation_hash_mismatch');
    // a valid observation is forwarded untouched
    const ok = setup(); expect((await createIngestHandler(ok.deps)(post(wire.envelope))).status).toBe(200);
    expect((ok.calls.find(c => c.name === 'internal_community_ingest_v2')!.args.p_events as Record<string, unknown>[])[0]).toHaveProperty('client_observation');
  });
  it('v2 status_correction is schema_invalid (event.schema.json enum); reshare/trigger mismatch stays event_type_mismatch',async()=>{
    const env=structuredClone(wire.envelope);env.events[0].event_type='status_correction';
    const r=await createIngestHandler(setup().deps)(post(env));
    expect(r.status).toBe(422);expect((await r.json()).error.code).toBe('schema_invalid');
    const reshare=structuredClone(wire.envelope);reshare.events[0].event_type='reshare';
    const m=await createIngestHandler(setup().deps)(post(reshare));
    expect(m.status).toBe(422);expect((await m.json()).error.code).toBe('event_type_mismatch');
  });
  it('fingerprint changes when metadata or comparison content changes, without storing a raw body',async()=>{
    const e=wire.envelope.events[0];const sha=await rawEventFingerprint(e);
    expect(await rawEventFingerprint({...e,raw:{...e.raw,source:'recovery'}})).not.toBe(sha);
  });
  it('worker derivation equals every v1 observation vector',async()=>{
    const vectors=JSON.parse(readFileSync('server/parser-py/contracts/derived-v1.json','utf8'));
    for(const c of vectors)expect(await deriveFact(c.payload as Observation),c.name).toEqual(c.derived);
  });
  it('public handlers/read models never import or read the raw/parsed stores',()=>{
    for(const name of readdirSync('server').filter(f=>f.endsWith('.ts'))){
      expect(readFileSync(`server/${name}`,'utf8'),name).not.toMatch(/community_report_(?:raw|parsed)|parse_report|parser-py/);
    }
  });
});
