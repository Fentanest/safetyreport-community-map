"""Build the additive migration, preserving the v1 fact assignment block verbatim.

Run from anywhere: python3 scripts/raw-ingest/build_v2.py && python3 scripts/raw-ingest/build_migration.py
The generated supabase/migrations/202610210100_raw_json_ingest.sql must equal this script's output.
"""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]


def sub(text: str, old: str, new: str, count: int = 1) -> str:
    """Exact replacement that fails loudly when the source drifts."""
    found = text.count(old)
    if found != count:
        raise SystemExit(f'build_migration: expected {count} match(es), found {found}: {old[:80]!r}')
    return text.replace(old, new)


OLD = (ROOT / 'supabase/migrations/202610121201_fine_estimate_ingest_aggregate.sql').read_text().split('\ncreate or replace function private.analytics_cohort_payload')[0]
start = OLD.index('        select * into v_fact from private.community_report_facts')
end = OLD.index('        update private.community_ingest_events set result = v_result', start)
block = OLD[start:end]
block = sub(block, '        v_was_visible := v_fact.contributor_id is not null and private.community_fact_publicly_listed(v_fact);\n', '')
block = block.replace('v_conn.dataset_key', 'p_dataset').replace('v_grant.grant_id', 'p_grant')
block = sub(block, 'elsif (v_epoch, v_rev) > (v_fact.writer_epoch, v_fact.source_revision) then',
    "elsif (v_epoch, v_rev) > (v_fact.writer_epoch, v_fact.source_revision)\n"
    "           or ((v_epoch, v_rev) = (v_fact.writer_epoch, v_fact.source_revision) and p_source = 'raw') then")
# H: a worker-side derivation change (new parse key, same DTO payload) must reach the fact columns. Only a raw-sourced fact
# being re-projected by the raw path qualifies; the v1 (dto) path keeps its exact no_change behaviour.
block = sub(block, 'if v_fact.payload_sha256 = e->>\'payload_sha256\' and v_fact.consent_grant_id = v_target_grant then',
    "if v_fact.payload_sha256 = e->>'payload_sha256' and v_fact.consent_grant_id = v_target_grant\n"
    "               and not (p_source = 'raw' and v_fact.fact_source = 'raw' and v_fact.fact_parser_version is distinct from p_parser) then")
# M3: fact_source/fact_parser_version/raw_sha256 travel inside the ORIGINAL insert/update statements, so v1 executes
# exactly as many statements (and statement triggers) as before this migration.
block = sub(block, '                answer_accepted_at)\n            values (',
    '                answer_accepted_at, fact_source, fact_parser_version, raw_sha256)\n            values (')
block = sub(block, "                clock_timestamp());\n            v_result := 'accepted';",
    "                clock_timestamp(), p_source, p_parser, p_raw_sha);\n            v_result := 'accepted';")
block = sub(block, "latest_receipt_id = v_receipt, report_number = coalesce(e->>'report_number', v_fact.report_number), updated_at = now()\n",
    "latest_receipt_id = v_receipt, report_number = coalesce(e->>'report_number', v_fact.report_number), updated_at = now(),\n"
    "                    fact_source = p_source, fact_parser_version = p_parser, raw_sha256 = p_raw_sha\n")
# L7: a reparse of the same raw bytes at the same revision is not a new answer (keeps representative election stable).
block = sub(block, """                    answer_accepted_at = case when v_fact.payload_sha256 is not distinct from e->>'payload_sha256'
                                              then v_fact.answer_accepted_at else clock_timestamp() end,
                    updated_at = now()
""", """                    answer_accepted_at = case when v_fact.payload_sha256 is not distinct from e->>'payload_sha256'
                                                or (p_source = 'raw' and v_fact.raw_sha256 is not distinct from p_raw_sha
                                                    and (v_fact.writer_epoch, v_fact.source_revision) = (v_epoch, v_rev))
                                              then v_fact.answer_accepted_at else clock_timestamp() end,
                    updated_at = now(),
                    fact_source = p_source, fact_parser_version = p_parser, raw_sha256 = p_raw_sha
""")
block += '        return v_result;\n'
helper = '''create or replace function private.project_raw_fact(
    p_user uuid, p_dataset text, p_grant uuid, v_receipt uuid, e jsonb,
    p_source text, p_parser text, p_raw_sha text)
returns text language plpgsql security definer set search_path='' as $$
declare
    v_fact private.community_report_facts%rowtype;
    v_epoch bigint := (e->>'writer_epoch')::bigint;
    v_rev bigint := (e->>'source_revision')::bigint;
    v_key text := e->>'source_report_key';
    d jsonb := e->'derived';
    v_result text;
    v_keep_grant boolean;
    v_target_grant uuid;
begin
    if p_source not in ('dto','raw') then raise exception 'invalid_fact_source'; end if;
''' + block + 'end;\n$$;\n'

