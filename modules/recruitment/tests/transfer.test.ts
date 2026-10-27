import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {sql,closeDb} from '@aihot/backend/db';
import {exportRecruitment,importRecruitment} from '../backend/transfer.ts';
import {readJobs} from '../backend/publication.ts';
import {applySnapshot} from '../backend/pipeline.ts';
import type {Source,Posting} from '../types.ts';
after(closeDb);
test('imports preserve observation time, reject future observations and replay safely',async()=>{
  const company='Import Fixture';
  await sql`INSERT INTO recruitment_sources(company,company_url,official_url,career_url,status) VALUES(${company},'https://www.aiman.world/company/fixture','https://robot.example','https://robot.example/careers','ready')`;
  const job:Posting={url:'https://robot.example/jobs/1',title:'Engineer',location:'Remote',department:null,employmentType:null,postedAt:null,validThrough:null};
  await applySnapshot({company,last_success:null} as Source,{jobs:[job],complete:true,hash:'a'.repeat(64)});
  const data=JSON.parse(JSON.stringify(await exportRecruitment()));
  await importRecruitment(data,'test');await importRecruitment(data,'test');
  const [row]=await sql`SELECT last_seen FROM recruitment_jobs WHERE company=${company}`;
  assert.equal(row.last_seen.toISOString(),data.jobs[0].last_seen);
  assert.equal((await sql`SELECT * FROM recruitment_jobs WHERE company=${company}`).length,1);
  const invalid=structuredClone(data);invalid.jobs[0].last_seen='2099-01-01T00:00:00Z';
  await assert.rejects(importRecruitment(invalid,'test'));
  assert.equal((await sql`SELECT * FROM audit_log WHERE action='recruitment.import'`).length,2);
});

test('stale observations remain filterable but never increase recent counts',async()=>{
  const company='Stale Import Fixture';
  await sql`INSERT INTO recruitment_sources(company,company_url,official_url,career_url,status) VALUES(${company},'https://www.aiman.world/company/fixture','https://robot.example','https://robot.example/careers','ready')`;
  const job:Posting={url:'https://robot.example/jobs/stale',title:'Engineer',location:'San Carlos, CA',department:null,employmentType:null,postedAt:null,validThrough:null};
  await applySnapshot({company,last_success:null} as Source,{jobs:[job],complete:true,hash:'b'.repeat(64)});
  await sql`UPDATE recruitment_jobs SET last_seen=now()-interval '8 days',first_seen=now()-interval '9 days' WHERE company=${company}`;
  const packet=JSON.parse(JSON.stringify(await exportRecruitment()));await importRecruitment(packet,'test');
  const recent=await readJobs({company});assert.equal(recent.total,0);assert.equal(recent.summary.observed,0);assert.equal(recent.summary.stale,1);
  assert.equal(recent.summary.countries.find(c=>c.code==='US')?.count,0);
  const old=await readJobs({company,status:'uncertain',country:'US',region:'California'});
  assert.equal(old.total,1);assert.equal(old.jobs[0].status,'stale');
  assert.ok(Date.now()-old.jobs[0].last_seen.getTime()>7*86400000);
});
