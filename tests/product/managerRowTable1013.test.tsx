import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ManagerEntityTable, { ManagerTableFootnote } from '../../src/components/ManagerEntityTable';
import PlaceDetailsPanel from '../../src/components/PlaceDetailsPanel';
import ScopeDetailsPanel from '../../src/components/ScopeDetailsPanel';
import { entityRates } from '../../src/components/entityMetrics';
import { fmtCountRate, fmtInt, fmtPercent } from '../../src/components/format';
import { demoDashboard } from '../../src/data/demo';
import { DEMO_SCOPE, type DashboardData, type PublicEntity } from '../../src/domain/public';

/**
 * 2026-10-13 지도 폭 축소 + 담당자 한 행 표 (요구사항 2번).
 * 열: 담당자 | 답변 | 분류 | 수용률 | 일부수용률 | 불수용률 | 과태료 | 계도 — entityRates를 그대로 재사용하는지,
 * 서로 다른 분모(답변=completed_count, 분류=result_known, 과태료·계도는 completed_count)가 맞는지,
 * '59건 · 92.2%' 형식과 미제공/계산 불가/실제 0건 구분, 동명이인, 더 보기/기관 목록 비영향을 Synthetic data로만 검증한다.
 */
const row = (key: string, name: string | null, agency: string, patch: Partial<PublicEntity> = {}): PublicEntity => ({
  key, agency_key: key.split(':')[0], manager_key: key, agency_name: agency, manager_name: name, completed_count: 10,
  outcomes: { accepted: 5, partial: 2, rejected: 2, result_known: 9, result_unknown: 1 }, fine_count: 3, warning_count: 1,
  duration: null, fine_amount: null, rating: null, ...patch,
});
const numCells = (html: string) => [...html.matchAll(/<td class="num">([^<]*)<\/td>/g)].map((m) => m[1]);
const GANGSEO = '서울특별시경찰청 서울강서경찰서';
const YANGCHEON = '서울특별시경찰청 서울양천경찰서';

describe('fmtCountRate: 과태료·계도의 "59건 · 92.2%" 형식과 미제공/계산 불가/실제 0건 구분', () => {
  it('요구사항 예시 그대로', () => expect(fmtCountRate(59, 92.2)).toBe('59건 · 92.2%'));
  it('미제공(서버가 건수 자체를 안 줌) → 단 하나의 —', () => {
    expect(fmtCountRate(null, null)).toBe('—');
    expect(fmtCountRate(undefined, undefined)).toBe('—');
  });
  it('계산 불가(건수는 있는데 분모가 0) → 건수는 보이고 비율만 —', () => {
    expect(fmtCountRate(0, null)).toBe('0건 · —');
  });
  it('실제 0건(분모 > 0) → 0.0%', () => {
    expect(fmtCountRate(0, 0)).toBe('0건 · 0.0%');
  });
});

