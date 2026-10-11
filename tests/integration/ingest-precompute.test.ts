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
  .map(n=>readFileSync(`supabase/migrations/${n}`,'utf8').replace(/^(begin|commit);\s*$/gm,'')).join('\n')+'\n'+readFileSync('supabase/migrations/202610061000_screen_aggregate_opt.sql','utf8').replace(/^(begin|commit);\s*$/gm,'');
const precompute=readdirSync('supabase/migrations').filter(n=>/^202610061200_/.test(n)).sort().map(n=>readFileSync(`supabase/migrations/${n}`,'utf8').replace(/^(begin|commit);\s*$/gm,'')).join('\n');
const backfill="do $$ begin loop exit when (private.screen_precompute_backfill(1000)->>'done')::boolean; end loop;end $$;";
const seed=readFileSync('tests/integration/helpers/cohort-timeout-seed.sql','utf8').replaceAll('__SIZE__','600');
const sql=(body:string,size=600)=>execFileSync('docker',['exec','-i',(process.env.PRECOMPUTE_DISPOSABLE==='1'?'astra-precompute-pg':'supabase_db_ci0926-int'),'psql','-X','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],
  {input:`begin;${migrations}${precompute}${seed.replace('generate_series(1,600)',`generate_series(1,${size})`)}${backfill}set constraints all immediate;${body}\nrollback;`,encoding:'utf8',timeout:180000,maxBuffer:64*1024*1024}).split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s));
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

describe.skipIf(process.env.COMMUNITY_STACK!=='1')('ingest precompute SQL parity and boundaries',()=>{
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
      return `select json_build_object('legacy',${call},p_options=>'{"fact_encoding":"columns-v1"}'),'v1',${call},p_options=>'${JSON.stringify({screen_encoding:'screen-aggregate-v1',panels:ps})}'),'new',${call},p_options=>'${JSON.stringify({screen_encoding:'screen-precompute-v1',panels:ps})}')) from cohort_users u where idx=1;`;
    }).join('\n');
    const rows=sql(body);expect(rows).toHaveLength(cases.length);
    for(let i=0;i<rows.length;i++) {
      const before=await replay(rows[i].legacy,cases[i],ps),after=await replay(rows[i].new,cases[i],ps);
      expect(after.status,JSON.stringify(cases[i])).toBe(200);assertPacket(after.body);
      expect(after.body,JSON.stringify(cases[i])).toEqual(before.body);
      expect((await replay(rows[i].v1,cases[i],ps)).body).toEqual(before.body);
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
    const query=`select json_build_object('legacy',${call},p_options=>'{"fact_encoding":"columns-v1"}'),'v1',${call},p_options=>'${JSON.stringify({screen_encoding:'screen-aggregate-v1',panels:ps})}'),'new',${call},p_options=>'${JSON.stringify({screen_encoding:'screen-precompute-v1',panels:ps})}')) from cohort_users u where idx=1;`;
    const rows=sql(mutation+['force_custom_plan','force_generic_plan'].map(mode=>`set plan_cache_mode=${mode};${query}`).join('\n'));
    expect(rows).toHaveLength(2);
    for(const row of rows){
      const before=await replay(row.legacy,scope,ps),after=await replay(row.new,scope,ps);
      expect(after.status).toBe(200);assertPacket(after.body);expect(after.body).toEqual(before.body);
      expect(JSON.stringify(row.new.aggregate)).not.toMatch(/경기76자3623|경기77자3623|report_identity|contributor_id|SPP-2026-/);
    }
  });
  it('denies failed viewers before aggregation and keeps service-only STABLE permissions',()=>{
    const call=`public.internal_analytics_read_snapshot('${JSON.stringify(base)}',true,p_user=>u.id,p_session=>u.session_id,p_options=>'{"screen_encoding":"screen-precompute-v1"}')`;
    const rows=sql(`
      select ${call.replace('p_session=>u.session_id',"p_session=>'00000000-0000-0000-0000-000000000000'::uuid")} from cohort_users u where idx=1;
      delete from private.community_report_facts where contributor_id=(select id from cohort_users where idx=1) and source_report_id not in
        (select source_report_id from private.community_report_facts where contributor_id=(select id from cohort_users where idx=1) order by source_report_id limit 5);
      select ${call} from cohort_users u where idx=1;
      update private.community_consent_grants set revoked_at=now() where user_id=(select id from cohort_users where idx=1);
      select ${call} from cohort_users u where idx=1;
      select json_build_object('name',proname,'stable',provolatile='s','definer',prosecdef,'path',proconfig @> array['search_path=""'],
        'anon',has_function_privilege('anon',oid,'execute'),'authenticated',has_function_privilege('authenticated',oid,'execute'))
        from pg_proc where proname in ('internal_analytics_read_snapshot','analytics_screen_aggregate','analytics_screen_precomputed');`);
    expect(rows).toHaveLength(6);
    for(const row of rows.slice(0,3)){expect(row.facts).toEqual([]);expect(row.aggregate).toBeUndefined();}
    expect(rows[0].viewer.session).toBe(false);expect(rows[1].viewer.public_fact_count).toBeLessThan(10);expect(rows[2].viewer.contributor).toBe('revoked');
    for(const row of rows.slice(3))expect(row).toMatchObject({stable:true,definer:true,path:true,anon:false,authenticated:false});
  });

  it('matches a high-cardinality map with more than 1,000 places without changing compaction',async()=>{
    const scope={date_basis:'completed_date',start:'2023-01-01',end:'2026-10-06',category:'all'};
    const ps=[...panels,{id:'focus',path:`places/${placeKeyOf('합성 주소 synthetic-31')}`,params:{}}] as typeof panels;
    const call=`public.internal_analytics_read_snapshot('${JSON.stringify(scope)}',true,p_user=>u.id,p_session=>u.session_id`;
    const rows=sql(`update private.community_report_facts set address='합성 주소 '||source_report_id;
      select json_build_object('legacy',${call},p_options=>'{"fact_encoding":"columns-v1"}'),'v1',${call},p_options=>'${JSON.stringify({screen_encoding:'screen-aggregate-v1',panels:ps})}'),'new',${call},p_options=>'${JSON.stringify({screen_encoding:'screen-precompute-v1',panels:ps})}')) from cohort_users u where idx=1;`,2400);
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
    const query=`select json_build_object('legacy',${call},p_options=>'{"fact_encoding":"columns-v1"}'),'new',${call},p_options=>'${JSON.stringify({screen_encoding:'screen-precompute-v1',panels})}')) from cohort_users u where idx=1;`;
    const rows=sql(`insert into private.community_report_facts select (jsonb_populate_record(null::private.community_report_facts,
      to_jsonb(f)||jsonb_build_object('dataset_key',repeat('b',64),'status','accepted','disposition','fine','amount_confirmed_won',0))).*
      from private.community_report_facts f where source_report_id in ('synthetic-11','synthetic-12','synthetic-30','synthetic-31');
      set plan_cache_mode=force_custom_plan;${query}set plan_cache_mode=force_generic_plan;${query}`);
    expect(rows).toHaveLength(2);
    for(const row of rows){const a=await replay(row.legacy,scope),b=await replay(row.new,scope);expect(b.status).toBe(200);expect(b.body).toEqual(a.body);}
  });


});

