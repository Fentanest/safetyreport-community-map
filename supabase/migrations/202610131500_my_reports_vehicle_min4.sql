-- my-reports-v1: allow four-character vehicle substrings in search and numbers.
-- CREATE OR REPLACE preserves the existing owner and ACL; keep IMMUTABLE,
-- SECURITY INVOKER (default) and the empty search_path unchanged.
begin;

create or replace function private.my_reports_check_query(p_kind text, p_query text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text;
begin
    if p_kind = 'vehicle' then
        v := private.my_reports_norm_vehicle(p_query);
        if v is null or char_length(v) not between 4 and 64 then raise exception 'INVALID_QUERY'; end if;
    elsif p_kind = 'address' then
        v := private.my_reports_norm_address(p_query);
        if v is null or char_length(v) not between 5 and 200 then raise exception 'INVALID_QUERY'; end if;
    else
        raise exception 'INVALID_QUERY';
    end if;
    if v ~ '[\u0001-\u001f\u007f-\u009f]' then raise exception 'INVALID_QUERY'; end if;
    return v;
end;
$$;

commit;
