// 202610131000_motorcycle_plate.sql 배포 경로 검증(메모리 PostgreSQL, PGlite). 실행: npm run test:sql
// (a) 운영과 같은 경로: 폐기된 202610061200_ingest_precompute 객체(screen_observations·screen_precompute_lock)가 없다.
// (b) 그 객체가 있는 배포. (c) 한쪽만 있는 알 수 없는 상태는 중단·롤백.
// 사전 상태는 202610060900(옛 가림)·202610130100 함수 정의를 실제 파일에서 읽어 만들고, 함수 소유자를 따로 둬
// owner·ACL·search_path·SECURITY DEFINER 보존을 확인한다. 합성 객체만 쓰며 운영 DB에 접속하지 않는다.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../..', import.meta.url)));
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync('supabase/migrations/202610131000_motorcycle_plate.sql', 'utf8');
const m060900 = readFileSync('supabase/migrations/202610060900_screen_server_aggregate.sql', 'utf8');
const m130100 = readFileSync('supabase/migrations/202610130100_screen_plate_normalization.sql', 'utf8');
const masking = JSON.parse(readFileSync('contracts/masking-vectors.json', 'utf8'));
const PLATE_FNS = ['screen_normalize_plate(text)', 'screen_plate_strict(text)', 'screen_plate(text)', 'screen_mask_plate(text)'];

async function makeDb(mode) {
  const db = new PGlite();
  await db.exec(`create schema private;
    create role anon; create role authenticated; create role service_role; create role fn_owner;
    create table private.screen_cache_epoch(singleton boolean primary key,revision bigint); insert into private.screen_cache_epoch values(true,0);
    create table private.analytics_state(singleton boolean primary key,revision bigint); insert into private.analytics_state values(true,0);
    create function private.community_bump_projection() returns void language plpgsql security definer set search_path='' as $$ begin
     update private.analytics_state set revision=revision+1; end $$;`);
  // 202610060900의 공개 가림·정규화(운영의 옛 정의)와 그 파일의 권한 그대로
  for (const name of ['screen_plate(raw text)', 'screen_mask_plate(t text)']) {
    const re = new RegExp(`create function private\\.${name.replace(/[()]/g, '\\$&')}[\\s\\S]*?end \\$\\$;`);
    await db.exec(m060900.match(re)[0]);
  }
  await db.exec(`revoke all on function private.screen_plate(text),private.screen_mask_plate(text) from public,anon,authenticated;
    grant execute on function private.screen_plate(text),private.screen_mask_plate(text) to postgres;`);
  await db.exec(m130100);
  for (const fn of PLATE_FNS) await db.exec(`alter function private.${fn} owner to fn_owner`);
  if (mode === 'precompute' || mode === 'partial') {
    await db.exec(`create table private.screen_observations(contributor_id text,dataset_key text,source_report_key text,
      vehicle_raw text,plate text,plate_mask text,primary key(contributor_id,dataset_key,source_report_key));`);
    for (const [i, c] of masking.entries()) await db.query(
      `insert into private.screen_observations values('fixture','fixture',$1,$2,private.screen_plate($2),
       case when private.screen_plate($2) is null then '번호 확인 불가' else private.screen_mask_plate(private.screen_plate($2)) end)`,
      [String(i), c.input]);
  }
  if (mode === 'precompute') {
    await db.exec(`create table private.screen_precompute_control(singleton boolean primary key,epoch bigint);
      insert into private.screen_precompute_control values(true,0);
      create function private.screen_precompute_lock() returns void language plpgsql security definer set search_path='' as $$ begin
       perform singleton from private.analytics_state where singleton for update;
       update private.screen_precompute_control set epoch=epoch+1 where singleton; end $$;
      grant usage on schema private to fn_owner; grant all on all tables in schema private to fn_owner;
      alter function private.screen_precompute_lock() owner to fn_owner;
      revoke all on function private.screen_precompute_lock() from public;`);
  }
  return db;
}