describe.skipIf(process.env.PRECOMPUTE_MEASURE!=='1')('precompute large SQL export parity',()=>{
 it('deep equals every public field of a high-diversity screen',async()=>{
  const a=JSON.parse(readFileSync('.agent-runtime/ingest-precompute/probe-before.json','utf8'));
  const b=JSON.parse(readFileSync('.agent-runtime/ingest-precompute/probe-after.json','utf8'));
  const before=await replay(a),after=await replay(b);
  expect(before.status).toBe(200);expect(after.status).toBe(200);assertPacket(after.body);
  expect(after.body).toEqual(before.body);
 },30000);
});

describe.skipIf(process.env.COMMUNITY_STACK!=='1')('precompute lifecycle and rollout',()=>{
  const scope={date_basis:'completed_date',start:'2023-01-01',end:'2026-10-06',category:'all'};
  const pair=(label:string)=>`select json_build_object('event','${label}','legacy',public.internal_analytics_read_snapshot('${JSON.stringify(scope)}',true,p_user=>u.id,p_session=>u.session_id,p_options=>'{"fact_encoding":"columns-v1"}'),
    'new',public.internal_analytics_read_snapshot('${JSON.stringify(scope)}',true,p_user=>u.id,p_session=>u.session_id,p_options=>'${JSON.stringify({screen_encoding:'screen-precompute-v1',panels})}')) from cohort_users u where idx=1;`;
  it('updates withdrawal, fresh/superseding lineage, reshare, suspension, disclosures, deletion fences and auth cascade in the same transaction',async()=>{
    const changes=[
      ['withdraw',`update private.community_consent_grants set revoked_at=now() where user_id=(select id from cohort_users where idx=2);`],
      ['new-lineage-no-resurrection',`insert into private.community_consent_grants(grant_id,lineage_id,user_id,policy_version,consent_text_sha256,granted_via,granted_session_id)
       select md5('new-grant')::uuid,md5('new-lineage')::uuid,id,'2026-09-28.3',repeat('a',64),'safetyreport_server',session_id from cohort_users where idx=2;`],
      ['explicit-reshare',`update private.community_report_facts set consent_grant_id=md5('new-grant')::uuid where contributor_id=(select id from cohort_users where idx=2);`],
      ['supersession',`update private.community_consent_grants set revoked_at=now(),revoke_reason='superseded_policy' where user_id=(select id from cohort_users where idx=3);
       insert into private.community_consent_grants(grant_id,lineage_id,user_id,policy_version,consent_text_sha256,granted_via,granted_session_id)
       select md5('superseding-grant')::uuid,lineage,id,'2026-09-28.1',repeat('a',64),'safetyreport_server',session_id from cohort_users where idx=3;`],
      ['suspend',`update private.contributor_profiles set status='suspended' where user_id=(select id from cohort_users where idx=4);`],
      ['reactivate',`update private.contributor_profiles set status='active' where user_id=(select id from cohort_users where idx=4);`],
      ['disclosure-off',`update private.community_policy_disclosures set amounts_public=false,violation_law_public=false,rating_public=false;`],
      ['disclosure-on',`update private.community_policy_disclosures set amounts_public=true,violation_law_public=true,rating_public=true where version='2026-09-28.3';`],
      ['delete-winner',`delete from private.community_report_facts where contributor_id=(select id from cohort_users where idx=5);`],
      ['delete-api-fence',`do $$ declare u record;r jsonb;begin select * into u from cohort_users where idx=6;
       r:=public.internal_community_delete_contributions(u.id,u.session_id);
       if r ? 'error' or (r->>'deleted_facts')::int<=0 then raise exception 'delete API did not execute';end if;
       if not exists(select 1 from private.community_deletion_fences where contributor_id=u.id) then raise exception 'missing fence';end if;
       end $$;`],
      ['auth-cascade',`delete from auth.users where id=(select id from cohort_users where idx=7);`],
      ['number-fallback',`update private.community_report_facts set report_number=null where source_report_id in ('synthetic-9','synthetic-10');
       update private.community_report_facts set report_number='SPP-2026-99999999' where source_report_id='synthetic-10';`],
    ];
    const rows=sql(pair('initial')+changes.map(([name,body])=>body+pair(name)).join('\n'));
    expect(rows).toHaveLength(changes.length+1);
    for(const row of rows){const old=await replay(row.legacy,scope),now=await replay(row.new,scope);
      expect(now.status,row.event).toBe(200);assertPacket(now.body);expect(now.body,row.event).toEqual(old.body);
    }
    // A new lineage alone must not resurrect withdrawn observations; reshare does.
    expect(rows[1].new.aggregate).toEqual(rows[2].new.aggregate);
    expect(rows[3].new.aggregate).not.toEqual(rows[2].new.aggregate);
  },180000);
  it('keeps storage/helpers private and rejects unsafe TRUNCATE',()=>{
    const rows=sql(`select json_build_object('tables',bool_and(relrowsecurity),'public_select',bool_or(has_table_privilege('authenticated',c.oid,'select')),
      'service_select',bool_or(has_table_privilege('service_role',c.oid,'select'))) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='private' and relname in ('screen_observations','screen_month_rollups','screen_dirty_months','screen_precompute_control');
      do $$ begin begin truncate private.community_report_facts cascade;raise exception 'TRUNCATE_UNEXPECTEDLY_ALLOWED';
      exception when others then if sqlerrm<>'PRECOMPUTE_TRUNCATE_REQUIRES_REBUILD' then raise;end if;end;end $$;
      select json_build_object('backfill',private.screen_precompute_backfill(250));
      select json_build_object('stable',provolatile='s','definer',prosecdef,'anon',has_function_privilege('anon',oid,'execute')) from pg_proc where proname='analytics_screen_precomputed';`);
    expect(rows).toHaveLength(3);expect(rows[0]).toEqual({tables:true,public_select:false,service_select:false});
    expect(rows[1].backfill).toEqual({done:true,keys:0,months:0});
    expect(rows[2]).toEqual({stable:true,definer:true,anon:false});
  });
  it('falls back while backfill is incomplete, resumes batches, and never changes the packet',async()=>{
    const rows=sql(`update private.screen_precompute_control set ready=false,backfill_cursor=null;
      ${pair('incomplete')}
      do $$ declare r jsonb;begin r:=private.screen_precompute_backfill(1);
      if (r->>'done')::boolean or (r->>'keys')::int<>1 then raise exception 'empty backfill';end if;end $$;
      ${backfill}${pair('resumed')}`);
    expect(rows).toHaveLength(2);expect(rows[0].new.aggregate.encoding).toBe('screen-aggregate-v2');
    expect(rows[1].new.aggregate.encoding).toBe('screen-precompute-v1');
    expect((await replay(rows[1].new,scope)).body).toEqual((await replay(rows[0].legacy,scope)).body);
    expect((await replay(rows[0].new,scope)).body).toEqual((await replay(rows[0].legacy,scope)).body);
  },60000);
});

