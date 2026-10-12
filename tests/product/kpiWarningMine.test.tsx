import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { aggregateDashboard, type PrivateFact } from '../../server/aggregate';
import { aggregateCompare } from '../../server/compare';
import { personalCompareSchema } from '../../src/data/personal';
import type { PersonalCompare } from '../../src/domain/personal';
import type { Scope } from '../../src/domain/public';
import KpiPanel from '../../src/components/KpiPanel';

/**
 * 2026-10-12: KPI 하단 줄 '계도'에 '내 신고' 값 병기 (CompareSummary.warning_count, server/compare.ts summarize()가
 * 공개 Overview.warning_count(S01, server/aggregate.ts)와 같은 정의로 채움). 고정 사실 6건(시청자 2건 · 다른 사람 4건)으로
 * 정확한 숫자를 검증하고, 구버전 Edge 응답(필드 없음)에서도 화면이 깨지지 않는지 확인한다.
 */
let n = 0;
const f = (patch: Partial<PrivateFact>): PrivateFact => {
  n += 1;
  return {
    fact_identity: `w-${n}`, contributor_id: 'other', snapshot_id: 's', snapshot_generation: 1,
    report_date: '2026-09-01', completed_date: '2026-09-05', category: 'traffic', status: 'accepted', disposition: 'none',
    vehicle_raw: null, point_key: null, lat: null, lng: null, address: null, region_code: null,
    agency_key: 'a1:x', agency_name: '예시 기관', manager_key: 'm1:x', manager_name: '김하늘', ...patch,
  };
};
const facts: PrivateFact[] = [
  f({ contributor_id: 'viewer', disposition: 'warning' }),
  f({ contributor_id: 'viewer', disposition: 'none' }),
  f({ disposition: 'warning' }),
  f({ disposition: 'warning' }),
  f({ disposition: 'fine' }),
  f({ disposition: 'none' }),
];
const scope: Scope = { date_basis: 'completed_date', start: '2026-09-01', end: '2026-09-05', category: 'all',
  region_code: null, agency_key: null, manager_key: null, bbox: null, law: null };
const dashOpts = { datasetVersion: 't', sourceUpdatedAt: null, generatedAt: '2026-09-05T00:00:00Z', asOf: '2026-09-05', sample: false, dataMin: '2026-09-01' };
const compareOpts = { datasetVersion: 't', asOf: '2026-09-05', dataMin: '2026-09-01', viewer: { contributor: 'active' as const, has_public_facts: true } };

const pub = aggregateDashboard(facts, scope, dashOpts);
const cmp = aggregateCompare(facts, scope, 'viewer', compareOpts);

const baseProps = {
  focus: { kind: 'nation' as const, label: '전국', basis: scope.date_basis, start: scope.start, end: scope.end },
  overview: pub.overview, state: 'ready' as const, showMine: true, unsupported: false, detail: null,
};

const warningRow = (html: string): string => html.match(/<div data-kpi="warning">[\s\S]*?<\/div>/)?.[0] ?? '';

describe('KPI 하단 줄 — 계도에 내 신고 병기 (2026-10-12)', () => {
  it('server: all/mine은 3건/1건, 비율은 50.0%/50.0% (disposition=warning ÷ 완료 건수)', () => {
    expect(pub.overview.warning_count).toBe(3);
    expect(cmp.all.warning_count).toBe(3);
    expect(cmp.mine.warning_count).toBe(1);
    expect(cmp.mine.completed_count).toBe(2);
    expect(personalCompareSchema.safeParse(JSON.parse(JSON.stringify(cmp))).success).toBe(true);
  });

  it('화면: 전체 줄과 같은 mine-col 표기로 내 건수·비율을 병기한다', () => {
    const personal = { status: 'ready' as const, data: cmp, error: null, retry: () => {} };
    const html = renderToStaticMarkup(<KpiPanel {...baseProps} personal={personal} />);
    const row = warningRow(html);
    expect(row).toContain('>계도<');
    // dotParts (components/dotParts.tsx, U-letter-break fix): each " · "-joined piece is its own unbreakable
    // <span class="nb">, joined by a plain breakable space — same words, new markup.
    expect(row).toContain('<span class="dp">3건</span> <span class="dp">·\u00A050.0%</span>'); // 전체
    expect(row).toContain('class="mine-col"');
    expect(row).toContain('<span class="dp">·\u00A0내\u00A01건</span> <span class="dp">·\u00A050.0%</span>'); // 내 신고
  });

  it('비교 꺼짐·장소 포커스에서는 내 값을 보이지 않는다(기존 규칙)', () => {
    const personal = { status: 'ready' as const, data: cmp, error: null, retry: () => {} };
    expect(warningRow(renderToStaticMarkup(<KpiPanel {...baseProps} personal={personal} showMine={false} />))).not.toContain('mine-col');
    expect(warningRow(renderToStaticMarkup(
      <KpiPanel {...baseProps} personal={personal} focus={{ ...baseProps.focus, kind: 'place' }} />,
    ))).not.toContain('mine-col');
  });

  it('구버전 Edge 응답(warning_count 없음)에서도 화면이 깨지지 않고 내 값 줄만 생략한다', () => {
    const older: PersonalCompare = { ...cmp, mine: { ...cmp.mine, warning_count: undefined } };
    const personal = { status: 'ready' as const, data: older, error: null, retry: () => {} };
    const html = renderToStaticMarkup(<KpiPanel {...baseProps} personal={personal} />);
    const row = warningRow(html);
    expect(row).toContain('<span class="dp">3건</span> <span class="dp">·\u00A050.0%</span>'); // 전체 값은 그대로
    expect(row).not.toContain('mine-col'); // 내 값 줄만 생략, 0건으로 표시되지 않음
    expect(row).not.toContain('0건');
  });
});
