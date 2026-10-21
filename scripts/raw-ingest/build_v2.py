"""Generate v2 reception from the same authenticated, fenced v1 transaction preamble."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]


def sub(text, old, new, count=1):
    found=text.count(old)
    if found!=count: raise SystemExit(f'build_v2: expected {count} match(es), found {found}: {old[:80]!r}')
    return text.replace(old,new)


old=(ROOT/'supabase/migrations/202610121201_fine_estimate_ingest_aggregate.sql').read_text().split('\ncreate or replace function private.analytics_cohort_payload')[0]
prefix=old[old.index('create or replace function public.internal_community_ingest'):old.index('        insert into private.community_ingest_events')]
prefix=sub(prefix,'public.internal_community_ingest(', 'public.internal_community_ingest_v2(')
prefix=sub(prefix,'    v_fact private.community_report_facts%rowtype;', '    v_fact private.community_report_facts%rowtype;\n    v_raw private.community_report_raw%rowtype;\n    v_cfg record;')
# L1: missing config row or NULL values fail closed.
prefix=sub(prefix,'begin\n    if jsonb_typeof', "begin\n    select v2_enabled, raw_policy_version into v_cfg from private.community_ingest_config where singleton;\n"
    "    if not coalesce(v_cfg.v2_enabled, false) or v_cfg.raw_policy_version is null then return jsonb_build_object('error','service_unavailable'); end if;\n"
    "    if jsonb_typeof")
# M1: the grant must be current AND at least the raw policy version (parsed YYYY-MM-DD.N, not lexical).
prefix=sub(prefix,'    -- FOR UPDATE (not SHARE)', "    if not private.community_policy_version_at_least(v_grant.policy_version, v_cfg.raw_policy_version) then\n"
    "        return jsonb_build_object('error','consent_outdated');\n    end if;\n    -- FOR UPDATE (not SHARE)")
# L6: record contract/version once the connection is identified, before every later early return.
prefix=sub(prefix,"    if v_conn.connection_id is null then return jsonb_build_object('error', 'connection_unknown'); end if;\n",
    "    if v_conn.connection_id is null then return jsonb_build_object('error', 'connection_unknown'); end if;\n"
    "    update private.community_connections set last_contract='community-ingest-v2',\n"
    "        last_client_version=p_envelope->>'client_version', last_parser_version=p_envelope->>'parser_version', last_seen_at=now()\n"
    "     where connection_id=v_conn.connection_id;\n")
a=old.index('        insert into private.community_ingest_events'); b=old.index('        -- Global identity locks',a)
ledger=old[a:b]
ledger=sub(ledger,'trigger, payload, payload_sha256','contract, trigger, payload, payload_sha256')
ledger=sub(ledger,"e->>'event_type', p_envelope->>'trigger',\n            e->'payload'", "e->>'event_type', 'community-ingest-v2', p_envelope->>'trigger',\n            null")
ledger=sub(ledger,'select receipt_id, payload_sha256, result', 'select contract, receipt_id, payload_sha256, result')
ledger=sub(ledger,"if v_existing.payload_sha256 =", "if v_existing.contract = 'community-ingest-v2' and v_existing.payload_sha256 =")
body='''        if exists(select 1 from private.community_report_facts f where f.dataset_key<>v_conn.dataset_key
            and (f.source_report_key=v_key or (e->>'report_number' is not null and f.report_number=e->>'report_number')))
           or exists(select 1 from private.community_report_raw r where r.dataset_key<>v_conn.dataset_key
            and (r.source_report_key=v_key or (e->>'report_number' is not null and r.report_number=e->>'report_number'))) then
            update private.community_ingest_events set result='rejected',rejection_reason='report_owned_elsewhere' where receipt_id=v_receipt;
            insert into private.community_report_ownership_audit(receipt_id,request_id,user_id,dataset_key,source_report_key,report_number)
                values(v_receipt,p_request_id,p_user,v_conn.dataset_key,v_key,e->>'report_number');
            v_results:=v_results||jsonb_build_object('event_id',v_event_id,'status','rejected','durable',false,'receipt_id',null,
                'projection_status','not_applicable','error',jsonb_build_object('code','report_owned_elsewhere','retryable',false));
            continue;
        end if;
        -- Lock order (shared with the parser worker and revoke): profile -> grant -> report advisory -> raw -> fact -> queue.
        select * into v_raw from private.community_report_raw where contributor_id=p_user and dataset_key=v_conn.dataset_key and source_report_key=v_key for update;
        select * into v_fact from private.community_report_facts where contributor_id=p_user and dataset_key=v_conn.dataset_key and source_report_key=v_key for update;
        if (v_raw.contributor_id is not null and (v_epoch,v_rev)<(v_raw.writer_epoch,v_raw.source_revision))
           or (v_fact.contributor_id is not null and (v_epoch,v_rev)<(v_fact.writer_epoch,v_fact.source_revision)) then
            v_result:='stale_ignored';
        elsif v_raw.contributor_id is not null and v_raw.raw_sha256=e->'raw'->>'sha256'
            and v_raw.supplement_sha256=e->>'supplement_sha256'
            and v_raw.consent_grant_id=v_grant.grant_id
            and ((v_raw.parse_state='parsed' and v_fact.fact_source='raw') or v_raw.parse_state='dead')
            and (v_epoch,v_rev)=(v_raw.writer_epoch,v_raw.source_revision) then
            -- dead: identical bytes would fail identically; only new bytes or a new parse key re-queue it.
            v_result:='no_change';
        else
            insert into private.community_report_raw(contributor_id,dataset_key,source_report_key,source_report_id,report_number,
                consent_grant_id,latest_receipt_id,event_type,captured_at,raw_text,raw_sha256,raw_size,fetched_at,raw_source,
                supplement,supplement_sha256,client_observation,client_observation_sha256,client_parser_version,writer_epoch,source_revision)
            values(p_user,v_conn.dataset_key,v_key,e->>'source_report_id',e->>'report_number',v_grant.grant_id,v_receipt,e->>'event_type',
                (e->>'captured_at')::timestamptz,e->'raw'->>'body',e->'raw'->>'sha256',(e->'raw'->>'size')::integer,
                (e->'raw'->>'fetched_at')::timestamptz,e->'raw'->>'source',e->'supplement',e->>'supplement_sha256',
                e->'client_observation',e->>'client_observation_sha256',p_envelope->>'parser_version',v_epoch,v_rev)
            on conflict(contributor_id,dataset_key,source_report_key) do update set
                source_report_id=excluded.source_report_id,
                report_number=coalesce(excluded.report_number,private.community_report_raw.report_number),
                consent_grant_id=excluded.consent_grant_id,
                latest_receipt_id=excluded.latest_receipt_id,event_type=excluded.event_type,captured_at=excluded.captured_at,
                raw_text=excluded.raw_text,raw_sha256=excluded.raw_sha256,raw_size=excluded.raw_size,fetched_at=excluded.fetched_at,raw_source=excluded.raw_source,
                supplement=excluded.supplement,supplement_sha256=excluded.supplement_sha256,client_observation=excluded.client_observation,
                client_observation_sha256=excluded.client_observation_sha256,client_parser_version=excluded.client_parser_version,
                writer_epoch=excluded.writer_epoch,source_revision=excluded.source_revision,received_at=now(),parse_state='pending',parse_error=null;
            -- A new body resets attempts and any lease: an in-flight worker on the old bytes ends `superseded`.
            insert into private.community_parse_queue(contributor_id,dataset_key,source_report_key)
                values(p_user,v_conn.dataset_key,v_key) on conflict(contributor_id,dataset_key,source_report_key)
                do update set priority='ingest',attempts=0,next_attempt_at=now(),leased_until=null,lease_token=null;
            v_result:='stored';
        end if;
        update private.community_ingest_events set result=v_result where receipt_id=v_receipt;
        v_max_rev:=greatest(v_max_rev,v_rev);
        v_results:=v_results||jsonb_build_object('event_id',v_event_id,'status',v_result,'durable',true,'receipt_id',v_receipt,
            'projection_status',case when v_result='stored' then 'parse_pending' else 'not_applicable' end);
    end loop;
    if v_max_rev > v_conn.last_accepted_revision then
        update private.community_connections set last_accepted_revision=v_max_rev where connection_id=v_conn.connection_id;
    end if;
    select dataset_version into v_version from private.analytics_state where singleton;
    return jsonb_build_object('results',v_results,'dataset_version',v_version);
end $$;
revoke all on function public.internal_community_ingest_v2(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.internal_community_ingest_v2(uuid,uuid,text,jsonb,jsonb) to service_role;
'''
(ROOT/'scripts/raw-ingest/v2_rpc.sql').write_text(prefix+ledger+body)
