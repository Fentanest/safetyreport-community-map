-- Answer recency for representative election + scope-independent identity numbers
-- + agency-code/name consistency for keyless payloads (REVIEW3, 2026-09-28).
--
-- R1 (REVIEW3 신규-높음-1, REVIEW2 높음-2 부분): 대표는 '서버가 가장 나중에
-- 수신한 서로 다른 답변'이다. 기존 answer_first_seen = min(first_accepted_at)
-- 은 UPDATE 로 새 답변이 와도 first_accepted_at 이 그대로라 B의 옛 결과가
-- 대표로 남았다. 새 컬럼 answer_accepted_at(답변 수신 시각)을 둔다:
--   - INSERT: now()
--   - 실제 내용 변경(sha 바뀜): now()
--   - 동일 내용-no_change / stale_ignored / sha 같은 reshare(동의 갱신 등
--     grant 만 바뀜): 유지 → 단순 재전송·재공유가 대표를 뒤집지 않는다.
-- 대표 선출 순서: 그룹의 answer_time(max(answer_accepted_at)) DESC,
--   completed_date(답변일) DESC NULLS LAST, first_accepted_at ASC,
--   contributor_id ASC. 수신 시각이 1순위(서버가 관측한 사실 진행 순서로
--   단조·전체 순서), 답변일은 동시 수신 tie-break 로 문서화한다.
-- 기존 행은 answer_accepted_at = first_accepted_at 으로 백필한다(이 migration
-- 이전 이력의 대표 선정은 기존과 동일, 이후 갱신부터 정확).
--
-- R2 (REVIEW3 신규-중간-3): 번호 없는 관측의 report_identity 는 조회 범위와
-- 무관하게 확정한다. 기존 key_number 윈도 함수는 날짜·동의 필터가 끝난 행만
-- 봐서 같은 관측도 조회 기간에 따라 다른 identity 에 붙었다. 이제 키 번호는
-- 날짜 창 없이(동의 유효 행 전체 이력에서) 확정한다: 먼저 날짜 창 안의 키
-- 집합을 구하고(scoped), 그 키들의 번호를 전체 이력에서 구한다(key_numbers).
-- 동의 철회 행의 번호는 쓰지 않는다(공개 출력에 철회 자료를 반영하지 않음) —
-- 이 점만 조회(동의 상태)에 따라 달라질 수 있고 문서화한다.
--
-- R3 (REVIEW3 신규-중간-4, REVIEW2 높음-4 부분): 키 없는 payload(v1/v2)가
-- 기관명이 바뀐 새 답변을 보내면 옛 기관코드를 붙이지 않는다. 키가 없을 때
-- 기관명이 기존 fact 와 같으면 보존(같은 기관의 새 답변), 다르면 NULL(새
-- 기관 답변에 옛 코드 부착 금지). 키가 있으면(명시적 null 포함) 그대로 쓴다.
--
-- R4 (REVIEW3 신규-높음-2): resolver 양방향 해석(shared 스냅샷, 1815198 →
-- 같은 institution)으로 신규 수신 행은 자동 연결된다. 1500 이후에 들어와
-- 옛 키로 남은 행이 있으면 아래 백필이 같은 키로 묶는다(멱등).
--
-- No app contract change: projection JSON 키는 그대로(first_accepted_at 유지,
-- answer_accepted_at 는 내부용). Rollback: re-run 202609281500's functions,
-- then `alter table private.community_report_facts drop column answer_accepted_at`.
begin;
alter table private.community_report_facts
    add column answer_accepted_at timestamptz not null default now();
update private.community_report_facts set answer_accepted_at = first_accepted_at
 where answer_accepted_at is not distinct from first_accepted_at;
