-- Preserve exact manifest generation increments while grouping bulk INSERT/DELETE by dataset.
-- UPDATE retains the original row-level key-transition rules, including upsert conflict updates.
-- No additional index or timeout. Statement triggers precede projection invalidation by name.
begin;

create or replace function private.community_facts_manifest_insert_batch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    insert into private.community_manifest_generations(contributor_id,dataset_key,generation)
    select contributor_id,dataset_key,count(*) from new_facts
     where public_state='completed'
     group by contributor_id,dataset_key order by contributor_id,dataset_key
    on conflict(contributor_id,dataset_key) do update
       set generation=private.community_manifest_generations.generation+excluded.generation;
    return null;
end;
$$;
create or replace function private.community_facts_manifest_delete_batch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    insert into private.community_manifest_generations(contributor_id,dataset_key,generation)
    select contributor_id,dataset_key,count(*) from old_facts
     where public_state='completed'
     group by contributor_id,dataset_key order by contributor_id,dataset_key
    on conflict(contributor_id,dataset_key) do update
       set generation=private.community_manifest_generations.generation+excluded.generation;
    return null;
end;
$$;
revoke all on function private.community_facts_manifest_insert_batch(), private.community_facts_manifest_delete_batch()
    from public,anon,authenticated;

drop trigger community_report_facts_manifest on private.community_report_facts;
create trigger community_report_facts_manifest after update on private.community_report_facts
for each row execute function private.community_facts_manifest_trigger();
create trigger community_report_facts_manifest_insert after insert on private.community_report_facts
referencing new table as new_facts for each statement execute function private.community_facts_manifest_insert_batch();
create trigger community_report_facts_manifest_delete after delete on private.community_report_facts
referencing old table as old_facts for each statement execute function private.community_facts_manifest_delete_batch();

commit;
