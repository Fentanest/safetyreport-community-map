// OOXML inspector for the F06 checks (Node only, no dependencies; the XLSX under test is made by Excelize — this file
// only READS it). Parses the ZIP container (central directory + deflate) and the parts the checks need:
// sheets/cells (value, type, formula, style), shared strings, number formats, conditional formatting, drawings → charts
// (type, series tx/cat/val references, caches, blanks, axes), content types, relationships and document properties.
import { inflateRawSync } from 'node:zlib';

export function unzip(buf) {
  const b = Buffer.from(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip: no end of central directory');
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const files = new Map();
  const names = [];
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), nameLen = b.readUInt16LE(p + 28), extraLen = b.readUInt16LE(p + 30), commentLen = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = b.readUInt16LE(local + 26), lExtraLen = b.readUInt16LE(local + 28);
    const data = b.subarray(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + csize);
    const raw = method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
    if (!raw) throw new Error(`unsupported compression ${method} for ${name}`);
    names.push(name);
    files.set(name, raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { files, names };
}

const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
const attr = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? unescape(m[1]) : null; };
const all = (xml, re) => [...xml.matchAll(re)];
const text = (x) => (x ? all(x, /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g).map((m) => unescape(m[1])).join('') : '');

export function colToNum(c) { let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
export function splitRef(r) { const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(r); return m ? { col: colToNum(m[1]), row: Number(m[2]), colName: m[1] } : null; }
/** "'차트 데이터'!$B$5:$B$9" → { sheet, cells: ['B5','B6',…] } */
export function expandRange(f) {
  const m = /^(?:'((?:[^']|'')+)'|([^!]+))!(\$?[A-Z]+\$?\d+)(?::(\$?[A-Z]+\$?\d+))?$/.exec(f.trim());
  if (!m) return null;
  const sheet = (m[1] ?? m[2]).replace(/''/g, "'");
  const a = splitRef(m[3]), z = splitRef(m[4] ?? m[3]);
  const cells = [];
  for (let r = a.row; r <= z.row; r++) for (let c = a.col; c <= z.col; c++) cells.push(`${numToCol(c)}${r}`);
  return { sheet, cells };
}
export function numToCol(n) { let s = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; }

