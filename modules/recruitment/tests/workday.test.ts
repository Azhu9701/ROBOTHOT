import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {createServer} from 'node:http';
import {config} from '@aihot/backend/config';
import {closeDb} from '@aihot/backend/db';
import {readSnapshot} from '../backend/pipeline.ts';
import type {Source} from '../types.ts';
after(closeDb);
test('Workday snapshots require every page and stable totals before declaring completeness',async()=>{
 const previous=config.allowPrivateNetworkFetch;config.allowPrivateNetworkFetch=true;
 let unstable=false;const seen:number[]=[];
 const server=createServer(async(req,res)=>{
   let raw='';for await(const c of req)raw+=c;
   const {offset,limit}=JSON.parse(raw);assert.equal(req.method,'POST');assert.equal(limit,20);seen.push(offset);
   const count=offset===0?20:1;
   res.setHeader('content-type','application/json');res.end(JSON.stringify({total:offset?(unstable?22:0):21,jobPostings:Array.from({length:count},(_,i)=>({title:'Engineer',externalPath:'/job/Waltham/Engineer_'+(offset+i),locationsText:'Waltham, MA'}))}));
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const port=(server.address() as {port:number}).port;
 const source={provider:'workday',career_url:'https://robot.example/careers',endpoint:`http://127.0.0.1:${port}/wday/cxs/robot/Careers/jobs`} as Source;
 try{
  const d=await readSnapshot(source);assert.equal(d.jobs.length,21);assert.equal(d.complete,true);assert.deepEqual(seen,[0,20]);
  assert.ok(d.jobs[0].url.includes('/Careers/job/'));unstable=true;
  await assert.rejects(readSnapshot(source),/total changed/);
 }finally{config.allowPrivateNetworkFetch=previous;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
