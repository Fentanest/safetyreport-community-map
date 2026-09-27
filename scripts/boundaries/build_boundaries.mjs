#!/usr/bin/env node
// Build the public administrative boundary layers (시·도, 시·군·구) and the region code table.
// Sources (docs/region-boundaries.md):
//   geometry  국가데이터처(구 통계청) SGIS 「행정구역 통계 및 경계」 2025-06-30 (data.go.kr 15129688), 공공누리 제1유형
//   codes     행정안전부 행정기관(행정동) 및 관할구역(법정동) 코드 2026-07-01 (jscode20260701.zip)
// Output codes are 법정 시군구 codes (first 5 digits of 법정동코드) of 2026-07-01, at the level of our region key:
//   일반구 are dissolved into their parent city; 세종 is one unit (36110); Incheon's 2026-07-01 districts are rebuilt
//   from SGIS 행정동 polygons regrouped by the 2026-07-01 행정동 code file; 광주·전남 become 전남광주통합특별시(12).
// Geometry is simplified in the native UTM-K (EPSG:5179) and then reprojected to WGS84 by mapshaper (reads the .prj).
//
//   node scripts/boundaries/build_boundaries.mjs --sgis <sgis.zip> --mois <jscode20260701.zip> [--work <tmp dir>]
// Inputs are verified by sha256. Outputs: public/boundaries/v20260701/{sido,sgg}.topo.json, meta.json and
// contracts/regions/regions-20260701.json. Nothing is downloaded silently: pass the files you fetched from the
// documented URLs (see docs/region-boundaries.md "갱신 절차").
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const VERSION = '20260701';
const MAPSHAPER = 'mapshaper@0.6.121';
const PINNED = {
  sgis: 'f1cf0f9de453ac7eaacb273f39cee52851183372b9ddfda428a967c3a670b2c6',
  mois: '0b9f143fb6e43657ff72c863ac1412cc4be43e79dce323aac602fb7754663898',
};
const SIMPLIFY = '2%';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const sgisZip = opt('--sgis'), moisZip = opt('--mois');
if (!sgisZip || !moisZip) { console.error('usage: --sgis <sgis.zip> --mois <jscode20260701.zip>'); process.exit(2); }
const work = opt('--work') || mkdtempSync(join(tmpdir(), 'cm-boundaries-'));

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
for (const [name, file] of [['sgis', sgisZip], ['mois', moisZip]]) {
  const got = sha256(file);
  if (got !== PINNED[name]) { console.error(`${name}: sha256 ${got} != pinned ${PINNED[name]} — review the new release before changing the pin`); process.exit(3); }
}

// ── unzip (entry names are cp949) ───────────────────────────────────────────────
const unzip = (zip, dest) => { mkdirSync(dest, { recursive: true }); execFileSync('unzip', ['-q', '-o', '-O', 'cp949', zip, '-d', dest]); };
unzip(sgisZip, join(work, 'sgis'));
unzip(moisZip, join(work, 'mois'));
const find = (dir, re) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { const hit = find(p, re); if (hit) return hit; } else if (re.test(name)) return p;
  }
  return null;
};
const shpSgg = find(join(work, 'sgis'), /^bnd_sigungu_.*\.shp$/);
const shpDong = find(join(work, 'sgis'), /^bnd_dong_.*\.shp$/);
const shpSido = find(join(work, 'sgis'), /^bnd_sido_.*\.shp$/);
const kikB = find(join(work, 'mois'), /^KIKcd_B\.\d{8}$/);
const kikH = find(join(work, 'mois'), /^KIKcd_H\.\d{8}$/);
if (!shpSgg || !shpDong || !shpSido || !kikB || !kikH) { console.error('expected files not found in the archives'); process.exit(4); }

