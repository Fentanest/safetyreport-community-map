import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { isObservation } from '../../server/ingest/handler';
import { deriveFact, canonicalJson, sha256Hex } from '../../server/ingest/observation';
import { aggregateDashboard, type PrivateFact } from '../../server/aggregate';
import { aggregateCompare } from '../../server/compare';
import { fineEstimateSummary } from '../../server/amount';
import { ScreenAggregates, type ScreenAggregate } from '../../server/screenAggregate';
import { decodeScreenFacts, SCREEN_FACT_COLUMNS } from '../../server/screenFacts';
import { personalCompareSchema, consistentWithPublic } from '../../src/data/personal';
import { overviewSchema } from '../../src/data/schema';
import { DEMO_SCOPE } from '../../src/domain/public';
import { demoMeta } from '../../src/data/demoEngine';
import KpiPanel from '../../src/components/KpiPanel';
import CompareKpis from '../../src/components/CompareKpis';
import DataGuide from '../../src/components/DataGuide';

const vectors = JSON.parse(readFileSync('contracts/community-ingest/vectors/observations.json', 'utf8'));
const payload = vectors.cases.find((v: {name: string}) => v.name === 'accepted_fine').expected_payload;
const estimate = { won: 40000, rule: 'parking', rule_version: '2026-10-11.4' };
let seq = 0;
const fact = (patch: Partial<PrivateFact> = {}): PrivateFact => ({
  fact_identity: `e-${seq++}`, contributor_id: 'viewer', snapshot_id: 's', snapshot_generation: 1,
  report_date: '2026-09-01', completed_date: '2026-09-05', category: 'parking', status: 'accepted', disposition: 'fine',
  vehicle_raw: null, point_key: null, lat: null, lng: null, address: null, region_code: null,
  agency_key: null, agency_name: null, manager_key: null, manager_name: null,
  amount_kind: 'fine', amount_confirmed_won: null, amount_public: true, amount_stated: false, fine_estimate_won: 40000, ...patch,
});
const scope = { ...DEMO_SCOPE, start: '2026-09-01', end: '2026-09-30' };
const opts = { datasetVersion: 'v', sourceUpdatedAt: null, generatedAt: '2026-09-30T00:00:00Z', asOf: '2026-09-30', sample: true, dataMin: '2020-01-01' };
const viewer = { contributor: 'active' as const, has_public_facts: true };
const facts = [fact(), fact({ contributor_id: 'other', fine_estimate_won: 80000 }), fact({amount_confirmed_won: 50000, amount_stated: true}),
  fact({amount_confirmed_won: 0, amount_stated: true}), fact({amount_public: false}), fact({amount_stated: true}),
  fact({disposition: 'warning'}), fact({fine_estimate_won: null}), fact({completed_date: '2026-10-01'})];
const dash = aggregateDashboard(facts, scope, opts);
const cmp = aggregateCompare(facts, scope, 'viewer', {...opts, viewer});

describe('fine estimate ingest extension', () => {
  it('accepts legacy and extended payloads without changing old canonical hashes', async () => {
    expect(isObservation(payload)).toBe(true);
    const old = {...payload}; delete old.rating; delete old.source_agency_code; delete old.violation_law;
    expect(isObservation(old)).toBe(true);
    expect(isObservation({...old, fine_estimate: estimate})).toBe(true);
    expect(isObservation({...payload, fine_estimate: estimate})).toBe(true);
    expect(await deriveFact({...payload, fine_estimate: estimate})).toMatchObject({fine_estimate_won:40000,fine_estimate_rule:'parking',fine_estimate_rule_version:'2026-10-11.4'});
    expect(await deriveFact(payload)).toMatchObject({fine_estimate_won:null,fine_estimate_rule:null,fine_estimate_rule_version:null});
    expect(await sha256Hex(canonicalJson(payload))).toBe(vectors.cases[0].payload_sha256);
  });
  it.each([null, {}, {...estimate,won:0}, {...estimate,won:-1}, {...estimate,won:1.5}, {...estimate,won:100000001},
    {...estimate,won:'40000'}, {...estimate,rule:'new-rule'}, {...estimate,rule_version:'a'.repeat(41)}, {...estimate,rule_version:null},
    {...estimate,extra:'raw photo time'}])('rejects invalid values %j', value => {
    expect(isObservation({...payload,fine_estimate:value})).toBe(false);
  });
  it('accepts bounds and all rule IDs', () => {
    for (const rule of ['bus_lane','parking','hydrant','school_zone','ev_charging','disabled_parking','fire_lane','waste','overnight_truck']) {
      expect(isObservation({...payload,fine_estimate:{...estimate,won:1,rule,rule_version:'가'.repeat(40)}})).toBe(true);
    }
    expect(isObservation({...payload,fine_estimate:{...estimate,won:100000000}})).toBe(true);
  });
});

