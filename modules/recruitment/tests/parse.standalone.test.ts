import assert from "node:assert/strict";
import { test } from "node:test";
import { board, careerLinks, embeddedBoard, parseApi, parseHtml, publicUrl } from "../backend/parse.ts";
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

test("structured countries and secondary locations survive without guessing from headquarters",()=>{
  const d=parseApi('ashby',{jobs:[{title:'Engineer',jobUrl:'/jobs/1',location:'Moss',address:{postalAddress:{addressCountry:'Norway',addressRegion:'Østfold',addressLocality:'Moss'}},secondaryLocations:[{location:'San Carlos, CA',address:{postalAddress:{addressCountry:'United States',addressRegion:'California'}}}]}]},'https://robot.example');
  assert.equal(d[0].locations?.[0].country,'Norway');assert.equal(d[0].locations?.[1].country,'United States');
  const lever=parseApi('lever',[{text:'Engineer',hostedUrl:'/jobs/2',categories:{location:'Remote - US'}}],'https://robot.example');
  assert.equal(lever[0].locations?.[0].raw,'Remote - US');
});

test('career discovery ignores placeholder/template links and recognizes official Workday boards',()=>{
  assert.deepEqual(careerLinks('<a href="#">Careers</a><a href="https://framer.com/projects/new?duplicate=abc">Join us</a><a href="/careers/job-listings">Job Listings</a>','https://apptronik.com'),['https://apptronik.com/careers/job-listings']);
  assert.deepEqual(board('https://bostondynamics.wd1.myworkdayjobs.com/en-US/Boston_Dynamics/introduceYourself'),{provider:'workday',endpoint:'https://bostondynamics.wd1.myworkdayjobs.com/wday/cxs/bostondynamics/Boston_Dynamics/jobs'});
  assert.equal(board('https://bostondynamics.wd1.myworkdayjobs.com.evil.test/Boston_Dynamics'),null);
});
test('Workday preserves the original employer URL and never guesses relative posting dates',()=>{
  const d=parseApi('workday',{total:1,jobPostings:[{title:'Atlas Engineer',externalPath:'/job/Waltham-MA/Engineer_R123',locationsText:'Waltham, MA',postedOn:'Posted 3 Days Ago'}]},'https://bostondynamics.wd1.myworkdayjobs.com/Boston_Dynamics');
  assert.equal(d[0].url,'https://bostondynamics.wd1.myworkdayjobs.com/Boston_Dynamics/job/Waltham-MA/Engineer_R123');assert.equal(d[0].postedAt,null);
  assert.throws(()=>parseApi('workday',{total:1,jobPostings:[{title:'Invalid',externalPath:'https://evil.test/job/1'}]},'https://example.test'));
});

test('Feishu keeps source address hierarchy and absolute publication metadata without descriptions',()=>{
 const d=parseApi('feishu',{code:0,data:{count:1,job_post_list:[{id:'12345',title:'数据采集员',publish_time:1792047350106,description:'not stored',city_list:[{name:'杭州'}],recruit_type:{name:'全职'},job_post_info:{address_list:[{city:{name:'杭州'},state:{name:'浙江'},country:{country_code:'CN_1'}}]}}]}},'https://robot.jobs.feishu.cn');
 assert.equal(d[0].url,'https://robot.jobs.feishu.cn/index/position/12345/detail');assert.equal(d[0].locations?.[0].country,'CN');assert.equal(d[0].locations?.[0].region,'浙江');assert.equal(d[0].postedAt,new Date(1792047350106).toISOString());assert.equal('description' in d[0],false);
 assert.deepEqual(board('https://robot.jobs.feishu.cn/index'),{provider:'feishu',endpoint:'https://robot.jobs.feishu.cn/index'});
 assert.equal(board('https://robot.jobs.feishu.cn.evil.test/index'),null);
 assert.throws(()=>parseApi('feishu',{code:403,data:{}},'https://robot.jobs.feishu.cn'));
});

test('company hiring portals are never interpreted as individual roles',()=>{
 const html='<a href="https://maker.haier.net/client/job/index">社会招聘 SOCIAL RECRUITMENT</a><a href="https://www.zhipin.com/gongsi/job/company.html">申请岗位</a><a href="/jobs/engineer">Explore Opportunities</a>';
 const d=parseHtml(html,'https://robot.example/careers');assert.equal(d.jobs.length,0);assert.equal(d.supported,false);
});

