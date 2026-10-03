import { kstMonth, type RankingQuery } from '../../contracts/user-rankings/types';

export const RANKING_THEME_METRICS: Record<RankingQuery['theme'], RankingQuery['metric'][]> = {
  reporters: ['reports_count'],
  fines: ['fine_count', 'fine_rate'],
  unlucky: ['rejected_count', 'rejected_rate', 'partial_count', 'partial_rate'],
};
export const RANKING_PRESETS = [
  { id: 'reporters', theme: 'reporters', period: 'all', label: '최다 신고자' },
  { id: 'fines', theme: 'fines', period: 'all', label: '최다 과태료 수용자' },
  { id: 'unlucky', theme: 'unlucky', period: 'all', label: '최다 불운자' },
  { id: 'reporters-month', theme: 'reporters', period: 'month', label: '월별 최다 신고자' },
  { id: 'fines-month', theme: 'fines', period: 'month', label: '월별 최다 과태료 수용자' },
  { id: 'unlucky-month', theme: 'unlucky', period: 'month', label: '월별 불운자' },
] as const;
export type RankingPreset = typeof RANKING_PRESETS[number];
export interface RankingViewDraft {
  theme: RankingQuery['theme']; metric: RankingQuery['metric']; period: RankingQuery['period']; month: string;
}
/** Monthly themes share the selected month and every other filter; a non-monthly preset keeps a custom range. */
export function selectRankingPreset<T extends RankingViewDraft>(draft: T, preset: RankingPreset): Omit<T, keyof RankingViewDraft> & RankingViewDraft {
  const metrics = RANKING_THEME_METRICS[preset.theme];
  return { ...draft, theme: preset.theme, metric: metrics.includes(draft.metric) ? draft.metric : metrics[0],
    period: preset.period === 'month' ? 'month' : draft.period === 'range' ? 'range' : 'all',
    month: draft.month || kstMonth() };
}
export function rankingTitle(query: Pick<RankingQuery, 'theme' | 'period' | 'month'>, now = new Date()): string {
  const name = query.theme === 'reporters' ? '최다 신고자' : query.theme === 'fines' ? '최다 과태료 수용자' : '최다 불운자';
  if (query.period !== 'month') return name;
  const month = query.month ?? kstMonth(now);
  const monthlyName = query.theme === 'unlucky' ? '불운자' : name;
  if (month === kstMonth(now)) return `이달의 ${monthlyName}`;
  const [year, m] = month.split('-');
  return `${year}년 ${Number(m)}월의 ${monthlyName}`;
}
