import { readFileSync } from 'node:fs';
// Shared deterministic, rollback-only synthetic seed for the existing rankings and new public rollup measurements.
// Triggers are disabled only during bulk insertion, then restored before every measured query.
export function rankingMeasureSeed(size=500000, globalKeys=false):string {
 if(!Number.isInteger(size)||size<0||size>500000)throw new Error('invalid fixture size');
 return `begin;
    alter table private.community_report_facts disable trigger user;
    create temporary table rk_users as select g as idx,overlay(overlay(md5('refactor-rank-user-'||g) placing '4' from 13 for 1) placing '8' from 17 for 1)::uuid as id,overlay(overlay(md5('refactor-rank-grant-'||g) placing '4' from 13 for 1) placing '8' from 17 for 1)::uuid as grant_id,overlay(overlay(md5('refactor-rank-lineage-'||g) placing '4' from 13 for 1) placing '8' from 17 for 1)::uuid as lineage from generate_series(1,1000) g;
    insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at)
      select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','ranking-perf-'||id||'@example.invalid',now(),now() from rk_users;
    insert into auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
      select id::text,id,jsonb_build_object('sub',id::text),'kakao',now(),now() from rk_users;
    insert into private.contributor_profiles(user_id,consent_version,privacy_policy_version) select id,'2026-09-28.3','2026-09-28.3' from rk_users;
    insert into private.community_consent_grants(grant_id,lineage_id,user_id,policy_version,consent_text_sha256,granted_via,granted_session_id)
      select grant_id,lineage,id,'2026-09-28.3',repeat('a',64),'safetyreport_server',gen_random_uuid() from rk_users;
    insert into private.community_report_facts(contributor_id,dataset_key,source_report_key,source_report_id,latest_receipt_id,consent_grant_id,writer_epoch,source_revision,payload_sha256,public_state,category,status,disposition,amount_kind,report_date,completed_date,coord_source,report_number,answer_accepted_at,first_accepted_at${globalKeys ? ',agency_key,agency_name,manager_key,manager_name,violation_law,region_code' : ''})
      select u.id,repeat('a',64),encode(sha256(convert_to(${globalKeys ? "'global-perf-'||u.idx||'-'||g" : "'perf-'||g"},'UTF8')),'hex'),'9100000001',gen_random_uuid(),u.grant_id,1,1,repeat('b',64),'completed','parking',
        case when g<=1+u.idx%50*10 then 'partial' when g%17=0 then 'completed_unknown' else 'accepted' end,
        case when g<=1+u.idx%50*10 then 'fine' else 'warning' end,'unknown','2040-09-01','2040-09-30','none',null,now(),now()${globalKeys ? ",'agency-'||(g%100),'합성 기관 '||(g%100),'manager-'||(g%500),'합성 담당 '||(g%500),'합성법 제'||(1+g%10)||'조','서울 중구'" : ''}
      from rk_users u cross join generate_series(1,500) g where (u.idx-1)*500+g<=${size};
    insert into private.community_report_facts select (jsonb_populate_record(null::private.community_report_facts,to_jsonb(f)||jsonb_build_object('dataset_key',repeat('c',64)))).*
      from private.community_report_facts f join rk_users u on u.id=f.contributor_id where u.idx<=200;
    analyze private.community_report_facts;
    alter table private.community_report_facts enable trigger user;
`;
}

/** Immutable original definitions, private transaction-only aliases, including the original eligibility gate. */
export function frozenOriginalRankingSql():string {
 const body=(file:string,pattern:RegExp)=>readFileSync(`supabase/migrations/${file}`,'utf8').match(pattern)![0];
 const reps=body('202610030100_user_rankings.sql',/create function private\.ranking_representatives[\s\S]*?\$\$;/)
  .replace('create function','create or replace function').replace('private.ranking_representatives()','private.ranking_representatives_before_measure()');
 const gate=body('202609281900_viewer_threshold.sql',/create or replace function public\.internal_analytics_viewer[\s\S]*?\$\$;/)
  .replace('public.internal_analytics_viewer(','private.analytics_viewer_before_measure(');
 const ranks=body('202610030200_user_ranking_periods.sql',/create or replace function public\.internal_user_rankings[\s\S]*?\$\$;/)
  .replace('public.internal_user_rankings(','private.user_rankings_before_measure(')
  .replace('private.ranking_representatives()','private.ranking_representatives_before_measure()')
  .replace('public.internal_analytics_viewer(','private.analytics_viewer_before_measure(');
 return `${reps}\n${gate}\n${ranks}\n`;
}