// ── MOIS fixed-width code files (cp949) ────────────────────────────────────────
const cp949 = new TextDecoder('euc-kr');
function readFixedWidth(file) {
  const lines = readFileSync(file).toString('binary').split(/\r?\n/).filter(Boolean).map((l) => Buffer.from(l, 'binary'));
  const header = cp949.decode(lines[0]);
  // byte offsets of the header tokens (Hangul = 2 bytes in cp949)
  const starts = [];
  let bytes = 0, prevSpace = true;
  for (const ch of header) {
    if (ch !== ' ' && prevSpace) starts.push(bytes);
    prevSpace = ch === ' ';
    bytes += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  }
  const names = header.trim().split(/\s+/);
  return lines.slice(1).map((line) => {
    const row = {};
    names.forEach((name, i) => { row[name] = cp949.decode(line.subarray(starts[i], starts[i + 1] ?? line.length)).trim(); });
    return row;
  });
}
const B = readFixedWidth(kikB).filter((r) => !r['말소일자']);
const H = readFixedWidth(kikH).filter((r) => !r['말소일자']);

const SHORT = {
  서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 대전광역시: '대전', 울산광역시: '울산',
  세종특별자치시: '세종', 경기도: '경기', 강원특별자치도: '강원', 충청북도: '충북', 충청남도: '충남', 전북특별자치도: '전북',
  경상북도: '경북', 경상남도: '경남', 제주특별자치도: '제주', 전남광주통합특별시: '전남광주',
};
const sidoRows = B.filter((r) => r['법정동코드'].endsWith('00000000'));
const sidoByName = new Map(sidoRows.map((r) => [r['시도명'], r['법정동코드'].slice(0, 2)]));
// key-level 시군구: no 일반구 (name with a space), no 출장소; 세종 is the city itself
const sggRows = B.filter((r) => r['법정동코드'].endsWith('00000') && !r['법정동코드'].endsWith('00000000'));
const keyLevel = sggRows.filter((r) => {
  const n = r['시군구명'];
  return (n === '' && r['법정동코드'].startsWith('36110')) || (n && !n.includes(' ') && !/출장(소)?$/.test(n));
}).map((r) => ({ code: r['법정동코드'].slice(0, 5), sido: r['법정동코드'].slice(0, 2), sido_name: r['시도명'],
  name: r['시군구명'] || r['시도명'] }));
const byName = new Map(keyLevel.map((s) => [`${s.sido}|${s.name}`, s]));

// ── SGIS attribute tables via mapshaper (fast: attributes only) ───────────────
const ms = (...a) => execFileSync('npx', ['-y', MAPSHAPER, ...a], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 30 });
const attrs = (shp) => { const out = join(work, `${Date.now()}-${Math.random()}.json`); ms('-i', shp, 'encoding=utf-8', '-o', out, 'format=json'); return JSON.parse(readFileSync(out, 'utf8')); };
const sgisSido = new Map(attrs(shpSido).map((r) => [r.SIDO_CD, r.SIDO_NM]));
// SGIS sido → 2026-07-01 법정 sido code (광주·전남 were merged into 전남광주통합특별시)
const sidoOf = (sgisSidoCd) => {
  const name = sgisSido.get(sgisSidoCd);
  if (name === '광주광역시' || name === '전라남도') return sidoByName.get('전남광주통합특별시');
  return sidoByName.get(name);
};
const norm = (s) => s.replace(/[·ㆍ.]/g, '.').replace(/\s+/g, '');

const sggMap = [], unmapped = [];
const incheonSplit = new Set();
for (const r of attrs(shpSgg)) {
  const sido = sidoOf(r.SIGUNGU_CD.slice(0, 2));
  let name = r.SIGUNGU_NM;
  if (name === '세종시') name = '세종특별자치시';
  const parent = name.includes(' ') ? name.split(' ')[0] : name; // 일반구 → parent city
  const hit = byName.get(`${sido}|${parent}`);
  if (hit) sggMap.push({ SIGUNGU_CD: r.SIGUNGU_CD, code: hit.code });
  else if (sido === '28') incheonSplit.add(r.SIGUNGU_CD); // abolished Incheon districts: rebuilt from 행정동
  else unmapped.push(`${r.SIGUNGU_CD} ${r.SIGUNGU_NM}`);
}
if (unmapped.length) { console.error('SGIS 시군구 without a 2026-07-01 code:', unmapped); process.exit(5); }

