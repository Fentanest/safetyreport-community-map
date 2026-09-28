import { describe, expect, it } from 'vitest';
import { aggregateDashboard, type PrivateFact } from '../../server/aggregate';
import { aggregateCompare } from '../../server/compare';
import { classifyAmount, fineAmountSummary } from '../../server/amount';
import { consistentWithPublic } from '../../src/data/personal';
import type { Scope } from '../../src/domain/public';

let n = 0;
const fine = (won: number | null, patch: Partial<PrivateFact> = {}): PrivateFact => ({
  fact_identity: `f${n++}`, contributor_id: 'c1', snapshot_id: 's', snapshot_generation: 1,
  report_date: '2026-09-01', completed_date: '2026-09-05', category: 'parking', status: 'accepted', disposition: 'fine',
  vehicle_raw: null, point_key: null, lat: null, lng: null, address: null, region_code: '서울 중구',
  agency_key: 'a1', agency_name: '기관1', manager_key: 'm1', manager_name: '담당1',
  amount_kind: 'fine', amount_confirmed_won: won, amount_public: true, amount_stated: won !== null, ...patch,
});
const scope: Scope = { start: '2026-09-01', end: '2026-09-30', category: 'all', region_code: null, agency_key: null, manager_key: null, bbox: null, law: null };
const opts = { datasetVersion: 'v', sourceUpdatedAt: null, generatedAt: '2026-09-27T00:00:00Z', asOf: '2026-12-31', sample: false, dataMin: '2020-01-01' };

describe('classification of one answered fact', () => {
  it('confirmed only when disposition, kind and status agree and the amount is published', () => {
    expect(classifyAmount(fine(40000))).toBe('confirmed');
    expect(classifyAmount(fine(40000, { status: 'partial' }))).toBe('confirmed');
    expect(classifyAmount(fine(0))).toBe('confirmed'); // an explicit 0원 is a real 0
  });
  it('a missing amount is unconfirmed, never 0', () => {
    expect(classifyAmount(fine(null))).toBe('unconfirmed');
    expect(classifyAmount(fine(null, { amount_kind: 'unknown' }))).toBe('conflict'); // disposition fine without a fine kind
  });
  it('amounts the consent policy does not publish are undisclosed (value never used)', () => {
    expect(classifyAmount(fine(null, { amount_public: false, amount_stated: true }))).toBe('undisclosed');
    expect(classifyAmount(fine(null, { amount_public: false, amount_stated: false }))).toBe('unconfirmed');
    // even if a value leaked into the fact, an unpublished amount is not summed
    expect(classifyAmount(fine(50000, { amount_public: false }))).toBe('undisclosed');
  });
  it('conflicting fields are excluded and counted', () => {
    expect(classifyAmount(fine(40000, { disposition: 'warning' }))).toBe('conflict');
    expect(classifyAmount(fine(40000, { status: 'rejected' }))).toBe('conflict');
    expect(classifyAmount(fine(40000, { amount_kind: 'penalty' }))).toBe('conflict');
  });
  it('범칙금 and inseparable amounts are never added to 과태료', () => {
    expect(classifyAmount(fine(null, { disposition: 'none', amount_kind: 'penalty' }))).toBe('penalty');
    expect(classifyAmount(fine(90000, { amount_kind: 'combined' }))).toBe('combined');
    expect(classifyAmount(fine(null, { disposition: 'none', amount_kind: 'unknown' }))).toBe('none');
  });
});

describe('summary', () => {
  it('sums exact won, keeps 0원 apart from missing and flags partial coverage', () => {
    const s = fineAmountSummary([fine(40000), fine(0), fine(80000), fine(null),
      fine(null, { amount_public: false, amount_stated: true }), fine(70000, { amount_kind: 'combined' }),
      fine(null, { disposition: 'none', amount_kind: 'penalty' })]);
    expect(s).toMatchObject({
      fine_count: 6, confirmed_count: 3, sum_won: 120000, mean_won: 40000, median_won: 40000, zero_count: 1,
      unconfirmed_count: 1, undisclosed_count: 1, combined_count: 1, penalty_count: 1, conflict_count: 0, partial: true,
    });
  });
  it('no confirmed amount → null sum and mean, not 0원', () => {
    const s = fineAmountSummary([fine(null), fine(null, { amount_public: false })]);
    expect(s).toMatchObject({ confirmed_count: 0, sum_won: null, mean_won: null, median_won: null, partial: true });
    expect(fineAmountSummary([])).toMatchObject({ fine_count: 0, sum_won: null, partial: false });
  });
  it('large sums stay exact integers', () => {
    const many = Array.from({ length: 1000 }, () => fine(99_999_999));
    expect(fineAmountSummary(many).sum_won).toBe(99_999_999_000);
  });
  it('even count median averages the two middle values', () => {
    expect(fineAmountSummary([fine(40000), fine(50000)]).median_won).toBe(45000);
  });
});

describe('dashboard and personal comparison', () => {
  const facts = [
    fine(40000, { contributor_id: 'me' }), fine(null, { contributor_id: 'me' }),
    fine(80000), fine(60000), fine(null, { amount_public: false }),
    fine(null, { disposition: 'none', amount_kind: 'penalty', report_date: '2026-09-02' }),
  ];
  const data = aggregateDashboard(facts, scope, opts);
  const cmp = aggregateCompare(facts, scope, 'me', {
    datasetVersion: 'v', asOf: '2026-12-31', dataMin: '2020-01-01', viewer: { contributor: 'active', has_public_facts: true },
  });

  it('public overview carries only aggregates and the capability states coverage', () => {
    expect(data.overview.fine_amount).toMatchObject({ fine_count: 5, confirmed_count: 3, sum_won: 180000, partial: true });
    expect(data.meta.capabilities.fine_amount).toMatchObject({ status: 'supported' });
    expect(JSON.stringify(data)).not.toMatch(/amount_confirmed_won|amount_public|amount_stated/);
  });
  it('all side equals the public numbers; mine is a subset in counts and sum', () => {
    expect(cmp.all.fine_amount).toMatchObject({ confirmed_count: 3, sum_won: 180000 });
    expect(cmp.mine.fine_amount).toMatchObject({ fine_count: 2, confirmed_count: 1, sum_won: 40000, unconfirmed_count: 1, partial: true });
    expect(cmp.mine.fine_amount.confirmed_count).toBeLessThanOrEqual(cmp.all.fine_amount.confirmed_count);
    expect(cmp.mine.fine_amount.sum_won!).toBeLessThanOrEqual(cmp.all.fine_amount.sum_won!);
    expect(consistentWithPublic(cmp, data.overview)).toBe(true);
  });
  it('diff: share of the sum and mean difference in won', () => {
    expect(cmp.diff.fine_amount_sum_share).toBeCloseTo(40000 / 180000 * 100);
    expect(cmp.diff.fine_amount_mean_won_diff).toBe(40000 - 60000);
  });
  it('a mismatching public amount withholds the personal columns', () => {
    const other = { ...data.overview, fine_amount: { ...data.overview.fine_amount!, sum_won: 170000 } };
    expect(consistentWithPublic(cmp, other)).toBe(false);
  });
  it('no confirmed amount on the all side → no share (never 0%)', () => {
    const none = aggregateCompare([fine(null, { contributor_id: 'me' })], scope, 'me', {
      datasetVersion: 'v', asOf: '2026-12-31', dataMin: '2020-01-01', viewer: { contributor: 'active', has_public_facts: true },
    });
    expect(none.diff.fine_amount_sum_share).toBeNull();
    expect(none.diff.fine_amount_mean_won_diff).toBeNull();
  });
});
