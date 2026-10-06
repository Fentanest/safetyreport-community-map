// Real shared local PostgreSQL; all DDL and fixtures are rolled back, each DB command takes flock.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { canonicalJson, deriveFact, sha256Hex } from '../../server/ingest/observation';
const auth = process.env.SR_AUTH_REPO ?? '/home/better0101/projects/worktree/auth-account-binding';
const strip = (s: string) => s.replace(/^(begin|commit);\s*$/gm, '');
const migration = strip(readFileSync(resolve(auth, 'supabase/migrations/202610061100_official_account_binding.sql'), 'utf8'))
  + strip(readFileSync('supabase/migrations/202610061101_official_account_ingest.sql', 'utf8'));
const fixture = readFileSync(resolve(auth, 'tests/support/official-binding-fixture.sql'), 'utf8');
let helpers: string;
const lit = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const send = (i = 1, key = 'a', number = 'SPP-2610-1000001', rev = 1, type = 'completed_observation') =>
  `pg_temp.binding_send(${i},repeat('${key}',64),${lit(number)},${rev},${lit(type)})`;
const rows = (body: string, before = '') => {
  const output = execFileSync('flock', ['/tmp/ci0926-db.lock','docker','exec','-i','supabase_db_ci0926-int',
    'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'], {
    input: `begin;set local lock_timeout='10s';${fixture}${before}${migration}${helpers}${body}\nrollback;`,
    encoding: 'utf8', timeout: 60000, stdio: ['pipe','pipe','pipe'], maxBuffer: 8*1024*1024,
  });
  return output.split('\n').filter(s => s.startsWith('{')).map(s => JSON.parse(s));
};
const code = (r: any) => r.results[0].error?.code;
const accepted = (r: any) => expect(r.results[0]).toMatchObject({ status: 'accepted', durable: true });
describe.skipIf(process.env.COMMUNITY_STACK !== '1')('binding-aware ingest on local PostgreSQL (rollback)', () => {
  beforeAll(async () => {
    const vectors = JSON.parse(readFileSync('contracts/community-ingest/vectors/observations.json', 'utf8'));
    const payload = vectors.cases.find((c: any) => c.name === 'accepted_fine').expected_payload;
    const derived = await deriveFact(payload);
    const hash = await sha256Hex(canonicalJson(payload));
    helpers = `
      do $$ begin perform pg_temp.binding_consent(1); perform pg_temp.binding_consent(2);
        perform pg_temp.binding_connect(1,repeat('a',64)); perform pg_temp.binding_connect(2,repeat('b',64)); end $$;
      create function pg_temp.binding_send(i integer,k text,n text,r bigint default 1,t text default 'completed_observation',
        eid uuid default gen_random_uuid(), captured timestamptz default clock_timestamp()) returns jsonb
      language plpgsql as $$ declare u record; begin
        select * into u from binding_users where idx=i;
        return public.internal_community_ingest(u.id,u.session_id,'binding-test-request',
          jsonb_build_object('connection_id',u.connection_id,'consent_grant_id',u.grant_id,
            'source_app','safetyreport','source_mode','server','trigger',case when t='reshare' then 'reshare' else 'manual' end),
          jsonb_build_array(jsonb_build_object('event_id',eid,'event_type',t,'source_report_id','BIND-'||left(k,10),
            'source_report_key',k,'report_number',n,'source_revision',r,'writer_epoch',u.epoch,
            'captured_at',captured,'payload',${lit(JSON.stringify(payload))}::jsonb,'payload_sha256','${hash}',
            'derived',${lit(JSON.stringify(derived))}::jsonb)));
      end $$;
      create function pg_temp.binding_counts() returns jsonb language sql as $$
        select jsonb_build_object('facts',(select count(*) from private.community_report_facts),
          'audit',(select count(*) from private.community_report_ownership_audit),
          'revision',(select last_accepted_revision from private.community_connections where connection_id=(select connection_id from binding_users where idx=2)))
      $$;`;
  });
  it('accepts own upload, retry, no_change and stale revision with one fact', () => {
    const r = rows(`select pg_temp.binding_send(1,repeat('a',64),'SPP-2610-1000001',1,'completed_observation','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-10-06T00:00Z');
      select pg_temp.binding_send(1,repeat('a',64),'SPP-2610-1000001',1,'completed_observation','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-10-06T00:00Z');
      select ${send(1,'a','SPP-2610-1000001',2)};select ${send(1,'a','SPP-2610-1000001',1)};select pg_temp.binding_counts();`);
    expect(r).toHaveLength(5); accepted(r[0]);
    expect(r[1].results[0]).toMatchObject({ status: 'duplicate', durable: true });
    expect(r[2].results[0].status).toBe('no_change'); expect(r[3].results[0].status).toBe('stale_ignored');
    expect(r[4]).toEqual({ facts: 1, audit: 0, revision: 0 });
  });
  it.each(['key','number'])('rejects cross-dataset %s collision, audits and leaves fact/revision unchanged', identity => {
    const r = rows(`select ${send()};select ${send(2,identity === 'key' ? 'a':'b',identity === 'key' ? 'SPP-2610-1000002':'SPP-2610-1000001')};select pg_temp.binding_counts();`);
    expect(r).toHaveLength(3); accepted(r[0]); expect(code(r[1])).toBe('report_owned_elsewhere');
    expect(r[1].results[0]).toMatchObject({ status: 'rejected', durable: false, receipt_id: null });
    expect(JSON.stringify(r[1])).not.toMatch(/dataset_key|user_id|SPP-/);
    expect(r[2]).toEqual({ facts: 1, audit: 1, revision: 0 });
  });
  it('replays a refused event without duplicating its audit', () => {
    const retry = `select pg_temp.binding_send(2,repeat('a',64),'SPP-2610-1000001',1,'completed_observation','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','2026-10-06T00:00Z');`;
    const r = rows(`select ${send()};${retry}${retry}select pg_temp.binding_counts();`);
    expect(r).toHaveLength(4); expect(code(r[1])).toBe('report_owned_elsewhere'); expect(code(r[2])).toBe('report_owned_elsewhere');
    expect(r[3]).toEqual({ facts: 1, audit: 1, revision: 0 });
  });
  it('rejects missing/mismatched binding before an event ledger entry', () => {
    const r = rows(`update private.community_official_account_bindings set dataset_key=repeat('c',64) where user_id=(select id from binding_users where idx=1);
      select ${send()};delete from private.community_official_account_bindings where user_id=(select id from binding_users where idx=1);
      select ${send()};select jsonb_build_object('n',count(*)) from private.community_ingest_events where contributor_id=(select id from binding_users where idx=1);`);
    expect(r).toEqual([{ error: 'official_account_mismatch' },{ error: 'official_account_mismatch' },{ n: 0 }]);
  });
  it('preserves consent revoke/re-consent/explicit reshare without releasing the binding', () => {
    const r = rows(`select ${send()};select public.internal_account_revoke_consent(id,session_id,grant_id) from binding_users where idx=1;
      select ${send()};select pg_temp.binding_consent(1);select ${send(1,'a','SPP-2610-1000001',2)};
      select jsonb_build_object('visible',private.community_fact_publicly_listed(f)) from private.community_report_facts f;
      select ${send(1,'a','SPP-2610-1000001',3,'reshare')};
      select jsonb_build_object('visible',private.community_fact_publicly_listed(f),'bindings',(select count(*) from private.community_official_account_bindings)) from private.community_report_facts f;`);
    expect(r).toHaveLength(8); accepted(r[0]); expect(r[2].error).toBe('consent_revoked');
    expect(r[5].visible).toBe(false); expect(r[7]).toEqual({ visible: true, bindings: 2 });
  });
  it('retains ownership while the original fact is hidden by revoked consent', () => {
    const r = rows(`select ${send()};select public.internal_account_revoke_consent(id,session_id,grant_id) from binding_users where idx=1;
      select ${send(2)};select pg_temp.binding_counts();`);
    expect(r).toHaveLength(4); expect(code(r[2])).toBe('report_owned_elsewhere'); expect(r[3].audit).toBe(1);
  });
  it('delete preserves tombstone/fence, releases binding, and new account accepts only fresh reports', () => {
    const r = rows(`select ${send()};select public.internal_community_delete_contributions(id,session_id) from binding_users where idx=1;
      select ${send()};select pg_temp.binding_connect(1,repeat('c',64));select ${send(1,'a','SPP-2610-1000001',2)};
      select pg_temp.binding_send(1,repeat('c',64),'SPP-2610-1000003',1,'completed_observation',gen_random_uuid(),'2000-01-01Z');
      select ${send(1,'d','SPP-2610-1000004')};select pg_temp.binding_counts();`);
    expect(r).toHaveLength(8); expect(r[1]).toMatchObject({ deleted_facts: 1, official_account_released: true });
    expect(r[2].error).toBe('connection_revoked'); expect(code(r[4])).toBe('deleted'); expect(code(r[5])).toBe('deleted'); accepted(r[6]);
    expect(r[7].facts).toBe(1);
  });
  it('operator deletion lets the real owner bind the same dataset and upload the same identities even with old captured_at', () => {
    const r = rows(`select ${send()};select public.internal_account_release_official_account(repeat('a',64),id,'ticket','verified') from binding_users where idx=1;
      select ${send()};select pg_temp.binding_consent(3);select pg_temp.binding_connect(3,repeat('a',64));
      select pg_temp.binding_send(3,repeat('a',64),'SPP-2610-1000001',1,'completed_observation',gen_random_uuid(),'2000-01-01Z');
      select jsonb_build_object('facts',count(*),'real_owner',bool_and(contributor_id=(select id from binding_users where idx=3)),
        'dataset',min(dataset_key)) from private.community_report_facts;
      select jsonb_build_object('fences',count(*),'previous_owner',bool_and(contributor_id=(select id from binding_users where idx=1)))
        from private.community_dataset_deletion_fences;`);
    expect(r).toHaveLength(8); accepted(r[0]);
    expect(r[1]).toMatchObject({ official_account_released: true, deleted_facts: 1, tombstoned_identities: 1, revoked_connections: 1 });
    expect(r[2].error).toBe('connection_revoked'); expect(r[4].connection_id).toBeTypeOf('string'); accepted(r[5]);
    expect(r[6]).toEqual({ facts: 1, real_owner: true, dataset: 'a'.repeat(64) });
    expect(r[7]).toEqual({ fences: 1, previous_owner: true });
  });
  it('blocks the previous owner by identity and fence on rebind while permitting fresh reports', () => {
    const r = rows(`select ${send()};select public.internal_account_release_official_account(repeat('a',64),id,'ticket','verified') from binding_users where idx=1;
      select pg_temp.binding_connect(1,repeat('a',64));select ${send(1,'a','SPP-2610-1000001',2)};
      select pg_temp.binding_send(1,repeat('c',64),'SPP-2610-1000003',1,'completed_observation',gen_random_uuid(),'2000-01-01Z');
      select ${send(1,'d','SPP-2610-1000004')};select pg_temp.binding_counts();`);
    expect(r).toHaveLength(7); expect(code(r[3])).toBe('deleted'); expect(code(r[4])).toBe('deleted'); accepted(r[5]);
    expect(r[6]).toEqual({ facts: 1, audit: 0, revision: 0 });
  });
  it('scopes operator identity tombstones and fences to the released dataset, preserving other users', () => {
    const r = rows(`select ${send()};select ${send(2,'b','SPP-2610-1000002')};
      select public.internal_account_release_official_account(repeat('a',64),id,'ticket','verified') from binding_users where idx=1;
      select pg_temp.binding_connect(1,repeat('c',64));
      select pg_temp.binding_send(1,repeat('a',64),'SPP-2610-1000001',1,'completed_observation',gen_random_uuid(),'2000-01-01Z');
      select ${send(2,'b','SPP-2610-1000002',2)};select pg_temp.binding_counts();`);
    expect(r).toHaveLength(7); accepted(r[0]); accepted(r[1]); accepted(r[4]);
    expect(r[5].results[0].status).toBe('no_change'); expect(r[6]).toEqual({ facts: 2, audit: 0, revision: 2 });
  });
  it('keeps rebind and takeover uploads in the same binding', () => {
    const r = rows(`select ${send()};
      select public.internal_account_rebind_connection(id,session_id,connection_id,repeat('a',64)) from binding_users where idx=1;
      select pg_temp.binding_connect(1,repeat('a',64),true);select ${send(1,'a','SPP-2610-1000001',2)};
      select pg_temp.binding_counts();`);
    expect(r).toHaveLength(5); expect(r[1].last_accepted_revision).toBe(1);
    expect(r[2].superseded_previous).toBe(true); expect(r[3].results[0].status).toBe('no_change');
    expect(r[4]).toEqual({ facts: 1, audit: 0, revision: 0 });
  });
  it('locks both global report identifiers and continues an accepted event after a collision in one batch', () => {
    const r = rows(`select ${send()};
      select jsonb_build_object('locks',count(*)) from pg_locks where pid=pg_backend_pid() and locktype='advisory';
      select public.internal_community_ingest(u.id,u.session_id,'binding-mixed-batch',
        jsonb_build_object('connection_id',u.connection_id,'consent_grant_id',u.grant_id,'source_app','safetyreport','source_mode','server','trigger','manual'),
        jsonb_build_array(
          to_jsonb(e)||jsonb_build_object('event_id',gen_random_uuid(),'writer_epoch',u.epoch),
          to_jsonb(e)||jsonb_build_object('event_id',gen_random_uuid(),'writer_epoch',u.epoch,'source_report_id','FRESH',
            'source_report_key',repeat('f',64),'report_number','SPP-2610-9999999',
            'derived',jsonb_build_object('public_state','completed','category','traffic','status','accepted',
              'disposition','none','amount_kind','unknown','coord_source','none'))))
      from binding_users u cross join private.community_ingest_events e where u.idx=2
        and e.contributor_id=(select id from binding_users where idx=1);
      select pg_temp.binding_counts();`);
    expect(r).toHaveLength(4); expect(r[1].locks).toBe(2);
    expect(r[2].results).toHaveLength(2); expect(code(r[2])).toBe('report_owned_elsewhere');
    expect(r[2].results[1]).toMatchObject({ status: 'accepted', durable: true });
    expect(r[3]).toEqual({ facts: 2, audit: 1, revision: 1 });
  });
  it('backfills facts with no connection and rejects a conflicting fact/connection snapshot', () => {
    // A fact derived from the existing stack schema before the new binding migration.
    const fact = `insert into private.community_report_facts(contributor_id,dataset_key,source_report_key,source_report_id,latest_receipt_id,
      consent_grant_id,writer_epoch,source_revision,payload_sha256,public_state,category,status,disposition,amount_kind,coord_source)
      select id,repeat('c',64),repeat('f',64),'FACT-ONLY',gen_random_uuid(),gen_random_uuid(),1,1,repeat('f',64),'completed','traffic','accepted','none','unknown','none'
      from binding_users where idx=3;`;
    const r = rows(`select public.internal_account_status(id,session_id,null) from binding_users where idx=3;`,fact);
    expect(r).toHaveLength(1); expect(r[0].official_account.dataset_key).toBe('c'.repeat(64));
    expect(() => rows('',fact+`select pg_temp.binding_connect(3,repeat('d',64));`)).toThrow(/OFFICIAL_ACCOUNT_BACKFILL_CONFLICT/);
  });
});
