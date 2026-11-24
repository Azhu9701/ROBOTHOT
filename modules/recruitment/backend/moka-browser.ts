import {config} from '@aihot/backend/config';
import {assertPublicUrl} from '@aihot/backend/lib/url';
import {hash,parseHtml,unique} from './parse.ts';
import type {Source,Snapshot,Posting} from '../types.ts';

// Read rendered public cards through normal navigation; never decode private API payloads.
export async function readMoka(source:Source):Promise<Snapshot>{
  if(process.env.RECRUITMENT_BROWSER_ENABLED!=='true')throw new Error('browser_adapter_disabled');
  const endpoint=await assertPublicUrl(source.endpoint!,config.allowPrivateNetworkFetch);
  if(!config.allowPrivateNetworkFetch && endpoint.hostname!=='app.mokahr.com')throw new Error('unsupported public career host');
  const {chromium}=await import('@playwright/test');const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext();
    await context.route('**/*',async route=>{
      const req=route.request();const u=new URL(req.url());
      if(!/^https?:$/.test(u.protocol)||!(u.host===endpoint.host||/(?:^|\.)mokahr\.com$/.test(u.hostname))||['image','font','media'].includes(req.resourceType()))return route.abort();
      await route.continue();
    });
    const page=await context.newPage();await page.goto(endpoint.href,{waitUntil:'domcontentloaded',timeout:30000});
    if(!new URL(page.url()).hash.startsWith('#/jobs')){
      const list=page.locator('a[href^="#/jobs"]').first();await list.waitFor({state:'attached',timeout:15000});
      const url=new URL((await list.getAttribute('href'))!,endpoint);if(url.origin!==endpoint.origin)throw new Error('cross-origin job list');
      await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:30000});
    }
    const jobs:Posting[]=[];const hashes:string[]=[];const seen=new Set<string>();
    for(let index=0;index<100;index++){
      await page.locator('a[href^="#/job/"] [class*="card-content-"]').first().waitFor({state:'attached',timeout:20000});
      const html=await page.content();
      const parsed=parseHtml(html,page.url());if(!parsed.supported)throw new Error('Moka job list layout changed');
      const signature=hash(parsed.jobs.map(j=>j.url).join('\n'));if(seen.has(signature))throw new Error('duplicate Moka page');
      seen.add(signature);jobs.push(...parsed.jobs);hashes.push(hash(html));
      const next=page.locator('button[class*="Pagination-forward"]').first();
      if(!await next.count()||await next.isDisabled()||await next.getAttribute('aria-disabled')==='true'||/disabled/i.test(await next.getAttribute('class')||''))
        return {jobs:unique(jobs),complete:false,hash:hash(hashes.join(':'))};
      const links=async()=>Promise.all((await page.locator('a[href^="#/job/"]:has([class*="card-content-"])').all()).map(a=>a.getAttribute('href'))).then(urls=>urls.join('\n'));
      const before=await links();await next.click({timeout:10000});const until=Date.now()+20000;
      while(await links()===before){if(Date.now()>until)throw new Error('Moka next page did not load');await new Promise(r=>setTimeout(r,100));}
    }
    throw new Error('Moka page limit reached');
  }finally{await browser.close();}
}