async function meta(db) {
  const { rows } = await db.query(`select p.oid::regprocedure::text as sig, pg_get_userbyid(p.proowner) as owner, p.prosecdef,
    coalesce(array_to_string(p.proconfig, ','), '') as config, p.provolatile,
    coalesce((select string_agg(coalesce(nullif(pg_get_userbyid(a.grantee),''),'PUBLIC')||':'||a.privilege_type, ',' order by 1)
      from aclexplode(p.proacl) a where a.grantee <> p.proowner), '') as acl
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in ('screen_normalize_plate','screen_plate_strict','screen_plate','screen_mask_plate','screen_precompute_lock')
    order by 1`);
  return Object.fromEntries(rows.map((r) => [r.sig, r]));
}
const one = async (db, sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
const masked = (db, raw) => one(db, 'select private.screen_mask_plate(private.screen_plate($1))', [raw]);

const result = {};
for (const mode of ['no_precompute', 'precompute']) {
  const db = await makeDb(mode);
  assert.equal(await masked(db, '123가4567'), '1*3*4*67', `${mode}: 사전 상태는 옛 가림`);
  const before = await meta(db);
  const epoch0 = await one(db, 'select revision from private.screen_cache_epoch');
  const state0 = await one(db, 'select revision from private.analytics_state');
  await db.exec(migration);
  await db.exec(migration); // 재적용도 성공
  const after = await meta(db);
  for (const fn of PLATE_FNS) {
    const sig = `private.${fn}`;
    assert.ok(after[sig], `${mode}: ${sig} 존재`);
    assert.equal(after[sig].owner, 'fn_owner', `${mode}: ${sig} owner 보존`);
    assert.equal(after[sig].prosecdef, false, `${mode}: ${sig} SECURITY INVOKER`);
    assert.equal(after[sig].config, 'search_path=""', `${mode}: ${sig} search_path`);
    assert.equal(after[sig].provolatile, 'i', `${mode}: ${sig} immutable`);
    if (before[sig]) {
      assert.equal(after[sig].prosecdef, before[sig].prosecdef);
      assert.equal(after[sig].config, before[sig].config);
      // 기존 권한은 그대로 남고, 파일이 정한 service_role 실행 권한만 더해진다.
      for (const grant of before[sig].acl.split(',').filter(Boolean)) assert.ok(after[sig].acl.split(',').includes(grant), `${mode}: ${sig} ${grant} 보존`);
    }
    for (const role of ['anon', 'authenticated']) {
      assert.equal(await one(db, `select has_function_privilege('${role}','${sig}','execute')`), false, `${mode}: ${sig} ${role} 실행 불가`);
    }
    assert.equal(await one(db, `select has_function_privilege('service_role','${sig}','execute')`), true);
  }
  for (const c of masking) assert.equal(await masked(db, c.input), c.output, `${mode}: ${c.input} 새 가림`);
  assert.equal(await masked(db, '123가4567'), '1*3가*5*7');
  assert.equal(await one(db, 'select revision from private.screen_cache_epoch'), epoch0 + 2, `${mode}: 캐시 epoch 무효화`);
  assert.equal(await one(db, 'select revision from private.analytics_state'), state0 + 2, `${mode}: projection 무효화`);
  if (mode === 'no_precompute') {
    assert.equal(await one(db, "select to_regclass('private.screen_observations')::text"), null, '폐기 객체를 만들지 않는다');
    assert.equal(await one(db, "select to_regprocedure('private.screen_precompute_lock()')::text"), null);
  } else {
    assert.deepEqual(after['private.screen_precompute_lock()'], before['private.screen_precompute_lock()'], '잠금 함수 owner·ACL·DEFINER 불변');
    assert.equal(after['private.screen_precompute_lock()'].prosecdef, true);
    assert.equal(await one(db, 'select epoch from private.screen_precompute_control'), 2, '저장 투영 잠금을 두 번 잡음');
    const { rows } = await db.query('select vehicle_raw,plate,plate_mask from private.screen_observations order by source_report_key::int');
    rows.forEach((r, i) => {
      assert.equal(r.vehicle_raw, masking[i].input, '원문 불변');
      assert.equal(r.plate_mask, masking[i].output, `${masking[i].input} 저장 가림 재계산`);
    });
  }
  result[mode] = 'pass';
  await db.close();
}

// (c) 한쪽만 있는 상태: 명확한 오류로 중단하고 아무것도 바꾸지 않는다.
{
  const db = await makeDb('partial');
  const before = await meta(db);
  await assert.rejects(db.exec(migration), /screen precompute objects are partial/);
  await db.exec('rollback');
  assert.equal(await masked(db, '123가4567'), '1*3*4*67', 'partial: 롤백되어 옛 함수 유지');
  assert.deepEqual(await meta(db), before);
  assert.equal(await one(db, "select count(*)::int from private.screen_observations where plate_mask='1*3*4*67'"), 1);
  result.partial = 'rejected+rolled back';
  await db.close();
}
console.log(JSON.stringify({ 검증: '202610131000 배포 경로(폐기 객체 없음/있음/일부)·owner·ACL·search_path·DEFINER·캐시 무효화', 결과: result }));