// Incheon 2026-07-01: SGIS 행정동 of the abolished districts → new district by 행정동 name (2026-07-01 code file)
const newIncheon = new Map();
for (const r of H) {
  const code = r['행정동코드'];
  if (!code.startsWith('28') || code.endsWith('00000')) continue;
  const gu = code.slice(0, 5);
  if (!byName.has(`28|${r['시군구명']}`)) continue;
  newIncheon.set(norm(r['읍면동명']), gu);
}
const dongMap = [], dongUnmapped = [];
for (const r of attrs(shpDong)) {
  if (!incheonSplit.has(r.ADM_CD.slice(0, 5))) continue;
  let gu = newIncheon.get(norm(r.ADM_NM));
  if (!gu) {
    // A dong split after the SGIS vintage (e.g. 운서동 → 운서1동·운서2동): map it only when EVERY numbered successor
    // `<name>N동` lies in one district; otherwise fail rather than guess.
    const stem = norm(r.ADM_NM).replace(/동$/, '');
    const succ = [...newIncheon].filter(([name]) => new RegExp(`^${stem}\\d+동$`).test(name)).map(([, g]) => g);
    if (succ.length && new Set(succ).size === 1) gu = succ[0];
  }
  if (gu) dongMap.push({ ADM_CD: r.ADM_CD, code: gu }); else dongUnmapped.push(`${r.ADM_CD} ${r.ADM_NM}`);
}
if (dongUnmapped.length) { console.error('Incheon 행정동 without a 2026-07-01 district:', dongUnmapped); process.exit(6); }

const toCsv = (rows, key) => [`${key},code`, ...rows.map((r) => `${r[key]},${r.code}`)].join('\n');
const sggCsv = join(work, 'sgg_map.csv'), dongCsv = join(work, 'dong_map.csv');
writeFileSync(sggCsv, toCsv(sggMap, 'SIGUNGU_CD'));
writeFileSync(dongCsv, toCsv(dongMap, 'ADM_CD'));
const lookup = keyLevel.map((s) => ({ ...s, sido_short: SHORT[s.sido_name] ?? s.sido_name }));
const lookupCsv = join(work, 'lookup.csv');
writeFileSync(lookupCsv, ['code,name,sido,sido_name', ...lookup.map((s) => `${s.code},${s.name},${s.sido},${s.sido_name}`)].join('\n'));

// ── geometry: recode, dissolve, simplify in UTM-K, reproject, TopoJSON ────────
const outDir = join(ROOT, 'public', 'boundaries', `v${VERSION}`);
mkdirSync(outDir, { recursive: true });
const utm = join(work, 'parts');
mkdirSync(utm, { recursive: true });
ms('-i', shpSgg, 'encoding=utf-8', '-join', sggCsv, 'keys=SIGUNGU_CD,SIGUNGU_CD', 'string-fields=SIGUNGU_CD,code',
  '-filter', 'code != null', '-each', 'SIGUNGU_CD=undefined, SIGUNGU_NM=undefined, BASE_DATE=undefined',
  '-o', join(utm, 'a.shp'));
ms('-i', shpDong, 'encoding=utf-8', '-join', dongCsv, 'keys=ADM_CD,ADM_CD', 'string-fields=ADM_CD,code',
  '-filter', 'code != null', '-each', 'ADM_CD=undefined, ADM_NM=undefined, BASE_DATE=undefined',
  '-o', join(utm, 'b.shp'));
ms('-i', join(utm, 'a.shp'), join(utm, 'b.shp'), 'combine-files', '-merge-layers', 'force', 'name=sgg',
  '-dissolve', 'code',
  '-join', lookupCsv, 'keys=code,code', 'string-fields=code,sido',
  '-simplify', SIMPLIFY, 'keep-shapes',
  '-proj', 'wgs84',
  '-dissolve', 'sido', 'copy-fields=sido_name', '+', 'name=sido',
  '-o', join(outDir, 'sgg.topo.json'), 'target=sgg', 'format=topojson', 'quantization=100000',
  '-o', join(outDir, 'sido.topo.json'), 'target=sido', 'format=topojson', 'quantization=100000');

