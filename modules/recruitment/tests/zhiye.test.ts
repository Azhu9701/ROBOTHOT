import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {createServer} from 'node:http';
import {config} from '@aihot/backend/config';
import {closeDb} from '@aihot/backend/db';
import {readSnapshot} from '../backend/pipeline.ts';
import type {Source} from '../types.ts';
after(closeDb);
test('zhiye snapshots paginate every page with a stable total before declaring completeness',async()=>{
 const previous=config.allowPrivateNetworkFetch;config.allowPrivateNetworkFetch=true;
 let unstable=false;const pages:number[]=[];
 const job=(n:number)=>({Id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,JobAdName:'工程师_'+n,CategoryId:'1',Kind:'全职',PostDate:'2026-10-01T08:00:00',LocNames:['江苏省·苏州市']});
 const server=createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;
  const {PageIndex,PageSize}=JSON.parse(raw);assert.equal(req.method,'POST');assert.equal(PageSize,50);pages.push(PageIndex);
  const first=PageIndex===0;
  res.setHeader('content-type','application/json');res.end(JSON.stringify({Code:200,Count:first?(unstable?99:51):51,Data:Array.from({length:first?50:1},(_,i)=>job(PageIndex*50+i))}));
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const port=(server.address() as {port:number}).port;
 const source={provider:'zhiye',career_url:'https://robot.zhiye.com/',endpoint:`http://127.0.0.1:${port}/api/Jobad/GetJobAdPageList`} as Source;
 try{
  const d=await readSnapshot(source);assert.equal(d.jobs.length,51);assert.equal(d.complete,true);assert.deepEqual(pages,[0,1]);
  assert.equal(d.jobs[0].url,'https://robot.zhiye.com/social/detail?jobAdId=00000000-0000-4000-8000-000000000000');
  assert.equal(d.jobs[0].locations?.[0].region,'江苏省');unstable=true;
  await assert.rejects(readSnapshot(source),/total changed/);
 }finally{config.allowPrivateNetworkFetch=previous;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
test('zhiye responses that stop short of the declared total fail instead of passing as complete',async()=>{
 const previous=config.allowPrivateNetworkFetch;config.allowPrivateNetworkFetch=true;
 const server=createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');res.end(JSON.stringify({Code:200,Count:51,Data:[{Id:'00000000-0000-4000-8000-000000000000',JobAdName:'工程师',CategoryId:'1',LocNames:['全国']}]}));
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const port=(server.address() as {port:number}).port;
 const source={provider:'zhiye',career_url:'https://robot.zhiye.com/',endpoint:`http://127.0.0.1:${port}/api/Jobad/GetJobAdPageList`} as Source;
 try{
  await assert.rejects(readSnapshot(source),/incomplete zhiye page/);
 }finally{config.allowPrivateNetworkFetch=previous;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
