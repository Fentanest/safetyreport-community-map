-- Agency registry 2026-09-29: derived-value recompute path (additive, idempotent).
--
-- Stored facts keep their source columns (source_agency_code, agency_name, manager_name)
-- untouched; only the derived projection (agency_key, agency_current_name, manager_key)
-- is refreshed when the registry changes, without re-upload and without touching
-- counts, identities, answers, or consent rows (handoff §5/§9).
--
-- 1) private.community_report_facts.agency_registry_version (nullable TEXT):
--    the registry version the stored derived values were computed with.
--    Backfilled to '2026-09-28.1' (the seed-only snapshot every existing row was
--    derived with). NULL after this migration means "not yet stamped".
-- 2) private.community_registry_state singleton (one row): the authoritative
--    server registry version. A BEFORE trigger stamps every fact write with it,
--    so new ingests and recompute updates always carry the current version even
--    though internal_community_ingest itself is untouched.
-- 3) Recompute itself runs OUTSIDE SQL in scripts/recompute-agency-keys.mjs
--    (same deriveFact code as the edge): it selects rows whose version is stale,
--    recomputes the derived triple locally, and updates only those three columns
--    (+ the version stamp). Content-identical rows are a no-op. Run it after
--    deploying the edge bundle that carries the new snapshot (receiver first).
--
-- Rollback: drop trigger/function/table/column (order below), facts keep values.
begin;
alter table private.community_report_facts
    add column agency_registry_version text;

create table private.community_registry_state (
    id integer primary key default 1 check (id = 1),
    version text not null,
    updated_at timestamptz not null default now()
);
insert into private.community_registry_state(version) values ('2026-09-29.1');

update private.community_report_facts
    set agency_registry_version = '2026-09-28.1'
    where agency_registry_version is null;

create or replace function private.community_stamp_registry_version()
returns trigger language plpgsql set search_path = '' as $$
begin
    NEW.agency_registry_version := (select version from private.community_registry_state);
    return NEW;
end;
$$;

drop trigger if exists community_report_facts_registry_version on private.community_report_facts;
create trigger community_report_facts_registry_version
    before insert or update on private.community_report_facts
    for each row execute function private.community_stamp_registry_version();
commit;
