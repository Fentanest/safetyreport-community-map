import { describe, expect, it } from 'vitest';
import { querySchema, monthBounds } from '../../contracts/user-rankings/types';
import { RANKING_PRESETS, rankingTitle, selectRankingPreset, type RankingViewDraft } from '../../src/domain/rankingPeriods';
const now = new Date('2026-09-30T15:00:00Z');
describe('ranking cumulative and shared monthly cohorts', () => {
  it.each(['all','range','month'] as const)('all three themes accept %s without metric or denominator substitution', period => {
    for (const [theme,metric] of [['reporters','reports_count'],['fines','fine_rate'],['unlucky','rejected_rate']] as const) {
      expect(querySchema.safeParse({theme,metric,period,...(period==='month'?{month:'2023-07'}:period==='range'?{start:'2023-07-01',end:'2023-07-31'}:{})}).success).toBe(true);
    }
  });
  it('rejects invalid months and conflicting dates for each theme', () => {
    for(const [theme,metric]of [['reporters','reports_count'],['fines','fine_count'],['unlucky','partial_count']]as const){
      for(const month of ['2023-00','2023-13','2023-7','2023-07-01'])expect(querySchema.safeParse({theme,metric,period:'month',month}).success).toBe(false);
      expect(querySchema.safeParse({theme,metric,period:'month',month:'2023-07',start:'2023-07-01'}).success).toBe(false);
    }
  });
  it('provides six distinct entries and preserves July2023 and date/filter conditions across monthly themes', () => {
    expect(new Set(RANKING_PRESETS.map(p=>p.id)).size).toBe(6);
    let draft: RankingViewDraft & {date_basis:'report_date';category:'parking';min_reports:string} = {theme:'reporters',metric:'reports_count',period:'all',month:'2023-07',date_basis:'report_date',category:'parking',min_reports:'1'};
    for(const preset of RANKING_PRESETS.filter(p=>p.period==='month')){
      const next=selectRankingPreset(draft,preset);
      expect(next).toMatchObject({month:'2023-07',period:'month',date_basis:'report_date',category:'parking',min_reports:'1'});
      expect(querySchema.safeParse({...next,min_reports:1}).success).toBe(true);
      draft = next;
    }
  });
  it('cumulative unlucky keeps all four outcome metrics and a custom range remains available', () => {
    const preset=RANKING_PRESETS.find(p=>p.id==='unlucky')!;
    const draft=selectRankingPreset({theme:'unlucky',metric:'partial_rate',period:'range',month:'2023-07',start:'2000-01-01',end:'2026-10-01'},preset);
    expect(draft).toMatchObject({metric:'partial_rate',period:'range',start:'2000-01-01',end:'2026-10-01'});
    expect(querySchema.parse({theme:'unlucky',metric:'partial_rate',period:'all'}).period).toBe('all');
  });
  it('titles use the selected month for every theme and KST midnight changes all current-month labels', () => {
    for(const theme of ['reporters','fines','unlucky']as const){
      expect(rankingTitle({theme,period:'month',month:'2023-07'},now)).toMatch(/^2023년 7월의 /);
      expect(rankingTitle({theme,period:'month',month:'2026-10'},now)).toMatch(/^이달의 /);
      expect(rankingTitle({theme,period:'month',month:'2026-09'},now)).toMatch(/^2026년 9월의 /);
      expect(rankingTitle({theme,period:'all',month:null},now)).not.toContain('이달');
    }
    expect(monthBounds('2023-07')).toEqual({start:'2023-07-01',end:'2023-07-31'});
    expect(monthBounds('2023-12').end).toBe('2023-12-31');
    expect(monthBounds('2024-02').end).toBe('2024-02-29');
  });
});