export function inspect(buf) {
  const { files, names } = unzip(buf);
  const str = (n) => files.get(n)?.toString('utf8') ?? null;
  const contentTypes = str('[Content_Types].xml');
  const rels = (n) => {
    const x = str(n); if (!x) return [];
    return all(x, /<Relationship\b[^>]*>/g).map((m) => ({ id: attr(m[0], 'Id'), type: attr(m[0], 'Type'), target: attr(m[0], 'Target'), mode: attr(m[0], 'TargetMode') }));
  };
  const resolve = (base, target) => {
    if (target.startsWith('/')) return target.slice(1);
    const parts = base.split('/'); parts.pop();
    for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
    return parts.join('/');
  };
  const wb = str('xl/workbook.xml');
  const wbRels = rels('xl/_rels/workbook.xml.rels');
  const sheets = all(wb, /<sheet\b[^>]*>/g).map((m) => ({ name: attr(m[0], 'name'), state: attr(m[0], 'state') ?? 'visible', rid: attr(m[0], 'r:id') }))
    .map((s) => ({ ...s, file: resolve('xl/workbook.xml', wbRels.find((r) => r.id === s.rid)?.target ?? '') }));
  const calcPr = /<calcPr\b[^>]*>/.exec(wb)?.[0] ?? '';
  const sst = str('xl/sharedStrings.xml');
  const shared = sst ? all(sst, /<si>([\s\S]*?)<\/si>/g).map((m) => text(m[1])) : [];
  const stylesXml = str('xl/styles.xml') ?? '';
  const numFmts = new Map(all(stylesXml, /<numFmt\b[^>]*>/g).map((m) => [Number(attr(m[0], 'numFmtId')), attr(m[0], 'formatCode')]));
  const cellXfs = (/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '');
  const xfs = all(cellXfs, /<xf\b[^>]*\/?>/g).map((m) => Number(attr(m[0], 'numFmtId') ?? 0));
  const formatOf = (s) => { const id = xfs[s ?? 0] ?? 0; return numFmts.get(id) ?? (id === 0 ? 'General' : `builtin:${id}`); };

  const out = { names, contentTypes, sheets: {}, charts: [], docProps: { core: str('docProps/core.xml'), app: str('docProps/app.xml'), custom: str('docProps/custom.xml') },
    calc: { fullCalcOnLoad: attr(calcPr, 'fullCalcOnLoad') }, workbookXml: wb, shared, allText: '' };
  const texts = [];
  for (const s of sheets) {
    const x = str(s.file);
    if (!x) { out.sheets[s.name] = { missing: true }; continue; }
    const cells = {};
    for (const m of all(x, /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = `<c ${m[1]}>`;
      const r = attr(tag, 'r'), t = attr(tag, 't'), sIdx = attr(tag, 's');
      const inner = m[2] ?? '';
      const f = /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/.exec(inner)?.[1];
      const vRaw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = null;
      if (t === 's' && vRaw !== undefined) value = shared[Number(vRaw)];
      else if (t === 'inlineStr') value = text(inner);
      else if (vRaw !== undefined) value = t === 'str' || t === 'e' ? unescape(vRaw) : Number(vRaw);
      // Excelize 0.1.3 writes every formula cell as t="str" with the cached result as text; `num` is that cached result
      // read as a number (Excel recalculates on open: fullCalcOnLoad) — the raw `t`/`value` stay visible for checks
      const formula = f !== undefined ? unescape(f) : null;
      const num = typeof value === 'number' ? value : formula && typeof value === 'string' && /^-?\d+(\.\d+)?(E[-+]?\d+)?$/i.test(value) ? Number(value) : null;
      cells[r] = { t, value, num, formula, style: sIdx === null ? 0 : Number(sIdx), format: formatOf(sIdx === null ? 0 : Number(sIdx)) };
      if (typeof value === 'string') texts.push(value);
    }
    const cf = all(x, /<conditionalFormatting\b([^>]*)>([\s\S]*?)<\/conditionalFormatting>/g).map((m) => ({
      sqref: attr(`<x ${m[1]}>`, 'sqref'),
      rules: all(m[2], /<cfRule\b([^>]*)>([\s\S]*?)<\/cfRule>/g).map((r) => ({ type: attr(`<x ${r[1]}>`, 'type'),
        cfvo: all(r[2], /<cfvo\b[^>]*>/g).map((c) => ({ type: attr(c[0], 'type'), val: attr(c[0], 'val') })),
        colors: all(r[2], /<color\b[^>]*>/g).map((c) => attr(c[0], 'rgb')) })),
    }));
    const pane = /<pane\b[^>]*>/.exec(x)?.[0] ?? null;
    const merges = all(x, /<mergeCell\b[^>]*>/g).map((m) => attr(m[0], 'ref'));
    const hyperlinks = all(x, /<hyperlink\b[^>]*>/g).length;
    const drawingRid = /<drawing\b[^>]*r:id="([^"]+)"/.exec(x)?.[1] ?? null;
    const sheetRels = rels(s.file.replace(/worksheets\//, 'worksheets/_rels/') + '.rels');
    let chartFiles = [];
    let anchors = [];
    if (drawingRid) {
      const drawingFile = resolve(s.file, sheetRels.find((r) => r.id === drawingRid)?.target ?? '');
      const dx = str(drawingFile) ?? '';
      const dRels = rels(drawingFile.replace(/drawings\//, 'drawings/_rels/') + '.rels');
      anchors = all(dx, /<xdr:(?:twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g).map((m) => {
        const from = /<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/.exec(m[0]);
        const rid = /<c:chart\b[^>]*r:id="([^"]+)"/.exec(m[0])?.[1];
        return { col: from ? Number(from[1]) : null, row: from ? Number(from[2]) : null, chart: rid ? resolve(drawingFile, dRels.find((r) => r.id === rid)?.target ?? '') : null };
      });
      chartFiles = anchors.map((a) => a.chart).filter(Boolean);
      for (const r of dRels) if (r.mode === 'External') out.externalLinks = (out.externalLinks ?? 0) + 1;
    }
    for (const r of sheetRels) if (r.mode === 'External') out.externalLinks = (out.externalLinks ?? 0) + 1;
    out.sheets[s.name] = { file: s.file, state: s.state, cells, cf, pane, merges, hyperlinks, anchors, chartFiles };
  }
  for (const n of names.filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n)).sort((a, b) => Number(/\d+/.exec(a)[0]) - Number(/\d+/.exec(b)[0]))) {
    const x = str(n);
    const plot = /<(?:c:)?plotArea>([\s\S]*?)<\/(?:c:)?plotArea>/.exec(x)?.[1] ?? '';
    const groups = all(plot, /<(?:c:)?(barChart|lineChart|scatterChart|areaChart|pieChart)>([\s\S]*?)<\/(?:c:)?\1>/g).map((g) => {
      const grouping = attr(/<(?:c:)?grouping\b[^>]*>/.exec(g[2])?.[0] ?? '', 'val');
      const barDir = attr(/<(?:c:)?barDir\b[^>]*>/.exec(g[2])?.[0] ?? '', 'val');
      const axIds = all(g[2], /<(?:c:)?axId\b[^>]*>/g).map((a) => attr(a[0], 'val'));
      const series = all(g[2], /<(?:c:)?ser>([\s\S]*?)<\/(?:c:)?ser>/g).map((sm) => {
        const s = sm[1];
        const ref = (tag) => {
          const block = new RegExp(`<(?:c:)?${tag}>([\\s\\S]*?)<\\/(?:c:)?${tag}>`).exec(s)?.[1] ?? '';
          const kind = /<(?:c:)?(numRef|strRef)>/.exec(block)?.[1] ?? null;
          const f = /<(?:c:)?f>([\s\S]*?)<\/(?:c:)?f>/.exec(block)?.[1];
          const pts = all(block, /<(?:c:)?pt\b[^>]*idx="(\d+)"[^>]*>\s*<(?:c:)?v>([\s\S]*?)<\/(?:c:)?v>/g).map((p) => ({ idx: Number(p[1]), v: unescape(p[2]) }));
          return { kind, f: f ? unescape(f) : null, cache: pts };
        };
        return { tx: ref('tx'), cat: ref('cat'), val: ref('val'), xVal: ref('xVal'), yVal: ref('yVal'),
          dash: attr(/<a:prstDash\b[^>]*>/.exec(s)?.[0] ?? '', 'val'), color: attr(/<a:srgbClr\b[^>]*>/.exec(s)?.[0] ?? '', 'val'),
          marker: attr(/<(?:c:)?symbol\b[^>]*>/.exec(s)?.[0] ?? '', 'val') };
      });
      return { type: g[1], grouping, barDir, axIds, series };
    });
    const valAx = all(plot, /<(?:c:)?valAx>([\s\S]*?)<\/(?:c:)?valAx>/g).map((m) => ({
      id: attr(/<(?:c:)?axId\b[^>]*>/.exec(m[1])?.[0] ?? '', 'val'), min: attr(/<(?:c:)?min\b[^>]*>/.exec(m[1])?.[0] ?? '', 'val'), max: attr(/<(?:c:)?max\b[^>]*>/.exec(m[1])?.[0] ?? '', 'val'),
      numFmt: attr(/<(?:c:)?numFmt\b[^>]*>/.exec(m[1])?.[0] ?? '', 'formatCode'), axPos: attr(/<(?:c:)?axPos\b[^>]*>/.exec(m[1])?.[0] ?? '', 'val'),
      deleted: attr(/<(?:c:)?delete\b[^>]*>/.exec(m[1])?.[0] ?? '', 'val'), crosses: attr(/<(?:c:)?crosses\b[^>]*>/.exec(m[1])?.[0] ?? '', 'val') }));
    const title = text(/<(?:c:)?title>([\s\S]*?)<\/(?:c:)?title>/.exec(x)?.[1] ?? '');
    texts.push(title);
    out.charts.push({ file: n, title, groups, valAx, dispBlanksAs: attr(/<(?:c:)?dispBlanksAs\b[^>]*>/.exec(x)?.[0] ?? '', 'val'), xml: x });
  }
  out.allText = [...texts, ...shared, out.docProps.core ?? '', out.docProps.app ?? '', out.docProps.custom ?? ''].join('\n');
  // every part XML must be well-formed enough to have no raw C0 control characters (Excel "repairs" such files)
  out.controlChars = names.filter((n) => /\.xml$|\.rels$/.test(n)).filter((n) => /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(files.get(n).toString('utf8')));
  // every part is declared in [Content_Types].xml (Default by extension or Override by part name)
  const defaults = new Set(all(contentTypes, /<Default\b[^>]*>/g).map((m) => attr(m[0], 'Extension')));
  const overrides = new Set(all(contentTypes, /<Override\b[^>]*>/g).map((m) => attr(m[0], 'PartName')));
  out.undeclaredParts = names.filter((n) => !n.endsWith('/') && n !== '[Content_Types].xml' && !overrides.has(`/${n}`) && !defaults.has(n.split('.').pop()));
  out.missingOverrides = [...overrides].filter((p) => !files.has(p.slice(1)));
  // every relationship target of every .rels exists
  out.brokenRels = names.filter((n) => n.endsWith('.rels')).flatMap((n) => {
    const base = n.replace(/_rels\//, '').replace(/\.rels$/, '');
    return rels(n).filter((r) => r.mode !== 'External' && !files.has(resolve(base || 'x', r.target))).map((r) => `${n} → ${r.target}`);
  });
  return out;
}

/** the value a chart range currently points at (cells of the referenced sheet) */
export function rangeValues(x, f) {
  const r = expandRange(f);
  if (!r) return null;
  const sh = x.sheets[r.sheet];
  if (!sh) return null;
  return r.cells.map((c) => (sh.cells[c] ? (sh.cells[c].num ?? sh.cells[c].value) : null));
}