create or replace function public.internal_community_ingest(
    p_user uuid, p_session uuid, p_request_id text, p_envelope jsonb, p_events jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
    v_policy private.community_policies%rowtype;
    v_profile private.contributor_profiles%rowtype;
    v_grant private.community_consent_grants%rowtype;
    v_conn private.community_connections%rowtype;
    v_fact private.community_report_facts%rowtype;
    v_lock_key text;
    v_id jsonb;
    v_ready boolean;
    v_generated timestamptz;
    v_changed boolean := false;
    v_results jsonb := '[]'::jsonb;
    v_result text;
    v_receipt uuid;
    v_existing record;
    v_max_rev bigint := 0;
    v_version text;
    e jsonb;
    d jsonb;
    v_event_id uuid;
    v_epoch bigint;
    v_rev bigint;
    v_key text;
    v_keep_grant boolean;
    v_target_grant uuid;
    v_visible boolean;
    v_was_visible boolean;
    v_fence timestamptz;
    v_projection text;
begin
    if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) not between 1 and 20 then
        return jsonb_build_object('error', 'invalid_request');
    end if;
    -- One event per report per request (S-11-B): per-event ACKs then equal the committed state.
    if (select count(distinct x->>'source_report_key') from jsonb_array_elements(p_events) x) <> jsonb_array_length(p_events) then
        return jsonb_build_object('error', 'invalid_request');
    end if;
    v_policy := private.community_current_policy(true);
    select * into v_profile from private.contributor_profiles where user_id = p_user for share;
    if v_profile.user_id is null then return jsonb_build_object('error', 'consent_missing'); end if;
    if v_profile.status <> 'active' then return jsonb_build_object('error', 'contributor_suspended'); end if;
    v_id := private.community_identity_state(p_user, p_session);
    if not (v_id->>'user_ok')::boolean or not (v_id->>'kakao')::boolean then
        return jsonb_build_object('error', 'kakao_required');
    end if;
    if not (v_id->>'session')::boolean then return jsonb_build_object('error', 'session_revoked'); end if;
    select * into v_grant from private.community_consent_grants
     where grant_id = (p_envelope->>'consent_grant_id')::uuid and user_id = p_user for share;
    if v_grant.grant_id is null then return jsonb_build_object('error', 'consent_grant_unknown'); end if;
    if v_grant.revoked_at is not null then return jsonb_build_object('error', 'consent_revoked'); end if;
    if not private.community_grant_is_current(v_grant, v_policy) then return jsonb_build_object('error', 'consent_outdated'); end if;
    -- FOR UPDATE (not SHARE): this transaction later raises last_accepted_revision, and a shared lock held by a
    -- parallel ingest of the same connection would deadlock with it (S-09-R). Same-connection ingests serialize.
    select * into v_conn from private.community_connections
     where connection_id = (p_envelope->>'connection_id')::uuid and user_id = p_user for update;
    if v_conn.connection_id is null then return jsonb_build_object('error', 'connection_unknown'); end if;
    if v_conn.status = 'superseded' then return jsonb_build_object('error', 'writer_superseded'); end if;
    if v_conn.status <> 'active' then return jsonb_build_object('error', 'connection_' || v_conn.status); end if;
    if v_conn.bound_session_id <> p_session then return jsonb_build_object('error', 'connection_session_mismatch'); end if;
    if v_conn.source_app <> p_envelope->>'source_app' or v_conn.source_mode <> p_envelope->>'source_mode' then
        return jsonb_build_object('error', 'connection_mode_mismatch');
    end if;
    select fenced_at into v_fence from private.community_deletion_fences where contributor_id = p_user;
    select ready, generated_at into v_ready, v_generated from private.analytics_state where singleton;

    -- A batch can contain many reports. Acquire every report lock in a stable order before any fact row lock.
    for v_lock_key in select distinct x->>'source_report_key' from jsonb_array_elements(p_events) x
                      order by 1 loop
        perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 913784));
    end loop;

    for e in select * from jsonb_array_elements(p_events) loop
        v_event_id := (e->>'event_id')::uuid;
        v_epoch := (e->>'writer_epoch')::bigint;
        v_rev := (e->>'source_revision')::bigint;
        v_key := e->>'source_report_key';
        d := e->'derived';
        if v_epoch <> v_conn.writer_epoch then
            v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', 'rejected', 'durable', false,
                'receipt_id', null, 'projection_status', 'not_applicable',
                'error', jsonb_build_object('code', 'writer_epoch_mismatch', 'retryable', false));
            continue;
        end if;
        if exists (select 1 from private.community_fact_tombstones t
                    where t.contributor_id = p_user and t.source_report_key = v_key)
           or (v_fence is not null and (e->>'captured_at')::timestamptz <= v_fence) then
            v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', 'rejected', 'durable', false,
                'receipt_id', null, 'projection_status', 'not_applicable',
                'error', jsonb_build_object('code', 'deleted', 'retryable', false));
            continue;
        end if;
        insert into private.community_ingest_events(contributor_id, event_id, request_id, connection_id, consent_grant_id,
            dataset_key, writer_epoch, source_system, source_report_key, source_report_id, source_revision, event_type,
            trigger, payload, payload_sha256, captured_at, quarantine_reason, report_number)
        values (p_user, v_event_id, p_request_id, v_conn.connection_id, v_grant.grant_id, v_conn.dataset_key, v_epoch,
            'safetyreport', v_key, e->>'source_report_id', v_rev, e->>'event_type', p_envelope->>'trigger',
            e->'payload', e->>'payload_sha256', (e->>'captured_at')::timestamptz, e->>'quarantine_reason', e->>'report_number')
        on conflict (contributor_id, event_id) do nothing
        returning receipt_id into v_receipt;
        if v_receipt is null then
            -- Immutable event fields (contract): event_type, source_report_id/key, source_revision, writer_epoch,
            -- captured_at, payload_sha256 and the connection's dataset. Grant/connection/trigger/request are transport
            -- context and may legitimately differ on a retry after rebind or policy re-consent.
            select receipt_id, payload_sha256, result, rejection_reason, dataset_key, source_report_key, source_report_id, source_revision,
                   writer_epoch, event_type, captured_at, report_number
              into v_existing from private.community_ingest_events where contributor_id = p_user and event_id = v_event_id;
            if v_existing.payload_sha256 = e->>'payload_sha256' and v_existing.dataset_key = v_conn.dataset_key
               and v_existing.source_report_key = v_key and v_existing.source_report_id = e->>'source_report_id'
               and v_existing.source_revision = v_rev and v_existing.writer_epoch = v_epoch
               and v_existing.event_type = e->>'event_type' and v_existing.captured_at = (e->>'captured_at')::timestamptz
               and v_existing.report_number is not distinct from e->>'report_number' then
                if v_existing.result = 'rejected' then
                    v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', 'rejected', 'durable', false,
                        'receipt_id', null, 'projection_status', 'not_applicable',
                        'error', jsonb_build_object('code', v_existing.rejection_reason, 'retryable', false));
                else
                    v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', 'duplicate', 'durable', true,
                        'receipt_id', v_existing.receipt_id, 'original_status', v_existing.result, 'projection_status', 'not_applicable');
                end if;
            else
                v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', 'conflict', 'durable', false,
                    'receipt_id', null, 'projection_status', 'not_applicable',
                    'error', jsonb_build_object('code', 'event_id_conflict', 'retryable', false));
            end if;
            continue;
        end if;
        -- 2026-09-28: only final-answer observations are stored. A non-eligible payload or a legacy
        -- status_correction event is rejected per event (durable=false) so the rest of the batch still
        -- processes. The central fact keeps its last answered state.
        if (e->'payload'->>'status') not in ('accepted','partial','rejected','completed_unknown')
           or e->>'event_type' = 'status_correction' then
            update private.community_ingest_events set result = 'rejected', rejection_reason = 'non_final_not_accepted'
             where receipt_id = v_receipt;
            v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', 'rejected',
                'durable', false, 'receipt_id', null, 'projection_status', 'not_applicable',
                'error', jsonb_build_object('code', 'non_final_not_accepted', 'retryable', false));
            continue;
        end if;
        if e->>'quarantine_reason' is not null then
            update private.community_ingest_events set result = 'quarantined' where receipt_id = v_receipt;
            v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', 'quarantined', 'durable', true,
                'receipt_id', v_receipt, 'projection_status', 'not_applicable');
            continue;
        end if;
        -- Sol 2026-09-28: last_accepted_revision advances only for events that reach fact processing.
        -- Rejected (non-final etc.) or quarantined events must not inflate the app's next-revision lower bound.
        v_max_rev := greatest(v_max_rev, v_rev);
        select * into v_fact from private.community_report_facts
         where contributor_id = p_user and dataset_key = v_conn.dataset_key and source_report_key = v_key for update;
        v_was_visible := v_fact.contributor_id is not null and private.community_fact_publicly_listed(v_fact);
        -- 2026-09-28 account rule: another account's fact for the same identity is left alone; this
        -- event creates (or updates) only the uploader's own contribution row. The public projection
        -- elects one representative per identity (see internal_analytics_v2_facts below).
        if v_fact.contributor_id is null then
            insert into private.community_report_facts(contributor_id, dataset_key, source_report_key, source_report_id,
                latest_receipt_id, consent_grant_id, writer_epoch, source_revision, payload_sha256, report_number, public_state,
                report_date, completed_date, category, status, disposition, amount_kind, amount_confirmed_won, penalty_points,
                vehicle_raw, lat, lng, lat_text, lng_text, coord_source, address, region_code, point_key, agency_key,
                agency_name, agency_current_name, manager_key, manager_name, violation_law, source_agency_code,
                answer_accepted_at)
            values (p_user, v_conn.dataset_key, v_key, e->>'source_report_id', v_receipt, v_grant.grant_id, v_epoch, v_rev,
                e->>'payload_sha256', e->>'report_number', d->>'public_state', (d->>'report_date')::date, (d->>'completed_date')::date,
                d->>'category', d->>'status', d->>'disposition', d->>'amount_kind', (d->>'amount_confirmed_won')::bigint,
                (d->>'penalty_points')::integer, d->>'vehicle_raw', (d->>'lat')::double precision,
                (d->>'lng')::double precision, d->>'lat_text', d->>'lng_text', d->>'coord_source', d->>'address',
                d->>'region_code', d->>'point_key', d->>'agency_key', d->>'agency_name', d->>'agency_current_name',
                d->>'manager_key', d->>'manager_name',
                d->>'violation_law', d->>'source_agency_code',
                now());
            v_result := 'accepted';
        elsif (v_epoch, v_rev) > (v_fact.writer_epoch, v_fact.source_revision) then
            -- A fact accepted under a lineage the USER revoked stays under that (hidden) grant unless this event is an
            -- explicit reshare; policy-version supersession keeps the lineage active, so it re-attributes normally.
            v_keep_grant := v_fact.consent_grant_id <> v_grant.grant_id and e->>'event_type' <> 'reshare'
                            and not private.community_lineage_active(v_fact.consent_grant_id);
            v_target_grant := case when v_keep_grant then v_fact.consent_grant_id else v_grant.grant_id end;
            if v_fact.payload_sha256 = e->>'payload_sha256' and v_fact.consent_grant_id = v_target_grant then
                update private.community_report_facts set writer_epoch = v_epoch, source_revision = v_rev,
                    latest_receipt_id = v_receipt, report_number = coalesce(e->>'report_number', v_fact.report_number), updated_at = now()
                 where contributor_id = p_user and dataset_key = v_conn.dataset_key and source_report_key = v_key;
                v_result := 'no_change';
            else
                update private.community_report_facts set latest_receipt_id = v_receipt, consent_grant_id = v_target_grant,
                    writer_epoch = v_epoch, source_revision = v_rev, payload_sha256 = e->>'payload_sha256',
                    report_number = coalesce(e->>'report_number', v_fact.report_number),
                    public_state = d->>'public_state', report_date = (d->>'report_date')::date,
                    completed_date = (d->>'completed_date')::date, category = d->>'category', status = d->>'status',
                    disposition = d->>'disposition', amount_kind = d->>'amount_kind',
                    amount_confirmed_won = (d->>'amount_confirmed_won')::bigint, penalty_points = (d->>'penalty_points')::integer,
                    vehicle_raw = d->>'vehicle_raw', lat = (d->>'lat')::double precision, lng = (d->>'lng')::double precision,
                    lat_text = d->>'lat_text', lng_text = d->>'lng_text', coord_source = d->>'coord_source',
                    address = d->>'address', region_code = d->>'region_code', point_key = d->>'point_key',
                    agency_key = d->>'agency_key', agency_name = d->>'agency_name',
                    agency_current_name = d->>'agency_current_name',
                    manager_key = d->>'manager_key',
                    manager_name = d->>'manager_name', violation_law = d->>'violation_law',
                    -- REVIEW3 R3: v1/v2 payload 에는 source_agency_code 키가 없다.
                    -- 키가 있을 때만(명시적 NULL 포함) 쓰고, 키가 없을 때는 기관명이
                    -- 같으면 보존(같은 기관의 새 답변), 다르면 NULL(새 기관 답변에
                    -- 옛 코드를 붙이지 않는다).
                    source_agency_code = case when (e->'payload') ? 'source_agency_code'
                                              then d->>'source_agency_code'
                                              when d->>'agency_name' is not distinct from v_fact.agency_name
                                              then v_fact.source_agency_code
                                              else null end,
                    -- REVIEW3 R1: 대표 선출용 답변 수신 시각. 내용이 실제로 바뀔
                    -- 때만 갱신한다(grant 만 바뀌는 reshare·no_change 는 유지).
                    answer_accepted_at = case when v_fact.payload_sha256 is not distinct from e->>'payload_sha256'
                                              then v_fact.answer_accepted_at else now() end,
                    updated_at = now()
                 where contributor_id = p_user and dataset_key = v_conn.dataset_key and source_report_key = v_key;
                v_result := 'accepted';
            end if;
        else
            v_result := 'stale_ignored';
        end if;
        update private.community_ingest_events set result = v_result where receipt_id = v_receipt;
        if v_result = 'accepted' then v_changed := true; end if;
        select private.community_fact_publicly_listed(f) into v_visible from private.community_report_facts f
         where f.contributor_id = p_user and f.dataset_key = v_conn.dataset_key and f.source_report_key = v_key;
        -- published: after commit the anonymous API lists the fact; removed: it was listed and no longer is;
        -- held: listable but projection not live (ready=false / generated_at null) or its consent lineage is revoked;
        -- not_public: stored but never listed (not completed, or no report/completion date).
        v_projection := case
            when v_result <> 'accepted' then 'not_applicable'
            when coalesce(v_visible, false) and coalesce(v_ready, false) and v_generated is not null then 'published'
            when coalesce(v_was_visible, false) and not coalesce(v_visible, false) and coalesce(v_ready, false) then 'removed'
            when coalesce(v_visible, false) then 'held'
            when (select f.public_state = 'completed' and (f.report_date is not null or f.completed_date is not null)
                    from private.community_report_facts f
                   where f.contributor_id = p_user and f.dataset_key = v_conn.dataset_key and f.source_report_key = v_key)
                 then 'held'
            else 'not_public' end;
        v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', v_result, 'durable', true,
            'receipt_id', v_receipt, 'projection_status', v_projection);
    end loop;

    if v_max_rev > v_conn.last_accepted_revision then
        update private.community_connections set last_accepted_revision = v_max_rev where connection_id = v_conn.connection_id;
    end if;
    select dataset_version into v_version from private.analytics_state where singleton;
    return jsonb_build_object('results', v_results, 'dataset_version', v_version);