v1 = OLD[OLD.index('create or replace function public.internal_community_ingest'):]
v1 = v1[:v1.index('        select * into v_fact from private.community_report_facts')] + '''        select * into v_fact from private.community_report_facts
         where contributor_id=p_user and dataset_key=v_conn.dataset_key and source_report_key=v_key for update;
        v_was_visible := v_fact.contributor_id is not null and private.community_fact_publicly_listed(v_fact);
        v_result := private.project_raw_fact(p_user, v_conn.dataset_key, v_grant.grant_id, v_receipt, e,
            'dto', p_envelope->>'parser_version', null);
''' + OLD[end:]
v1 = sub(v1, 'select receipt_id, payload_sha256, result', 'select contract, receipt_id, payload_sha256, result')
v1 = sub(v1, "if v_existing.payload_sha256 =", "if v_existing.contract = 'community-ingest-v1' and v_existing.payload_sha256 =")
# L6: record the client contract/version as soon as the caller's connection is identified, including every later
# early return (superseded/revoked/session/mode/binding). One UPDATE, same as the earlier end-of-function form.
v1 = sub(v1, "    if v_conn.connection_id is null then return jsonb_build_object('error', 'connection_unknown'); end if;\n",
    "    if v_conn.connection_id is null then return jsonb_build_object('error', 'connection_unknown'); end if;\n"
    "    update private.community_connections set last_contract='community-ingest-v1',\n"
    "        last_client_version=p_envelope->>'client_version', last_parser_version=p_envelope->>'parser_version', last_seen_at=now()\n"
    "     where connection_id=v_conn.connection_id;\n")
# Raw reservations must also prevent a v1 upload racing a pending v2 parse from another dataset (L2: audited like facts).
needle = '        -- 2026-09-28: only final-answer observations are stored.'
v1 = sub(v1, needle, '''        if exists (select 1 from private.community_report_raw r where r.dataset_key<>v_conn.dataset_key
            and (r.source_report_key=v_key or (e->>'report_number' is not null and r.report_number=e->>'report_number'))) then
            update private.community_ingest_events set result='rejected', rejection_reason='report_owned_elsewhere' where receipt_id=v_receipt;
            insert into private.community_report_ownership_audit(receipt_id,request_id,user_id,dataset_key,source_report_key,report_number)
            values (v_receipt,p_request_id,p_user,v_conn.dataset_key,v_key,e->>'report_number');
            v_results := v_results || jsonb_build_object('event_id',v_event_id,'status','rejected','durable',false,
                'receipt_id',null,'projection_status','not_applicable','error',jsonb_build_object('code','report_owned_elsewhere','retryable',false));
            continue;
        end if;
''' + needle)

# M3: the three transport columns do not change a personal result. Redefine the newest screen_user_changed.
STALE = (ROOT / 'supabase/migrations/202610121400_screen_cache_stale.sql').read_text()
user_changed = STALE[STALE.index('create function private.screen_user_changed()'):]
user_changed = user_changed[:user_changed.index('end $$;') + len('end $$;')] + '\n'
user_changed = sub(user_changed, 'create function private.screen_user_changed()', 'create or replace function private.screen_user_changed()')
user_changed = sub(user_changed, "array['updated_at','latest_receipt_id','source_revision','writer_epoch']",
    "array['updated_at','latest_receipt_id','source_revision','writer_epoch','fact_source','fact_parser_version','raw_sha256']", 2)

