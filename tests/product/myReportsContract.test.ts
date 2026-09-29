// my-reports-v1: the prose contract, the JSON Schema, types.ts and the fixtures agree (runs in CI, no stack).
// The success fixtures are real responses of the handler over the real local Postgres (tests/integration/
// my-reports-sql.test.ts with UPDATE_MY_REPORTS_FIXTURES=1); here they are checked for shape and invariants.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import schema from '../../contracts/my-reports/my-reports-v1.schema.json';
import {
  AMOUNT_KINDS, CATEGORIES, DISPOSITIONS, ERRORS, LIMITS, OFFICIAL_DETAIL_PREFIX, STATUSES, STATUS_LABEL,
  addressBase, codePoints, normalizeAddress, normalizeVehicle, officialUrl, validQuery,
} from '../../contracts/my-reports/types';
import { validate } from './helpers/jsonSchema';

type Json = Record<string, any>;
const dir = new URL('../../contracts/my-reports/fixtures/', import.meta.url);
const readme = readFileSync(new URL('../../contracts/my-reports/README.md', import.meta.url), 'utf8');
const defs = (schema as Json).$defs;
const ref = (name: string) => ({ $ref: `#/$defs/${name}`, $defs: defs });
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(readFileSync(new URL(f, dir), 'utf8'))] as const);

function checkSummary(s: Json) {
  const sum = (o: Json) => Object.values(o).reduce((a: number, b) => a + (b as number), 0);
  expect(sum(s.status)).toBe(s.total);
  expect(sum(s.disposition)).toBe(s.total);
  expect(sum(s.category)).toBe(s.total);
  expect(s.accept_rate).toBe(s.total === 0 ? null : Math.round((s.status.accepted * 1000) / s.total) / 10);
  const f = s.fine_amount;
  expect(f.fine_count).toBe(s.disposition.fine);
  expect(f.confirmed_count + f.unconfirmed_count + f.other_count).toBe(f.fine_count);
  if (f.confirmed_count === 0) expect(f.confirmed_sum_won).toBeNull();
}