end;
$$;

revoke all on function public.internal_community_ingest(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.internal_community_ingest(uuid, uuid, text, jsonb, jsonb) to service_role;


-- 2) Public fact projection: report_identity isolation (H1) + elect-then-filter representative (H2/R1)
-- + scope-independent identity numbers (R2).
create or replace function public.internal_analytics_v2_facts(
    p_start date, p_end date, p_category text, p_region_code text,
    p_agency_key text, p_manager_key text, p_bbox double precision[]
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_previous_start date;
    v_rows jsonb;
    v_count integer;
begin
    if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 1826 or
       p_category is null or p_category not in ('all','traffic','parking','other') or
       (p_bbox is not null and (array_length(p_bbox,1) <> 4 or p_bbox[1] > p_bbox[3] or p_bbox[2] > p_bbox[4])) then
        raise exception 'INVALID_QUERY';
    end if;
    perform set_config('statement_timeout', '8000', true);
    v_previous_start := p_start - (p_end - p_start + 1);
    with scoped as (
        select f.*,
               -- the lineage's CURRENT grant decides: consenting to a disclosing version covers facts sent under
               -- the earlier version of the same lineage (the 2026-09-28.1 text says so); an older consent alone never does
               exists(select 1 from private.community_consent_grants g0
                        join private.community_consent_grants g on g.lineage_id = g0.lineage_id and g.revoked_at is null
                        join private.community_policy_disclosures d on d.version = g.policy_version and d.amounts_public
                       where g0.grant_id = f.consent_grant_id) as amount_public,
               -- the same rule for the violation law (위반법규): only a lineage whose current grant's policy lists it
               -- as published (2026-09-28.2 text: '위반법규' row) exposes it; otherwise it leaves the database as null
               exists(select 1 from private.community_consent_grants g0
                        join private.community_consent_grants g on g.lineage_id = g0.lineage_id and g.revoked_at is null
                        join private.community_policy_disclosures d on d.version = g.policy_version and d.violation_law_public
                       where g0.grant_id = f.consent_grant_id) as law_public
          from private.community_report_facts f
          join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
         where f.public_state = 'completed'
           and private.community_lineage_active(f.consent_grant_id)
           and (f.report_date between v_previous_start and p_end or f.completed_date between v_previous_start and p_end)
         limit 100001
    ),
    -- R2: the number a key was first seen with, fixed over the consent-active
    -- full history (no date window), so a numberless observation joins the same
    -- report_identity whatever period is queried. Only keys inside the queried
    -- window are numbered here, so widening the window never renumbers a key.
    key_numbers as (
        select distinct on (f.source_report_key) f.source_report_key,
               f.report_number as key_number
          from private.community_report_facts f
          join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
         where f.public_state = 'completed'
           and private.community_lineage_active(f.consent_grant_id)
           and f.source_report_key in (select s.source_report_key from scoped s)
         order by f.source_report_key, (f.report_number is null), f.first_accepted_at, f.contributor_id
    ),
    identified as (
        select s.*,
               k.key_number,
               -- H1: both numbers present and different -> separate identities;
               -- a missing number joins the key's first numbered group, else the legacy group.
               (s.source_report_key || '|' || coalesce(s.report_number, k.key_number, 'legacy')) as report_identity,
               -- R1: the latest DISTINCT answer wins: the answer group adopted
               -- most recently (same answer re-sent does not move it, because
               -- no_change/stale/grant-only reshare keep answer_accepted_at).
               max(s.answer_accepted_at) over (
                   partition by s.source_report_key, coalesce(s.report_number, k.key_number, 'legacy'), s.payload_sha256
               ) as answer_time
          from scoped s
          join key_numbers k using (source_report_key)
    ),
    ranked as (
        select i.*,
               -- R1: the representative is elected per identity BEFORE scope filters (see final select).
               -- Order: latest adopted answer first, then the newer official
               -- answer date (completed_date), then earliest contributor.
               row_number() over (partition by i.report_identity
                                  order by i.answer_time desc, i.completed_date desc nulls last,
                                           i.first_accepted_at, i.contributor_id) = 1
                   as is_representative,
               count(*) over (partition by i.report_identity) as contribution_count
          from identified i
    )
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
        'fact_identity', dataset_key || ':' || source_report_key, 'contributor_id', contributor_id,
        'report_identity', report_identity, 'report_number', report_number,
        'source_report_key', source_report_key, 'first_accepted_at', first_accepted_at,
        'snapshot_id', 'ingest-v1', 'snapshot_generation', 1,
        'report_date', report_date, 'completed_date', completed_date,
        'category', category, 'status', status, 'disposition', disposition,
        'vehicle_raw', vehicle_raw, 'point_key', point_key, 'lat', lat, 'lng', lng,
        'address', address, 'region_code', region_code,
        'agency_key', agency_key, 'agency_name', agency_name,
        'agency_current_name', agency_current_name,
        'manager_key', manager_key, 'manager_name', manager_name,
        'is_representative', is_representative, 'contribution_count', contribution_count,
        'amount_kind', amount_kind,
        'amount_confirmed_won', case when amount_public then amount_confirmed_won else null end,
        'amount_public', amount_public,
        -- whether the answer stated an amount at all (existence only, never the value) — keeps 'not stated' apart from 'not published'
        'amount_stated', amount_confirmed_won is not null,
        -- 위반법규 (observation-v2): exact text for the law filter and the per-law table; null = 법규 미상
        -- (v1 payload, not extracted, or the lineage's policy does not publish it)
        'violation_law', case when law_public then violation_law else null end
    )), '[]'::jsonb) into v_count, v_rows from ranked
     where (p_category = 'all' or category = p_category)
       and (p_region_code is null or region_code = p_region_code)
       and (p_agency_key is null or agency_key = p_agency_key)
       and (p_manager_key is null or manager_key = p_manager_key)
       and (p_bbox is null or (lat is not null and lng between p_bbox[1] and p_bbox[3] and lat between p_bbox[2] and p_bbox[4]));
    if v_count > 100000 then raise exception 'AGGREGATE_NOT_READY'; end if;
    return v_rows;