header = '''-- Local candidate only. Requires the composed map/auth schema through 202610180400.
begin;
set local lock_timeout = '3s';
alter table private.community_report_facts
    add column fact_source text not null default 'dto' check (fact_source in ('dto','raw')),
    add column fact_parser_version text,
    add column raw_sha256 text;
alter table private.community_connections
    add column last_contract text, add column last_client_version text,
    add column last_parser_version text, add column last_seen_at timestamptz;
-- Keep immutable identity/hash/result metadata indefinitely; scrub only the 30-day payload.
alter table private.community_ingest_events alter column payload drop not null;
alter table private.community_ingest_events add column contract text not null default 'community-ingest-v1';
alter table private.community_ingest_events drop constraint community_ingest_events_trigger_check;
alter table private.community_ingest_events add constraint community_ingest_events_trigger_check
    check (trigger in ('realtime','manual','midnight','recovery','rebuild','reshare','raw_backfill'));
alter table private.community_ingest_events drop constraint community_ingest_events_result_check;
alter table private.community_ingest_events add constraint community_ingest_events_result_check
    check (result in ('pending','accepted','no_change','stale_ignored','quarantined','rejected','stored'));
-- M4: the payload purge walks only rows that still carry a payload, oldest first.
create index community_ingest_events_payload_due on private.community_ingest_events(received_at) where payload is not null;

create table private.community_report_raw (
    contributor_id uuid not null references private.contributor_profiles(user_id) on delete cascade,
    dataset_key text not null check (dataset_key ~ '^[0-9a-f]{64}$'),
    source_report_key text not null check (source_report_key ~ '^[0-9a-f]{64}$'),
    source_report_id text not null, report_number text,
    consent_grant_id uuid not null references private.community_consent_grants(grant_id) on delete cascade,
    latest_receipt_id uuid not null references private.community_ingest_events(receipt_id) on delete cascade,
    event_type text not null, captured_at timestamptz not null,
    raw_text text not null, raw_sha256 text not null check (raw_sha256 ~ '^[0-9a-f]{64}$'),
    raw_size integer not null check (raw_size=octet_length(raw_text) and raw_size between 1 and 1048576),
    fetched_at timestamptz not null, raw_source text not null,
    supplement jsonb not null, supplement_sha256 text not null,
    client_observation jsonb, client_observation_sha256 text, client_parser_version text not null,
    writer_epoch bigint not null, source_revision bigint not null, received_at timestamptz not null default now(),
    -- dead: permanent failure after the attempt limit; a new raw/supplement hash or a new parse key re-queues it.
    parse_state text not null default 'pending' check (parse_state in ('pending','parsed','failed','dead')),
    parsed_parser_version text, parse_error text,
    primary key(contributor_id,dataset_key,source_report_key)
);
-- M2: v1/v2 cross-dataset reservation lookups. M6: per-contributor tombstone purge. FK cascades from the ledger.
create index community_raw_report_number on private.community_report_raw(report_number) where report_number is not null;
create index community_raw_source_key on private.community_report_raw(source_report_key);
create index community_raw_contributor_key on private.community_report_raw(contributor_id,source_report_key);
create index community_raw_receipt on private.community_report_raw(latest_receipt_id);
create index community_raw_grant on private.community_report_raw(consent_grant_id);
create table private.community_report_parsed (
    contributor_id uuid not null, dataset_key text not null, source_report_key text not null,
'''
# Full PC parser output, expanded title and supplement columns, plus values outside raw.
columns = {'entry_value':'text','ssnpc_cd':'text','ssnpc_type':'text','car_number':'text','occurrence_date':'text','occurrence_time':'text',
'violation_location':'text','violation_latitude':'double precision','violation_longitude':'double precision','progress_status':'text',
'processing_status':'text','processing_finish':'text','processing_agency':'text','processing_agency_code':'text','person_in_charge':'text',
'response_date':'text','processing_content':'text','violation_law':'text','penalty_amount':'text','penalty_points':'text','report_content':'text',
'attachment_files':'text','attached_photos':'text','map_image':'text','raw_content':'text','raw_type':'text','report_number':'text','report_title':'text',
'report_date':'text','list_status':'text','survey_state':'text','rating':'integer','rating_cause':'text','photo_first_at':'text','photo_last_at':'text',
'photo_count':'integer','category':'text','supplement_count':'integer','supplement_is_open':'text','supplement_requester':'text',
'supplement_requested_at':'text','supplement_completed_at':'text','supplement_request_text':'text','supplement_reporter_opinion':'text',
'supplement_requester_phone':'text'}
header += ''.join(f'    {name} {typ},\n' for name,typ in columns.items()) + '''    parser_version text not null, parsed_at timestamptz not null default now(),
    primary key(contributor_id,dataset_key,source_report_key),
    foreign key(contributor_id,dataset_key,source_report_key) references private.community_report_raw on delete cascade
);
create table private.community_parse_diffs (
    contributor_id uuid not null, dataset_key text not null, source_report_key text not null,
    -- differences is NULL when the client sent no observation (nothing to compare), {} when they agree.
    parser_version text not null, client_parser_version text not null, differences jsonb,
    recorded_at timestamptz not null default now(),
    primary key(contributor_id,dataset_key,source_report_key,parser_version),
    foreign key(contributor_id,dataset_key,source_report_key) references private.community_report_raw on delete cascade
);
-- H1: a claim only sets a lease (next_attempt_at := leased_until) and commits; each job is then processed in its own
-- short transaction with the ingest/revoke lock order. `ingest` sorts before `reparse`, so the index matches the claim.
create table private.community_parse_queue (
    contributor_id uuid not null, dataset_key text not null, source_report_key text not null,
    priority text not null default 'ingest' check (priority in ('ingest','reparse')),
    attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
    leased_until timestamptz, lease_token uuid,
    primary key(contributor_id,dataset_key,source_report_key),
    foreign key(contributor_id,dataset_key,source_report_key) references private.community_report_raw on delete cascade
);
create index community_parse_due on private.community_parse_queue(priority,next_attempt_at);
do $$ begin
    if not exists (select 1 from pg_roles where rolname='community_parser') then
        create role community_parser nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
    end if;
end $$;
-- Applies when operations give community_parser itself LOGIN; the worker also sets them per session.
alter role community_parser set lock_timeout = '5s';
alter role community_parser set statement_timeout = '30s';
alter role community_parser set idle_in_transaction_session_timeout = '60s';
grant usage on schema private to community_parser;
'''
for table in ('community_report_raw','community_report_parsed','community_parse_diffs','community_parse_queue'):
    header += f'alter table private.{table} enable row level security;\nrevoke all on private.{table} from public, anon, authenticated, service_role, community_parser;\n'
    if table == 'community_report_raw':
        # Read-only body access; every write goes through the lock-ordered SECURITY DEFINER functions below.
        header += f'grant select on private.{table} to community_parser;\ncreate policy parser_read on private.{table} for select to community_parser using (true);\n'

