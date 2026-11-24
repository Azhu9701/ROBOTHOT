import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {createServer} from 'node:http';
import {config} from '@aihot/backend/config';
import {closeDb} from '@aihot/backend/db';
import {readFeishu} from '../backend/feishu-browser.ts';
import type {Source} from '../types.ts';
after(closeDb);
test('public browser collector reads every UI page and preserves original IDs',async()=>{
 const privateBefore=config.allowPrivateNetworkFetch;const flag=process.env.RECRUITMENT_BROWSER_ENABLED;
 config.allowPrivateNetworkFetch=true;process.env.RECRUITMENT_BROWSER_ENABLED='true';
 const offsets:number[]=[];
 const server=createServer(async(req,res)=>{
  if(req.url==='/api/v1/search/job/posts'){
   let text='';for await(const c of req)text+=c;const {offset}=JSON.parse(text);offsets.push(offset);
   res.setHeader('content-type','application/json');res.end(JSON.stringify({code:0,data:{count:3,job_post_list:Array.from({length:offset?1:2},(_,i)=>({id:String(1000+offset+i),title:'Engineer',city_list:[{name:'杭州'}],publish_time:1792047350106}))}}));return;
  }
  res.setHeader('content-type','text/html');res.end(`<html><button class="atsx-pagination-next" onclick="offset+=2;load()">下一页</button><script>let offset=0;function load(){fetch('/api/v1/search/job/posts',{method:'POST',body:JSON.stringify({offset})})}load()</script></html>`);
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as {port:number}).port;
 try{
  const snapshot=await readFeishu({endpoint:`http://127.0.0.1:${port}/index/position/list`} as Source);
  assert.equal(snapshot.complete,true);assert.equal(snapshot.jobs.length,3);assert.deepEqual(offsets,[0,2]);assert.ok(snapshot.jobs.every(j=>j.url.includes('/index/position/')));
  offsets.length=0;const custom=await readFeishu({endpoint:'http://127.0.0.1:'+port+'/careers/position/list'} as Source);
  assert.equal(custom.jobs.length,3);assert.ok(custom.jobs.every(j=>j.url.includes('/careers/position/')));
 }finally{config.allowPrivateNetworkFetch=privateBefore;if(flag===undefined)delete process.env.RECRUITMENT_BROWSER_ENABLED;else process.env.RECRUITMENT_BROWSER_ENABLED=flag;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
