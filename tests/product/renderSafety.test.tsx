import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import EntityTable from '../../src/components/EntityTable';
import InsightPanel from '../../src/components/InsightPanel';
import { demoDashboard } from '../../src/data/demo';
import { DEMO_SCOPE } from '../../src/domain/public';

describe('public text rendering', () => {
  it('escapes untrusted agency, manager, and address fields', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const data = demoDashboard(DEMO_SCOPE, 'one');
    const agency = { ...data.agencies[0], agency_name: payload };
    const manager = { ...data.managers[0], manager_name: payload, agency_name: payload };
    const point = { ...data.points[0], address: payload };
    const table = renderToStaticMarkup(
      <EntityTable agencies={[agency]} managers={[manager]} tab="agency" onTab={() => {}} onPick={() => {}} />,
    );
    const detail = renderToStaticMarkup(
      <InsightPanel data={data} point={point} scopeLabel="전국" onAnalyzePoint={() => {}} onPickEntity={() => {}} toast={() => {}} />,
    );
    expect(table).toContain('&lt;img');
    expect(detail).toContain('&lt;img');
    expect(table + detail).not.toContain('<img src=x onerror=alert(1)>');
  });
});
