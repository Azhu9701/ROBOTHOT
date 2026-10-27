import { sql } from "@aihot/backend/db";
export interface Filters { q?: string; company?: string; status?: "observed" | "uncertain" | "all"; offset?: number }
export async function readJobs({ q = "", company = "", status = "observed", offset = 0 }: Filters = {}) {
  const uncertain = sql`(j.missing_since IS NOT NULL OR j.last_seen < now()-interval '7 days'
    OR (j.details->>'validThrough' IS NOT NULL AND (j.details->>'validThrough')::timestamptz < now()))`;
  const rows = await sql`SELECT j.company,j.url,j.details,j.first_seen,j.last_seen,j.baseline,j.missing_since,
    j.evidence_hash,s.company_url,s.official_url,s.career_url,s.last_error,COUNT(*) OVER() AS filtered_total,
    CASE WHEN ${uncertain} THEN 'uncertain' ELSE 'observed' END AS status
    FROM recruitment_jobs j JOIN recruitment_sources s USING(company)
    WHERE s.status='ready' AND s.catalog_seen_at > now()-interval '14 days'
      AND (${company}='' OR j.company=${company})
      AND (${q}='' OR j.company ILIKE ${`%${q}%`} OR j.details->>'title' ILIKE ${`%${q}%`} OR j.details->>'location' ILIKE ${`%${q}%`})
      AND (${status}='all' OR (${status}='uncertain' AND ${uncertain}) OR (${status}='observed' AND NOT ${uncertain}))
    ORDER BY j.first_seen DESC,j.company,j.url LIMIT 50 OFFSET ${offset}`;
  const total = Number(rows[0]?.filtered_total || 0);
  const sources = await sql`SELECT company,company_url,official_url,career_url,provider,status,discovered_at,last_success,last_error,evidence
    FROM recruitment_sources WHERE catalog_seen_at > now()-interval '14 days' ORDER BY company`;
  const [runs] = await sql`SELECT max(created_at) AS last_run,max(id) AS last_run_id FROM recruitment_runs`;
  return { jobs: rows, total, offset, nextOffset: offset + 50 < total ? offset + 50 : null,
    sources, lastRun: runs.last_run, lastRunId: runs.last_run_id,
    notice: "岗位仅表示最近在官方来源观察到；首次发现不等于发布时间。首次导入标记为存量。来源异常、未再出现或超过7天未核验的岗位归入待确认，最终以原招聘页面为准。" };
}
export async function jobsMarkdown() {
  const d = await readJobs();
  return { data: d, text: `${d.notice}\n\n当前观察到 ${d.total} 个岗位；以下最多50条。\n\n` + d.jobs.map(j => `- ${j.company}｜${j.details.title}｜${j.details.location || "地点未注明"}｜${j.url}｜最近观察 ${j.last_seen.toISOString()}${j.baseline ? "｜首次导入存量" : ""}`).join("\n") };
}
