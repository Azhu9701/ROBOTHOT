import { z } from 'zod';
import { sql } from '@aihot/backend/db';
import { audit } from '@aihot/backend/audit';
import { hash,publicUrl } from './parse.ts';
import {reconcileFeishuAliases} from './identity.ts';
const stamp=z.string().datetime({offset:true}).refine(s=>Date.parse(s)<=Date.now()+300000,'future observation');
const url=z.string().max(3000).refine(s=>publicUrl(s)!==null,'public HTTP URL required');
const source=z.object({company:z.string().min(1).max(200),company_url:url,official_url:url.nullable(),career_url:url.nullable(),provider:z.string().nullable(),endpoint:url.nullable(),status:z.string().max(50),evidence:z.record(z.string(),z.unknown()),catalog_seen_at:stamp,discovered_at:stamp.nullable(),attempted_at:stamp.nullable(),last_success:stamp.nullable(),last_error:z.string().max(300).nullable()});
const details=z.object({url,title:z.string().min(1).max(500),location:z.string().max(500).nullable(),department:z.string().max(500).nullable(),employmentType:z.string().max(500).nullable(),postedAt:z.string().nullable(),validThrough:z.string().nullable(),locations:z.array(z.object({raw:z.string().nullable(),country:z.string().nullable(),region:z.string().nullable(),city:z.string().nullable()})).max(30).optional(),remote:z.boolean().nullable().optional()});
const posting=z.object({company:z.string(),url,details,first_seen:stamp,last_seen:stamp,missing_since:stamp.nullable(),baseline:z.boolean(),evidence_hash:z.string().regex(/^[a-f0-9]{64}$/)});
const schema=z.object({version:z.literal(1),exportedAt:stamp,sources:z.array(source).max(2000),jobs:z.array(posting).max(100000)}).strict();
export async function exportRecruitment() {
  return sql.begin(async tx=>{
    await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    return {version:1,exportedAt:new Date().toISOString(),sources:await tx`SELECT * FROM recruitment_sources`,jobs:await tx`SELECT * FROM recruitment_jobs`};
  });
}
export async function importRecruitment(input:unknown,actor:string) {
  const data=schema.parse(input); const map=new Map(data.sources.map(s=>[s.company,s]));
  if(map.size!==data.sources.length||new Set(data.jobs.map(j=>`${j.company}\n${j.url}`)).size!==data.jobs.length)throw Object.assign(new Error('duplicate source or job'),{statusCode:400});
  for(const j of data.jobs){const s=map.get(j.company);if(!s?.official_url||!s.career_url||j.details.url!==j.url||Date.parse(j.first_seen)>Date.parse(j.last_seen))throw Object.assign(new Error('job has no official source or invalid observation interval'),{statusCode:400});}
  const digest=hash(JSON.stringify(data));let count=0;
  await sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(727001927)`;
    const accepted=new Set<string>();
    for(const s of data.sources){
      const updated=await tx`INSERT INTO recruitment_sources (company,company_url,official_url,career_url,provider,endpoint,status,evidence,catalog_seen_at,discovered_at,attempted_at,last_success,last_error)
        VALUES (${s.company},${s.company_url},${s.official_url},${s.career_url},${s.provider},${s.endpoint},${s.status},${tx.json(s.evidence as never)},${s.catalog_seen_at},${s.discovered_at},${s.attempted_at},${s.last_success},${s.last_error})
        ON CONFLICT(company) DO UPDATE SET company_url=EXCLUDED.company_url,official_url=EXCLUDED.official_url,career_url=EXCLUDED.career_url,provider=EXCLUDED.provider,endpoint=EXCLUDED.endpoint,status=EXCLUDED.status,evidence=EXCLUDED.evidence,catalog_seen_at=EXCLUDED.catalog_seen_at,discovered_at=EXCLUDED.discovered_at,attempted_at=EXCLUDED.attempted_at,last_success=EXCLUDED.last_success,last_error=EXCLUDED.last_error
        WHERE GREATEST(EXCLUDED.catalog_seen_at,EXCLUDED.attempted_at,EXCLUDED.discovered_at,EXCLUDED.last_success)>=GREATEST(recruitment_sources.catalog_seen_at,recruitment_sources.attempted_at,recruitment_sources.discovered_at,recruitment_sources.last_success) RETURNING company`;
      if(updated.length)accepted.add(s.company);
    }
    for(const s of data.sources)if(accepted.has(s.company)&&s.provider==='feishu')await reconcileFeishuAliases(tx,s,data.jobs.filter(j=>j.company===s.company).map(j=>({url:j.url,lastSeen:new Date(j.last_seen)})),actor);
    for(const j of data.jobs){if(!accepted.has(j.company))continue;
      await tx`INSERT INTO recruitment_jobs(company,url,details,first_seen,last_seen,missing_since,baseline,evidence_hash)
        VALUES(${j.company},${j.url},${tx.json(j.details)},${j.first_seen},${j.last_seen},${j.missing_since},${j.baseline},${j.evidence_hash})
        ON CONFLICT(company,url) DO UPDATE SET details=EXCLUDED.details,last_seen=EXCLUDED.last_seen,missing_since=EXCLUDED.missing_since,evidence_hash=EXCLUDED.evidence_hash WHERE EXCLUDED.last_seen>=recruitment_jobs.last_seen`;
      count++;
    }
    await audit(actor,'recruitment.import','recruitment', 'Mac official careers observation sync',null,{digest,sources:accepted.size,jobs:count,exportedAt:data.exportedAt},{db:tx});
    await tx`INSERT INTO recruitment_runs(company,outcome,job_count,complete,evidence_hash) VALUES ('__sync__','import',${count},false,${digest})`;
  });
  return {ok:true,sources:data.sources.length,jobs:count,digest};
}