describe.skipIf(process.env.COMMUNITY_STACK!=='1')('precompute compatibility rollback',()=>{
 it('restores the previous SQL while retaining the complete screen packet and ACL',async()=>{
  const scope={date_basis:'completed_date',start:'2023-01-01',end:'2026-10-06',category:'all'};
  const call=`public.internal_analytics_read_snapshot('${JSON.stringify(scope)}',true,p_user=>u.id,p_session=>u.session_id,p_options=>'${JSON.stringify({screen_encoding:'screen-precompute-v1',fact_encoding:'columns-v1',panels})}')`;
  const rollback=readFileSync('docs/implementation/ingest-precompute-20261006/rollback.sql','utf8').replace(/^(begin|commit);\s*$/gm,'');
  const rows=sql(`select ${call} from cohort_users u where idx=1;${rollback}select ${call} from cohort_users u where idx=1;
   select json_build_object('removed',to_regclass('private.screen_observations') is null,'owner',pg_get_userbyid(proowner),
   'service',has_function_privilege('service_role',oid,'execute'),'anon',has_function_privilege('anon',oid,'execute')) from pg_proc where proname='internal_analytics_read_snapshot';`);
  expect(rows).toHaveLength(3);expect(rows[0].aggregate.encoding).toBe('screen-precompute-v1');expect(rows[1].facts.encoding).toBe('columns-v1');
  expect(rows[2]).toEqual({removed:true,owner:'postgres',service:true,anon:false});
  expect((await replay(rows[0],scope)).body).toEqual((await replay(rows[1],scope)).body);
 });
 it('does not return partial results when eligible history exceeds 100000',()=>{
  const rows=sql(`create temp table errors(code text);do $$ begin
   begin perform private.analytics_screen_precomputed('{"date_basis":"completed_date","start":"2023-01-01","end":"2026-10-06","category":"all"}',(select id from cohort_users where idx=1),'[]');
    insert into errors values('NO_ERROR');exception when others then insert into errors values(sqlerrm);end;
   end $$;select row_to_json(e) from errors e;`,120000);
  expect(rows).toEqual([{code:'RESULT_TOO_LARGE'}]);
 },180000);
});

