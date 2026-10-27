export interface Place { raw: string | null; country?: string | null; region?: string | null; city?: string | null }
export interface Geography { country: string | null; region: string | null; city: string | null; basis: 'source' | 'place_lookup' | 'unknown' }
const names = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
const aliases: Record<string,string> = { 'united states':'US',usa:'US','u.s.':'US','united states of america':'US','美国':'US',china:'CN','中国':'CN',norway:'NO','挪威':'NO','united kingdom':'GB',uk:'GB','英国':'GB',germany:'DE','德国':'DE',france:'FR','法国':'FR',canada:'CA','加拿大':'CA',japan:'JP','日本':'JP',singapore:'SG','新加坡':'SG',australia:'AU','澳大利亚':'AU','south korea':'KR','韩国':'KR','hong kong':'HK','中国香港':'HK',taiwan:'TW','中国台湾':'TW',switzerland:'CH','瑞士':'CH' };
const states: Record<string,string> = { CA:'California',OR:'Oregon',PA:'Pennsylvania',TX:'Texas',NY:'New York',IL:'Illinois',TN:'Tennessee',MA:'Massachusetts',WA:'Washington',MI:'Michigan',OH:'Ohio',GA:'Georgia',CO:'Colorado',NC:'North Carolina',VA:'Virginia',FL:'Florida',AZ:'Arizona',UT:'Utah',NJ:'New Jersey',MD:'Maryland',WI:'Wisconsin',MN:'Minnesota',CT:'Connecticut',IN:'Indiana',MO:'Missouri',SC:'South Carolina',KY:'Kentucky',AL:'Alabama',OK:'Oklahoma',NV:'Nevada',NH:'New Hampshire',RI:'Rhode Island',ID:'Idaho',KS:'Kansas',IA:'Iowa',NE:'Nebraska',LA:'Louisiana',AR:'Arkansas',MS:'Mississippi',ME:'Maine',VT:'Vermont',DE:'Delaware',WV:'West Virginia',MT:'Montana',ND:'North Dakota',SD:'South Dakota',NM:'New Mexico',AK:'Alaska',HI:'Hawaii',WY:'Wyoming' };
// Exact, unambiguous cities observed in the source; never use company headquarters.
const provinces=new Set('河北 山西 辽宁 吉林 黑龙江 江苏 浙江 安徽 福建 江西 山东 河南 湖北 湖南 广东 海南 四川 贵州 云南 陕西 甘肃 青海 台湾'.split(' '));
function regionName(country:string,region:string|null|undefined){if(!region)return null;if(country==='US')return states[region]||region;if(country==='CN'){if(provinces.has(region))return region+'省';if(['北京','上海','天津','重庆'].includes(region))return region+'市';}return region;}
const cn: Record<string,string> = { '杭州':'浙江省','杭州市':'浙江省','上海':'上海市','上海市':'上海市','北京':'北京市','北京市':'北京市','深圳':'广东省','深圳市':'广东省','广州':'广东省','广州市':'广东省','苏州':'江苏省','苏州市':'江苏省','南京':'江苏省','南京市':'江苏省','合肥':'安徽省','合肥市':'安徽省','成都':'四川省','成都市':'四川省','武汉':'湖北省','武汉市':'湖北省' };
export function countryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s=value.trim(); const alias=aliases[s.toLowerCase()];
  if (alias) return alias;
  if (/^[A-Z]{2}$/.test(s) && s!=='ZZ' && names.of(s)!==s) return s;
  return null;
}
export const countryLabel = (code: string | null) => code ? names.of(code) || code : '国家/地区未注明';
export function placesOf(details: { location?: string | null; locations?: Place[] }): Geography[] {
  const places=details.locations?.length ? details.locations : [{raw:details.location || null}];
  const out: Geography[]=[];
  for (const p of places) {
    const explicit=countryCode(p.country); const raw=p.raw || '';
    if (explicit) { out.push({country:explicit,region:regionName(explicit,p.region),city:p.city || null,basis:'source'});continue; }
    const found:Geography[]=[];
    for(const [key,region] of Object.entries(states)) {
      if (new RegExp(`,\\s*${key}(?=$|[\\s,;)])`).test(raw) || raw.toLowerCase().includes(region.toLowerCase()+', united states'))
        found.push({country:'US',region,city:p.city || null,basis:'place_lookup'});
    }
    for(const token of raw.split(/[\s,，|/;（）()-]+/)) if(cn[token]) found.push({country:'CN',region:cn[token],city:token,basis:'place_lookup'});
    if(found.length) {out.push(...found);continue;}
    let code:string|null=null;
    for (const [name,c] of Object.entries(aliases)) if(name.length>3 && (name.match(/^[a-z .]+$/) ? new RegExp('(?:^|[^a-z])'+name.replace(/[.]/g,'\\.')+'(?:$|[^a-z])','i').test(raw) : raw.includes(name))) {code=c;break;}
    if(/\b(?:US|USA|United States)\b/.test(raw))code='US';
    out.push({country:code,region:p.region || null,city:p.city || null,basis:code ? 'source' : 'unknown'});
  }
  return [...new Map(out.map(p=>[`${p.country}:${p.region}:${p.city}`,p])).values()];
}
export function observationStatus(job: { last_seen: string | Date; missing_since?: unknown; details:{validThrough?: string|null} }, now=Date.now()) {
  const until=job.details.validThrough;
  const deadline=until ? Date.parse(until) + (/^\d{4}-\d\d-\d\d$/.test(until) ? 24*3600000 : 0) : NaN;
  if(Number.isFinite(deadline) && deadline<now)return 'expired' as const;
  if(job.missing_since)return 'unconfirmed' as const;
  if(!Number.isFinite(new Date(job.last_seen).getTime()) || now-new Date(job.last_seen).getTime()>7*86400000)return 'stale' as const;
  return 'observed' as const;
}
