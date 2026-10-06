-- PostgREST connects as authenticator (statement_timeout=8s) and applies the settings of the impersonated role.
-- service_role had none, so service RPCs inherited 8 s. The screen RPC plus the PostgREST json_agg(...)->0
-- re-parse of the ~20 MB facts payload measured 3.5-8.9 s on production and was intermittently cancelled
-- (503 AGGREGATE_NOT_READY). Give only service_role a 30 s ceiling; anon/authenticated keep 3 s/8 s.
-- The client request deadline is separate (src/data/requestDeadline.ts). Rollback: alter role service_role reset statement_timeout.
alter role service_role set statement_timeout = '30s';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
