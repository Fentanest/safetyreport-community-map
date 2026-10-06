/** Real local SQL-exported synthetic sources; Node handler replay, no hosted Edge performance claim. */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createScreenHandler } from '../../server/screenHandler';
import { decodeScreenFacts } from '../../server/screenFacts';
import { dashboardResponseSchema, entitiesResponseSchema, lawsResponseSchema } from '../../src/data/schema';
import { personalCompareSchema } from '../../src/data/personal';

describe.skipIf(process.env.SCREEN_SQL_MEASURE !== '1')('SQL payload to Node screen handler', () => {
  it('measures before/after decode, full handler and bytes; compares every public field', async () => {
    const reports = [], packets = [];
    for (const phase of ['before','after']) {
      const text = readFileSync(`${process.env.SCREEN_SOURCE_DIR ?? '.agent-runtime/screen-r3'}/source-${phase}.json`, 'utf8');
      const start = performance.now(); const source = JSON.parse(text); const parseMs = performance.now()-start;
      const decodeStart=performance.now(); const facts=decodeScreenFacts(source.facts)!; const decodeMs=performance.now()-decodeStart;
      expect(facts.length).toBeGreaterThanOrEqual(13035);
      // md5 fixture user 1. Auth validation is explicitly stubbed; SQL gate was exercised by the exporter.
      const user = (await import('node:crypto')).createHash('md5').update('cohort-timeout-user-1').digest('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5');
      const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({sub:user,role:'authenticated',aud:'authenticated',session_id:'11111111-2222-4333-8444-555555555555'})).toString('base64url')}.sig`;
      const handler=createScreenHandler({enabled:true,allowedOrigins:[],jwtIssuer:null,getUser:async()=>({id:user,isAnonymous:false}),
        rpc:async name=>name.endsWith('rate_limit')?true:source});
      const panels=[{id:'entities',path:'entities',params:{kind:'agency'}},{id:'laws',path:'laws',params:{}},{id:'compare',path:'compare',params:{}},
        {id:'places',path:'places',params:{view_bbox:'126,36,129,39'}},{id:'prefix',path:'entity-prefix',params:{kind:'agency',through_page:'2'}}];
      const query=new URLSearchParams({date_basis:'completed_date',start:'2025-10-07',end:'2026-10-06',category:'all',panels:JSON.stringify(panels)});
      const runs=[];let packet:any;
      for(let i=0;i<3;i++) {
        const t=performance.now(),cpu=process.cpuUsage();
        const response=await handler(new Request(`https://local.invalid/my-analytics/screen?${query}`,{headers:{Authorization:`Bearer ${token}`}}));
        expect(response.status).toBe(200);const body=await response.text();packet=JSON.parse(body);
        const used=process.cpuUsage(cpu);runs.push({ms:performance.now()-t,cpu_ms:(used.user+used.system)/1000,public_bytes:Buffer.byteLength(body)});
      }
      dashboardResponseSchema.parse(packet.dashboard);entitiesResponseSchema.parse(packet.panels[0].body);
      lawsResponseSchema.parse(packet.panels[1].body);personalCompareSchema.parse(packet.panels[2].body);
      expect(packet.panels.map((p:any)=>p.status)).toEqual([200,200,200,200,200]);
      expect(JSON.stringify(packet)).not.toContain(user);
      packets.push(packet);reports.push({phase,source_bytes:Buffer.byteLength(text),facts:facts.length,parse_ms:parseMs,decode_ms:decodeMs,runs});
    }
    expect(packets[1]).toEqual(packets[0]);
    writeFileSync(process.env.SCREEN_HANDLER_OUT ?? 'docs/implementation/screen-snapshot-timeout-20261006/evidence/r3/sql-source-handler.json',JSON.stringify({mode:'actual SQL synthetic source replay; Node handler; auth/RPC stub; not hosted Edge',whole_packet_parity:true,reports},null,2)+'\n');
  },120000);
});
