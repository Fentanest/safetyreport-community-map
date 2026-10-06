// Actual local GoTrue/PostgREST/Deno + live Pages build. Only Kakao map SDK and external ad are mocked.
import { chromium } from './harness.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const sessionFile = process.env.SNAPSHOT_BROWSER_SESSION;
if (!sessionFile?.startsWith('.agent-runtime/')) throw new Error('private local session file required');
const session = JSON.parse(readFileSync(sessionFile, 'utf8'));
const out = process.env.SNAPSHOT_BROWSER_OUT ?? 'docs/implementation/dataset-snapshot-20261006/evidence/browser';
mkdirSync(out, { recursive: true });
const origin = 'http://127.0.0.1:56480';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const wallStart = Date.now();
const results = { mode: 'local-real-auth-db-edge; mock-map-sdk; external-network-blocked', started: new Date().toISOString(), responses: [], errors: [], checks: [] };
try {
 const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR' });
 await context.route('**/*', async route => {
  const u = new URL(route.request().url());
  if (u.hostname === 'dapi.kakao.com') return route.fulfill({ contentType: 'text/javascript', body: readFileSync('scripts/browser/mock-kakao-sdk.js','utf8') });
  if (u.hostname === '127.0.0.1') return route.continue();
  return route.fulfill({ contentType:'text/html', body:'' });
 });
 await context.addInitScript(({session})=>{localStorage.setItem('cm-map-auth-v1',JSON.stringify(session));localStorage.setItem('cm-theme','dark');},{session});
 const page = await context.newPage();
 page.on('pageerror', e=>results.errors.push(e.message));
 const bodies = [];
 page.on('response', async res=>{
  const u = new URL(res.url()); if (!u.pathname.includes('/functions/v1/')) return;
  const record = { path:u.pathname,status:res.status(),at:new Date().toISOString() }; results.responses.push(record);
  if(res.status()===200 && u.pathname.endsWith('/screen')) {
   const b=await res.json();record.version=b.meta.dataset_version;record.count=b.dashboard.overview.report_count.value;
   record.mixed=b.dashboard.dataset_version!==record.version||b.panels.some(p=>p.status===200&&p.body.dataset_version!==record.version);
   record.panels=b.panels.map(p=>({id:p.id,status:p.status}));bodies.push(b);
  }
 });
 await page.goto(`${origin}/?date_basis=completed_date&start=2024-01-01&end=2028-12-31`);
 await page.locator('.kpi-value, .kpi-main, .kpi-panel').first().waitFor({timeout:30000}).catch(async()=>{
  await page.waitForFunction(()=>document.querySelectorAll('.cm-number').length>2,{timeout:30000});
 });
 await page.waitForTimeout(1000);
 await page.screenshot({path:`${out}/dashboard-1440-dark.png`,fullPage:true});
 await page.getByRole('switch',{name:'내 신고와 비교'}).check();
 await page.waitForTimeout(1500);
 assert(bodies.some(b=>b.panels.some(p=>p.id==='compare')),'comparison bundle received');
 await page.getByRole('tab',{name:'기관·담당자',exact:true}).click().catch(()=>{});
 const entity = page.locator('#entities');
 if(await entity.count()) {
  await entity.getByRole('button',{name:'전체 보기',exact:true}).click();
  await entity.getByRole('searchbox').fill('경찰');await page.waitForTimeout(1200);
  await entity.getByRole('searchbox').fill('');await page.waitForTimeout(1000);
 }
 results.checks.push({screen:'dashboard',bundles:bodies.length,errors:await page.locator('.banner.error').allTextContents()});
 await page.getByRole('button',{name:'맞춤 통계',exact:true}).click();
 await page.getByLabel('예시 설정').selectOption('outcome_disposition');
 await page.getByRole('button',{name:'통계 만들기',exact:true}).click();
 await page.waitForTimeout(1500);
 await page.screenshot({path:`${out}/statistics-1440-dark.png`,fullPage:true});
 results.checks.push({screen:'statistics',errors:await page.locator('.banner.error').allTextContents()});
 await page.getByRole('button',{name:'유저 랭킹',exact:true}).click();
 await page.waitForTimeout(1500);
 await page.screenshot({path:`${out}/rankings-1440-dark.png`,fullPage:true});
 results.checks.push({screen:'rankings',errors:await page.locator('.banner.error').allTextContents()});
 await page.getByRole('button',{name:'대시보드',exact:true}).click();await page.waitForTimeout(1200);
 for(const [width,height,theme] of [[390,844,'light'],[1920,1080,'dark'],[2560,1440,'light']]) {
  await page.setViewportSize({width,height});
  await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
  await page.waitForTimeout(700);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  results.checks.push({width,height,theme,overflow});assert(overflow<=1);
  await page.screenshot({path:`${out}/dashboard-${width}-${theme}.png`,fullPage:true});
 }
 const until = wallStart + Number(process.env.SNAPSHOT_BROWSER_SECONDS ?? 180) * 1000;
 while (Date.now() < until) {
  const errors = await page.locator('.banner.error').allTextContents();
  results.checks.push({monitorAt:new Date().toISOString(),errors});
  assert(errors.length===0,JSON.stringify(errors));
  await page.waitForTimeout(Math.min(10000, Math.max(1, until-Date.now())));
  if (Date.now()<until) { await page.reload(); await page.waitForFunction(()=>document.querySelectorAll('.cm-number').length>2); }
 }
 assert(results.errors.length===0,JSON.stringify(results.errors));
 assert(results.responses.every(r=>r.status===200),JSON.stringify(results.responses.filter(r=>r.status!==200)));
 assert(results.responses.filter(r=>'mixed'in r).every(r=>!r.mixed));
 assert(results.checks.filter(r=>'errors'in r).every(r=>r.errors.length===0));
 results.passed=true;
} catch(e) {results.passed=false;results.failure=e.message;throw e;}
finally{results.finished=new Date().toISOString();writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');await browser.close();}