describe('my-reports-v1 contract', () => {
  it('has success fixtures for the three routes, empty results and errors', () => {
    const names = fixtures.map(([f]) => f);
    for (const n of ['search-vehicle-first-page', 'search-vehicle-next-page', 'search-managers-page', 'search-empty', 'summary-first-page',
      'summary-next-page', 'summary-empty-no-consent', 'numbers-first-page', 'numbers-last-page', 'error-dataset-changed']) {
      expect(names).toContain(`${n}.json`);
    }
  });

  it.each(fixtures)('%s matches the schema and the statistics invariants', (name, body) => {
    if (name.startsWith('error-')) {
      expect(validate(ref('ErrorResponse'), body.body)).toEqual([]);
      const e = ERRORS[body.body.error.code as keyof typeof ERRORS];
      expect(body.http_status).toBe(e.status);
      expect(body.body.error).toEqual({ code: body.body.error.code, message: e.message, retryable: e.retryable });
      return;
    }
    const kind = { search: 'SearchResponse', summary: 'SummaryResponse', numbers: 'NumbersResponse' }[body.route as string]!;
    expect(validate(ref(kind), body)).toEqual([]);
    for (const s of [body.summary, body.recent_summary].filter(Boolean)) checkSummary(s);
    for (const m of body.managers?.items ?? []) checkSummary({ ...m, category: { x: m.total }, completed_date_missing: 0 });
    const rows = [...(body.reports?.items ?? []), ...(body.recent?.items ?? [])];
    for (const r of rows) {
      expect(r.status_label).toBe(STATUS_LABEL[r.status as keyof typeof STATUS_LABEL]);
      expect(r.official_url).toBe(officialUrl(r.source_report_id));
      for (const banned of ['title', 'body', 'answer', 'attachments', 'photos', 'contributor_id', 'dataset_key', 'source_report_key',
        'payload_sha256', 'consent_grant_id', 'report_identity']) expect(r).not.toHaveProperty(banned);
    }
    if (body.route === 'numbers') expect(body.complete).toBe(body.next_cursor === null);
  });

  it('schema enums and limits are the constants of types.ts; every error code is documented', () => {
    expect(defs.Status.enum).toEqual(STATUSES);
    expect(defs.Disposition.enum).toEqual(DISPOSITIONS);
    expect(defs.Category.enum).toEqual(CATEGORIES);
    expect(defs.AmountKind.enum).toEqual(AMOUNT_KINDS);
    expect(defs.ReportRow.properties.status_label.enum).toEqual(STATUSES.map((s) => STATUS_LABEL[s]));
    expect(defs.ErrorResponse.properties.error.properties.code.enum).toEqual(Object.keys(ERRORS));
    expect(defs.SearchRequest.properties.page_size.maximum).toBe(LIMITS.page_size_max);
    expect(defs.SearchRequest.properties.managers_page_size.maximum).toBe(LIMITS.managers_page_size_max);
    expect(defs.NumbersRequest.properties.page_size.maximum).toBe(LIMITS.numbers_page_size_max);
    expect(defs.SearchRequest.properties.query.maxLength).toBe(LIMITS.query_raw_chars);
    for (const code of Object.keys(ERRORS)) expect(readme).toContain(`\`${code}\``);
    expect(readme).toContain(OFFICIAL_DETAIL_PREFIX);
  });

  it('vehicle normalisation: NFC, every JS whitespace removed, 6..64 code points, no control characters', () => {
    // decomposed Hangul (U+1100 series) composes under NFC; ideographic and no-break spaces are removed
    const decomposed = '12' + String.fromCharCode(0x1100, 0x1161) + '3456';
    expect(normalizeVehicle(decomposed)).toBe('12가3456');
    expect(normalizeVehicle(`\t12${String.fromCharCode(0x3000)}가${String.fromCharCode(0xa0)}34 56\n`)).toBe('12가3456');
    expect(validQuery('vehicle', '가나다라마')).toBe(false);
    expect(validQuery('vehicle', '가나다라마바')).toBe(true);
    // 6 astral characters are 12 UTF-16 units but 6 code points
    const astral = String.fromCodePoint(0x20000).repeat(6);
    expect(astral.length).toBe(12);
    expect(codePoints(astral)).toBe(6);
    expect(validQuery('vehicle', astral)).toBe(true);
    expect(validQuery('vehicle', 'a'.repeat(64))).toBe(true);
    expect(validQuery('vehicle', 'a'.repeat(65))).toBe(false);
    expect(validQuery('vehicle', `12가34${String.fromCharCode(7)}56`)).toBe(false);
  });

  it('address: trim + collapse; one trailing (…) reference is ignored; neighbours stay different', () => {
    expect(normalizeAddress('  서울특별시   종로구\t예시로 1 ')).toBe('서울특별시 종로구 예시로 1');
    expect(addressBase('서울특별시 종로구 예시로 1 (예시동)')).toBe('서울특별시 종로구 예시로 1');
    expect(addressBase('서울특별시 종로구 예시로 1')).toBe('서울특별시 종로구 예시로 1');
    expect(addressBase('서울특별시 종로구 예시로 12')).not.toBe(addressBase('서울특별시 종로구 예시로 1'));
    expect(addressBase('(예시동)')).toBe('(예시동)');
    expect(validQuery('address', '서울 종로')).toBe(true);
    expect(validQuery('address', '종로구')).toBe(false);
  });

  it('official link: fixed origin and path, validated id only', () => {
    expect(officialUrl('9100000001')).toBe('https://www.safetyreport.go.kr/#mypage/mysafereport/9100000001');
    for (const bad of ['', 'javascript:alert(1)', '../x', 'a/b', 'https://evil.example/x', 'SPP 1', 'x'.repeat(41), null, 12, undefined]) {
      expect(officialUrl(bad)).toBeNull();
    }
  });
});

describe('my-reports contract folder integrity', () => {
  it('MANIFEST.sha256 lists every file with its current hash (the extension copy is verified against it)', async () => {
    const { createHash } = await import('node:crypto');
    const { readdirSync: rd, statSync } = await import('node:fs');
    const root = new URL('../../contracts/my-reports/', import.meta.url);
    const lines = readFileSync(new URL('MANIFEST.sha256', root), 'utf8').trim().split('\n');
    const listed = new Map(lines.map((l) => { const [h, p] = l.split('  '); return [p.replace(/^\.\//, ''), h]; }));
    const files: string[] = [];
    const walk = (rel: string) => {
      for (const n of rd(new URL(rel || '.', root))) {
        const r = rel ? `${rel}/${n}` : n;
        if (statSync(new URL(r, root)).isDirectory()) walk(r); else if (r !== 'MANIFEST.sha256') files.push(r);
      }
    };
    walk('');
    expect([...listed.keys()].sort()).toEqual(files.sort());
    for (const f of files) expect(createHash('sha256').update(readFileSync(new URL(f, root))).digest('hex'), f).toBe(listed.get(f));
  });
});
