# 官方招聘管线

从 AIMAN.World 企业目录取得有机器人产品的企业，再从企业详情的 `profile.officialWebsite` 取得官网。官网注册表仍由 AIMAN 维护；ROBOTHOT 不写回企业事实库，也不将招聘观察混入新闻热点评分。

## 已实现

- `modules/recruitment/` 拥有招聘来源、岗位观察和运行记录三个表。
- 从官网链接发现招聘页及 Greenhouse、Lever、Ashby 公共招聘板；按实际分页读取 Lever。支持官网 JobPosting JSON-LD 和已核验的官网职位列表、Workday、飞书（含已核验自定义域名）、Moka 公开列表。
- 宇树英文首页的服务端 HTML 不带招聘链接，使用同官方域名、已人工核验的 `seeds.ts` 招聘页；不猜第三方招聘板租户。
- 保存企业资料页、官网、招聘页、嵌入招聘板的来源链和响应 SHA-256。只存岗位元数据，不复制完整岗位说明、不代投简历、不收个人信息、不调用模型。
- 每小时推进一批：同步企业名单，检查最多20家待发现的官网，采集最多20个到期来源。每个来源至少间隔12小时；每7天重查入口，发现异常后次日重试。网页动态加载、未知结构和访问失败进入缺口清单。
- 第一次导入的岗位标记为存量；`first_seen` 不是发布日期。没有明确发布日期、地点或用工类型就保留未知。
- 只有完整招聘板的成功快照才把未再出现的岗位标为待确认；局部 HTML 不做消失判断。失败不改岗位观察，超过7天未观察到或来源明确的有效期已过也归入待确认；不把这些情况自动写成已关闭。
- 同一企业和岗位原文 URL 判重；再次观察会恢复状态。招聘入口变化会先把旧入口的岗位标为待确认。
- API、网页和 MCP 都读模块的唯一公开读取面 `backend/publication.ts`。招聘是独立数据域，不读取或绕过新闻 `packages/backend/src/publication/` 的发布范围；原资讯出口不变。

## 读取入口

| 地址 | 用途 |
| --- | --- |
| `/jobs` | 查询岗位、核验时间和来源覆盖/缺口 |
| `/api/v1/jobs?q=数据&status=observed` | 岗位 JSON，支持 `q`、`company`、`status=observed/uncertain/all`、`offset`，每页50条 |
| `/api/v1/agent/jobs` | 招聘观察 Markdown |
| MCP `myhot_get_jobs` | 同一份招聘观察，最多50条并给出总量 |

读取不会触发抓取或模型调用。公开响应不缓存，避免待确认状态被延长。岗位数据只是“最近在官方来源观察到”，申请前仍须打开原文确认。

## 两种调度方式，选用一种

已有 ROBOTHOT 实例：保持正常迁移与部署流程，在 worker 中同时设置 `COLLECT_ENABLED=true`、`RECRUITMENT_ENABLED=true`。worker 每小时15分执行 `recruitment.sync`，沿用 `job_runs`；其余采集开关仍按原实例设置。

本次在 Mac 安装的是独立调度方式，避免为招聘开启其他新闻采集：

```bash
cd /Users/mac/ROBOTHOT
python3 modules/recruitment/scripts/install-local.py prepare
npm run build -w @aihot/web
python3 modules/recruitment/scripts/install-local.py activate
```

- 数据库：Docker `robothot-recruitment-db`，仅监听 `127.0.0.1:55446`，数据卷 `robothot-recruitment-pg17`。
- 私有运行配置：`~/Library/Application Support/ROBOTHOT/recruitment.env`，权限0600，生成随机凭据，不进入 Git。
- 登录后由 LaunchAgent `world.aiman.robothot.recruitment` 每小时执行 `scripts/run.ts`；API 和网页由相同前缀的 `.api`、`.web` 维护。
- 本地页面：`http://127.0.0.1:3034/jobs`，API：`http://127.0.0.1:3033`。没有公网发布。
- 日志位于同一运行目录，`recruitment.log`、`recruitment.error.log`。进程跨次通过数据库 advisory lock 排除重入。
- Mac 需登录、保持运行且 Docker 可用；休眠/离线不会产生新的核验，页面会据最后观察时间变为待确认。
- 主 worker 和本地调度不能同时启用为长期默认；短期交接的并发由锁阻止重复运行。

新增的三个迁移只创建模块表，不修改既有数据。部署回退时先停调度和卸载模块入口，保留招聘表和数据卷供恢复；不要直接删除数据。

## 验证

```bash
npm run typecheck
npm run test:standalone
python3 modules/recruitment/scripts/test-local.py
npm run build -w @aihot/web
node --test apps/web/tests/*.test.ts
node scripts/mcp-check.ts http://127.0.0.1:3034/api/mcp
```

`test-local.py` 使用专用 PostgreSQL 实例中的 `_test` 数据库，沿用仓库每文件隔离的测试框架；不会对运行数据执行测试写入。需本机 `/opt/homebrew/opt/libpq/bin/pg_dump`，测试输出中的数据库凭据会被隐藏。新模块测试验证错误响应拒绝、分页/完整性、判重、存量标记、消失/重现，以及抓取失败不改变岗位。

## 初始观察（2026-10-27）

企业目录同步取得293家有机器人产品的企业。首批已成功采集：宇树26个、Agility Robotics 69个、1X Technologies 102个，均按首次存量导入。该数字是当次观察，不代表所有293家都已完成适配；运行后的最新覆盖以 `/jobs` 页面为准。

本轮补充识别 ATS 预加载链接与飞书自定义域名，读取 Moka 正常渲染的职位卡及分页，保留其 #/job/ 岗位标识；另适配 Weave、RoboParty、光轮、星炽、Vision One、卓益得的官网列表。普通 HTML / Moka 快照不声明完整，未再出现不会立即自动关闭。后续优先处理北森等中国企业动态招聘平台适配，核对官网缺失和错误跳转，再扩展同一企业的多地区/校招招聘板。当前每家企业只选一个招聘入口；不能将现有记录数解释为企业全部岗位数。
