import type {Tx} from '@aihot/backend/db';
import {audit} from '@aihot/backend/audit';
import {isFeishuHost} from './parse.ts';

export function feishuIdentity(raw:string):string|null{
  try{const u=new URL(raw);if(!/^https?:$/.test(u.protocol)||u.username||u.password||!isFeishuHost(u.hostname))return null;
    const id=u.pathname.match(/^\/[^/]+\/position\/(?:detail\/(\d+)|(\d+)\/detail)\/?$/);
    return id ? u.origin+'\\n'+(id[1]||id[2]) : null;
  }catch{return null;}
}
interface Row{url:string;first_seen:Date;last_seen:Date;baseline:boolean}
export async function reconcileFeishuAliases(tx:Tx,source:{company:string;provider:string|null},jobs:Array<{url:string;lastSeen:Date}>,actor:string){
  if(source.provider!=='feishu')return;
  const incoming=new Map<string,{url:string;lastSeen:Date}>();
  for(const job of jobs){const key=feishuIdentity(job.url);if(!key)continue;
    if(incoming.has(key)&&incoming.get(key)!.url!==job.url)throw new Error('duplicate Feishu posting identity');
    incoming.set(key,job);
  }
  if(!incoming.size)return;
  const previous=await tx<Row[]>`SELECT * FROM recruitment_jobs WHERE company=${source.company}`;
  const changes=[];
  for(const[key,job]of incoming){
    const group=previous.filter(r=>feishuIdentity(r.url)===key);if(!group.some(r=>r.url!==job.url))continue;
    if(group.some(r=>r.last_seen.getTime()>job.lastSeen.getTime()))throw new Error('stale Feishu URL migration');
    const earliest=group.reduce((a,b)=>a.first_seen<=b.first_seen?a:b);
    const keeper=group.find(r=>r.url===job.url)||earliest;
    const removed=group.filter(r=>r.url!==keeper.url).map(r=>r.url);
    await tx`UPDATE recruitment_jobs SET url=${job.url},first_seen=${earliest.first_seen},baseline=${earliest.baseline} WHERE company=${source.company} AND url=${keeper.url}`;
    if(removed.length)await tx`DELETE FROM recruitment_jobs WHERE company=${source.company} AND url=ANY(${removed}::text[])`;
    changes.push({before:group,after:{url:job.url,firstSeen:earliest.first_seen.toISOString(),baseline:earliest.baseline}});
  }
  if(changes.length)await audit(actor,'recruitment.alias','recruitment',source.company,{jobs:changes.map(c=>c.before)},{jobs:changes.map(c=>c.after)},{db:tx});
}
