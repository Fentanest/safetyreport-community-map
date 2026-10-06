/** Replay native SQL exports from the rollback-only benchmark with the 0964d90 and candidate handlers. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
import { createScreenHandler } from '../../server/screenHandler';
import { dashboardResponseSchema,entitiesResponseSchema,lawsResponseSchema,entitySchema,placesResponseSchema,placeDetailResponseSchema } from '../../src/data/schema';
import { personalCompareSchema } from '../../src/data/personal';
const user=createHash('md5').update('cohort-timeout-user-1').digest('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5');
const token=`${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({sub:user,role:'authenticated',aud:'authenticated',session_id:'11111111-2222-4333-8444-555555555555'})).toString('base64url')}.sig`;
const panels=[{id:'entities',path:'entities',params:{kind:'agency'}},{id:'laws',path:'laws',params:{}},{id:'compare',path:'compare',params:{}},
  {id:'places',path:'places',params:{view_bbox:'126,36,129,39'}},{id:'prefix',path:'entity-prefix',params:{kind:'agency',through_page:'2'}}];
const base={date_basis:'completed_date',start:'2025-10-07',end:'2026-10-06',category:'all'};
async function replay(source:unknown,scope=base,ps:typeof panels=panels,before=false) {
  const baselineModule='../../.agent-runtime/screen-aggregate-opt/screenHandler.before.ts';
  const factory=before?(await import(baselineModule)).createScreenHandler:createScreenHandler;
  const handler=factory({enabled:true,allowedOrigins:[],jwtIssuer:null,getUser:async()=>({id:user,isAnonymous:false}),rpc:async name=>name.endsWith('rate_limit')?true:source});
  const q=new URLSearchParams({...scope,panels:JSON.stringify(ps)});
  const start=performance.now(),cpu=process.cpuUsage();
  const response=await handler(new Request(`https://local.invalid/my-analytics/screen?${q}`,{headers:{Authorization:`Bearer ${token}`}}));
  const text=await response.text(),used=process.cpuUsage(cpu);
  return {status:response.status,body:JSON.parse(text),ms:performance.now()-start,cpu_ms:(used.user+used.system)/1000,bytes:Buffer.byteLength(text)};
}
function assertPacket(packet:any) {
  dashboardResponseSchema.parse(packet.dashboard);
  for(const p of packet.panels) {
    if(p.status!==200)continue;
    if(p.id==='entities'||p.id==='managers')entitiesResponseSchema.parse(p.body);
    if(p.id==='laws')lawsResponseSchema.parse(p.body);
    if(p.id==='compare')personalCompareSchema.parse(p.body);
    if(p.id==='prefix')for(const row of p.body.items)entitySchema.parse(row);
    if(p.id==='places')placesResponseSchema.parse(p.body);
    if(p.id==='focus')placeDetailResponseSchema.parse(p.body);
  }
  expect(JSON.stringify(packet)).not.toContain(user);
  expect(JSON.stringify(packet)).not.toMatch(/SPP-2026-|cohort-key-|vehicle_raw|report_identity|contributor_id/);
}

describe.skipIf(process.env.SCREEN_AGG_MEASURE!=='1')('screen aggregate SQL-exported Node handler measurement',()=>{
  it('deep equals the whole packet and measures actual parse + handler at the requested scale',async()=>{
    const size=process.env.SCREEN_AGG_SIZE??'30000',profile=process.env.SCREEN_AGG_PROFILE??'production',window=process.env.SCREEN_AGG_WINDOW??'year',stem=`${size}-${profile}-${window}`,packets=[],measurements=[];
    const scope={...base,start:window==='year'?base.start:'2019-04-23'};
    for(const phase of ['legacy','before','after']) {
      const text=readFileSync(`.agent-runtime/screen-aggregate-opt/${stem}-${phase}.json`,'utf8');
      const runs=[];
      for(let i=0;i<3;i++) {
        const t=performance.now(),source=JSON.parse(text),parse_ms=performance.now()-t;
        const nativeParse=JSON.parse;let handler_parse_calls=0;
        JSON.parse=(...args:Parameters<typeof JSON.parse>)=>{handler_parse_calls++;return nativeParse(...args);};
        let result:Awaited<ReturnType<typeof replay>>;
        try { result=await replay(source,scope,panels,phase!=='after'); } finally { JSON.parse=nativeParse; }
expect(result.status).toBe(200);assertPacket(result.body);
        if(i===0)packets.push(result.body);
        runs.push({parse_ms,source_parse_calls:1,handler_parse_calls,handler_ms:result.ms,cpu_ms:result.cpu_ms,public_bytes:result.bytes});
      }
      const source=JSON.parse(text);
      measurements.push({phase,source_bytes:Buffer.byteLength(text),fact_rows:source.facts?.rows?.length??0,
        decoded_fact_cells:source.facts?.rows?.length*34||0,aggregate_groups:source.aggregate?.stats?.length??0,runs});
    }
    expect(packets[1]).toEqual(packets[0]);
    expect(packets[2]).toEqual(packets[0]);
    writeFileSync(`.agent-runtime/screen-aggregate-opt/${stem}-public.json`,JSON.stringify(packets[2]));
    writeFileSync(`docs/implementation/screen-aggregate-opt-20261006/evidence/handler-${stem}.json`,JSON.stringify({synthetic:true,runtime:'Node; actual SQL response; auth/RPC stub; not hosted Edge',whole_packet_parity:true,scope,measurements},null,2)+'\n');
  },180000);
});

