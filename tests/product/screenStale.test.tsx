import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createScreenHandler } from '../../server/screenHandler';
import { applySnapshotComparison } from '../../server/screenSnapshots';
import { aggregateCompare, diffOf } from '../../server/compare';
import { demoFacts, demoMeta, DEMO_VIEWER_ID, DEMO_AS_OF, DEMO_DATA_MIN } from '../../src/data/demoEngine';
import { DEMO_SCOPE } from '../../src/domain/public';
import { personalCompareSchema } from '../../src/data/personal';
import { snapshotTime, snapshotBasis } from '../../src/components/snapshotTime';
import CompareKpis from '../../src/components/CompareKpis';
import KpiPanel from '../../src/components/KpiPanel';
const state = { ...demoMeta(), ready: true, coverage_note: 'synthetic', dedupe_policy_version: 'contribution-dedupe-v1' };
const viewer = { user_ok: true, kakao: true, session: true, contributor: 'active' as const, has_public_facts: true, public_fact_count: 10 };
const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: DEMO_VIEWER_ID, role: 'authenticated', aud: 'authenticated', session_id: '11111111-2222-4333-8444-555555555555' })).toString('base64url')}.sig`;
const q = new URLSearchParams({ date_basis: DEMO_SCOPE.date_basis, start: DEMO_SCOPE.start, end: DEMO_SCOPE.end, category: DEMO_SCOPE.category });
const compare = () => aggregateCompare(demoFacts(), DEMO_SCOPE, DEMO_VIEWER_ID, { datasetVersion: 'fixture', asOf: DEMO_AS_OF, dataMin: DEMO_DATA_MIN, viewer: { contributor: viewer.contributor, has_public_facts: true } });

describe('stale screen compatibility and comparisons', () => {
  it.each([undefined, 'rpc PGRST202', 'rpc 42883', 'rpc 57014', 'rpc 42501'])('new Edge falls back only for missing RPC: %s', async failure => {
    const calls: string[]=[];
    const handler=createScreenHandler({ enabled:true,allowedOrigins:[],jwtIssuer:null,getUser:async()=>({id:DEMO_VIEWER_ID,isAnonymous:false}),rpc:async name=>{
      calls.push(name);if(name.endsWith('rate_limit'))return true;
      if(name==='internal_analytics_screen_stale'&&failure)throw new Error(failure);
      return {state,viewer,facts:demoFacts()};
    }});
    const res=await handler(new Request(`https://local.invalid/my-analytics/screen?${q}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json; screen-cache=stale-v2'}}));
    const fallback=failure==='rpc PGRST202'||failure==='rpc 42883';
    expect(res.status).toBe(!failure||fallback?200:503);
    expect(calls.includes('internal_analytics_screen_cached')).toBe(fallback);
  });
  it('mixed versions keep mine > all, preserve comparisons and suppress only shared-place claims, and pass strict schema', () => {
    const input=compare(); input.mine.report_count=input.all.report_count+100; input.diff=diffOf(input.all,input.mine);
    const result=applySnapshotComparison(input,{public_at:'2026-10-12T08:01:00Z',personal_at:'2026-10-12T08:02:00Z',comparable:false});
    expect(result.mine.report_count).toBeGreaterThan(result.all.report_count);
    expect(result.diff).toEqual(input.diff);
    expect(result.diff.report_share).toBeGreaterThan(100);
    expect(result.regions).toEqual(input.regions);
    expect(result.agencies).toEqual(input.agencies);
    expect(result.managers).toEqual(input.managers);
    expect(result.my_points.every(p=>p.shared===null)).toBe(true);
    personalCompareSchema.parse(result);
    for (const field of ['report_share','completed_share','fine_share','point_share','fine_amount_sum_share'] as const) {
      expect(personalCompareSchema.safeParse({...result,diff:{...result.diff,[field]:125}}).success).toBe(true);
      expect(personalCompareSchema.safeParse({...result,diff:{...result.diff,[field]:-1}}).success).toBe(false);
    }
    expect(personalCompareSchema.safeParse({...result,mine:{...result.mine,accept_rate:101}}).success).toBe(false);
    const html=renderToStaticMarkup(<KpiPanel focus={{kind:'nation',label:'전국',basis:'completed_date',start:DEMO_SCOPE.start,end:DEMO_SCOPE.end}}
      snapshotAt={result.snapshots!.public_at} overview={null} state="ready" personal={{status:'ready',data:result,error:null,retry:()=>{}}} showMine unsupported={false} detail={null}/>);
    expect(html).toContain('전체 ');expect(html).toContain('17:01:00');expect(html).toContain('17:02:00');expect(html).not.toContain('표시하지 않습니다');
  });
  it.each([99, 100, 125, null])('share %s has a cell note only above 100; zero denominators stay missing', share => {
    const input=compare();
    input.diff={...input.diff,report_share:share,completed_share:share,point_share:share,fine_amount_sum_share:share};
    const result=applySnapshotComparison(input,{public_at:'2026-10-12T08:01:00Z',personal_at:'2026-10-12T08:02:00Z',comparable:false});
    const metric={value:1,denominator:null,eligible:1,missing:0,delta_reason:null,previous:null,delta:null,delta_percent:null,basis:'completed_date' as const};
    const overview={report_count:metric,completed_count:metric,fine_count:metric,point_count:metric,contributor_count:metric,accepted_including_partial:{...metric,numerator:1,unit:'percent' as const},outcomes:null};
    const html=renderToStaticMarkup(<CompareKpis overview={overview} personal={{status:'ready',data:result,error:null,retry:()=>{}}}
      compareOn auth={{status:'signed_out',displayName:null,viewerId:null,synthetic:true,message:null}} onSignIn={()=>{}} unsupported={false}/>);
    expect((html.match(/최근 업로드 반영 차이/g)||[]).length).toBe(share !== null && share>100?4:0);
    if(share===125) expect((html.match(/125.0%/g)||[]).length).toBe(4);
    expect(html).toContain('17:01:00');expect(html).toContain('17:02:00');
  });
  it('zero denominators remain null with their reason even when snapshots differ',()=>{
    const input=aggregateCompare([],DEMO_SCOPE,DEMO_VIEWER_ID,{datasetVersion:'empty',asOf:DEMO_AS_OF,dataMin:DEMO_DATA_MIN,viewer:{contributor:'active',has_public_facts:true}});
    const result=applySnapshotComparison(input,{public_at:'2026-10-12T08:01:00Z',personal_at:'2026-10-12T08:02:00Z',comparable:false});
    expect(result.diff.report_share).toBeNull();expect(result.diff.accept_rate_pp).toBeNull();expect(result.diff.rate_reason).toBe('no_all');
  });
  it('same instant uses one timestamp; different times show both even for comparable versions',()=>{
    const at='2026-10-12T08:01:00Z';
    expect(snapshotBasis(at,'2026-10-12T17:01:00+09:00')).toBe(`전체 · 내 신고 ${snapshotTime(at)} 기준`);
    expect(snapshotBasis(at,'2026-10-12T08:02:00Z')).toContain('내 신고');
    expect(snapshotBasis(at)).not.toContain('내 신고');
  });
  it('same dataset preserves comparisons; old packets stay unchanged',()=>{
    const input=compare();expect(applySnapshotComparison(input)).toBe(input);
    expect(applySnapshotComparison(input,{public_at:'2026-10-12T08:01:00Z',personal_at:'2026-10-12T08:02:00Z',comparable:true}).diff).toEqual(input.diff);
    expect(snapshotTime('2026-10-12T15:01:00Z')).toContain('00:01:00');
  });
});
