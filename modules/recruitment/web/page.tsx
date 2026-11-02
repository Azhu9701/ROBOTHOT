import { Form, Link, useLoaderData } from "react-router";
import { apiGet, cachedPage } from "../../../apps/web/app/lib/api.server.ts";
import { pageMeta } from "../../../apps/web/app/lib/seo.ts";
import { buttonClass } from "../../../apps/web/app/components/ui/Controls.tsx";
import type { readJobs } from "../backend/publication.ts";
type Result = Awaited<ReturnType<typeof readJobs>>;
export const handle = { tab: "me", name: "机器人招聘" };
export { pageHeaders as headers } from "../../../apps/web/app/lib/api.server.ts";
export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  for (const key of ["q", "company", "status", "offset"]) if (url.searchParams.has(key)) params.set(key, url.searchParams.get(key)!);
  return cachedPage(0, { data: await apiGet<Result>(`/api/v1/jobs?${params}`, { signal: request.signal }), query: Object.fromEntries(params) });
}
export function meta() { return pageMeta({ title: "机器人招聘", description: "从聚身之家企业档案找到官方招聘来源，保留岗位原文、首次发现与最近核验时间。", path: "/jobs" }); }
const time = (date: string | Date | null) => date ? new Date(date).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "尚未成功采集";
export default function Jobs() {
  const { data, query } = useLoaderData<typeof loader>();
  const covered = data.sources.filter(s => s.last_success).length;
  return <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
    <p className="text-sm text-ink-3">聚身之家 · 官方招聘观察</p>
    <h1 className="mt-2 text-3xl font-bold text-ink">机器人公司，正在找什么人</h1>
    <p className="mt-4 max-w-3xl text-sm leading-7 text-ink-2">{data.notice}</p>
    <div className="my-6 rounded-xl border border-line p-4 text-sm text-ink-2">已登记 {data.sources.length} 家有机器人产品的企业 · {covered} 家成功采集 · 当前筛选 {data.total} 个岗位<br />最近运行：{time(data.lastRun)}</div>
    <Form method="get" className="mb-6 flex flex-wrap gap-3">
      <label className="flex-1 text-sm">岗位、企业或城市<input aria-label="搜索岗位、企业或城市" className="mt-1 block w-full rounded-lg border border-line bg-transparent p-3" name="q" defaultValue={query.q || ""} placeholder="例如：数采、杭州、宇树" /></label>
      <label className="text-sm">观察状态<select name="status" defaultValue={query.status || "observed"} className="mt-1 block rounded-lg border border-line bg-transparent p-3"><option value="observed">近期观察到</option><option value="uncertain">待确认</option><option value="all">全部记录</option></select></label>
      <button className={`${buttonClass("primary", "lg")} self-end`} type="submit">查岗位</button>
    </Form>
    <div className="grid gap-4">
      {data.jobs.map(j => <article key={`${j.company}:${j.url}`} className="rounded-xl border border-line p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><a href={j.company_url} className="text-sm text-ink-3" target="_blank" rel="noreferrer">{j.company} ↗</a><h2 className="mt-1 text-lg font-semibold"><a href={j.url} target="_blank" rel="noreferrer">{j.details.title} ↗</a></h2></div><span className="rounded-full border border-line px-3 py-1 text-xs">{j.status === "observed" ? "近期观察到" : "待确认"}</span></div>
        <p className="mt-3 text-sm text-ink-2">{[j.details.location || "地点未注明", j.details.department, j.details.employmentType].filter(Boolean).join(" · ")}</p>
        <p className="mt-3 text-xs leading-6 text-ink-3">首次发现：{time(j.first_seen)}{j.baseline ? "（首次导入存量）" : ""}<br />最近观察：{time(j.last_seen)} · 原文发布时间：{j.details.postedAt || "未注明"}</p>
        {j.last_error && <p className="mt-2 text-xs text-ink-3">本次来源检查未成功，申请前请核对原招聘页。</p>}
      </article>)}
      {!data.jobs.length && <p className="rounded-xl border border-line p-6 text-ink-2">当前条件没有岗位记录。没有抓到岗位不代表企业没有招聘。</p>}
    </div>
    <nav aria-label="岗位翻页" className="my-6 flex gap-5 text-sm">{data.offset > 0 && <Link to={`?${new URLSearchParams({ ...query, offset: String(Math.max(0, data.offset - 50)) })}`}>上一页</Link>}{data.nextOffset !== null && <Link to={`?${new URLSearchParams({ ...query, offset: String(data.nextOffset) })}`}>下一页</Link>}</nav>
    <details className="mt-8 rounded-xl border border-line p-5"><summary className="cursor-pointer font-semibold">来源覆盖与未解决项（{data.sources.length} 家）</summary><p className="mt-3 text-sm text-ink-3">官网取自聚身之家企业注册表；招聘入口须能从官网追溯。动态页面、访问受限和缺少官网的企业会保留为待处理。</p>
      <ul className="mt-4 space-y-3 text-sm">{data.sources.map(s => <li key={s.company} className="border-t border-line pt-3"><a href={s.company_url} target="_blank" rel="noreferrer">{s.company} ↗</a> · {s.last_success ? "已采集" : s.status === "pending" ? "待检查" : s.status === "missing_website" ? "缺官网" : s.status === "no_career_link" ? "未找到招聘入口" : "待处理"}{s.career_url && <> · <a href={s.career_url} target="_blank" rel="noreferrer">官方招聘入口 ↗</a></>}{s.last_error && <span className="text-ink-3"> · {s.last_error === "manual_adapter_required" ? "页面需要补采集适配" : "最近检查异常"}</span>}</li>)}</ul>
    </details>
  </main>;
}
