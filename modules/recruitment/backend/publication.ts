import { sql } from '@aihot/backend/db';
import { placesOf, countryLabel, observationStatus } from './geography.ts';
import type {Posting} from '../types.ts';
interface JobRow {company:string;url:string;details:Posting;first_seen:Date;last_seen:Date;baseline:boolean;missing_since:Date|null;evidence_hash:string;company_url:string;official_url:string|null;career_url:string|null;last_error:string|null}
export interface Filters { q?:string;company?:string;country?:string;region?:string;status?:'observed'|'uncertain'|'expired'|'stale'|'unconfirmed'|'all';offset?:number }
export async function readJobs({q='',company='',country='',region='',status='observed',offset=0}:Filters={}) {
  const now=Date.now();
  const records=await sql<JobRow[]>`SELECT j.company,j.url,j.details,j.first_seen,j.last_seen,j.baseline,j.missing_since,j.evidence_hash,
    s.company_url,s.official_url,s.career_url,s.last_error
    FROM recruitment_jobs j JOIN recruitment_sources s USING(company)
    WHERE s.status='ready' AND s.catalog_seen_at>now()-interval '14 days'
      AND (${company}='' OR j.company=${company})
      AND (${q}='' OR j.company ILIKE ${`%${q}%`} OR j.details->>'title' ILIKE ${`%${q}%`} OR j.details->>'location' ILIKE ${`%${q}%`})`;
  const all=records.map(j=>({...j,geographies:placesOf(j.details),status:observationStatus(j,now)}));
  const counts={observed:0,stale:0,expired:0,unconfirmed:0};
  const countries=new Map<string,{code:string;label:string;count:number}>();
  const regions=new Map<string,{country:string;region:string;count:number}>();
  const companies=new Map<string,{company:string;observed:number;uncertain:number;lastSeen:string;careerUrl:string|null}>();
  for(const j of all) {
    counts[j.status]++;
    const c=companies.get(j.company)||{company:j.company,observed:0,uncertain:0,lastSeen:j.last_seen.toISOString(),careerUrl:j.career_url};
    if(j.status==='observed')c.observed++;else c.uncertain++;
    if(j.last_seen.toISOString()>c.lastSeen)c.lastSeen=j.last_seen.toISOString();companies.set(j.company,c);
    for(const key of new Set(j.geographies.map(p=>p.country||'unknown'))) {const c=countries.get(key)||{code:key,label:countryLabel(key==='unknown'?null:key),count:0};if(j.status==='observed')c.count++;countries.set(key,c);}
    for(const key of new Set(j.geographies.map(p=>`${p.country||'unknown'}\t${p.region||'unknown'}`))) {const [c,r]=key.split('\t');const g=regions.get(key)||{country:c,region:r,count:0};if(j.status==='observed')g.count++;regions.set(key,g);}
  }
  const jobs=all.filter(j=>(status==='all'||status==='uncertain'&&j.status!=='observed'||status===j.status)
    &&(!country&&!region || j.geographies.some(p=>(!country||(p.country||'unknown')===country)&&(!region||(p.region||'unknown')===region))))
    .sort((a,b)=>b.first_seen.getTime()-a.first_seen.getTime()||a.company.localeCompare(b.company)||a.url.localeCompare(b.url));
  const sources=await sql`SELECT company,company_url,official_url,career_url,provider,status,discovered_at,last_success,last_error,evidence
    FROM recruitment_sources WHERE catalog_seen_at>now()-interval '14 days' ORDER BY company`;
  const [runs]=await sql`SELECT max(created_at) AS last_run,max(id) AS last_run_id FROM recruitment_runs`;
  return {jobs:jobs.slice(offset,offset+50),total:jobs.length,offset,nextOffset:offset+50<jobs.length?offset+50:null,sources,lastRun:runs.last_run,lastRunId:runs.last_run_id,
    summary:{...counts,total:all.length,coveredCompanies:sources.filter(s=>s.last_success).length,catalogCompanies:sources.length,countries:[...countries.values()].sort((a,b)=>b.count-a.count),regions:[...regions.values()].sort((a,b)=>b.count-a.count),companies:[...companies.values()].sort((a,b)=>b.observed-a.observed),asOf:new Date(now).toISOString()},
    notice:'岗位表示最近在官方来源观察到；首次发现不等于发布日期，首次导入为存量。超过7天未核验、已过有效期或未再出现的岗位不计入近期岗位。地点未注明则保留未知，不按企业总部推断；一岗可覆盖多地。申请前以官方原文为准。'};
}
export async function jobsMarkdown() {
  const d=await readJobs();return {data:d,text:`${d.notice}\n\n近期观察到 ${d.total} 个岗位；以下最多50条。\n\n`+d.jobs.map(j=>`- ${j.company}｜${j.details.title}｜${j.details.location||'地点未注明'}｜${j.url}｜最近观察 ${j.last_seen.toISOString()}${j.baseline?'｜首次导入存量':''}`).join('\n')};
}
