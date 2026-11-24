import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {sql,closeDb} from '@aihot/backend/db';
import {applySnapshot} from '../backend/pipeline.ts';
import {exportRecruitment,importRecruitment} from '../backend/transfer.ts';
import {feishuIdentity} from '../backend/identity.ts';
import type {Source,Posting} from '../types.ts';
after(closeDb);
const old='https://robot.jobs.feishu.cn/index/position/123/detail';
const current='https://robot.jobs.feishu.cn/campus/position/123/detail';
const posting=(url:string):Posting=>({url,title:'Engineer',location:'杭州',department:null,employmentType:null,postedAt:null,validThrough:null});
async function seed(company:string){
 await sql`INSERT INTO recruitment_sources(company,company_url,official_url,career_url,provider,endpoint,status) VALUES(${company},'https://www.aiman.world/company/fixture','https://robot.example','https://robot.jobs.feishu.cn/campus','feishu','https://robot.jobs.feishu.cn/campus','ready')`;
 const source={company,provider:'feishu',last_success:null} as Source;
 await applySnapshot(source,{jobs:[posting(old)],complete:true,hash:'a'.repeat(64)});
 await sql`UPDATE recruitment_jobs SET first_seen=now()-interval '3 days',last_seen=now()-interval '1 day' WHERE company=${company}`;
 return source;
}
test('collector reconciles an existing URL alias without inventing a new first observation',async()=>{
 const source=await seed('Alias Collector Fixture');const[original]=await sql`SELECT * FROM recruitment_jobs WHERE company=${source.company}`;
 await sql`INSERT INTO recruitment_jobs(company,url,details,baseline,evidence_hash) VALUES(${source.company},${current},${sql.json({...posting(current)})},false,${'b'.repeat(64)})`;
 await applySnapshot({...source,last_success:new Date()},{jobs:[posting(current)],complete:true,hash:'c'.repeat(64)});
 const rows=await sql`SELECT * FROM recruitment_jobs WHERE company=${source.company}`;assert.equal(rows.length,1);assert.equal(rows[0].url,current);assert.equal(rows[0].first_seen.toISOString(),original.first_seen.toISOString());assert.equal(rows[0].baseline,true);assert.equal(rows[0].missing_since,null);assert.equal(rows[0].details.url,current);
});
test('audited import migrates an official alias, replays safely and refuses older alias snapshots',async()=>{
 const source=await seed('Alias Import Fixture');const[original]=await sql`SELECT * FROM recruitment_jobs WHERE company=${source.company}`;
 const all=JSON.parse(JSON.stringify(await exportRecruitment()));const packet={...all,sources:all.sources.filter((s:{company:string})=>s.company===source.company),jobs:all.jobs.filter((j:{company:string})=>j.company===source.company)};
 packet.jobs[0].url=current;packet.jobs[0].details.url=current;packet.jobs[0].last_seen=new Date().toISOString();packet.sources[0].last_success=packet.jobs[0].last_seen;
 await importRecruitment(packet,'test');await importRecruitment(packet,'test');
 let rows=await sql`SELECT * FROM recruitment_jobs WHERE company=${source.company}`;assert.equal(rows.length,1);assert.equal(rows[0].url,current);assert.equal(rows[0].first_seen.toISOString(),original.first_seen.toISOString());assert.equal(rows[0].baseline,true);
 const stale=structuredClone(packet);stale.jobs[0].url=old;stale.jobs[0].details.url=old;stale.jobs[0].last_seen=new Date(Date.now()-3600000).toISOString();
 await assert.rejects(importRecruitment(stale,'test'),/stale Feishu URL migration/);
 rows=await sql`SELECT * FROM recruitment_jobs WHERE company=${source.company}`;assert.equal(rows.length,1);assert.equal(rows[0].url,current);
 assert.equal(feishuIdentity(old),feishuIdentity(current));assert.equal(feishuIdentity(old),feishuIdentity('https://robot.jobs.feishu.cn/index/position/detail/123'));
 assert.notEqual(feishuIdentity(old),feishuIdentity('https://robot.jobs.feishu.cn/index/position/124/detail'));assert.notEqual(feishuIdentity(old),feishuIdentity('https://other.jobs.feishu.cn/index/position/123/detail'));assert.equal(feishuIdentity('https://evil.example/index/position/123/detail'),null);
 assert.equal((await sql`SELECT * FROM audit_log WHERE action='recruitment.alias'`).length,2);
});
