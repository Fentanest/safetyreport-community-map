/** Real PostgreSQL, rollback only. Both handlers receive native SQL JSON from the same transaction. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
import { createScreenHandler } from '../../server/screenHandler';
import { dashboardResponseSchema,entitiesResponseSchema,lawsResponseSchema,entitySchema,placesResponseSchema,placeDetailResponseSchema } from '../../src/data/schema';
import { lawKey } from '../../src/domain/public';
import { personalCompareSchema } from '../../src/data/personal';
import { maskPlate, parsePlate } from '../../server/plate';
import { normalizeAddress, placeKeyOf } from '../../server/places';
const user=createHash('md5').update('cohort-timeout-user-1').digest('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5');
const token=`${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({sub:user,role:'authenticated',aud:'authenticated',session_id:'11111111-2222-4333-8444-555555555555'})).toString('base64url')}.sig`;
const panels=[{id:'entities',path:'entities',params:{kind:'agency'}},{id:'laws',path:'laws',params:{}},{id:'compare',path:'compare',params:{}},
  {id:'places',path:'places',params:{view_bbox:'126,36,129,39'}},{id:'prefix',path:'entity-prefix',params:{kind:'agency',through_page:'2'}}];
const base={date_basis:'completed_date',start:'2025-10-07',end:'2026-10-06',category:'all'};
async function replay(source:unknown,scope=base,ps:typeof panels=panels) {
  const handler=createScreenHandler({enabled:true,allowedOrigins:[],jwtIssuer:null,getUser:async()=>({id:user,isAnonymous:false}),rpc:async name=>name.endsWith('rate_limit')?true:source});
  const q=new URLSearchParams({...scope,panels:JSON.stringify(ps)});
  const start=performance.now(),cpu=process.cpuUsage();
  const response=await handler(new Request(`https://local.invalid/my-analytics/screen?${q}`,{headers:{Authorization:`Bearer ${token}`}}));
  const text=await response.text(),used=process.cpuUsage(cpu);
  return {status:response.status,body:JSON.parse(text),ms:performance.now()-start,cpu_ms:(used.user+used.system)/1000,bytes:Buffer.byteLength(text)};
}
const migrations=readdirSync('supabase/migrations').filter(n=>/^202610060[1-9]00_/.test(n)&&!n.includes('0800_')).sort()
  .map(n=>readFileSync(`supabase/migrations/${n}`,'utf8').replace(/^(begin|commit);\s*$/gm,'')).join('\n');
const seed=readFileSync('tests/integration/helpers/cohort-timeout-seed.sql','utf8').replaceAll('__SIZE__','600');
const sql=(body:string,size=600)=>execFileSync('docker',['exec','-i','supabase_db_ci0926-int','psql','-X','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],
  {input:`begin;${migrations}${seed.replace('generate_series(1,600)',`generate_series(1,${size})`)}${body}\nrollback;`,encoding:'utf8',timeout:180000,maxBuffer:64*1024*1024}).split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s));
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
    const size=process.env.SCREEN_AGG_SIZE??'300',profile=process.env.SCREEN_AGG_PROFILE??'diverse',window=process.env.SCREEN_AGG_WINDOW??'year',stem=`${size}-${profile}-${window}`,packets=[],measurements=[];
    const scope={...base,start:window==='year'?base.start:'2019-04-23'};
    for(const phase of ['before','after']) {
      const text=readFileSync(`.agent-runtime/screen-aggregate/${stem}-${phase}.json`,'utf8');
      const runs=[];
      for(let i=0;i<3;i++) {
        const t=performance.now(),source=JSON.parse(text),parse_ms=performance.now()-t;
        const nativeParse=JSON.parse;let handler_parse_calls=0;
        JSON.parse=(...args:Parameters<typeof JSON.parse>)=>{handler_parse_calls++;return nativeParse(...args);};
        let result:Awaited<ReturnType<typeof replay>>;
        try { result=await replay(source,scope); } finally { JSON.parse=nativeParse; }
expect(result.status).toBe(200);assertPacket(result.body);
        if(i===0)packets.push(result.body);
        runs.push({parse_ms,source_parse_calls:1,handler_parse_calls,handler_ms:result.ms,cpu_ms:result.cpu_ms,public_bytes:result.bytes});
      }
      const source=JSON.parse(text);
      measurements.push({phase,source_bytes:Buffer.byteLength(text),fact_rows:source.facts?.rows?.length??0,
        decoded_fact_cells:source.facts?.rows?.length*34||0,aggregate_groups:source.aggregate?.stats?.length??0,runs});
    }
    expect(packets[1]).toEqual(packets[0]);
    writeFileSync(`.agent-runtime/screen-aggregate/${stem}-public.json`,JSON.stringify(packets[1]));
    writeFileSync(`docs/implementation/screen-server-aggregate-20261006/evidence/handler-${stem}.json`,JSON.stringify({synthetic:true,runtime:'Node; actual SQL response; auth/RPC stub; not hosted Edge',whole_packet_parity:true,scope,measurements},null,2)+'\n');
  },180000);
});

describe.skipIf(process.env.COMMUNITY_STACK!=='1')('screen aggregate local SQL parity and boundary',()=>{
  it('deep equals dates, dimensions, empty/full ranges and every panel (including focused places)',async()=>{
    const cases=['report_date','completed_date'].flatMap(date_basis=>[
      {date_basis,start:'2023-01-01',end:'2026-10-06',category:'all'},
      {date_basis,start:'2023-03-01',end:'2023-09-30',category:'traffic'},
      {date_basis,start:'2023-01-01',end:'2026-10-06',category:'all',region_code:'11'},
      {date_basis,start:'2023-01-01',end:'2026-10-06',category:'all',agency_key:'agency-1',manager_key:'manager-1'},
      {date_basis,start:'2023-01-01',end:'2026-10-06',category:'all',bbox:'127.1,37.1,127.3,37.3'},
      {date_basis,start:'2023-01-01',end:'2026-10-06',category:'all',law:'합성법 제2조'},
      {date_basis,start:'2023-01-03',end:'2023-01-03',category:'all'},
      {date_basis,start:'2023-01-01',end:'2026-10-06',category:'parking',law:'__none__'},
      {date_basis,start:'2023-01-01',end:'2026-10-06',category:'other',region_code:'11140'},
      {date_basis,start:'2040-01-01',end:'2040-01-31',category:'all'},
    ]);
    const ps=[...panels,{id:'focus',path:`places/${placeKeyOf('합성 주소')}`,params:{}},{id:'managers',path:'entities',params:{kind:'manager',sort:'rating',sort_value:'mean',dir:'asc',q:'담당',page_size:'7'}},{id:'missing',path:'places/pl1:0000000000000000',params:{}}] as typeof panels;
    const body=cases.map(scope=>{
      const s={...scope,...('bbox' in scope?{bbox:scope.bbox!.split(',').map(Number)}:{})};
      const call=`public.internal_analytics_read_snapshot('${JSON.stringify(s)}',true,p_user=>u.id,p_session=>u.session_id`;
      return `select json_build_object('legacy',${call},p_options=>'{"fact_encoding":"columns-v1"}'),'new',${call},p_options=>'${JSON.stringify({screen_encoding:'screen-aggregate-v1',panels:ps})}')) from cohort_users u where idx=1;`;
    }).join('\n');
    const rows=sql(body);expect(rows).toHaveLength(cases.length);
    for(let i=0;i<rows.length;i++) {
      const before=await replay(rows[i].legacy,cases[i],ps),after=await replay(rows[i].new,cases[i],ps);
      expect(after.status,JSON.stringify(cases[i])).toBe(200);assertPacket(after.body);
      expect(after.body,JSON.stringify(cases[i])).toEqual(before.body);
      if(cases[i].start===cases[i].end)expect(after.body.dashboard.overview.report_count.value).toBe(1);
    }
  },180000);
  it('matches normalization, masking collisions, Unicode and exact coordinates',()=>{
    const addresses=[null,'','  서울시  중구 도로 10 - 2  ','서울\u200b중구\u00a0도로 1','합성 😀 주소 10','경기도 광주시 산 1-2','가\u0301나'];
    const plates=[null,'','경기도 76자 3623','경기76자3623','경기77자3623','１２가３４５６','123가4567','서울12가3456','wrong'];
    const quote=(v:string|null)=>v===null?'null':`$v$${v}$v$`;
    const rows=sql(addresses.map(v=>`select json_build_object('address',private.screen_address(${quote(v)}),'key',private.screen_place_key(private.screen_address(${quote(v)})));`).join('\n')+
      plates.map(v=>`select json_build_object('plate',private.screen_plate(${quote(v)}),'mask',private.screen_mask_plate(private.screen_plate(${quote(v)})));`).join('\n'));
    expect(rows).toHaveLength(addresses.length+plates.length);
    addresses.forEach((v,i)=>expect(rows[i]).toEqual({address:normalizeAddress(v),key:placeKeyOf(v)}));
    plates.forEach((v,i)=>expect(rows[i+addresses.length]).toEqual({plate:parsePlate(v)?.canonical??null,mask:parsePlate(v)?maskPlate(v):null}));
  });
  it('preserves mixed states, zero/conflicting/withheld amounts, personal copies and address anchors on both plan modes',async()=>{
    const mutation=`
      update private.community_report_facts f set
        status=(array['accepted','partial','rejected','withdrawn','transferred','completed_unknown','processing','supplement','other'])[1+substring(source_report_id from '[0-9]+')::int%9],
        amount_kind=(array['fine','penalty','combined','unknown'])[1+substring(source_report_id from '[0-9]+')::int%4],
        amount_confirmed_won=case when substring(source_report_id from '[0-9]+')::int%3=0 then 0 else amount_confirmed_won end,
        address=(array['서울시  중구 도로 10 - 2','서울특별시 중구 도로 10-2','합성 😀 주소','주소 없는 좌표',null,'공유 주소'])[1+substring(source_report_id from '[0-9]+')::int%6],
        vehicle_raw=(array['경기76자3623','경기77자3623','１２가３４５６','123가4567',null,'invalid'])[1+substring(source_report_id from '[0-9]+')::int%6],
        agency_name='같은 기관',agency_current_name='같은 기관',manager_name='동명이인',
        violation_law=case when substring(source_report_id from '[0-9]+')::int%2=0 then '도로교통법 제032조제1항' else null end;
      insert into private.community_report_facts select (jsonb_populate_record(null::private.community_report_facts,
        to_jsonb(f)||jsonb_build_object('dataset_key',repeat('b',64),'status','accepted','first_accepted_at','2026-10-05T00:00:00Z'))).* from private.community_report_facts f
        where contributor_id=(select id from cohort_users where idx=1);
    `;
    const scope={date_basis:'report_date',start:'2023-01-01',end:'2026-10-06',category:'all'};
    const ps=[...panels,{id:'focus',path:`places/${placeKeyOf('서울특별시 중구 도로 10-2')}`,params:{}}] as typeof panels;
    const call=`public.internal_analytics_read_snapshot('${JSON.stringify(scope)}',true,p_user=>u.id,p_session=>u.session_id`;
    const query=`select json_build_object('legacy',${call},p_options=>'{"fact_encoding":"columns-v1"}'),'new',${call},p_options=>'${JSON.stringify({screen_encoding:'screen-aggregate-v1',panels:ps})}')) from cohort_users u where idx=1;`;
    const rows=sql(mutation+['force_custom_plan','force_generic_plan'].map(mode=>`set plan_cache_mode=${mode};${query}`).join('\n'));
    expect(rows).toHaveLength(2);
    for(const row of rows){
      const before=await replay(row.legacy,scope,ps),after=await replay(row.new,scope,ps);
      expect(after.status).toBe(200);assertPacket(after.body);expect(after.body).toEqual(before.body);
      expect(JSON.stringify(row.new.aggregate)).not.toMatch(/경기76자3623|경기77자3623|report_identity|contributor_id|SPP-2026-/);
    }
  });
  it('denies failed viewers before aggregation and keeps service-only STABLE permissions',()=>{
    const call=`public.internal_analytics_read_snapshot('${JSON.stringify(base)}',true,p_user=>u.id,p_session=>u.session_id,p_options=>'{"screen_encoding":"screen-aggregate-v1"}')`;
    const rows=sql(`
      select ${call.replace('p_session=>u.session_id',"p_session=>'00000000-0000-0000-0000-000000000000'::uuid")} from cohort_users u where idx=1;
      delete from private.community_report_facts where contributor_id=(select id from cohort_users where idx=1) and source_report_id not in
        (select source_report_id from private.community_report_facts where contributor_id=(select id from cohort_users where idx=1) order by source_report_id limit 5);
      select ${call} from cohort_users u where idx=1;
      update private.community_consent_grants set revoked_at=now() where user_id=(select id from cohort_users where idx=1);
      select ${call} from cohort_users u where idx=1;
      select json_build_object('name',proname,'stable',provolatile='s','definer',prosecdef,'path',proconfig @> array['search_path=""'],
        'anon',has_function_privilege('anon',oid,'execute'),'authenticated',has_function_privilege('authenticated',oid,'execute'))
        from pg_proc where proname in ('internal_analytics_read_snapshot','analytics_screen_aggregate');`);
    expect(rows).toHaveLength(5);
    for(const row of rows.slice(0,3)){expect(row.facts).toEqual([]);expect(row.aggregate).toBeUndefined();}
    expect(rows[0].viewer.session).toBe(false);expect(rows[1].viewer.public_fact_count).toBeLessThan(10);expect(rows[2].viewer.contributor).toBe('revoked');
    for(const row of rows.slice(3))expect(row).toMatchObject({stable:true,definer:true,path:true,anon:false,authenticated:false});
  });

  it('matches a high-cardinality map with more than 1,000 places without changing compaction',async()=>{
    const scope={date_basis:'completed_date',start:'2023-01-01',end:'2026-10-06',category:'all'};
    const ps=[...panels,{id:'focus',path:`places/${placeKeyOf('합성 주소 synthetic-31')}`,params:{}}] as typeof panels;
    const call=`public.internal_analytics_read_snapshot('${JSON.stringify(scope)}',true,p_user=>u.id,p_session=>u.session_id`;
    const rows=sql(`update private.community_report_facts set address='합성 주소 '||source_report_id;
      select json_build_object('legacy',${call},p_options=>'{"fact_encoding":"columns-v1"}'),'new',${call},p_options=>'${JSON.stringify({screen_encoding:'screen-aggregate-v1',panels:ps})}')) from cohort_users u where idx=1;`,2400);
    expect(rows).toHaveLength(1);
    const before=await replay(rows[0].legacy,scope,ps),after=await replay(rows[0].new,scope,ps);
    expect(after.status).toBe(200);expect(after.body.dashboard.points.some((p:any)=>p.aggregate)).toBe(true);
    expect(after.body.dashboard.points.length).toBeLessThanOrEqual(1000);assertPacket(after.body);expect(after.body).toEqual(before.body);
  },180000);
  it('keeps JavaScript law whitespace/article semantics in the SQL projection',()=>{
    const values=[null,'','  ','도로교통법 제032조제1항','도로 교통법 제 0조 의 002 제3항','\ufeff도로교통법\u00a0제32조\u00a0','  기타\u00a0법규  ','특정법 제123456789012345678901234567890조'];
    const rows=sql(values.map(v=>`select json_build_object('law',private.screen_law(${v===null?'null':`$v$${v}$v$`}));`).join('\n'));
    expect(rows).toHaveLength(values.length);values.forEach((v,i)=>expect(rows[i].law).toBe(lawKey(v)));
  });

  it('keeps current-baseline election ties across duplicate datasets without sorting away differences',async()=>{
    const scope={date_basis:'completed_date',start:'2023-01-01',end:'2026-10-06',category:'all'};
    const call=`public.internal_analytics_read_snapshot('${JSON.stringify(scope)}',true,p_user=>u.id,p_session=>u.session_id`;
    const query=`select json_build_object('legacy',${call},p_options=>'{"fact_encoding":"columns-v1"}'),'new',${call},p_options=>'${JSON.stringify({screen_encoding:'screen-aggregate-v1',panels})}')) from cohort_users u where idx=1;`;
    const rows=sql(`insert into private.community_report_facts select (jsonb_populate_record(null::private.community_report_facts,
      to_jsonb(f)||jsonb_build_object('dataset_key',repeat('b',64),'status','accepted','disposition','fine','amount_confirmed_won',0))).*
      from private.community_report_facts f where source_report_id in ('synthetic-11','synthetic-12','synthetic-30','synthetic-31');
      set plan_cache_mode=force_custom_plan;${query}set plan_cache_mode=force_generic_plan;${query}`);
    expect(rows).toHaveLength(2);
    for(const row of rows){const a=await replay(row.legacy,scope),b=await replay(row.new,scope);expect(b.status).toBe(200);expect(b.body).toEqual(a.body);}
  });

  it('rolls back SQL independently while the new Edge still returns the same complete packet',async()=>{
    const scope={date_basis:'completed_date',start:'2023-01-01',end:'2026-10-06',category:'all'};
    const call=`public.internal_analytics_read_snapshot('${JSON.stringify(scope)}',true,p_user=>u.id,p_session=>u.session_id,p_options=>'${JSON.stringify({fact_encoding:'columns-v1',screen_encoding:'screen-aggregate-v1',panels})}')`;
    const rollback=readFileSync('docs/implementation/screen-server-aggregate-20261006/rollback.sql','utf8').replace(/^(begin|commit);\s*$/gm,'');
    const rows=sql(`select ${call} from cohort_users u where idx=1;${rollback}select ${call} from cohort_users u where idx=1;
      select json_build_object('removed',to_regprocedure('private.analytics_screen_aggregate(jsonb,uuid,jsonb)') is null,
      'owner',pg_get_userbyid(proowner),'service',has_function_privilege('service_role',oid,'execute')) from pg_proc where proname='internal_analytics_read_snapshot';`);
    expect(rows).toHaveLength(3);expect(rows[0].aggregate.encoding).toBe('screen-aggregate-v1');expect(rows[1].facts.encoding).toBe('columns-v1');
    expect(rows[2]).toEqual({removed:true,owner:'postgres',service:true});
    const a=await replay(rows[0],scope),b=await replay(rows[1],scope);expect(a.status).toBe(200);expect(b.status).toBe(200);expect(b.body).toEqual(a.body);
  });

  it('refuses the same over-budget history before returning any partial aggregates',()=>{
    const rows=sql(`create temp table budget_errors(encoding text,code text);
      do $probe$ declare u record; encoding text; code text;
      begin select * into u from cohort_users where idx=1;
        foreach encoding in array array['columns-v1','screen-aggregate-v1'] loop
          code:='NO_ERROR';
          begin perform public.internal_analytics_read_snapshot('{"date_basis":"completed_date","start":"2023-01-01","end":"2026-10-06","category":"all"}',true,
            p_user=>u.id,p_session=>u.session_id,p_options=>jsonb_build_object('fact_encoding',encoding,'screen_encoding',encoding));
          exception when others then code:=sqlerrm;end;
          insert into budget_errors values(encoding,code);
        end loop;
      end $probe$;select row_to_json(b) from budget_errors b;`,120000);
    expect(rows).toEqual([{encoding:'columns-v1',code:'RESULT_TOO_LARGE'},{encoding:'screen-aggregate-v1',code:'RESULT_TOO_LARGE'}]);
  },180000);

});
