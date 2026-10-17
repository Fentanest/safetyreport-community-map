\timing on
\echo OBJECTS
select octet_length(public.internal_analytics_read_snapshot('{"date_basis":"completed_date","start":"2019-01-01","end":"2026-10-17","category":"all"}'::jsonb,false)::text);
\echo COLUMNS
select octet_length(public.internal_analytics_read_snapshot('{"date_basis":"completed_date","start":"2019-01-01","end":"2026-10-17","category":"all"}'::jsonb,false,null,'{"fact_encoding":"columns-v1"}')::text);