test('preloaded ATS scripts and verified custom Feishu domains are discoverable',()=>{
 assert.equal(embeddedBoard('<link rel="preload" as="script" href="https://jobs.ashbyhq.com/ReflexRobotics/embed?version=2">','https://www.reflexrobotics.com/careers')?.provider,'ashby');
 assert.equal(board('https://career.limxdynamics.com/index')?.provider,'feishu');
 assert.equal(board('https://careers.kinetixai.cn/careers')?.provider,'feishu');
 assert.equal(board('https://careers.kinetixai.cn.evil.test/careers'),null);
 assert.equal(board('https://robot.jobs.feishu.cn/index/position/123/detail')?.endpoint,'https://robot.jobs.feishu.cn/index/position/list');
 const d=parseApi('feishu',{code:0,data:{count:1,job_post_list:[{id:'123',title:'Engineer'}]}},'https://careers.kinetixai.cn/careers/position/list');
 assert.equal(d[0].url,'https://careers.kinetixai.cn/careers/position/123/detail');
});
test('verified employer cards retain titles, locations and calendar dates without descriptions',()=>{
 const cases=[
  ['https://www.weaverobotics.com/careers','<a href="/careers/id"><span class="type-h2">Robot Operator</span><span class="type-meta">San Francisco, CA · On-site</span></a>','Robot Operator','San Francisco, CA · On-site'],
  ['https://www.roboparty.com/join-us','<a class="careers__jobLink" href="/join-us/intern"><div class="careers__jobContent"><h3>研究实习生</h3><p>Lab</p></div><span class="careers__jobMeta">北京、上海</span></a>','研究实习生','北京、上海'],
  ['https://www.lightwheel.ai/careers','<a href="/careers/manager"><div><h4>Product Manager</h4><p>Palo Alto</p></div></a>','Product Manager','Palo Alto'],
  ['https://xingchidongli.com/zh-CN/careers','<a href="/zh-CN/careers/data"><span>数据研发</span><h3>数据工程师</h3><small>青岛 · 全职</small></a>','数据工程师','青岛 · 全职'],
  ['https://visionone.tech/careers','<a href="/careers/scientist"><h2>Senior Scientist</h2><p>Long description</p></a>','Senior Scientist',null],
  ['https://www.droidup.com/jiaruwomen','<a href="/jiaruwomen/19"><h3>算法工程师</h3><div class="x-p">社会招聘 | 研发类 | 2026/10/14</div></a>','算法工程师',null],
 ] as const;
 for(const [base,html,title,location]of cases){const d=parseHtml(html,base);assert.equal(d.jobs.length,1);assert.equal(d.jobs[0].title,title);assert.equal(d.jobs[0].location,location);assert.equal(d.complete,false);assert.equal('description' in d.jobs[0],false);}
 assert.equal(parseHtml(cases[5][1],cases[5][0]).jobs[0].postedAt,'2026-10-14');
 assert.equal(parseHtml(cases[0][1],'https://unrelated.example/careers').supported,false);
 assert.equal(parseHtml('<a href="/careers">Join Us</a>','https://www.weaverobotics.com/careers').supported,false);
 assert.throws(()=>parseHtml('<a href="/careers/id">Wrong layout</a>','https://www.weaverobotics.com/careers'));
});

test('Moka public cards retain distinct SPA URLs, displayed metadata and source dates',()=>{
 const base='https://app.mokahr.com/social-recruitment/astribot/144861?locale=zh-CN#/jobs/';
 const html='<a href="#/job/abc-1"><div class="card-content-a"><span class="title-a">算法工程师</span><span class="published-at-a">发布于 2026-09-11</span><div class="info-a"><div class="no-adaptive-tooltip">研发事业部</div><div class="no-adaptive-tooltip">全职</div><div class="no-adaptive-tooltip">广东·深圳市</div></div><p>Long description not stored</p></div></a><a href="#/job/abc-2"><div class="card-content-b"><span class="title-b">数据工程师</span><div class="info-b"><div class="no-adaptive-tooltip">技术类</div></div></div></a><a href="#/job/sidebar">推荐岗位</a>';
 const d=parseHtml(html,base);assert.equal(d.jobs.length,2);assert.equal(d.complete,false);
 assert.equal(d.jobs[0].url,'https://app.mokahr.com/social-recruitment/astribot/144861?locale=zh-CN#/job/abc-1');
 assert.notEqual(d.jobs[0].url,d.jobs[1].url);assert.equal(d.jobs[0].postedAt,'2026-09-11');assert.equal(d.jobs[0].location,'广东·深圳市');
 assert.equal(d.jobs[0].locations?.[0].raw,'广东 / 深圳市');assert.equal(d.jobs[0].employmentType,'全职');assert.equal(d.jobs[1].location,null);assert.equal('description' in d.jobs[0],false);
 assert.equal(board(base)?.provider,'moka');assert.equal(board('https://app.mokahr.com.evil.test/social-recruitment/astribot/144861'),null);
 assert.equal(publicUrl('https://app.mokahr.com/social-recruitment/astribot/144861#/job/abc-1')?.endsWith('#/job/abc-1'),true);
 assert.equal(board('https://robot.jobs.feishu.cn/index/position/detail/123')?.endpoint,'https://robot.jobs.feishu.cn/index/position/list');
});
