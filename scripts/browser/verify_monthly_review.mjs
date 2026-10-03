// Local synthetic API + mocked Kakao only. Never records sessions or tokens.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, openPage, api, sleep, waitMap } from './harness.mjs';
const mode = process.env.REVIEW_STAGE || 'after';
const dir = `docs/implementation/monthly-review-20261003/evidence/${mode}`;
mkdirSync(dir, { recursive: true });
const results = [], errors = [];
const check = (id, actual, expected) => results.push({id, actual, expected, pass: JSON.stringify(actual) === JSON.stringify(expected)});
const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--lang=ko-KR']});
const log = () => api('log');
const search = '?date_basis=completed_date&start=2025-09-25&end=2026-09-24&category=all';
async function composition(page, input, word, route) {
  const n = (await log()).length;
  await input.dispatchEvent('compositionstart');
  await input.fill(word);
  await sleep(450);
  check(`${route}-IME-during`, (await log()).slice(n).filter(x=>x.route===route && x.params.q===word).length, 0);
  await input.dispatchEvent('compositionend', { data: word });
  await sleep(700);
  check(`${route}-IME-commit`, (await log()).slice(n).filter(x=>x.route===route && x.params.q===word).length, 1);
}
try {
 await api('reset');
 const {page, context, consoleErrors} = await openPage(browser,{search});
 await waitMap(page);
 const entities = page.locator('#entities');
 await entities.getByRole('button',{name:'전체 보기',exact:true}).click();
 await entities.locator('tbody .table-pick').first().waitFor();
 await composition(page,entities.getByRole('searchbox'),'경찰','entities');
 await entities.getByRole('searchbox').fill(''); await sleep(650);
 await api('delay',{entities:1800});
 await entities.getByRole('button',{name:'담당자',exact:true}).click();
 await sleep(200);
 check('entities-no-old-rows-new-kind',await entities.locator('tbody .table-pick').count(),0);
 await page.screenshot({path:`${dir}/entity-kind-pending.png`,fullPage:true});
 await sleep(1900); await api('delay',{});
 await api('inject',{route:'entities',status:503,times:1});
 await entities.getByRole('button',{name:'비경찰',exact:true}).click();
 await entities.getByRole('alert').waitFor();
 check('entities-no-old-rows-failure',await entities.locator('tbody .table-pick').count(),0);
 await entities.getByRole('button',{name:'다시 시도'}).click();
 await sleep(650);
 check('entities-retry-restores-rows',await entities.locator('tbody .table-pick').count()>0,true);
 await composition(page,page.locator('.scope-panel').getByRole('searchbox',{name:'기관 이름 검색',exact:true}),'경찰','entities');
 const laws=page.locator('#laws');
 await composition(page,laws.getByRole('searchbox'),'도로','laws');
 await laws.getByRole('searchbox').fill('');await sleep(650);
 await api('delay',{laws:1600});
 await laws.getByRole('searchbox').fill('없는법규'); await sleep(500);
 check('laws-no-old-rows-new-search',await laws.locator('tbody tr').count(),0);
 await page.screenshot({path:`${dir}/law-search-pending.png`,fullPage:true});
 await sleep(1800);await api('delay',{});
 await api('inject',{route:'laws',status:503,times:1});
 await laws.getByRole('searchbox').fill('도로'); await sleep(600);
 check('laws-error-not-no-results',await laws.locator('.empty-state').count(),0);
 check('laws-error-retry-present',await laws.getByRole('button',{name:'다시 시도'}).count(),1);
 if (await laws.getByRole('button',{name:'다시 시도'}).count()) {await laws.getByRole('button',{name:'다시 시도'}).click();await sleep(700);check('laws-retry-restores-rows',await laws.locator('tbody tr').count()>0,true);}
 await page.locator('.rail button[aria-label^="통계"]').click();
 await page.waitForSelector('.pivot-table tbody tr');
 const opener=page.getByRole('button',{name:'비교 대상 선택'});
 await opener.focus();await opener.click();
 const dialog=page.getByRole('dialog',{name:'비교 대상 선택'});
 await dialog.locator('.picker-list li').first().waitFor();
 await composition(page,dialog.getByRole('searchbox'),'경찰','statistics/candidates');
 await dialog.getByRole('button',{name:'적용',exact:true}).focus();await page.keyboard.press('Tab');
 check('picker-tab-trapped',await page.evaluate(()=>!!document.activeElement?.closest('[role=dialog]')),true);
 await page.keyboard.press('Escape');
 check('picker-focus-restored',await opener.evaluate(el=>el===document.activeElement),true);
 // Cells in a pivot must be operable from the keyboard.
 await page.getByLabel('예시 설정').selectOption('outcome_disposition');
 await page.getByRole('button',{name:'통계 만들기',exact:true}).click();
 await page.locator('.pivot-cell').first().waitFor();
 const cell=page.locator('.pivot-cell').first();await cell.press('Enter');await sleep(200);
 check('pivot-cell-keyboard-narrow',await page.getByRole('dialog',{name:'이 항목으로 좁히기'}).count(),1);
 await page.getByRole('dialog',{name:'이 항목으로 좁히기'}).getByRole('button',{name:'닫기',exact:true}).click();
 errors.push(...consoleErrors);
 await context.close();
 // Page 2 of the full list must not survive a narrower displayed scope.
 await api('reset');await api('dataset',{name:'managers'});
 const narrow=await openPage(browser,{search});await waitMap(narrow.page);
 const table=narrow.page.locator('#entities');
 await table.getByRole('button',{name:'담당자',exact:true}).click();
 await table.getByRole('button',{name:'전체 보기',exact:true}).click();
 await table.locator('tbody .table-pick').first().waitFor();
 await table.getByRole('button',{name:'다음 페이지'}).click();
 await narrow.page.waitForFunction(()=>document.querySelector('#entities .table-pager')?.textContent?.includes('2 /'));
 await sleep(200);
 check('entities-page-two-reached',(await table.locator('.table-pager').innerText()).trim().startsWith('2 /'),true);
 await table.locator('tbody .table-pick').first().click();await sleep(1300);
 check('entities-new-scope-page-one',(await table.locator('.table-pager').innerText()).trim().startsWith('1 /'),true);
 check('entities-new-scope-not-empty',await table.locator('tbody .table-pick').count()>0,true);
 await table.screenshot({path:`${dir}/scope-page-reset.png`});
 await narrow.context.close();
 // Inspect both tokens and responsive layouts; tests use synthetic data only.
 for(const theme of ['light','dark'])for(const width of [1920,1440,2560,390]) {
   await api('reset');
   const v=await openPage(browser,{theme,width,height:width<500?844:1080,search});await waitMap(v.page);
   check(`viewport-${width}-${theme}`,await v.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   check(`theme-${width}-${theme}`,await v.page.evaluate(()=>document.documentElement.dataset.theme),theme);
   await v.page.screenshot({path:`${dir}/${width}-${theme}.png`,fullPage:true});
   if(width===390){
     await v.page.locator('.bottom-nav button').filter({hasText:'통계'}).click();
     await v.page.getByRole('button',{name:'비교 대상 선택'}).click();
     await v.page.getByRole('dialog',{name:'비교 대상 선택'}).waitFor();
     await v.page.screenshot({path:`${dir}/picker-390-${theme}.png`});
     await v.page.evaluate(()=>{const texts=Array.from(document.querySelectorAll('button,input,select,p,label,small,span,h1,h2,h3')).map(el=>[el,parseFloat(getComputedStyle(el).fontSize)]);texts.forEach(([el,px])=>{el.style.fontSize=(px*2)+'px';});});
     check(`large-text-picker-${theme}`,await v.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
     await v.page.screenshot({path:`${dir}/picker-390-${theme}-large-text.png`});
   }
   errors.push(...v.consoleErrors);await v.context.close();
 }
} finally {
 await api('reset');await browser.close();
 writeFileSync(`${dir}/results.json`,JSON.stringify({stage:mode,source:mode==='before'?'49c4c6d':'working-tree',environment:'local synthetic fixtures; mocked Kakao',results,consoleErrors:errors,unexpectedErrors:errors.filter(x=>!x.includes('503'))},null,2));
 console.log(JSON.stringify({stage:mode,checks:results.length,failed:results.filter(x=>!x.pass),consoleErrors:errors.length},null,2));
}
if(mode==='after'&&results.some(x=>!x.pass))process.exitCode=1;
