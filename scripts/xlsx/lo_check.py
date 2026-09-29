#!/usr/bin/env python3
"""SUPPLEMENTARY viewer check of browser-made .xlsx files with LibreOffice Calc (UNO) — NOT Microsoft Excel.

For each file: open (hidden), recalculate, read back
  * the charts on the '차트' sheet and the values each chart currently plots,
  * the formula cells of '통계표' (computed numbers, not the cached text),
  * the conditional formats on '차트' (heatmaps),
then EDIT one source cell that a chart depends on (the numerator of the first charted rate, found through the chart's
own range → '차트 데이터' formula → '통계표' cell), recalculate, and read the chart again: the plotted value must
change. Also exports the '차트' sheet to PDF → PNG for a visual record. Writes a JSON report.

  soffice --headless --accept="socket,host=127.0.0.1,port=2002;urp;" --norestore &
  python3 scripts/xlsx/lo_check.py out.json file1.xlsx file2.xlsx …
"""
import json
import os
import re
import subprocess
import sys
import time

import uno
from com.sun.star.beans import PropertyValue


def prop(name, value):
    p = PropertyValue()
    p.Name, p.Value = name, value
    return p


def connect():
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
    for _ in range(60):
        try:
            ctx = resolver.resolve('uno:socket,host=127.0.0.1,port=2002;urp;StarOffice.ComponentContext')
            return ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)
        except Exception:  # noqa: BLE001 — soffice still starting
            time.sleep(1)
    raise RuntimeError('LibreOffice did not start')


def chart_values(sheet):
    out = []
    charts = sheet.getCharts()
    for name in charts.getElementNames():
        tc = charts.getByName(name)
        doc = tc.getEmbeddedObject()
        diagram = doc.getFirstDiagram()
        series = []
        for cs in diagram.getCoordinateSystems():
            for ct in cs.getChartTypes():
                for s in ct.getDataSeries():
                    vals, ranges = [], []
                    for lseq in s.getDataSequences():
                        vseq = lseq.getValues()
                        role = vseq.Role
                        ranges.append(f'{role}={vseq.getSourceRangeRepresentation()}')
                        if role in ('values-y', 'values'):
                            vals = [None if (isinstance(x, float) and x != x) else x for x in vseq.getData()]
                    series.append({'type': ct.getChartType(), 'ranges': ranges, 'values': vals})
        out.append({'name': name, 'series': series})
    return out


def cell_by_ref(doc, ref):
    m = re.match(r"^\$?'?(.+?)'?\.\$?([A-Z]+)\$?(\d+)$", ref)
    if not m:
        return None
    sheet = doc.getSheets().getByName(m.group(1))
    return sheet.getCellRangeByName(f'{m.group(2)}{m.group(3)}')


def check(desktop, path, pngdir):
    url = uno.systemPathToFileUrl(os.path.abspath(path))
    doc = desktop.loadComponentFromURL(url, '_blank', 0, (prop('Hidden', True),))
    report = {'file': os.path.basename(path)}
    try:
        doc.calculateAll()
        sheets = doc.getSheets()
        report['sheets'] = list(sheets.getElementNames())
        chart_sheet = sheets.getByName('차트')
        before = chart_values(chart_sheet)
        report['charts'] = before
        report['conditional_formats'] = len(chart_sheet.ConditionalFormats.getConditionalFormats())
        # formula cells of 통계표 are numbers after recalculation
        table = sheets.getByName('통계표')
        cursor = table.createCursor()
        cursor.gotoEndOfUsedArea(False)
        last_col, last_row = cursor.getRangeAddress().EndColumn, cursor.getRangeAddress().EndRow
        formulas = numeric = 0
        for r in range(0, min(last_row + 1, 400)):
            for c in range(0, min(last_col + 1, 60)):
                cell = table.getCellByPosition(c, r)
                if cell.getFormula().startswith('='):
                    formulas += 1
                    if cell.getType().value == 'FORMULA' and cell.getError() == 0 and cell.getPropertyValue('FormulaResultType2') == 1:
                        numeric += 1
        report['table_formulas'] = formulas
        report['table_formulas_numeric_after_recalc'] = numeric
        # edit a source cell behind the first charted value and see the chart follow
        edited = None
        for ch in before:
            for s in ch['series']:
                rng = next((r.split('=', 1)[1] for r in s['ranges'] if r.startswith('values-y=') or r.startswith('values=')), None)
                if not rng:
                    continue
                first = rng.split(':')[0]
                data_cell = cell_by_ref(doc, first)
                if data_cell is None:
                    continue
                f = data_cell.getFormula()
                m = re.match(r"^=\$?'?통계표'?\.\$?([A-Z]+)\$?(\d+)", f) or re.match(r"^='?통계표'?!\$?([A-Z]+)\$?(\d+)", f)
                if not m:
                    continue
                src = table.getCellRangeByName(f'{m.group(1)}{m.group(2)}')
                target = src
                sm = re.match(r'^=([A-Z]+\d+)/([A-Z]+\d+)$', src.getFormula())
                if sm:  # a rate cell: edit its numerator
                    target = table.getCellRangeByName(sm.group(1))
                old_plotted = s['values'][0]
                old = target.getValue()
                target.setValue(old + 1)
                doc.calculateAll()
                after = chart_values(chart_sheet)
                new_plotted = next((x['values'][0] for c2 in after if c2['name'] == ch['name'] for x in c2['series'] if x['ranges'] == s['ranges']), None)
                edited = {'chart': ch['name'], 'source_cell': target.getPropertyValue('AbsoluteName'), 'old_value': old, 'new_value': old + 1,
                          'plotted_before': old_plotted, 'plotted_after': new_plotted, 'chart_followed': old_plotted != new_plotted}
                target.setValue(old)
                doc.calculateAll()
                break
            if edited:
                break
        report['edit_check'] = edited
        # PDF of the 차트 sheet → PNG (visual record)
        controller = doc.getCurrentController()
        if controller is not None:
            controller.setActiveSheet(chart_sheet)
        pdf = os.path.join(pngdir, report['file'].replace('.xlsx', '.pdf'))
        sel = chart_sheet
        doc.storeToURL(uno.systemPathToFileUrl(pdf), (prop('FilterName', 'calc_pdf_Export'), prop('FilterData', uno.Any('[]com.sun.star.beans.PropertyValue', tuple([prop('Selection', sel)])))))
        subprocess.run(['pdftoppm', '-png', '-r', '60', '-f', '1', '-l', '2', pdf, pdf[:-4]], check=False)
        report['png'] = sorted(p for p in os.listdir(pngdir) if p.startswith(os.path.basename(pdf[:-4])) and p.endswith('.png'))
    finally:
        doc.close(True)
    return report


def main():
    out = sys.argv[1]
    files = sys.argv[2:]
    pngdir = os.path.join(os.path.dirname(out) or '.', 'libreoffice-png')
    os.makedirs(pngdir, exist_ok=True)
    desktop = connect()
    version = subprocess.run(['soffice', '--version'], capture_output=True, text=True).stdout.strip()
    results = []
    for f in files:
        try:
            results.append(check(desktop, f, pngdir))
        except Exception as e:  # noqa: BLE001 — recorded per file
            results.append({'file': os.path.basename(f), 'error': repr(e)})
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump({'tool': version, 'note': 'LibreOffice Calc is a supplementary viewer, NOT Microsoft Excel', 'results': results}, fh, ensure_ascii=False, indent=2)
    print(json.dumps([{k: r.get(k) for k in ('file', 'error', 'table_formulas', 'table_formulas_numeric_after_recalc', 'conditional_formats', 'edit_check')} for r in results], ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
