// 메모리 전용 PostgreSQL(PGlite)에서 공유 벡터·마이그레이션·63,595행 성능을 검증한다.
// PGLITE_MODULE=/tmp/map-sql-test/node_modules/@electric-sql/pglite/dist/index.js node tests/sql/verify-screen-plate.mjs
// 선택: MOTO_UNRECOGNIZED_TSV=/비공개/목록.tsv (원문은 출력하거나 저장하지 않는다).
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const vectors = JSON.parse(readFileSync('tests/fixtures/plate_normalize_vectors.json','utf8')).cases;
const sql = readFileSync('supabase/migrations/202610131000_motorcycle_plate.sql','utf8');
await db.exec(`create schema private; create schema before;
 create role anon; create role authenticated; create role service_role;
 create table private.screen_precompute_control(singleton boolean primary key,epoch bigint);
 insert into private.screen_precompute_control values(true,0);
 create table private.screen_cache_epoch(singleton boolean primary key,revision bigint);
 insert into private.screen_cache_epoch values(true,0);
 create table private.analytics_state(singleton boolean primary key,revision bigint);
 insert into private.analytics_state values(true,0);
 create table private.screen_observations(contributor_id text,dataset_key text,source_report_key text,
 vehicle_raw text,plate text,plate_mask text,primary key(contributor_id,dataset_key,source_report_key));
 create function private.screen_precompute_lock() returns void language plpgsql as $$ begin
  update private.screen_precompute_control set epoch=epoch+1; end $$;
 create function private.community_bump_projection() returns void language plpgsql as $$ begin
  update private.analytics_state set revision=revision+1; end $$;`);
const old = readFileSync('supabase/migrations/202610130100_screen_plate_normalization.sql','utf8');
for (const fn of old.match(/create or replace function private.screen_\w+\(raw text\)[\s\S]*?end \$\$;/g)) {
 await db.exec(fn.replaceAll('private.', 'before.'));
}
for (const [i,c] of vectors.entries()) await db.query(
 'insert into private.screen_observations values($1,$2,$3,$4,$5,$6)', ['fixture','fixture',String(i),c.raw,'이전값','이전가림']);
await db.exec(sql);
for (const [i,c] of vectors.entries()) {
 const {rows:[r]} = await db.query(`select private.screen_plate($1) as plate, private.screen_normalize_plate($1) as normalized,
 private.screen_plate_strict($1) as fast, private.screen_mask_plate(private.screen_plate($1)) as masked`, [c.raw]);
 assert.equal(r.plate,c.expected,c.name+' 공개');
 assert.equal(r.normalized,c.expected,c.name+' 느린 경로');
 if(r.fast!==null) assert.equal(r.fast,c.expected,c.name+' 빠른 경로');
 if(c.expected && /^[가-힣0-9]+$/u.test(c.raw.normalize('NFKC').replace(/[-\s]/gu,'')))
  assert.equal(r.fast,c.expected,c.name+' 전체 번호판 빠른 경로');
 assert.equal(r.masked,c.masked,c.name+' 가림');
 const {rows:[stored]} = await db.query('select * from private.screen_observations where source_report_key=$1',[String(i)]);
 assert.equal(stored.vehicle_raw,c.raw,c.name+' 원문 불변');
 assert.equal(stored.plate,c.expected,c.name+' 저장 투영');
 assert.equal(stored.plate_mask,c.masked,c.name+' 저장 가림');
 if(c.expected) assert.equal((r.masked.slice(-4).match(/[0-9]/g)||[]).length,2,c.name+' 끝 네 자리 노출');
}
assert.equal((await db.query('select revision from private.screen_cache_epoch')).rows[0].revision,1);
assert.equal((await db.query('select revision from private.analytics_state')).rows[0].revision,1);
assert.equal((await db.query("select has_function_privilege('anon','private.screen_mask_plate(text)','execute') as allowed")).rows[0].allowed,false);
// 재적용도 원문·투영을 훼손하지 않는다.
await db.exec(sql);
for (const c of JSON.parse(readFileSync('contracts/masking-vectors.json','utf8'))) {
 assert.equal((await db.query('select private.screen_mask_plate(private.screen_plate($1)) as masked',[c.input])).rows[0].masked,c.output);
}
console.log(JSON.stringify({검증:'벡터·가림·투영 재계산·원문 보존·캐시·권한',벡터:vectors.length,엔진:(await db.query('select version()')).rows[0].version}));
// 공개되지 않은 실번호는 로그에 싣지 않고 메모리 테이블 안에서만 사용한다.
let missed=[];
if(process.env.MOTO_UNRECOGNIZED_TSV) {
 missed=readFileSync(process.env.MOTO_UNRECOGNIZED_TSV,'utf8').trim().split('\n').map(line=>{
  const at=line.lastIndexOf('\t');return {raw:line.slice(0,at),n:Number(line.slice(at+1))};
 }).filter(r=>Number.isInteger(r.n)&&r.n>0);
}
await db.exec('create table benchmark(raw text);');
if(missed.length) await db.query(`insert into benchmark select raw from jsonb_to_recordset($1::jsonb) as x(raw text,n int)
 cross join lateral generate_series(1,n)`,[JSON.stringify(missed)]);
else await db.exec("insert into benchmark select '경기군포다'||lpad((i%10000)::text,4,'0') from generate_series(1,12579) i;");
const missedCount=(await db.query('select count(*)::int as n from benchmark')).rows[0].n;
const recovered=(await db.query('select count(private.screen_plate(raw))::int as n from benchmark')).rows[0].n;
await db.query("insert into benchmark select '12가'||lpad((i%10000)::text,4,'0') from generate_series(1,$1::int) i",[63595-missedCount]);
const times={};
for(const [name,fn] of [['이전','before.screen_plate'],['변경','private.screen_plate'],['변경_느린경로','private.screen_normalize_plate']]) {
 await db.query(`select count(${fn}(raw)) from (select raw from benchmark limit 1000) warmup`);
 const elapsed=[]; let recognized=0;
 for(let i=0;i<3;i++) {
  const start=performance.now();const result=await db.query(`select count(${fn}(raw))::int as recognized from benchmark`);
  elapsed.push(Math.round(performance.now()-start)); recognized=result.rows[0].recognized;
 }
 times[name]={밀리초:elapsed,중앙값:elapsed.toSorted((a,b)=>a-b)[1],인식:recognized};
}
console.log(JSON.stringify({측정:'전체 화면 집계가 아닌 번호판 함수만, 63595행',미인식자료:missed.length?'제공 TSV':'합성',미인식입력:missedCount,새인식:recovered,결과:times}));
await db.close();
