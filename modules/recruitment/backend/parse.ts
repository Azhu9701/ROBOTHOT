import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { Posting } from "../types.ts";

export const hash = (text: string) => createHash("sha256").update(text).digest("hex");
// Official custom Feishu domains, verified through each company's linked career page.
export const isFeishuHost = (host:string) => /^[\w-]+\.jobs\.feishu\.cn$/.test(host) || ['career.limxdynamics.com','careers.kinetixai.cn'].includes(host);
const text = (x: unknown): string | null => typeof x === "string" && x.trim() ? x.trim().slice(0, 500) : null;
export function publicUrl(raw: unknown, base?: string): string | null {
  try {
    if (typeof raw !== "string") return null;
    const u = new URL(raw, base);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
    // Moka's public role identifier lives in the fragment, unlike tracking anchors.
    if(!(u.hostname==='app.mokahr.com' && /^#\/job\/[\w-]+$/.test(u.hash)))u.hash = "";
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|gh_src$|source$|ref$)/i.test(key)) u.searchParams.delete(key);
    return u.href;
  } catch { return null; }
}
export function careerLinks(html: string, base: string): string[] {
  const $ = load(html);
  return [...new Set($("a[href]").toArray().flatMap((el) => {
    const href = $(el).attr("href")!;
    if (!href || href.startsWith("#") || /(?:^|\.)framer\.com$/i.test(new URL(publicUrl(href,base)||base).hostname)) return [];
    const label = $(el).text().replace(/\s+/g, " ").trim();
    const matched = /careers?|join\s*(?:us|our team)|open (?:roles|positions)|we['’]re hiring|招聘|招贤纳士|加入我们|人才招聘|诚聘英才|採用|채용|stellenangebote|karriere/i.test(label)
      || /\/(?:careers?|jobs|join[-_]?us|recruit(?:ment)?|zhaopin)(?:[/?#]|$)/i.test(href);
    const url = matched ? publicUrl(href, base) : null;
    return url ? [url] : [];
  }))].slice(0, 5);
}
export function board(raw: string): { provider: string; endpoint: string } | null {
  try {
    const u = new URL(raw); const slug = u.pathname.split("/").filter(Boolean)[0];
    if (["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(u.hostname)) {
      const token = u.searchParams.get("for") || (slug !== "embed" ? slug : null);
      if (token && /^[\w-]+$/.test(token)) return { provider: "greenhouse", endpoint: `https://boards-api.greenhouse.io/v1/boards/${token}/jobs` };
    }
    if (["jobs.lever.co", "jobs.eu.lever.co"].includes(u.hostname) && slug && /^[\w-]+$/.test(slug))
      return { provider: "lever", endpoint: `https://${u.hostname === "jobs.eu.lever.co" ? "api.eu.lever.co" : "api.lever.co"}/v0/postings/${slug}` };
    if(u.hostname==='app.mokahr.com' && /^\/(?:social|campus)-recruitment\/[\w-]+\/\d+\/?$/.test(u.pathname))
      return {provider:'moka',endpoint:u.href};
    if (u.hostname === "jobs.ashbyhq.com" && slug && /^[\w-]+$/.test(slug))
      return { provider: "ashby", endpoint: `https://api.ashbyhq.com/posting-api/job-board/${slug}` };
    if(isFeishuHost(u.hostname)){
      const detail=u.pathname.match(/^(\/[^/]+)\/position\/(?:\d+\/detail|detail\/\d+)\/?$/);
      if(detail)u.pathname=detail[1]+'/position/list';
      return {provider:'feishu',endpoint:u.href};
    }
    if (/^[a-z0-9-]+\.wd[0-9]+\.myworkdayjobs\.com$/.test(u.hostname)) {
      const parts=u.pathname.split('/').filter(Boolean);if(/^[a-z]{2}-[A-Z]{2}$/.test(parts[0]||''))parts.shift();
      const site=parts[0];const tenant=u.hostname.split('.')[0];
      if(site && /^[\w-]+$/.test(site))return {provider:'workday',endpoint:`${u.origin}/wday/cxs/${tenant}/${site}/jobs`};
    }
  } catch { /* Not an ATS URL. */ }
  return null;
}
export function embeddedBoard(html: string, base: string) {
  const $ = load(html);
  for (const el of $("a[href],iframe[src],script[src],link[rel=preload][href]").toArray()) {
    const url = publicUrl($(el).attr("href") || $(el).attr("src"), base);
    const found = url && board(url);
    if (found) return { ...found, link: url };
  }
  // Agility embeds the public API address in inline script rather than an iframe.
  const api = /https:\/\/boards-api\.greenhouse\.io\/v1\/boards\/([\w-]+)\/(?:departments|jobs)/.exec(html);
  if (api) return { provider: "greenhouse", endpoint: `https://boards-api.greenhouse.io/v1/boards/${api[1]}/jobs`, link: api[0] };
  return null;
}
function date(value: unknown): string | null {
  // A date without an offset stays a calendar date; never guess the source timezone.
  const s = text(value);
  if (!s || !Number.isFinite(Date.parse(s))) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s).toISOString().slice(0,10) === s ? s : null;
  return /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(s) ? s : null;
}
function posting(value: Record<string, any>, base: string): Posting | null {
  const title = text(value.title || value.text || value.name);
  const url = publicUrl(value.url || value.absolute_url || value.hostedUrl || value.jobUrl, base);
  if (!title || !url) return null;
  const locations = [value, ...(Array.isArray(value.secondaryLocations) ? value.secondaryLocations : [])].map(v => {
    const address = v.address?.postalAddress || v.jobLocation?.address || {};
    return {raw:text(v.location?.name ?? v.location ?? v.categories?.location)?.replace(/[、·]/g,' / ')||null,country:text(address.addressCountry?.name ?? address.addressCountry),region:text(address.addressRegion),city:text(address.addressLocality)};
  });
  return { title, url, locations, remote:typeof value.isRemote === "boolean" ? value.isRemote : null, location: text(value.location?.name ?? value.location ?? value.categories?.location),
    department: text(value.departments?.[0]?.name ?? value.department ?? value.categories?.team),
    employmentType: text(value.employmentType ?? value.categories?.commitment),
    postedAt: date(value.datePosted ?? value.publishedAt), validThrough: date(value.validThrough) };
}
export function parseApi(provider: string, data: any, base: string): Posting[] {
  if(provider==='feishu') {
    if(data?.code!==0||!Array.isArray(data.data?.job_post_list)||!Number.isInteger(data.data.count)||data.data.count<0)throw new Error('invalid public Feishu job list');
    const jobs=data.data.job_post_list.map((v:any)=>{
      if(typeof v.id!=='string'||!/^\d+$/.test(v.id))throw new Error('invalid job identifier');
      const addresses=v.job_post_info?.address_list||[];
      const locations=addresses.map((p:any)=>({raw:text(p.city?.name||p.name),country:text(p.country?.country_code)?.split('_')[0]||null,region:text(p.state?.name),city:text(p.city?.name)}));
      const prefix=new URL(base).pathname.match(/^\/([^/]+)\/position\//)?.[1]||'index';
      const job=posting({title:v.title,url:new URL('/'+prefix+'/position/'+v.id+'/detail',base).href,location:(v.city_list||[]).map((p:any)=>p.name).filter(Boolean).join(' / '),employmentType:v.recruit_type?.name,datePosted:typeof v.publish_time==='number'?new Date(v.publish_time).toISOString():null},base);
      return job&&{...job,...(locations.length?{locations}: {})};
    });
    if(jobs.some((j:Posting|null)=>!j))throw new Error('invalid public Feishu job');return unique(jobs as Posting[]);
  }
  if(provider==='workday') {
    if(!Array.isArray(data?.jobPostings)||!Number.isInteger(data.total)||data.total<0)throw new Error('invalid Workday response');
    const jobs=data.jobPostings.map((v:any)=>{
      if(typeof v.externalPath!=='string'||!v.externalPath.startsWith('/job/'))throw new Error('invalid Workday original URL');
      return posting({title:v.title,url:base+v.externalPath,location:v.locationsText},base);
    });
    if(jobs.some((j:Posting|null)=>!j))throw new Error('invalid Workday job');
    return unique(jobs as Posting[]);
  }
  const values = provider === "lever" ? data : data?.jobs;
  if (!Array.isArray(values)) throw new Error("invalid job board response");
  const listed = values.filter(v => v && typeof v === "object" && v.isListed !== false);
  const jobs = listed.map(v => posting(v, base));
  if (jobs.some(j => !j)) throw new Error("job board item missing title or original URL");
  if (provider === "greenhouse" && data.meta?.total !== undefined && data.meta.total !== values.length) throw new Error("incomplete job board response");
  return unique(jobs as Posting[]);
}
// Only verified employer layouts; navigation links are never treated as job cards.
const HTML_CARDS:Record<string,[string,string,string,string]>={
  'weaverobotics.com':['a[href^="/careers/"]','.type-h2','.type-meta',''],
  'roboparty.com':['a[href^="/join-us/"][class*="jobLink"]','h3','[class*="jobMeta"]','[class*="jobContent"] p'],
  'lightwheel.ai':['a[href^="/careers/"]','h4','p',''],
  'xingchidongli.com':['a[href^="/zh-CN/careers/"]','h3','small','span'],
  'visionone.tech':['a[href^="/careers/"]','h2,h3','',''],
  'droidup.com':['a[href^="/jiaruwomen/"]','h3','',''],
};
export function parseHtml(html: string, base: string): { jobs: Posting[]; complete: boolean; supported: boolean } {
  const $ = load(html);
  if (new URL(base).hostname.replace(/^www\./, "") === "unitree.com") {
    const jobs: Posting[] = [];
    for (const el of $('a[href*="/position/"]').toArray()) {
      if (!/\/position\/\d+\/?$/.test($(el).attr("href") || "")) continue;
      const title = $(el).find(".title").clone().children().remove().end().text().trim();
      const parts = $(el).find(".base-info").text().split("|").map(s => s.trim());
      const job = posting({ title, url: $(el).attr("href"), location: parts[0], department: parts[2] }, base);
      if (!job) throw new Error("Unitree job layout changed");
      jobs.push(job);
    }
    // The custom HTML list does not promise complete pagination. Absence is never a closure signal.
    if (jobs.length) return { jobs: unique(jobs), complete: false, supported: true };
  }
  const jobs: Posting[] = [];
  const host=new URL(base).hostname.replace(/^www\./,'');
  const cards=HTML_CARDS[host];
  if(cards)for(const el of $(cards[0]).toArray()){
    const field=(selector:string)=>selector ? text($(el).find(selector).first().text().replace(/\s+/g,' ')) : null;
    const meta=host==='droidup.com' ? $(el).find('.x-p').text().split('|').map(s=>s.trim()) : [];
    const job=posting({title:field(cards[1]),url:$(el).attr('href'),location:field(cards[2]),department:meta[1]||field(cards[3]),datePosted:meta[2]?.replaceAll('/','-')},base);
    if(!job)throw new Error('official job card layout changed');
    jobs.push(job);
  }
  if(host==='app.mokahr.com')for(const el of $('a[href^="#/job/"]').toArray()){
    // Sidebar recommendations do not contain the full metadata card.
    if(!$(el).find('[class*="card-content-"]').length)continue;
    const labels=[...new Set($(el).find('[class*="info-"] .no-adaptive-tooltip').toArray().map(e=>$(e).clone().children().remove().end().text().trim()).filter(Boolean))];
    const job=posting({title:$(el).find('[class*="title-"]').first().text(),url:$(el).attr('href'),
      location:labels.filter(s=>/[省市]$|·/.test(s)||s==='全国').join(' / ')||null,
      department:labels.find(s=>/事业部$|中心$|部门$/.test(s)),
      employmentType:labels.find(s=>/^(全职|实习|兼职|劳务|合同制|Full-time|Part-time|Internship)$/.test(s)),
      datePosted:$(el).find('[class*="published-at-"]').text().match(/\d{4}-\d\d-\d\d/)?.[0]},base);
    if(!job)throw new Error('Moka job card layout changed');
    jobs.push(job);
  }
  function visit(v: any) {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(visit); return; }
    const types = Array.isArray(v["@type"]) ? v["@type"] : [v["@type"]];
    if (types.includes("JobPosting")) {
      const address = v.jobLocation?.address;
      const job = posting({ ...v, title: v.title, location: [address?.addressLocality, address?.addressRegion, address?.addressCountry].filter(Boolean).join(", ") || (v.jobLocationType === "TELECOMMUTE" ? "Remote" : null) }, base);
      if (job) jobs.push(job);
    }
    if (v["@graph"]) visit(v["@graph"]);
    if (v.itemListElement) visit(v.itemListElement);
    if (v.item) visit(v.item);
  }
  $('script[type="application/ld+json"]').each((_i, e) => { try { visit(JSON.parse($(e).text())); } catch { /* Other schema blocks need not be JSON. */ } });
  return { jobs: unique(jobs), complete: false, supported: jobs.length > 0 };
}
export function unique(jobs: Posting[]): Posting[] { return [...new Map(jobs.map(j => [j.url, j])).values()]; }
