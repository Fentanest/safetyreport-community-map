load 'auto_explain';
set auto_explain.log_min_duration=0; set auto_explain.log_analyze=on; set auto_explain.log_nested_statements=on;
set auto_explain.log_timing=on; set auto_explain.log_level=notice; set auto_explain.log_format=text;
set client_min_messages=notice;
select length(private.analytics_screen_parts('{"date_basis":"completed_date","start":"2019-01-01","end":"2026-10-17","category":"all"}','00000000-0000-0000-0000-000000000000','[]','public')::text);
