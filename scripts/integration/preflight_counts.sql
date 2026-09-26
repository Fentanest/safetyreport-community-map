-- READ-ONLY preflight for the community-ingest rollout (operator runs it on the target project BEFORE applying
-- auth 202609260100 / map 202609260200). Writes nothing; missing tables are reported, never queried.
-- Output (NOTICE lines) selects the row in docs/integration/community-ingest/deployment-and-rollback.md §2.
begin read only;
do $$
declare
    t text;
    n bigint;
    p bigint;
begin
    foreach t in array array['private.upload_snapshots', 'private.report_facts_v2', 'private.analytics_state',
        'private.community_auth_requests', 'private.community_consent_grants', 'private.community_report_facts'] loop
        raise notice 'table % present=%', t, to_regclass(t) is not null;
    end loop;
    if to_regclass('private.upload_snapshots') is not null then
        for t, n in execute 'select state, count(*) from private.upload_snapshots group by state order by state' loop
            raise notice 'upload_snapshots state=% rows=%', t, n;
        end loop;
    end if;
    if to_regclass('private.report_facts_v2') is not null and to_regclass('private.upload_snapshots') is not null then
        execute 'select count(*), count(*) filter (where s.state = ''active'') from private.report_facts_v2 f
                 left join private.upload_snapshots s on s.id = f.snapshot_id' into n, p;
        raise notice 'v2_facts_total=% v2_facts_public=% (public > 0 blocks 202609260200)', n, p;
    else
        raise notice 'v2 facts: table absent (map v2 not applied) — guard passes';
    end if;
    if to_regclass('private.analytics_state') is not null then
        execute 'select count(*) filter (where ready) from private.analytics_state' into n;
        raise notice 'analytics_state ready_rows=%', n;
    end if;
end $$;
rollback;
