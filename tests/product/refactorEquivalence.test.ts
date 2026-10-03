import { beforeEach,describe,expect,it,vi } from 'vitest';
import golden from '../../docs/refactoring/map-performance/evidence/before/oracle-responses.json';
import { createPublicHandler } from '../../server/publicHandler';
import { aggregateDashboard, entityRows, seriesOf } from '../../server/aggregate';
import { oracleFacts, oracleState } from './helpers/refactorOracle';
import { fixtureAccess,viewerRequest } from './helpers/mapViewer';
vi.mock('../../server/aggregate',async importOriginal=>{
 const real=await importOriginal<typeof import('../../server/aggregate')>();
 return {...real,aggregateDashboard:vi.fn(real.aggregateDashboard),entityRows:vi.fn(real.entityRows),seriesOf:vi.fn(real.seriesOf)};
});
const handler=()=>createPublicHandler({getState:async()=>oracleState,getFacts:async()=>oracleFacts,allowRequest:async()=>true},fixtureAccess());
const request=(path:string)=>viewerRequest('https://local.invalid/public-analytics/'+path);
const q='start=2026-01-01&end=2026-03-31&category=all&date_basis=completed_date';
beforeEach(()=>vi.clearAllMocks());
describe('refactor: captured original and independent small oracle',()=>{
 it('preserves every response field for both dates, every global sort/direction, page 2 and search/type filtering',async()=>{
  const run=handler();
  for(const previous of golden.results){const r=await run(request(previous.path));expect(r.status,previous.path).toBe(previous.status);expect(await r.json(),previous.path).toEqual(previous.body);}
 });
 it('manual oracle: N=7 C=7 K=6 F=5; zero amounts, missing and reversed days have their own denominators',async()=>{
  const r=await handler()(request('dashboard?'+q));const data=await r.json();
  expect(data.overview.report_count.value).toBe(7);expect(data.overview.completed_count.value).toBe(7);
  expect(data.overview.outcomes).toEqual({accepted:4,partial:1,rejected:1,result_known:6,result_unknown:1});
  expect(data.overview.fine_count.value).toBe(5);
  expect(data.overview.accepted_including_partial).toMatchObject({numerator:5,denominator:6,value:500/6});
  expect(data.overview.processing_duration).toMatchObject({count:5,median_days:1,mean_days:.8,excluded:{no_report_date:1,reversed:1,no_answer_date:0}});
  expect(data.overview.fine_amount).toMatchObject({fine_count:5,confirmed_count:4,sum_won:40000,zero_count:3,undisclosed_count:1,mean_won:10000,partial:true});
  expect(data.overview.rating).toEqual({count:5,mean:4.2});
  expect(data.monthly.map((m:{report_count:number})=>m.report_count)).toEqual([0,7,0]);
  expect(JSON.stringify(data)).not.toMatch(/synthetic-a|synthetic-b|oracle-[0-9]|"s2"/);
 });
 it('entities builds only its requested grouping; series never builds the dashboard or either entity list',async()=>{
  await handler()(request('entities?kind=manager&'+q));
  expect(aggregateDashboard).not.toHaveBeenCalled();expect(entityRows).toHaveBeenCalledTimes(1);expect(seriesOf).not.toHaveBeenCalled();
  vi.clearAllMocks();await handler()(request('series?'+q));
  expect(aggregateDashboard).not.toHaveBeenCalled();expect(entityRows).not.toHaveBeenCalled();expect(seriesOf).toHaveBeenCalledTimes(1);
 });
});
