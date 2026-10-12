-- Optional scheduling migration; run only after the operator verifies pg_cron is available/preloaded.
-- Host restart / shared_preload_libraries changes are deliberately NOT done by this migration.
begin;
create extension if not exists pg_cron;
select cron.schedule('screen-result-cache-v1','* * * * *',
 $$set statement_timeout='55s'; select private.screen_cache_maintain();$$);
commit;
