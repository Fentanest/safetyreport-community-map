// Compare frozen old gate/bounds functions and candidates in one local PostgreSQL transaction.
import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createUser,deleteUsers,insertFacts,lit,serviceClient,sql,stackKeys,type TestUser } from './helpers/myReportsSeed';
const users:TestUser[]=[];
const read=(name:string)=>readFileSync(`supabase/migrations/${name}`,'utf8');
const strip=(s:string)=>s.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'');
describe.skipIf(process.env.COMMUNITY_STACK!=='1')('viewer gate/state exact refactor equivalence',()=>{
 beforeAll(async()=>{
  const keys=stackKeys(),svc=serviceClient(keys);
  users.push(await createUser(svc,keys.ANON_KEY,'gate-refactor-a'),await createUser(svc,keys.ANON_KEY,'gate-refactor-b'),await createUser(svc,keys.ANON_KEY,'gate-refactor-no-kakao',{kakao:false,profile:false}));
  const[a,b]=users;
  const f=(user:TestUser,key:string,dataset='pc',number:string|null=null)=>({user,key,dataset,number,sourceId:'9100000001',reportDate:'2043-01-01',completedDate:'2043-09-30'});
  insertFacts([...Array.from({length:8},(_,i)=>f(a,`gate-key-${i}`)),f(a,'gate-shared'),f(a,'gate-shared','mobile','SPP-4309-00000002'),f(a,'gate-shared','restored'),f(b,'gate-shared','pc','SPP-4309-00000001')]);
  sql(`update private.community_report_facts set first_accepted_at='2000-01-01T00:00:00Z' where contributor_id='${b.id}';`);
 },60000);
 afterAll(()=>deleteUsers(users),60000);
 it('10-report threshold, cross-account historical fallback, duplicate devices, auth states, withdrawal/reconsent/deletion and both bounds match',()=>{
  const oldGate=read('202609281900_viewer_threshold.sql').match(/create or replace function public\.internal_analytics_viewer[\s\S]*?\$\$;/)![0].replace('public.internal_analytics_viewer(', 'private.analytics_viewer_before_refactor(');
  const oldState=read('202610010100_single_date_cohort.sql').match(/create or replace function public\.internal_analytics_cohort_state\(\)[\s\S]*?\$\$;/)![0].replace('public.internal_analytics_cohort_state()', 'private.analytics_state_before_refactor()');
  const[a,b,c]=users;
  const compare=()=>users.map(u=>`select jsonb_build_object('before',private.analytics_viewer_before_refactor('${u.id}','${u.session}'),'after',public.internal_analytics_viewer('${u.id}','${u.session}'));`).join('\n')+`select jsonb_build_object('before',private.analytics_state_before_refactor(),'after',public.internal_analytics_cohort_state());`;
  const mutations=[`update private.community_consent_grants set revoked_at=now() where user_id='${b.id}';`,
   `update private.community_consent_grants set revoked_at=null where user_id='${b.id}';`,
   `update private.contributor_profiles set status='suspended' where user_id='${a.id}';`,
   `update private.contributor_profiles set status='active' where user_id='${a.id}';`,
   `delete from private.community_report_facts where contributor_id='${a.id}';`];
  const rows=sql('begin;\n'+oldGate+'\n'+oldState+'\n'+strip(read('202610040400_viewer_key_lookup.sql'))+'\n'+strip(read('202610040500_cohort_state_setwise.sql'))+'\n'+compare()+'\n'+mutations.map(m=>m+compare()).join('\n')+`select jsonb_build_object('before',private.analytics_viewer_before_refactor('${c.id}','00000000-0000-4000-8000-000000000001'),'after',public.internal_analytics_viewer('${c.id}','00000000-0000-4000-8000-000000000001'));rollback;`)
   .split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l));
  expect(rows).toHaveLength(4*(1+mutations.length)+1);
  for(const [i,r]of rows.entries())expect(r.after,`gate/state comparison ${i}`).toEqual(r.before);
  expect(rows[0].after.public_fact_count).toBe(10);
  expect(rows[4].after.public_fact_count).toBe(9); // Global number fallback changes after the earlier cross-account number is withdrawn.
  expect(rows[12].after).toMatchObject({contributor:'suspended',public_fact_count:0,has_public_facts:false});
  expect(rows[20].after).toMatchObject({public_fact_count:0,has_public_facts:false});
 });
});
