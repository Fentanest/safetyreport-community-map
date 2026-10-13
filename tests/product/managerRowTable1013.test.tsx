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

describe('ManagerEntityTable P3 회귀(Astra 2026-10-13): 동명이인 라벨이 "더 보기" 전후로 안 바뀐다', () => {
  // same_name 서버 메타데이터가 없는(구서버/정적 스냅샷 fallback) 6행: 1번째·6번째가 같은 이름+같은 기관
  // (computeSameNames의 "같은 기관" 분기 → "…(시험기관 1번)" 서수 라벨까지 나온다, managerNames.ts 참고)
  const AG = '시험기관';
  const six = [
    row('시험:1', '김동명', AG), row('기타1:2', '박서준', '기타기관1'), row('기타2:3', '이서윤', '기타기관2'),
    row('기타3:4', '최하은', '기타기관3'), row('기타4:5', '정민호', '기타기관4'), row('시험:6', '김동명', AG),
  ];
  const firstLabel = (html: string) => html.match(/<span class="table-name">([^<]+)<\/span>/)![1];

  it('5행만 보여도(짝인 6번째가 아직 안 보임) rows 전체 기준으로 동명이인 라벨이 이미 붙는다', () => {
    const html5 = renderToStaticMarkup(
      <ManagerEntityTable rows={six} visible={six.slice(0, 5)} activeAgency={null} activeManager={null} onPick={() => {}} />,
    );
    expect(firstLabel(html5)).toBe('김동명 (시험기관 1번)');
  });

  it('5행 → 6행("더 보기") 전후로 1번째 행 라벨이 완전히 같다(핵심 회귀 — 예전에는 "김동명" → "김동명 (시험기관 1번)"로 바뀌었다)', () => {
    const html5 = renderToStaticMarkup(
      <ManagerEntityTable rows={six} visible={six.slice(0, 5)} activeAgency={null} activeManager={null} onPick={() => {}} />,
    );
    const html6 = renderToStaticMarkup(
      <ManagerEntityTable rows={six} visible={six.slice(0, 6)} activeAgency={null} activeManager={null} onPick={() => {}} />,
    );
    expect(firstLabel(html6)).toBe(firstLabel(html5));
  });

  it('대조: rows 자체를 visible만큼만 넘기면(예전 버그 패턴) 짝을 모르니 평범한 이름 — 그래서 호출부는 반드시 전체 rows를 넘겨야 한다', () => {
    const buggyPattern = renderToStaticMarkup(
      <ManagerEntityTable rows={six.slice(0, 5)} activeAgency={null} activeManager={null} onPick={() => {}} />,
    );
    expect(firstLabel(buggyPattern)).toBe('김동명'); // 비교 기준 — 지금 호출부(PlaceDetailsPanel/ScopeDetailsPanel)는 이렇게 안 부른다
  });

  it('visible을 생략하면 rows 전체를 그대로 그린다(기존 단일 rows 호출과 호환)', () => {
    const html = renderToStaticMarkup(<ManagerEntityTable rows={six.slice(0, 2)} activeAgency={null} activeManager={null} onPick={() => {}} />);
    expect((html.match(/<tbody>([\s\S]*)<\/tbody>/)![1].match(/<tr/g) ?? []).length).toBe(2);
  });
});

describe('ManagerTableFootnote: 표 아래 지표별 분모 설명 — 실제 cell 표현과 정확히 일치(2026-10-13 P3 수정)', () => {
  const html = renderToStaticMarkup(<ManagerTableFootnote />);
  it('답변·분류 정의', () => {
    expect(html).toContain('답변완료');
    expect(html).toContain('분류');
  });
  it('수용률 등(비율 전용 칸): 분류가 0건이면 계산 불가 → —', () => {
    expect(html).toMatch(/분류가 0건이면 비율을 계산할 수 없어/);
  });
  it('과태료·계도: 답변이 있으면 0건도 실제 값(0.0%)', () => {
    expect(html).toMatch(/답변이 있으면 건수가 0건이어도 실제 값\(0\.0%\)/);
  });
  it('과태료·계도: 답변이 0건이면(계산 불가) 건수만 보이고 비율은 —', () => {
    expect(html).toMatch(/답변이 0건이면\s*계산할 수 없어 건수만 보이고 비율은/);
  });
  it('과태료·계도: 서버 미제공이면 건수 칸까지 — 하나(계산 불가와 다르게 보임을 명시)', () => {
    expect(html).toMatch(/미제공.*건수 칸까지 포함해.*하나만/);
  });
  it('실제 fmtCountRate/fmtPercent 동작과 각주 문구가 모순되지 않는다(회귀 가드)', () => {
    // 계산 불가(과태료·계도): 건수 0 + 분모 0 → "0건 · —" — 각주가 말하는 그대로
    expect(fmtCountRate(0, null)).toBe('0건 · —');
    // 미제공: 건수 자체가 없음 → "—" 하나 — 각주가 말하는 "건수 칸까지 —"와 일치(건수 표시가 아예 없음)
    expect(fmtCountRate(null, null)).toBe('—');
    // 수용률 등: 분류 0이면 fmtPercent(null) === '—' (건수 칸이 없는 칸이라 "—" 하나뿐)
    expect(fmtPercent(null)).toBe('—');
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
