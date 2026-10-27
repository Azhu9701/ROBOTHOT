import { sql } from "@aihot/backend/db";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { board, careerLinks, embeddedBoard, hash, parseApi, parseHtml, publicUrl, unique } from "./parse.ts";
import type { Source, Snapshot, Posting } from "../types.ts";
import { readFeishu } from "./feishu-browser.ts";
import { readMoka } from "./moka-browser.ts";
import {reconcileFeishuAliases} from "./identity.ts";
import { CAREER_SEEDS, CAREER_BOARD_SEEDS } from "../seeds.ts";

const WORLD = "https://www.aiman.world";
export const enabled = () => process.env.COLLECT_ENABLED === "true" && process.env.RECRUITMENT_ENABLED === "true";
export async function getPage(url: string) {
  const res = await guardedFetch(url, { timeoutMs: 25000, maxBytes: 5 * 1024 * 1024 });
  if (res.status !== 200) throw new Error(`source_http_${res.status}`);
  return { url: res.url, body: res.text() };
}
export async function syncCatalog() {
  const companies: string[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await getPage(`${WORLD}/api/companies?page=${page}&page_size=1000`);
    const data = JSON.parse(res.body);
    if (!Array.isArray(data.companies) || !Number.isInteger(data.total)) throw new Error("invalid company catalog");
    for (const c of data.companies) {
      if (typeof c.company !== "string" || typeof c.robot_count !== "number") throw new Error("invalid company item");
      if (c.robot_count > 0) companies.push(c.canonicalName || c.company);
    }
    if (page * data.pageSize >= data.total) break;
    if (page === 20 || !data.companies.length) throw new Error("incomplete company catalog");
  }
  // Only publish a new catalog observation after every page has succeeded.
  await sql.begin(async tx => {
    for (const company of new Set(companies)) await tx`
      INSERT INTO recruitment_sources (company, company_url) VALUES (${company}, ${`${WORLD}/company/${encodeURIComponent(company)}`})
      ON CONFLICT (company) DO UPDATE SET catalog_seen_at = now()`;
  });
  return new Set(companies).size;
}
export async function discoverSource(source: Source) {
  const profilePage = await getPage(`${WORLD}/api/companies/${encodeURIComponent(source.company)}`);
  const profile = JSON.parse(profilePage.body).profile;
  if (!profile || typeof profile.canonicalName !== "string") throw new Error("invalid company profile");
  const official = publicUrl(profile.officialWebsite);
  const evidence: Record<string, string | null> = { profileUrl: profilePage.url, profileHash: hash(profilePage.body), checkedAt: new Date().toISOString() };
  if (!official || profile.lifecycle?.historical === true) {
    await sql`UPDATE recruitment_sources SET official_url=${official}, career_url=NULL, provider=NULL, endpoint=NULL,
      status=${official ? "historical" : "missing_website"}, discovered_at=now(), evidence=${sql.json(evidence)}, last_error=NULL WHERE company=${source.company}`;
    return;
  }
  const home = await getPage(official);
  Object.assign(evidence, { officialUrl: official, homepageUrl: home.url, homepageHash: hash(home.body) });
  let links = careerLinks(home.body, home.url);
  const seed = CAREER_SEEDS[source.company];
  if (seed && new URL(seed).hostname.replace(/^www\./, "") === new URL(official).hostname.replace(/^www\./, "")) {
    links = [seed, ...links];
    evidence.curatedOfficialPage = seed;
  }
  const boardSeed=CAREER_BOARD_SEEDS[source.company];
  if(boardSeed && new URL(official).hostname.replace(/^www\./,'')===boardSeed.officialHost && board(boardSeed.url)){
    await getPage(boardSeed.linkedFrom);links=[boardSeed.url,...links];
    Object.assign(evidence,{curatedBoard:boardSeed.url,curatedLinkedFrom:boardSeed.linkedFrom,curatedVerifiedAt:boardSeed.verifiedAt});
  }
  // Some companies put the board itself in the footer or an iframe.
  const direct = embeddedBoard(home.body, home.url);
  if (direct) links = [direct.link, ...links];
  const candidates=[...new Set(links)].map(url=>({url,from:home.url,depth:0}));
  const seen=new Set<string>();let fallback:{url:string;body:string;from:string}|null=null;let failed:Error|null=null;
  for(let i=0;i<candidates.length && i<10;i++) {
    const candidate=candidates[i];if(seen.has(candidate.url))continue;seen.add(candidate.url);
    let career;try{career=await getPage(candidate.url);}catch(e){failed=e as Error;continue;}
    const ats=board(career.url)||embeddedBoard(career.body,career.url);
    const supported=!!ats||parseHtml(career.body,career.url).supported;
    if(!fallback)fallback={...career,from:candidate.from};
    if(candidate.depth<1)for(const url of careerLinks(career.body,career.url))if(!seen.has(url))candidates.push({url,from:career.url,depth:1});
    if(!supported)continue;
    Object.assign(evidence,{linkedFrom:candidate.from,careerUrl:career.url,careerHash:hash(career.body),boardLink:ats && 'link' in ats ? ats.link : career.url});
    await save(career.url,ats?.provider||'html',ats?.endpoint||career.url);return;
  }
  if(fallback){
    Object.assign(evidence,{linkedFrom:fallback.from,careerUrl:fallback.url,careerHash:hash(fallback.body)});
    await save(fallback.url,'html',fallback.url);return;
  }
  if(failed)throw failed;
  async function save(career:string,provider:string,endpoint:string){
    await sql.begin(async tx=>{
      if(source.endpoint && source.endpoint!==endpoint)await tx`UPDATE recruitment_jobs SET missing_since=COALESCE(missing_since,now()) WHERE company=${source.company}`;
      await tx`UPDATE recruitment_sources SET official_url=${official},career_url=${career},provider=${provider},endpoint=${endpoint},status='ready',discovered_at=now(),evidence=${tx.json(evidence)},last_error=NULL WHERE company=${source.company}`;
    });
  }
  await sql`UPDATE recruitment_sources SET official_url=${official}, career_url=NULL, provider=NULL, endpoint=NULL,
    status='no_career_link', discovered_at=now(), evidence=${sql.json(evidence)}, last_error=NULL WHERE company=${source.company}`;
}
export async function discoverDue(limit = 20) {
  const sources = await sql<Source[]>`SELECT * FROM recruitment_sources
    WHERE catalog_seen_at > now() - interval '14 days' AND (discovered_at IS NULL OR
      discovered_at < now() - CASE WHEN last_error IS NOT NULL THEN interval '1 day' ELSE interval '7 days' END)
    ORDER BY discovered_at NULLS FIRST, created_at, company LIMIT ${limit}`;
  for (const source of sources) {
    try { await discoverSource(source); }
    catch (e) {
      await sql`UPDATE recruitment_sources SET discovered_at=now(), last_error=${errorText(e)},
        status=CASE WHEN status='ready' THEN status ELSE 'discovery_error' END WHERE company=${source.company}`;
    }
  }
  return sources.length;
}
export async function readSnapshot(source: Source): Promise<Snapshot> {
  if (!source.endpoint || !source.career_url) throw new Error("source not ready");
  if(source.provider==='feishu')return readFeishu(source);
  if(source.provider==='moka')return readMoka(source);
  if(source.provider==='workday'){
    const origin=new URL(source.endpoint);const site=origin.pathname.split('/')[4];
    const base=origin.origin+'/'+site;const jobs:Posting[]=[];const hashes:string[]=[];let total:number|null=null;
    for(let offset=0;offset<10000;offset+=20){
      const r=await guardedFetch(source.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({appliedFacets:{},limit:20,offset,searchText:''}),timeoutMs:25000,maxBytes:5*1024*1024});
      if(r.status!==200)throw new Error('source_http_'+r.status);
      const raw=r.text();const data=JSON.parse(raw);const batch=parseApi('workday',data,base);
      if(total===null)total=data.total;else if(data.total!==0 && total!==data.total)throw new Error('Workday total changed; incomplete snapshot'); // Workday reports total only on its first page.
      jobs.push(...batch);hashes.push(hash(raw));
      if(jobs.length===total){const uniqueJobs=unique(jobs);if(uniqueJobs.length!==total)throw new Error('duplicate Workday page');return {jobs:uniqueJobs,complete:true,hash:hash(hashes.join(':'))};}
      if(!batch.length || jobs.length>total!)throw new Error('incomplete Workday page');
    }
    throw new Error('Workday page limit reached');
  }
  if (source.provider === "lever") {
    const jobs: Posting[] = []; const hashes: string[] = [];
    for (let skip = 0; skip < 10000; skip += 100) {
      const p = await getPage(`${source.endpoint}?mode=json&limit=100&skip=${skip}`);
      const data = JSON.parse(p.body);
      const batch = parseApi("lever", data, source.career_url);
      hashes.push(hash(p.body)); jobs.push(...batch);
      if (data.length < 100) return { jobs: unique(jobs), complete: true, hash: hash(hashes.join(":")) };
    }
    throw new Error("Lever page limit reached; snapshot incomplete");
  }
  const page = await getPage(source.endpoint);
  if (source.provider === "html") {
    const parsed = parseHtml(page.body, page.url);
    if (!parsed.supported) throw new Error("manual_adapter_required");
    return { jobs: parsed.jobs, complete: parsed.complete, hash: hash(page.body) };
  }
  return { jobs: parseApi(source.provider!, JSON.parse(page.body), source.career_url), complete: true, hash: hash(page.body) };
}
export async function applySnapshot(source: Source, snapshot: Snapshot) {
  await sql.begin(async tx => {
    const now=new Date();await reconcileFeishuAliases(tx,source,snapshot.jobs.map(j=>({url:j.url,lastSeen:now})),"system:recruitment");
    for (const job of snapshot.jobs) await tx`
      INSERT INTO recruitment_jobs (company,url,details,baseline,evidence_hash)
      VALUES (${source.company},${job.url},${tx.json({ ...job })},${source.last_success === null},${snapshot.hash})
      ON CONFLICT (company,url) DO UPDATE SET details=EXCLUDED.details,last_seen=now(),missing_since=NULL,evidence_hash=EXCLUDED.evidence_hash`;
    if (snapshot.complete) await tx`UPDATE recruitment_jobs SET missing_since=COALESCE(missing_since,now())
      WHERE company=${source.company} AND NOT (url=ANY(${snapshot.jobs.map(j => j.url)}::text[]))`;
    await tx`UPDATE recruitment_sources SET last_success=now(),attempted_at=now(),last_error=NULL WHERE company=${source.company}`;
    await tx`INSERT INTO recruitment_runs (company,outcome,job_count,complete,evidence_hash)
      VALUES (${source.company},'success',${snapshot.jobs.length},${snapshot.complete},${snapshot.hash})`;
  });
}
const errorText = (e: unknown) => (e instanceof Error ? e.message : "collection_failed").slice(0, 300);
export async function recordFailure(company: string, error: string) {
  await sql.begin(async tx => {
    await tx`UPDATE recruitment_sources SET attempted_at=now(),last_error=${error.slice(0,300)} WHERE company=${company}`;
    await tx`INSERT INTO recruitment_runs (company,outcome,complete,error) VALUES (${company},'error',false,${error.slice(0,300)})`;
  });
}
export async function collectDue(limit = 20) {
  const sources = await sql<Source[]>`SELECT * FROM recruitment_sources WHERE status='ready'
    AND catalog_seen_at > now() - interval '14 days' AND (attempted_at IS NULL OR attempted_at < now() - interval '12 hours')
    ORDER BY attempted_at NULLS FIRST, created_at, company LIMIT ${limit}`;
  const results: Array<{ company: string; count?: number; error?: string }> = [];
  for (const source of sources) {
    try {
      const snapshot = await readSnapshot(source); await applySnapshot(source, snapshot);
      results.push({ company: source.company, count: snapshot.jobs.length });
    } catch (e) {
      const error = errorText(e);
      await recordFailure(source.company, error);
      results.push({ company: source.company, error });
    }
  }
  return results;
}
export async function runPipeline() {
  if (!enabled()) return { skipped: "COLLECT_ENABLED and RECRUITMENT_ENABLED must both be true" };
  // CLI and worker can coexist during a handover; only one collector may update snapshots.
  const lock = await sql.reserve();
  try {
    const [row] = await lock`SELECT pg_try_advisory_lock(727001927) AS acquired`;
    if (!row.acquired) return { skipped: "recruitment already running" };
    try { return { companies: await syncCatalog(), discovered: await discoverDue(), collected: await collectDue() }; }
    finally { await lock`SELECT pg_advisory_unlock(727001927)`; }
  } finally { lock.release(); }
}
