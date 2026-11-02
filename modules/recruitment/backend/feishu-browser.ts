import { config } from '@aihot/backend/config';
import { assertPublicUrl } from '@aihot/backend/lib/url';
import { hash,parseApi,unique,isFeishuHost } from './parse.ts';
import type { Source,Snapshot,Posting } from '../types.ts';

// Mac-only public-page collection. No login, signatures, copied cookies or model calls.
export async function readFeishu(source:Source):Promise<Snapshot> {
  if(process.env.RECRUITMENT_BROWSER_ENABLED!=='true')throw new Error('browser_adapter_disabled');
  const endpoint=await assertPublicUrl(source.endpoint!,config.allowPrivateNetworkFetch);
  if(!config.allowPrivateNetworkFetch && !isFeishuHost(endpoint.hostname))throw new Error('unsupported public career host');
  const {chromium}=await import('@playwright/test');
  const browser=await chromium.launch({headless:true});
  const pages:Array<{jobs:Posting[];count:number;hash:string}>=[];let problem:Error|null=null;
  try {
    const context=await browser.newContext();
    await context.route('**/*',async route=>{
      const req=route.request();const u=new URL(req.url());
      const staticHost=/(?:^|\.)(?:feishucdn\.com|bytegoofy\.com|bytescm\.com|byteimg\.com|bytedance\.com|bytedance\.net|pstatp\.com|ibytedtos\.com|volccdn\.com)$/.test(u.hostname);
      if(!/^https?:$/.test(u.protocol)||!(u.host===endpoint.host||staticHost)||['image','font','media'].includes(req.resourceType()))return route.abort();
      await route.continue();
    });
    const page=await context.newPage();
    page.on('response',async response=>{
      const u=new URL(response.url());if(u.host!==endpoint.host||u.pathname!=='/api/v1/search/job/posts')return;
      try{const raw=await response.text();const data=JSON.parse(raw);pages.push({jobs:parseApi('feishu',data,page.url()),count:data.data.count,hash:hash(raw)});}catch(e){problem=e as Error;}
    });
    async function nextPacket(index:number) {
      const until=Date.now()+30000;
      while(pages.length<=index){if(problem)throw problem;if(Date.now()>until)throw new Error('public career page did not return a job list');await new Promise(r=>setTimeout(r,100));}
      return pages[index];
    }
    await page.goto(endpoint.href,{waitUntil:'domcontentloaded',timeout:30000});
    if(!endpoint.pathname.includes('/position/list')) {
      const list=page.locator('a[href*="/position/list"]').first();
      try{await list.waitFor({state:'attached',timeout:8000});const link=await list.getAttribute('href');if(link){const u=new URL(link,endpoint);if(u.origin!==endpoint.origin)throw new Error('cross-origin job list');await page.goto(u.href,{waitUntil:'domcontentloaded',timeout:30000});}}catch(e){if(!pages.length)throw e;}
    }
    let packet=await nextPacket(0);const total=packet.count;const jobs:Posting[]=[];const hashes:string[]=[];
    for(let index=0;index<500;index++) {
      if(packet.count!==total)throw new Error('career total changed; incomplete snapshot');jobs.push(...packet.jobs);hashes.push(packet.hash);
      const all=unique(jobs);if(all.length===total)return {jobs:all,complete:true,hash:hash(hashes.join(':'))};
      if(!packet.jobs.length||all.length>total)throw new Error('incomplete career page');
      const received=pages.length;await page.locator('[class*="pagination-next"]').first().click({timeout:10000});packet=await nextPacket(received);
    }
    throw new Error('career page limit reached');
  }finally{await browser.close();}
}