end;
$$;

revoke all on function public.internal_analytics_v2_facts(date, date, text, text, text, text, double precision[]) from public, anon, authenticated;
grant execute on function public.internal_analytics_v2_facts(date, date, text, text, text, text, double precision[]) to service_role;

-- 3) Backfill the one verified 1:1 link (registry seed 2026-09-28.1:
-- 1812314 광주광역시경찰청 → 1815198 광주경찰청, institution ag-gwangju-police-hq)
-- so pre-migration facts join the same institution key without waiting for
-- re-observation. Idempotent re-run of the 1500 backfill: catches rows that
-- arrived with the old key between 1500 and this migration. manager_key
-- follows the same rule as deriveFact (m1:sha256(agency_key|NFC(manager_name))[:24]).
-- first_accepted_at and answer_accepted_at are untouched, so representative
-- election does not move.
update private.community_report_facts
   set agency_key = 'inst:ag-gwangju-police-hq',
       agency_current_name = '광주경찰청',
       manager_key = case when manager_name is null then manager_key
                          else 'm1:' || substring(encode(extensions.digest('inst:ag-gwangju-police-hq' || '|' || manager_name, 'sha256'), 'hex'), 1, 24) end,
       updated_at = now()
 where source_agency_code in ('1812314', '1815198')
   and (agency_key is distinct from 'inst:ag-gwangju-police-hq'
        or agency_current_name is distinct from '광주경찰청');

commit;
