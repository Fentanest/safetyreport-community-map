import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { dotParts } from '../../src/components/dotParts';
import CommandBar from '../../src/components/CommandBar';
import type { DraftFilters } from '../../src/state/filters';

/**
 * 2026-10-12 (모바일 줄바꿈 수정): style-regression coverage for two fixes —
 *  1) Korean text no longer breaks mid-syllable or mid-token (number+단위, "내 …" 묶음, "· " 구분 항목): a global
 *     `word-break: keep-all` base rule (app.css) plus `dotParts` (components/dotParts.tsx), which renders each
 *     " · "-joined piece of a KPI line as its own `white-space: nowrap` <span class="nb">, breakable only between
 *     pieces.
 *  2) The mobile condition bar's horizontally-scrolling row now carries overflow cues and keeps "내 신고와 비교"
 *     out of the scroll entirely (CommandBar.tsx, layout.css .command-scroller/.command-extra).
 */

describe('word-break: keep-all base rule (U-letter-break)', () => {
  const appCss = readFileSync(join(__dirname, '../../src/styles/app.css'), 'utf8');

  it('sets word-break: keep-all on body, so Korean wraps by word everywhere by default', () => {
    const bodyRule = appCss.match(/^body \{[^}]*\}/m)?.[0] ?? '';
    expect(bodyRule).toContain('word-break: keep-all');
  });

  it('keeps .cm-panel\'s overflow-wrap as a non-min-content-shrinking fallback (break-word), not the broad ' +
    '"anywhere" that let flex items (KPI labels) shrink to one character wide', () => {
    const panelRule = appCss.match(/\.cm-panel \{ overflow-wrap: [a-z-]+; \}/)?.[0] ?? '';
    expect(panelRule).toContain('overflow-wrap: break-word');
    expect(panelRule).not.toContain('anywhere');
  });
});

describe('dotParts (components/dotParts.tsx)', () => {
  const html = (node: ReturnType<typeof dotParts>) => renderToStaticMarkup(<>{node}</>);

  it('wraps a single value (no " · ") in one unbreakable span, unchanged content', () => {
    expect(html(dotParts('829,610,000원'))).toBe('<span class="dp">829,610,000원</span>');
  });

  it('splits "A · B · C" into one nowrap span per piece, joined by a plain breakable space — ' +
    'the line may only break between pieces, never inside "6일" or "60,297건"', () => {
    expect(html(dotParts('평균 · 중앙값 6일 · 계산 60,297건'))).toBe(
      '<span class="dp">평균</span> <span class="dp">·\u00A0중앙값 6일</span> <span class="dp">·\u00A0계산 60,297건</span>',
    );
  });

  it('lead: true treats the whole string as already introduced by its own " · " (KpiPanel\'s minor-row mine cell, ' +
    'which sits after the all/sub value on the same line) — the "·" stays glued to what follows it, never stranded', () => {
    expect(html(dotParts('내 평균 38.2일 · 중앙값 38일', { lead: true }))).toBe(
      '<span class="dp">·\u00A0내\u00A0평균 38.2일</span> <span class="dp">·\u00A0중앙값 38일</span>',
    );
  });

  it('passes through null/undefined/empty untouched (no stray wrapper around nothing)', () => {
    expect(dotParts(null)).toBeNull();
    expect(dotParts(undefined)).toBeUndefined();
    expect(dotParts('')).toBe('');
  });
});

describe('CommandBar mobile scroll affordance (U-command-scroll)', () => {
  const draft: DraftFilters = { date_basis: 'completed_date', start: '2026-09-01', end: '2026-09-30', category: 'all', region_code: null, law: null };
  const baseProps = {
    draft, onDraft: () => {}, appliedStart: draft.start, appliedEnd: draft.end,
    basis: draft.date_basis, onBasis: () => {}, onPreset: () => {}, category: draft.category, onCategory: () => {},
    filterCount: 0, minDate: draft.start, maxDate: draft.end, onApply: () => true, onReset: () => {}, onShare: () => {},
    onOpenDrawer: () => {}, dateError: null, regionCounts: new Map<string, number>(),
  };

  it('renders the scrollable condition row inside .command-scroller (the fade/nudge host)', () => {
    const html = renderToStaticMarkup(<CommandBar {...baseProps} />);
    expect(html).toContain('class="command-scroller');
    expect(html.indexOf('command-scroller')).toBeLessThan(html.indexOf('command-row'));
  });

  it('"내 신고와 비교" (extra) renders in .command-extra, a sibling of — never nested inside — .command-row, ' +
    'so it can never be scrolled out of view with the rest of the condition row', () => {
    const html = renderToStaticMarkup(<CommandBar {...baseProps} extra={<div className="view-controls">내 신고와 비교</div>} />);
    // balanced-tag scan: find where the .command-row div this markup opens actually closes (not just the next
    // "</div>", which could belong to a div nested inside it), then confirm the extra marker text sits after that.
    const openTag = '<div class="command-row">';
    const start = html.indexOf(openTag);
    expect(start).toBeGreaterThan(-1);
    let depth = 1;
    let i = start + openTag.length;
    const tagRe = /<div[ >]|<\/div>/g;
    tagRe.lastIndex = i;
    let m: RegExpExecArray | null;
    while (depth > 0 && (m = tagRe.exec(html))) {
      depth += m[0].startsWith('</') ? -1 : 1;
      i = tagRe.lastIndex;
    }
    const commandRowClose = i; // index right after .command-row's own matching </div>
    expect(html).toContain('<div class="command-extra"><div class="view-controls">내 신고와 비교</div></div>');
    expect(html.indexOf('내 신고와 비교')).toBeGreaterThan(commandRowClose);
  });

  it('omits .command-extra entirely when there is no extra content (no empty row)', () => {
    const html = renderToStaticMarkup(<CommandBar {...baseProps} />);
    expect(html).not.toContain('command-extra');
  });
});
