import { chromium, openPage, api, waitMap, sleep } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const sourceCommit=execFileSync('git',['rev-parse','--short','HEAD'],{encoding:'utf8'}).trim();
const dir='docs/implementation/monthly-review-20261003/evidence/pivot-paging';mkdirSync(dir,{recursive:true});
const checks=[],errors=[];const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
function check(name,condition){checks.push({name,pass:condition});assert.ok(condition,name);}
try{
 await api('reset');await api('dataset',{name:'managers'});
 const {page,context,consoleErrors}=await openPage(browser,{search:'?start=2026-01-01&end=2026-09-30&date_basis=completed_date'});await waitMap(page);
 await page.locator('.rail button[aria-label^="통계"]').click();
 await page.getByLabel('예시 설정').selectOption('manager_duration');await page.getByRole('button',{name:'통계 만들기',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.pivot-pager')?.textContent?.includes('118'));
 const pager=page.locator('.pivot-pager');await pager.getByRole('button',{name:'다음',exact:true}).click();await sleep(100);
 check('manager118-page2',(await pager.innerText()).includes('51–100'));
 await page.locator('.pivot-sort').first().click();await sleep(100);
 check('sort-resets-page1',(await pager.innerText()).includes('1–50'));
 check('aria-sort-on-column-header',await page.locator('.pivot-table th[aria-sort]').count()===1&&await page.locator('.pivot-sort[aria-sort]').count()===0);
 await pager.getByRole('button',{name:'다음',exact:true}).click();await sleep(100);
 await page.getByLabel('예시 설정').selectOption('outcome_disposition');await page.getByRole('button',{name:'통계 만들기',exact:true}).click();
 await page.locator('.pivot-cell').first().waitFor();
 check('new-small-result-visible',await page.locator('.pivot-table tbody tr').count()>0&&(await pager.innerText()).includes('1–'));
 await page.locator('.pivot-cell').first().press('Space');
 await page.getByRole('dialog',{name:'이 항목으로 좁히기'}).waitFor();
 check('numeric-cell-space-opens-narrow',true);
 await page.getByRole('dialog',{name:'이 항목으로 좁히기'}).getByRole('button',{name:'닫기',exact:true}).click();
 await page.locator('.pivot-sort').first().click();await sleep(100);
 check('matrix-sort-on-one-total-header',await page.locator('.pivot-table th[aria-sort]').count()===1&&await page.locator('.pivot-table th.pivot-total[aria-sort]').count()===1&&await page.locator('button[aria-sort]').count()===0);
 await page.locator('.stats-result').screenshot({path:`${dir}/keyboard-cell.png`});
 errors.push(...consoleErrors);await context.close();
}finally{await browser.close();await api('reset');writeFileSync(`${dir}/result.json`,JSON.stringify({commit:sourceCommit,environment:'local synthetic managers, mocked Kakao',checks,consoleErrors:errors},null,2));console.log(JSON.stringify({checks,errors}));}
