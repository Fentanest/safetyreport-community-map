// Optional real PostgreSQL WASM execution, isolated in memory (never connects to any database).
// npm install --prefix /tmp/map-sql-test --cache /tmp/map-npm-cache @electric-sql/pglite
// PGLITE_MODULE=/tmp/map-sql-test/node_modules/@electric-sql/pglite/dist/index.js node tests/sql/verify-screen-plate.mjs [--before]
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const before = process.argv.includes('--before');
const sql = readFileSync(before ? 'supabase/migrations/202610061000_screen_aggregate_opt.sql' : 'supabase/migrations/202610130100_screen_plate_normalization.sql','utf8');
const funcs = sql.match(/create or replace function private.screen_(?:normalize_)?plate\(raw text\)[\s\S]*?end \$\$;/g);
await db.exec('create schema private;');
for (const fn of funcs) await db.exec(fn);
let tested = 0;
const failures=[];
for (const c of JSON.parse(readFileSync('tests/fixtures/plate_normalize_vectors.json','utf8')).cases) {
  const expectedPublic = c.expected && /^([가-힣]+)?[0-9]{2,3}[가-힣][0-9]{4}$/u.test(c.expected) ? c.expected : null;
  const { rows } = await db.query(`select private.screen_plate($1) as public_plate${before?'':', private.screen_normalize_plate($1) as canonical'}`, [c.raw]);
  if(rows[0].public_plate !== expectedPublic || (!before && rows[0].canonical !== c.expected)) failures.push(c.name);
  tested++;
}
console.log(JSON.stringify({engine:(await db.query('select version()')).rows[0].version, tested, failures}));
await db.close();
assert.equal(failures.length,0);