describe('separate all/mine estimate summaries', () => {
  it('uses consent, completion cohort and excludes confirmed amounts including zero', () => {
    expect(dash.overview.fine_estimate).toEqual({count:2,sum_won:120000,mean_won:60000});
    expect(dash.overview.fine_amount?.sum_won).toBe(50000);
    expect(cmp.all.fine_estimate).toEqual(dash.overview.fine_estimate);
    expect(cmp.mine.fine_estimate).toEqual({count:1,sum_won:40000,mean_won:40000});
    expect(personalCompareSchema.safeParse(cmp).success).toBe(true);
    expect(overviewSchema.safeParse(dash.overview).success).toBe(true);
    expect(consistentWithPublic(cmp,dash.overview)).toBe(true);
    expect(consistentWithPublic({...cmp,all:{...cmp.all,fine_estimate:{count:1,sum_won:1,mean_won:1}}},dash.overview)).toBe(false);
    expect(fineEstimateSummary([])).toEqual({count:0,sum_won:null,mean_won:null});
    expect(fineEstimateSummary([fact({amount_kind:'unknown'})]).count).toBe(1);
  });
  it('obeys selected report-date cohort, with no completion-date fallback', () => {
    const undated = fact({completed_date:null});
    expect(aggregateDashboard([undated],scope,opts).overview.fine_estimate?.count).toBe(0);
    expect(aggregateDashboard(facts,{...scope,date_basis:'report_date'},opts).overview.fine_estimate?.count).toBe(3);
  });
  it('counts all representatives once and retains own contribution', () => {
    const shared = [fact({report_identity:'r',is_representative:true,contributor_id:'other'}),fact({report_identity:'r',is_representative:false})];
    const r = aggregateCompare(shared,scope,'viewer',{...opts,viewer});
    expect(r.all.fine_estimate?.count).toBe(1); expect(r.mine.fine_estimate?.count).toBe(1);
  });
  it('decodes both compact SQL transports and rejects unknown columns', () => {
    const f = fact();
    for (const columns of [SCREEN_FACT_COLUMNS, SCREEN_FACT_COLUMNS.slice(0,-1)]) {
      const rows = [columns.map(key=>f[key])];
      expect(decodeScreenFacts({encoding:'columns-v1',columns,rows})?.[0].fine_estimate_won).toBe(columns.length===35?40000:undefined);
    }
    expect(decodeScreenFacts({encoding:'columns-v1',columns:['unknown'],rows:[[1]]})).toBeNull();
  });
});

it('production v2 maps SQL estimate tuples and distinguishes old response from empty new response', () => {
  const base: ScreenAggregate['stats'][number] = {side:'all' as const,period:0,kind:'summary',k:'',focus:'',ord:0,label:[null,'기관 없음',null,null],
    n:2,c:2,a:2,p:0,r:0,f:2,w:0,penalty:0,places:0,missing:0,answer_missing:0,
    duration:[0,null,null,null,null,null,0,0,0],amount:[0,null,null,0,2,0,0,0,0],rating:[0,null],histogram:Array(13).fill(0),ratings:Array.from({length:6},()=>[0,0,0,0,0])};
  const aggregate = {encoding:'screen-aggregate-v2',estimate_version:1,stats:[{...base,estimate:[2,120000]},{...base,side:'mine',estimate:[1,40000]}],anchors:[],full:[],
    vehicles:{identifiable:0,top:[],days:[0,0,0,0],excluded:[0,0]},source_min:null} as ScreenAggregate;
  const state = {...demoMeta(),ready:true};
  const s = new ScreenAggregates(aggregate,scope,state);
  expect(s.overview().fine_estimate).toEqual(cmp.all.fine_estimate);
  expect(s.compare({...viewer,user_ok:true,kakao:true,session:true}).mine.fine_estimate).toEqual(cmp.mine.fine_estimate);
  expect(new ScreenAggregates({...aggregate,stats:[]},scope,state).overview().fine_estimate).toEqual({count:0,sum_won:null,mean_won:null});
  expect(new ScreenAggregates({...aggregate,estimate_version:undefined,stats:[]},scope,state).overview().fine_estimate).toBeUndefined();
});

it('renders estimates, own counts, average, guide and absent states without calling them confirmed amounts', () => {
  const personal = {status:'ready' as const,data:cmp,error:null,retry:()=>{}};
  const props = {focus:{kind:'nation' as const,label:'전국',basis:scope.date_basis,start:scope.start,end:scope.end},overview:dash.overview,
    state:'ready' as const,showMine:true,unsupported:false,detail:null,personal};
  const html = renderToStaticMarkup(<KpiPanel {...props}/>);
  // dotParts (components/dotParts.tsx, U-letter-break fix) renders each " · "-joined piece as its own unbreakable
  // <span class="nb">, joined by a plain breakable space — same words, new markup (never a mid-number-and-unit break).
  expect(html).toContain('추정 과태료(법정 최저 기준)');
  expect(html).toContain('<span class="nb">120,000원</span> <span class="nb">· 2건</span>');
  expect(html).toContain('<span class="nb">· 내 40,000원</span> <span class="nb">· 1건</span>');
  expect(renderToStaticMarkup(<KpiPanel {...props} overview={{...dash.overview,fine_estimate:undefined}}/>)).toContain('제공 안 됨');
  expect(renderToStaticMarkup(<KpiPanel {...props} overview={{...dash.overview,fine_estimate:{count:0,sum_won:null,mean_won:null}}}/>)).toContain('추정 자료 없음');
  const detail = renderToStaticMarkup(<CompareKpis overview={dash.overview} personal={personal} compareOn auth={{status:'signed_in'} as never} onSignIn={()=>{}} unsupported={false}/>);
  expect(detail).toContain('평균 60,000원'); expect(detail).toContain('평균 40,000원');
  expect(renderToStaticMarkup(<DataGuide data={dash}/>)).toContain('답변에 금액이 없는 과태료를 법정 최저 기준으로 계산한 값');
});