// Districts that replaced an old name ambiguously (인천 중구 → 제물포구|영종구, 인천 서구 → 서해구|검단구): the server
// assigns legacy keys of these by point-in-polygon on the report's own coordinates (display geometry, see docs).
const PIP_CODES = ['28125', '28155', '28275', '28290'];
const pipFile = join(work, 'pip.json');
ms('-i', join(outDir, 'sgg.topo.json'), '-filter', `${JSON.stringify(PIP_CODES)}.includes(code)`,
  '-o', pipFile, 'format=geojson', 'precision=0.000001');
const pip = JSON.parse(readFileSync(pipFile, 'utf8'));
const topo = (f) => JSON.parse(readFileSync(join(outDir, f), 'utf8'));
const count = (f, layer) => topo(f).objects[layer].geometries.length;
const meta = {
  version: VERSION,
  levels: { sido: { file: 'sido.topo.json', features: count('sido.topo.json', 'sido') },
    sgg: { file: 'sgg.topo.json', features: count('sgg.topo.json', 'sgg') } },
  codes: '법정 시군구 코드(행정안전부 법정동코드 앞 5자리), 2026-07-01 기준. 일반구는 상위 시로 합침. 세종 36110.',
  crs: 'WGS84 (EPSG:4326), SGIS UTM-K(EPSG:5179)에서 mapshaper가 .prj로 변환. 표시용으로 2% 단순화(원 좌표·통계 기준 불변).',
  sources: [
    { name: '국가데이터처(구 통계청) SGIS 「행정구역 통계 및 경계」', base_date: '2025-06-30', sha256: PINNED.sgis,
      url: 'https://www.data.go.kr/data/15129688/fileData.do', license: '공공누리 제1유형(출처표시)' },
    { name: '행정안전부 행정기관(행정동) 및 관할구역(법정동) 코드', effective: '2026-07-01', sha256: PINNED.mois,
      url: 'https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000052&nttId=127039' },
  ],
  attribution: '행정구역 경계: 국가데이터처(구 통계청) 통계지리정보서비스(SGIS) 「행정구역 통계 및 경계」(2025.6.30. 기준), '
    + '공공누리 제1유형 — 좌표변환·단순화·행정구역 코드 재부여(행정안전부 2026.7.1. 기준)로 가공함.',
  tool: MAPSHAPER, simplify: SIMPLIFY,
};
writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

const regionsOut = join(ROOT, 'contracts', 'regions');
mkdirSync(regionsOut, { recursive: true });
const sido = [...new Map(lookup.map((s) => [s.sido, { code: s.sido, name: s.sido_name, short: s.sido_short }])).values()]
  .sort((a, b) => a.code.localeCompare(b.code));
writeFileSync(join(regionsOut, `regions-${VERSION}.json`), JSON.stringify({
  version: VERSION, note: meta.codes, sido,
  sgg: lookup.map(({ code, sido: s, name }) => ({ code, sido: s, name })).sort((a, b) => a.code.localeCompare(b.code)),
  // Legacy region keys whose district was split: candidates resolved by point-in-polygon, else 지역 미확인.
  split: { '28|중구': ['28125', '28155'], '28|서구': ['28275', '28290'] },
  // Renamed or moved units (official history): legacy key → current code.
  renamed: { '28|남구': '28177', '47|군위군': '27720', '28|동구': '28125' },
  pip: pip.features.map((f) => ({ code: f.properties.code, geometry: f.geometry })),
}, null, 1) + '\n');
console.log(JSON.stringify({ out: outDir, sido: meta.levels.sido.features, sgg: meta.levels.sgg.features,
  incheon_dongs: dongMap.length, work }, null, 1));
if (!existsSync(join(outDir, 'sgg.topo.json'))) process.exit(7);