describe.skipIf(process.env.PRECOMPUTE_FULL_MEASURE!=='1')('resource-limited SQL exports',()=>{
 for(const size of [35000,100000])for(const window of ['year','all'])it(`${size} ${window}: legacy/v1/precompute whole-packet deep equality`,async()=>{
  const scope={...base,start:window==='year'?base.start:'2019-04-23'},packets:unknown[]=[],measurements=[];
  for(const phase of ['legacy','before','after']) {
   const text=readFileSync(`.agent-runtime/ingest-precompute/${size}-${window}-${phase}.json`,'utf8');
   const began=performance.now(),source=JSON.parse(text),parse_ms=performance.now()-began;
   if(phase==='after')expect(source.aggregate.encoding).toBe('screen-precompute-v1');
   const response=await replay(source,scope);expect(response.status).toBe(200);assertPacket(response.body);packets.push(response.body);
   measurements.push({phase,source_bytes:Buffer.byteLength(text),parse_ms,handler_ms:response.ms,public_bytes:response.bytes});
   if(phase==='after')writeFileSync(`.agent-runtime/ingest-precompute/${size}-${window}-public.json`,JSON.stringify(response.body));
  }
  expect(packets[1]).toEqual(packets[0]);expect(packets[2]).toEqual(packets[0]);
  writeFileSync(`docs/implementation/ingest-precompute-20261006/evidence/parity-${size}-${window}.json`,JSON.stringify({whole_packet_deep_equal:true,synthetic:true,size,window,measurements},null,2)+'\n');
 },90000);
});

