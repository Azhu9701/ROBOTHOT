import assert from "node:assert/strict";
import { test } from "node:test";
import { board, careerLinks, parseApi, parseHtml, publicUrl } from "../backend/parse.ts";
test("discovery follows explicit career links and rejects non-web URLs", () => {
  assert.deepEqual(careerLinks('<a href="/careers">Careers</a><a href="javascript:alert(1)">招聘</a><a href="/news">新闻</a>', "https://robot.example/"), ["https://robot.example/careers"]);
  assert.equal(publicUrl("https://user:pass@example.org/jobs"), null);
  assert.equal(publicUrl("https://a.example/job?id=1&utm_source=x#apply"), "https://a.example/job?id=1");
  assert.deepEqual(board("https://boards.greenhouse.io/embed/job_board?for=robot"), { provider: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/robot/jobs" });
  assert.equal(board("https://jobs.lever.co.evil.example/robot"), null);
});
test("custom Unitree list extracts metadata, never inventing a posted date or completeness", () => {
  const d = parseHtml('<a href="/cn/position/123"><p class="title">机器人数据运营工程师 <span>热招</span></p><p class="base-info">杭州市 | 技术类 | 研发部</p></a>', "https://www.unitree.com/cn/position/");
  assert.equal(d.jobs[0].title, "机器人数据运营工程师"); assert.equal(d.jobs[0].location, "杭州市");
  assert.equal(d.jobs[0].postedAt, null); assert.equal(d.complete, false);
  assert.equal(parseHtml("<h1>Something went wrong</h1>", "https://www.unitree.com/position/").supported, false);
});
test("malformed and partial boards fail rather than becoming successful empty snapshots", () => {
  assert.throws(() => parseApi("greenhouse", { error: "rate limit" }, "https://robot.example/"));
  assert.throws(() => parseApi("greenhouse", { jobs: [{title:"Engineer"}], meta: { total:1 } }, "https://robot.example/"));
  assert.throws(() => parseApi("greenhouse", { jobs: [], meta: { total:1 } }, "https://robot.example/"));
  assert.deepEqual(parseApi("greenhouse", { jobs: [], meta: { total:0 } }, "https://robot.example/"), []);
});
test("JSON-LD handles arrays and graphs without copying descriptions or guessing dates", () => {
  const d = parseHtml('<script type="application/ld+json">{"@graph":[{"@type":"JobPosting","title":"Engineer","url":"/job/1","datePosted":"2026-10-25","description":"long copyrighted body","jobLocation":{"address":{"addressLocality":"杭州"}}}]}</script>', "https://robot.example/careers");
  assert.equal(d.jobs.length, 1); assert.equal(d.jobs[0].location, "杭州"); assert.equal(d.jobs[0].postedAt, "2026-10-25");
  assert.equal("description" in d.jobs[0], false); assert.equal(d.complete, false);
  assert.deepEqual(parseApi("ashby", { jobs:[{title:"Hidden",jobUrl:"/hidden",isListed:false}] }, "https://robot.example/"), []);
});
