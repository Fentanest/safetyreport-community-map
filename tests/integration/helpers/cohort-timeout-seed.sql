-- Local synthetic fixture. The caller owns BEGIN/ROLLBACK; nothing survives the test.
-- Replace __SIZE__ with a validated integer. Three thousand/30 thousand total fact rows.
alter table private.community_report_facts disable trigger user;
delete from private.community_report_facts;
create temp table cohort_users as
select g as idx, md5('cohort-timeout-user-'||g)::uuid as id,
       md5('cohort-timeout-grant-'||g)::uuid as grant_id,
       md5('cohort-timeout-lineage-'||g)::uuid as lineage,
       md5('cohort-timeout-session-'||g)::uuid as session_id
from generate_series(1,30) g;
insert into auth.users(id,aud,role,created_at,updated_at)
select id,'authenticated','authenticated',now(),now() from cohort_users;
insert into auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
select id::text,id,jsonb_build_object('sub',id::text),'kakao',now(),now() from cohort_users;
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
select session_id,id,now(),now(),'aal1' from cohort_users;
insert into private.contributor_profiles(user_id,consent_version,privacy_policy_version,status)
select id,'2026-09-28.3','2026-09-28.3',case when idx=30 then 'suspended' else 'active' end from cohort_users;
insert into private.community_consent_grants(grant_id,lineage_id,user_id,policy_version,consent_text_sha256,granted_via,granted_session_id,revoked_at)
select grant_id,lineage,id,(array['2026-09-26.1','2026-09-28.1','2026-09-28.2','2026-09-28.3'])[1+idx%4],repeat('a',64),'safetyreport_server',session_id,
       case when idx=29 then now() end from cohort_users;
-- Superseded consent remains eligible when the same user and lineage have an active grant.
insert into private.community_consent_grants(grant_id,lineage_id,user_id,policy_version,consent_text_sha256,granted_via,granted_session_id,revoked_at)
select md5('cohort-old-grant-'||idx)::uuid,lineage,id,'2026-09-26.1',repeat('a',64),'safetyreport_server',session_id,now() from cohort_users;
insert into private.community_report_facts(contributor_id,dataset_key,source_report_key,source_report_id,latest_receipt_id,
 consent_grant_id,writer_epoch,source_revision,payload_sha256,public_state,category,status,disposition,amount_kind,amount_confirmed_won,
 report_date,completed_date,coord_source,lat,lng,report_number,answer_accepted_at,first_accepted_at,
 agency_key,agency_name,agency_current_name,manager_key,manager_name,violation_law,rating,region_code,address,point_key,vehicle_raw)
select u.id,repeat('a',64),md5('cohort-key-'||k)||md5('cohort-key-'||k),'synthetic-'||g,md5('cohort-receipt-'||g)::uuid,
 case when g%7=0 then md5('cohort-old-grant-'||u.idx)::uuid else u.grant_id end,
 1,1,md5('payload-'||g)||md5('payload-'||g),case when g%97=0 then 'not_completed' else 'completed' end,
 (array['parking','traffic','other'])[1+k%3],(array['accepted','partial','rejected','completed_unknown'])[1+g%4],
 (array['fine','penalty','warning','none','unknown'])[1+g%5],'fine',case when g%11<>0 then 50000+g end,
 case when g%71<>0 then date '2023-01-01'+(k%1300) end,
 case when g%73<>0 then date '2023-01-01'+(k%1300)+g%90 end,
 case when g%17=0 then 'none' else 'geocode' end,
 case when g%17<>0 then 37.0+(k%50)*0.01 end,case when g%17<>0 then 127.0+(k%50)*0.01 end,
 case when g%13<>0 then 'SPP-2026-'||lpad(k::text,8,'0') end,
 timestamptz '2026-10-01 00:00Z'+g*interval '1 second',timestamptz '2026-01-01 00:00Z'+g*interval '1 second',
 'agency-'||k%10,'합성 기관 '||k%10,'합성 기관 '||k%10,'manager-'||k%50,'합성 담당 '||k%50,
 '합성법 제'||(1+k%10)||'조',1+g%5,case when k%2=0 then '서울 중구' else '경기 수원' end,
 '합성 주소', 'point-'||k%50, null
from generate_series(1,__SIZE__) g
join cohort_users u on u.idx=1+g%30
cross join lateral (select case when g%10=0 then g-1 else g end as k) key;
alter table private.community_report_facts enable trigger user;
analyze private.community_report_facts;
analyze private.contributor_profiles;
analyze private.community_consent_grants;