describe.skipIf(process.env.COMMUNITY_STACK!=='1')('transaction-end rollup batching',()=>{
 it('coalesces event statements, reads current data while dirty, and flushes before commit',async()=>{
  const scope={date_basis:'completed_date',start:'2023-01-01',end:'2026-10-06',category:'all'};
  const call=`public.internal_analytics_read_snapshot('${JSON.stringify(scope)}',true,p_user=>u.id,p_session=>u.session_id,p_options=>'${JSON.stringify({screen_encoding:'screen-precompute-v1',panels})}')`;
  const rows=sql(`set constraints all deferred;
    update private.community_report_facts set status='accepted' where source_report_id='synthetic-31';
    update private.community_report_facts set status='rejected' where source_report_id='synthetic-32';
    select json_build_object('dirty',(select count(*) from private.screen_dirty_months),'new',${call},
      'legacy',public.internal_analytics_read_snapshot('${JSON.stringify(scope)}',true,p_user=>u.id,p_session=>u.session_id,p_options=>'{"fact_encoding":"columns-v1"}')) from cohort_users u where idx=1;
    set constraints all immediate;
    select json_build_object('dirty',(select count(*) from private.screen_dirty_months),'new',${call}) from cohort_users u where idx=1;`);
  expect(rows).toHaveLength(2);expect(rows[0].dirty).toBeGreaterThan(0);expect(rows[1].dirty).toBe(0);
  expect(rows[0].new.aggregate.encoding).toBe('screen-aggregate-v2');expect(rows[1].new.aggregate.encoding).toBe('screen-precompute-v1');
  const legacy=await replay(rows[0].legacy,scope);
  expect((await replay(rows[0].new,scope)).body).toEqual(legacy.body);
  expect((await replay(rows[1].new,scope)).body).toEqual(legacy.body);
 });
});

describe.skipIf(process.env.PRECOMPUTE_FULL_MEASURE!=='1')('committed concurrent writes export',()=>{
 it('preserves every public field after overlapping same-identity writers',async()=>{
  const scope={...base,start:'2019-04-23'};
  const legacy=JSON.parse(readFileSync('.agent-runtime/ingest-precompute/concurrency-legacy.json','utf8'));
  const candidate=JSON.parse(readFileSync('.agent-runtime/ingest-precompute/concurrency-after.json','utf8'));
  const before=await replay(legacy,scope),after=await replay(candidate,scope);
  expect(after.status).toBe(200);assertPacket(after.body);expect(after.body).toEqual(before.body);
 });
});

describe.skipIf(process.env.COMMUNITY_STACK!=='1')('precompute app and public RPC regression',()=>{
 it('leaves owner reports, rankings and all four public rollup kinds byte-value equivalent to the previous SQL',()=>{
  const scope=`'{"date_basis":"completed_date","start":"2023-01-01","end":"2026-10-06","category":"all"}'`;
  const options=`jsonb_build_object('page',1,'page_size',100,'sort',jsonb_build_object('column','completed','value','count','dir','desc'),
    'expected_version',public.internal_analytics_cohort_state()->>'dataset_version')`;
  const query=`select jsonb_build_object('reports',public.internal_my_reports_search(u.id,u.session_id,'address','합성 주소',true,0,50,0,10,null),
   'rankings',public.internal_user_rankings(u.id,u.session_id,'{"theme":"reporters","metric":"reports_count","period":"all","date_basis":"completed_date","category":"all","min_reports":1,"page":1,"page_size":10,"consistency":"latest"}'),
   'rollups',(select jsonb_object_agg(kind,public.internal_analytics_rollup(${scope},kind,${options})) from unnest(array['agency','manager','laws','series']) kind)) as value
   from cohort_users u where idx=1`;
  const rollback=readFileSync('docs/implementation/ingest-precompute-20261006/rollback.sql','utf8').replace(/^(begin|commit);\s*$/gm,'');
  // generated_at is statement_timestamp(), so execute both full RPC packets within one outer
  // statement. Compare the timestamp too; do not strip fields to make the equality pass.
  const rows=sql(`do $rpc$ begin
    execute $before$create temp table rpc_before as ${query}$before$;
    execute $restore$${rollback}$restore$;
    execute $after$create temp table rpc_after as ${query}$after$;
    end $rpc$;
    select json_build_object('equal',a.value=b.value,'reports',(a.value->'reports'->'reports'->>'total')::int,
      'ranking_rows',jsonb_array_length(a.value->'rankings'->'rows'),
      'rollup_kinds',(select count(*) from jsonb_object_keys(a.value->'rollups'))) from rpc_before a cross join rpc_after b;`);
  expect(rows).toHaveLength(1);expect(rows[0].equal).toBe(true);expect(rows[0].reports).toBeGreaterThan(0);
  expect(rows[0].ranking_rows).toBe(10);expect(rows[0].rollup_kinds).toBe(4);
 });
});
