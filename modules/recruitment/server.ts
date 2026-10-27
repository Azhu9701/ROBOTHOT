import { z } from "zod";
import { defineServerModule } from "@aihot/backend/modules";
import { enabled, runPipeline } from "./backend/pipeline.ts";
import { readJobs, jobsMarkdown } from "./backend/publication.ts";
export default defineServerModule({
  name: "recruitment",
  http(app) {
    app.get("/api/v1/jobs", async (req, reply) => {
      const query = z.object({ q: z.string().max(100).optional(), company: z.string().max(200).optional(),
        status: z.enum(["observed", "uncertain", "all"]).optional(), offset: z.coerce.number().int().min(0).max(100000).optional() }).strict().safeParse(req.query);
      if (!query.success) return reply.code(400).send({ error: "invalid_query" });
      return reply.header("Cache-Control", "no-store").send(await readJobs(query.data));
    });
  },
  schedules: [{ name: "recruitment.sync", cron: "15 * * * *", when: enabled, run: runPipeline }],
  agent: { abilities: [{ path: "/jobs", title: "机器人企业招聘", ask: "查询官方招聘岗位与来源覆盖",
    answer: async () => (await jobsMarkdown()).text, etagPrefix: "recruitment", cacheControl: "no-store",
    mcp: { tool: "get_jobs", use: "for official robotics job observations", description: "读取最近在企业官方招聘来源观察到的岗位。首次发现不代表发布时间，核查原文后申请。", input: z.object({}),
      run: async () => { const d = await jobsMarkdown(); return { text: d.text, structured: d.data }; } } }] },
  llms: () => ({ pages: ["- /jobs：官方招聘岗位与来源覆盖"], api: ["- /api/v1/jobs?q=数据：岗位查询；/api/v1/agent/jobs、MCP get_jobs 读取同一份资料"], pace: ["招聘每小时检查一批，每个来源至少间隔12小时"], usage: ["招聘观察与新闻分开；抓取失败不等于停止招聘。"] }),
  sitemap: { pages: [{ loc: "/jobs" }] },
});
