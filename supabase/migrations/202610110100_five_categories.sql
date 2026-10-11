-- 신고 분류 5분류(2026-10-11, observation-v5): traffic·parking·safety·living·other.
-- 수집 앱은 안전신문고 분류 코드(SSNPC)로 category 를 정한다(contracts/report-categories.json). 예전 3분류의 other 에 있던
-- 안전신고·생활불편이 safety·living 으로 나뉜다. 이미 올라간 other 행은 그대로 두고, 업데이트된 앱이 1회 초기화 크롤링
-- (source-rebuild-2026-10-11.1)으로 다시 올리면 새 분류로 바뀐다.
--
-- 함수가 20여 개 migration 에 걸쳐 여러 번 다시 정의돼 있어 손으로 옮기면 빠뜨리기 쉽다. 그래서 **지금 DB 에 있는 정의**를
-- 읽어 3분류 목록만 5분류로 바꿔 다시 만든다(같은 트랜잭션). 끝에 남은 3분류 목록이 없음을 확인하고, 있으면 실패해 되돌린다.

begin;

do $migration$
declare
    fn record;
    con record;
    def text;
    new_def text;
    changed_functions int := 0;
    changed_constraints int := 0;
begin
    -- 1) 함수: 소스의 ’traffic’,’parking’,’other’ 목록(공백 허용) → 5분류, my_reports_stats 의 분류별 건수에 safety·living 추가
    for fn in
        select p.oid, n.nspname, p.proname
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private')
          and p.prokind in ('f', 'p')
          and (p.prosrc ~ $re$'traffic'\s*,\s*'parking'\s*,\s*'other'$re$
               or p.prosrc ~ $re$'other',\s*count\(\*\)\s*filter\s*\(where category = 'other'\)$re$)
    loop
        def := pg_get_functiondef(fn.oid);
        new_def := regexp_replace(def, $re$'traffic'(\s*),(\s*)'parking'(\s*),(\s*)'other'$re$,
                                  $rep$'traffic',\2'parking',\4'safety',\4'living',\4'other'$rep$, 'g');
        new_def := regexp_replace(new_def,
            $re$'other',(\s*)count\(\*\)(\s*)filter(\s*)\(where category = 'other'\)$re$,
            $rep$'safety', count(*) filter (where category = 'safety'), 'living', count(*) filter (where category = 'living'), 'other',\1count(*)\2filter\3(where category = 'other')$rep$, 'g');
        if new_def <> def then
            execute new_def;
            changed_functions := changed_functions + 1;
            raise notice '5분류 함수 갱신: %.%', fn.nspname, fn.proname;
        end if;
    end loop;

    -- 2) CHECK 제약: Postgres 가 저장한 형태(’traffic’::text, ’parking’::text, ’other’::text)
    for con in
        select c.oid, c.conname, c.conrelid::regclass as rel, pg_get_constraintdef(c.oid) as condef
        from pg_constraint c join pg_namespace n on n.oid = c.connamespace
        where c.contype = 'c' and n.nspname in ('public', 'private')
          and pg_get_constraintdef(c.oid) ~ $re$'traffic'::text,\s*'parking'::text,\s*'other'::text$re$
    loop
        new_def := regexp_replace(con.condef, $re$'traffic'::text,(\s*)'parking'::text,(\s*)'other'::text$re$,
                                  $rep$'traffic'::text,\1'parking'::text,\2'safety'::text,\2'living'::text,\2'other'::text$rep$, 'g');
        execute format('alter table %s drop constraint %I', con.rel, con.conname);
        execute format('alter table %s add constraint %I %s', con.rel, con.conname, new_def);
        changed_constraints := changed_constraints + 1;
        raise notice '5분류 제약 갱신: %.%', con.rel, con.conname;
    end loop;

    -- 3) 확인: 3분류 목록이 남아 있으면 실패(되돌림)
    if exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private')
          and p.prosrc ~ $re$'traffic'\s*,\s*'parking'\s*,\s*'other'$re$
    ) or exists (
        select 1 from pg_constraint c join pg_namespace n on n.oid = c.connamespace
        where c.contype = 'c' and n.nspname in ('public', 'private')
          and pg_get_constraintdef(c.oid) ~ $re$'traffic'::text,\s*'parking'::text,\s*'other'::text$re$
    ) then
        raise exception '5분류 전환 뒤에도 3분류 목록이 남았습니다';
    end if;
    if changed_functions = 0 or changed_constraints = 0 then
        raise exception '5분류 전환 대상이 없습니다(함수 %, 제약 %) — 스키마가 예상과 다릅니다', changed_functions, changed_constraints;
    end if;
    raise notice '5분류 전환: 함수 %개, 제약 %개', changed_functions, changed_constraints;
end
$migration$;

commit;