# Parsed upsert used by finish_raw_parse: all columns from one jsonb object, typed by the table itself.
parsed_cols = ','.join(columns)
parsed_upsert = (
    '    insert into private.community_report_parsed(contributor_id,dataset_key,source_report_key,' + parsed_cols + ',parser_version)\n'
    '    select p_user,p_dataset,p_key,' + ','.join('x.' + c for c in columns) + ',p_parser\n'
    '      from jsonb_populate_record(null::private.community_report_parsed, coalesce(p_parsed,\'{}\'::jsonb)) x\n'
    '    on conflict(contributor_id,dataset_key,source_report_key) do update set\n        '
    + ','.join(f'{c}=excluded.{c}' for c in columns) + ',parser_version=excluded.parser_version,parsed_at=now();\n')
tail = (ROOT/'scripts/raw-ingest/migration_tail.sql').read_text()
tail = sub(tail, '    -- @@PARSED_UPSERT@@\n', parsed_upsert)

# Kept as source-controlled mapping for worker/tests, not a runtime generated schema.
(ROOT / 'server/parser-py/parsed_columns.json').write_text(__import__('json').dumps(list(columns), indent=2)+'\n')
(ROOT / 'supabase/migrations/202610210100_raw_json_ingest.sql').write_text(
    header + '\n' + helper + '\n' + user_changed + '\n' + v1 + '\n' + tail + '\n'
    + (ROOT/'scripts/raw-ingest/v2_rpc.sql').read_text() + '\ncommit;\n')
