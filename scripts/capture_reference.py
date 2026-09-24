#!/usr/bin/env python3
"""Capture the exact local reference UI. Requires Playwright installed by the user.
Default: HTTP localhost harness. --inline: exact CSS/JS/image embedding on about:blank.
This is NOT a live Kakao/Supabase or Muse browser test.
"""
from __future__ import annotations
import argparse,base64,json,threading
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path


def main() -> int:
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--inline',action='store_true')
    ap.add_argument('--browser',type=Path,help='Existing Chromium executable; omitted uses Playwright browser')
    ap.add_argument('--no-sandbox',action='store_true',help='Only for a trusted isolated container requiring this browser flag')
    ap.add_argument('--out',type=Path,default=None)
    args=ap.parse_args()
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        ap.error('Playwright is not installed. Install the approved pinned testing dependency first; this script never auto-installs it.')
    root=Path(__file__).resolve().parents[1]
    ui=root/'design/reference-ui'
    out=(args.out or root/'.agent-runtime/reference-shots').resolve();out.mkdir(parents=True,exist_ok=True)
    html=(ui/'index.html').read_text(encoding='utf-8')
    if args.inline:
        html=html.replace('<link rel="stylesheet" href="../tokens.css">','<style>'+(root/'design/tokens.css').read_text()+'</style>')
        html=html.replace('<link rel="stylesheet" href="ui.css">','<style>'+(ui/'ui.css').read_text()+'</style>')
        html=html.replace('<script src="app.js"></script>','<script>'+(ui/'app.js').read_text()+'</script>')
        image='data:image/png;base64,'+base64.b64encode((root/'design/assets/family-mark.png').read_bytes()).decode('ascii')
        html=html.replace('../assets/family-mark.png',image)
        server=None;url=None
    else:
        class Quiet(SimpleHTTPRequestHandler):
            def log_message(self,*args):pass
        server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(root)))
        threading.Thread(target=server.serve_forever,daemon=True).start()
        url=f'http://127.0.0.1:{server.server_port}/design/reference-ui/index.html'
    results=[]
    try:
        with sync_playwright() as pw:
            options={'headless':True,'args':['--no-sandbox'] if args.no_sandbox else []}
            if args.browser:options['executable_path']=str(args.browser)
            browser=pw.chromium.launch(**options)
            for width,height,theme in [(1920,1080,'dark'),(1920,1080,'light'),(1440,900,'dark'),(2560,1440,'dark'),(390,844,'dark'),(390,844,'light')]:
                ctx=browser.new_context(viewport={'width':width,'height':height},reduced_motion='reduce',device_scale_factor=1)
                page=ctx.new_page();errors=[]
                page.on('pageerror',lambda error:errors.append(str(error)))
                page.on('console',lambda message:errors.append(message.text) if message.type=='error' else None)
                if args.inline:page.set_content(html,wait_until='load')
                else:page.goto(url,wait_until='networkidle')
                page.wait_for_timeout(250)
                page.evaluate('(theme)=>document.documentElement.dataset.theme=theme',theme)
                page.screenshot(path=str(out/f'wall-{width}-{theme}.png'),full_page=True)
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'horizontal viewport overflow'
                assert page.locator('.kpi').count()==6
                assert page.locator('.vehicle-list li').count()==5
                page.locator('[data-entity="manager"]').click()
                assert page.locator('.sample-one').inner_text()=='표본 1건'
                page.locator('#filters').click();assert page.locator('#drawer').is_visible()
                page.keyboard.press('Escape');assert page.locator('#drawer').is_hidden()
                before=page.evaluate('document.documentElement.dataset.theme')
                page.locator('#theme').click();assert page.evaluate('document.documentElement.dataset.theme')!=before
                page.locator('#chart-table').click();assert page.locator('#trend table tbody tr').count()==8
                page.locator('#chart-table').click();assert page.locator('#trend svg').count()==1
                assert not errors,errors
                results.append({'viewport':f'{width}x{height}','theme':theme,'passed':True,'console_errors':errors})
                ctx.close()
            browser.close()
    finally:
        if server:server.shutdown();server.server_close()
        (out/'results.json').write_text(json.dumps({'harness':'inline' if args.inline else 'local_http','scope':'synthetic reference UI only','results':results},ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'PASS: {len(results)} viewport/theme combinations. Evidence: {out}')
    return 0

if __name__=='__main__':raise SystemExit(main())