describe('ManagerEntityTable: 담당자 한 명 = 한 행, 기존 entityRates와 수치 일치', () => {
  const e = row('a1:m1', '김하늘', '갑 경찰서'); // C=10, K=9, F=3, W=1
  const m = entityRates(e);
  const html = renderToStaticMarkup(<ManagerEntityTable rows={[e]} activeAgency={null} activeManager={null} onPick={() => {}} />);

  it('머리글이 요구사항 순서 그대로: 담당자 | 답변 | 분류 | 수용률 | 일부수용률 | 불수용률 | 과태료 | 계도', () => {
    const headers = [...html.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((x) => x[1]);
    expect(headers).toEqual(['담당자', '답변', '분류', '수용률', '일부수용률', '불수용률', '과태료', '계도']);
  });

  it('하나의 <tr>에 모든 지표가 담긴다(담당자마다 별도 카드가 아니다)', () => {
    const tbody = html.match(/<tbody>([\s\S]*)<\/tbody>/)![1];
    expect(tbody.match(/<tr/g)).toHaveLength(1);
  });

  it('cell 값이 entityRates(e)와 정확히 같다 — 중복 재계산이 아니라 그대로 재사용', () => {
    expect(numCells(html)).toEqual([
      fmtInt(m.C), fmtInt(m.K), fmtPercent(m.accept), fmtPercent(m.partial), fmtPercent(m.reject),
      fmtCountRate(m.F, m.fineRate), fmtCountRate(m.W, m.warnRate),
    ]);
  });

  it('답변(completed_count)과 분류(result_known)는 서로 다른 분모 — 같은 숫자가 아니다', () => {
    expect(m.C).toBe(10);
    expect(m.K).toBe(9);
    expect(m.C).not.toBe(m.K);
    expect(html).toContain('<td class="num">10</td>');
    expect(html).toContain('<td class="num">9</td>');
  });

  it('과태료·계도는 completed_count를 분모로 "건 · %" 형식', () => {
    expect(m.fineRate).toBeCloseTo(30, 1); // 3/10*100
    expect(m.warnRate).toBeCloseTo(10, 1); // 1/10*100
    expect(html).toContain('3건 · 30.0%');
    expect(html).toContain('1건 · 10.0%');
  });

  it('이름 셀에 소속 기관을 함께 보여주고, 선택 가능한 버튼이다', () => {
    expect(html).toContain('table-name');
    expect(html).toContain('갑 경찰서');
    expect(html).toMatch(/<button type="button" class="mini-btn table-pick"/);
    expect(html).toContain('<small title="갑 경찰서">갑 경찰서</small>');
  });

  it('active 담당자는 class="active"가 붙는다', () => {
    const activeHtml = renderToStaticMarkup(<ManagerEntityTable rows={[e]} activeAgency="a1" activeManager="a1:m1" onPick={() => {}} />);
    expect(activeHtml).toContain('<tr class="active">');
  });
});

describe('ManagerEntityTable: 미제공 · 계산 불가 · 실제 0건을 한 표 안에서 구분', () => {
  it('fine_count 미제공(older server)은 — 하나, warning_count 실제 0건은 0.0%', () => {
    const e = row('a2:m2', '박서준', '을 구청', { fine_count: null, warning_count: 0 });
    const html = renderToStaticMarkup(<ManagerEntityTable rows={[e]} activeAgency={null} activeManager={null} onPick={() => {}} />);
    const cells = numCells(html);
    expect(cells[5]).toBe('—'); // 과태료: 미제공
    expect(cells[6]).toBe('0건 · 0.0%'); // 계도: 실제 0건(분모 10 > 0)
  });
  it('completed_count가 0이면(계산 불가) 과태료 0건이라도 비율은 —', () => {
    const e = row('a3:m3', '이도윤', '병 구청', {
      completed_count: 0, outcomes: { accepted: 0, partial: 0, rejected: 0, result_known: 0, result_unknown: 0 },
      fine_count: 0, warning_count: 0,
    });
    const html = renderToStaticMarkup(<ManagerEntityTable rows={[e]} activeAgency={null} activeManager={null} onPick={() => {}} />);
    const cells = numCells(html);
    expect(cells[0]).toBe('0'); // 답변
    expect(cells[1]).toBe('0'); // 분류
    expect(cells[2]).toBe('—'); // 수용률: K=0이라 계산 불가
    expect(cells[5]).toBe('0건 · —'); // 과태료: 건수는 0으로 알지만 분모(답변)가 0이라 비율 계산 불가
  });
});

describe('ManagerEntityTable: 동명이인은 이름만으로 합치지 않고 기존 식별자(소속 기관)로 구분', () => {
  it('다른 기관의 같은 이름 두 담당자는 각각 소속 기관이 붙어 구분된다', () => {
    const rows = [row('A:1', '김지원', GANGSEO), row('B:2', '김지원', YANGCHEON)];
    const html = renderToStaticMarkup(<ManagerEntityTable rows={rows} activeAgency={null} activeManager={null} onPick={() => {}} />);
    expect(html).toContain('김지원 (서울강서경찰서)');
    expect(html).toContain('김지원 (서울양천경찰서)');
  });
});

describe('ManagerTableFootnote: 표 아래 지표별 분모 설명', () => {
  it('답변·분류·과태료·계도의 분모를 설명한다', () => {
    const html = renderToStaticMarkup(<ManagerTableFootnote />);
    expect(html).toContain('답변완료');
    expect(html).toContain('분류');
    expect(html).toMatch(/과태료|계도/);
  });
});

describe('PlaceDetailsPanel: 담당자는 표, 기관 카드는 그대로 — 더 보기 유지', () => {
  const base = demoDashboard(DEMO_SCOPE, 'overview');
  const point = base.points[0];
  const managers = Array.from({ length: 10 }, (_, i) => row(`m${i}:k${i}`, `담당${i}`, '예시 기관'));
  const agencies = [{ key: 'ag1', agency_key: 'ag1', manager_key: null, agency_name: '예시 기관', manager_name: null,
    completed_count: 40, outcomes: { accepted: 20, partial: 10, rejected: 10, result_known: 40, result_unknown: 0 }, fine_count: 5 }];
  const detail = { status: 'ready' as const, detail: {
    dataset_version: 'v', scope: DEMO_SCOPE, place: point, agencies, managers, agency_total: 1, manager_total: 10,
  } };
  const html = renderToStaticMarkup(
    <PlaceDetailsPanel point={point} detail={detail} scopeLabel="전국" onClose={() => {}} onRetry={() => {}}
      onPickEntity={() => {}} toast={() => {}} activeAgency={null} activeManager={null} />,
  );

  it('담당자 섹션은 entity-table(한 행 표)을 쓴다', () => {
    expect(html).toContain('manager-entity-table');
    expect((html.match(/manager-entity-table/g) ?? []).length).toBeGreaterThan(0);
  });
  it('기관 섹션은 기존 pe-row 카드 그대로(이번 변경 범위 밖)', () => {
    expect(html).toContain('pe-row');
  });
  it('담당자 10명 중 6명만 보이고 "더 보기 · 4"가 뜬다(일부 목록이 전체 정렬처럼 보이지 않게 — 이 패널의 "더 보기" 임계값은 LIST_STEP=6)', () => {
    expect(html).toContain('더 보기 · 4');
  });
  it('표 아래 분모 설명(footnote)이 붙는다', () => {
    expect(html).toContain('manager-table-note');
  });
});

describe('ScopeDetailsPanel: 지역/전국 범위 상세도 같은 담당자 표를 공유', () => {
  const base = demoDashboard(DEMO_SCOPE, 'overview');
  const managers = Array.from({ length: 8 }, (_, i) => row(`sm${i}:sk${i}`, `범위담당${i}`, '예시 기관'));
  const data: DashboardData = { ...base, managers, manager_total: 20, agencies: base.agencies, agency_total: base.agencies.length };
  const html = renderToStaticMarkup(
    <ScopeDetailsPanel scope={DEMO_SCOPE} data={data} version="v" autoRefresh={false} busy={false}
      onPickRegion={() => {}} onPickEntity={() => {}} onMakeStatistics={() => {}} activeAgency={null} activeManager={null} conditions="" />,
  );
  it('담당자 탭도 manager-entity-table을 쓴다(주소별 상세와 공통 컴포넌트)', () => {
    expect(html).toContain('manager-entity-table');
  });
  it('로딩된 8명 중 5명(PREVIEW)만 보이고 더 보기가 남는다 — 일부만 받은 목록을 전체처럼 보이지 않게', () => {
    expect(html).toContain('>더 보기<');
  });
});
