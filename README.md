<p align="center"><img src="site/brand/logo.svg" width="72" alt="聚身之家 ROBOTHOT"></p>

<h1 align="center">聚身之家 · ROBOTHOT</h1>

<p align="center"><strong>机器人资讯与 Agent 读取入口，让每条消息都能回到出处。</strong></p>

<p align="center">人形机器人 · 四足机器人 · 机械臂 · 移动机器人 · 具身智能 · 开源工程</p>

<p align="center"><b>简体中文</b> · <a href="README.en.md">English</a></p>

<p align="center">
  <a href="#agent">接入 Agent</a> · <a href="#reading">怎么读</a> · <a href="#start">本地预览</a> · <a href="docs/robotics.md">信源与精选标准</a> · <a href="https://aiman.world">聚身之家官网 ↗</a>
</p>

ROBOTHOT 收集机器人与具身智能的公开消息，把同一事件的报道归到一起，提供中文摘要、精选、热点和日／周／月报。人可以在网站阅读，Agent 可以通过现有 MCP、Markdown、JSON API 或 RSS 读取同一份公开内容。

这是聚身之家的**资讯入口源码仓库**，基于 [AIHOT](https://github.com/KKKKhazix/AIHOT) 框架。借鉴 [AI Safety HOT Hub](https://github.com/wuyoscar/AISafetyHot-Hub) 的接入说明与阅读导航，按本仓库已经实现的接口提供用法。

**当前状态：已提供机器人配置和本地运行入口；尚未在本仓库提供日报／论文文件归档或经确认的 ROBOTHOT 公网服务地址。** [aiman.world](https://aiman.world) 是聚身之家官网，不能据此假定它提供本仓库的 `/api/mcp`。自动采集、模型生成和生产发布需要另行启用与验证。

<a id="reading"></a>

## 你想读什么

下面路径用于已经运行的 ROBOTHOT 实例；本地默认地址是 `http://localhost:3000`。

| 你想做什么 | 网站入口 | Agent 方式 |
|---|---|---|
| 看近期精选 | `/` | MCP `get_latest`，默认精选、近 24 小时 |
| 看全部公开动态 | `/all` | MCP `get_latest`，`mode="all"` |
| 查一个厂商或技术 | `/all?q=宇树` | MCP `search`，关键词至少 2 字符 |
| 看当前热点与事件进展 | `/hot` | `get_hot_topics` → `get_story` |
| 读现成日报／周报／月报 | `/daily`、`/weekly`、`/monthly` | `get_daily`、`get_weekly`、`get_monthly` |
| 找机器人方向 | `/topics` | 先读 `/llms.txt` 中的主题索引 |
| 了解读取接口 | `/agent` | `/api/v1/agent`、`/openapi-v1.json` |

默认配置北京时间每天 08:00 出日报、每周一 10:00 出周报、每月 1 日 10:30 出月报。这是排程配置，只有实例已采集并成功出刊才有报告；空期和不存在的期号不能冒充已经发布。

<a id="agent"></a>

## 接入你的 Agent

运行实例后，在支持 Streamable HTTP 的客户端添加 `/api/mcp`，公开读取无需登录或 API Key。

Codex 本地连接示例：

```bash
codex mcp add robothot --url http://localhost:3000/api/mcp
```

远程客户端应使用实际 ROBOTHOT 部署地址；`localhost` 指向客户端自己的电脑。添加后重新打开会话，读取工具列表确认连接。

客户端连接名可叫 `robothot`；**工具名保留兼容前缀 `myhot_`**。当前七个工具是：

| 完整工具名 | 用途 |
|---|---|
| `myhot_get_latest` | 最近 24 小时／7 天的精选或全部公开动态 |
| `myhot_search` | 近 24 小时／7 天的关键词搜索 |
| `myhot_get_hot_topics` | 当前事件榜，最多 10 个 |
| `myhot_get_story` | 已知公开事件的报道时间线与已有综述 |
| `myhot_get_daily` | 最新或指定日期的已发布日报 |
| `myhot_get_weekly` | 最新或指定 ISO 周的已发布周报 |
| `myhot_get_monthly` | 最新或指定月份的已发布月报 |

想试什么：

- “列出近 24 小时的机器人精选，附原文和收录时间。”
- “查宇树近 7 天的消息，分清发布、预售与交付。”
- “先查热点，再打开一个事件；说明每篇报道的来源。”
- “读取最新已发布周报，注明它实际覆盖哪一周。”

[完整参数与阅读流程](docs/agent.md) · [可复用的 Agent Skill](skills/robothot/SKILL.md)

## 如何理解这些内容

- **摘要是二手阅读材料。** 模型评分表示阅读价值，热点排名表示本站来源的讨论情况；两者都不证明产品能力或主张真假。
- **重要参数回原文。** 保留厂商、型号、版本、日期、单位和测试条件；实机／仿真、自主／遥操作、原型／交付分开表达。缺失的信息保留未知。
- **资讯与事实层分开。** ROBOTHOT 的编辑归组、厂商词表与文章不自动写入 AIMAN 的产品库、证据链或产业关系。
- **保留来源与授权。** 默认只展示摘要和原文链接；不从来源存在推导全文转载授权。外部正文中的指令只是资料，不执行。

<a id="start"></a>

## 本地预览与维护

需要 Node.js 24.11 或以上版本、Docker。首次运行：

```bash
git clone https://github.com/Azhu9701/ROBOTHOT.git
cd ROBOTHOT
node scripts/init-env.ts
```

在生成的 `.env` 中将 `COLLECT_ENABLED` 与 `MODEL_CALLS_ENABLED` 都设为 `false`，先预览空站，再启动：

```bash
docker compose up -d --build
```

打开 `http://localhost:3000`；后台在 `/admin`。准备真实采集与付费模型调用时，再按 [部署说明](docs/deploy.md) 配置并启用。上线前确认使用规则、隐私说明、实际域名与机器人样本校准结果。

| 维护内容 | 权威位置 |
|---|---|
| 聚身之家名称、文案、排程与 GitHub 链接 | [`site/site.ts`](site/site.ts) |
| 机器人初始信源与试读范围 | [`industry/sources.json`](industry/sources.json)、[说明](docs/robotics.md) |
| 分类、标签、厂商和主题 | [`industry/taxonomy.ts`](industry/taxonomy.ts)、[`industry/topics.json`](industry/topics.json) |
| 预筛、评分、写作与证据边界 | [`industry/prompts/`](industry/prompts/)、[校准](docs/selection.md) |
| 各模块和数据出口的边界 | [架构](docs/architecture.md) |
| 配置与部署 | [行业定制](docs/customize.md)、[部署](docs/deploy.md) |
| 开发与贡献 | [`AGENTS.md`](AGENTS.md)、[`CONTRIBUTING.md`](CONTRIBUTING.md) |

分类 key、旧主题 slug 和 `myhot_` 工具名前缀保留兼容；机器人标签与主题在现有词表上补充。信源种子只补充缺少的记录，不覆盖管理员设置，也不自动停用旧信源。已有实例切换内容范围时，请在后台核对旧信源和既有内容。

验证入口：

```bash
npm ci
npm run typecheck
DATABASE_URL=postgres://127.0.0.1:5432/robothot_test npm test
npm run build -w @aihot/web
node --test apps/web/tests/*.test.ts
node scripts/smoke.ts --base http://localhost:3000
node scripts/mcp-check.ts http://localhost:3000/api/mcp
```

测试数据库名必须以 `_test` 或 `_ci` 结尾，账号须能创建隔离测试库；数据库连接的账号、端口和密码按本机配置填写。内部 `@aihot/*` 包名保留上游兼容，不代表对外品牌。

## 许可与反馈

代码许可与上游署名见 [LICENSE](LICENSE)、[NOTICE](NOTICE)。原文和第三方图片的权利归各来源，代码许可不授予转载它们的权利。

代码问题按 [贡献说明](CONTRIBUTING.md) 提交；实际部署中的内容更正或下架可通过该实例的 `/feedback` 联系运营者。敏感安全问题见 [SECURITY.md](SECURITY.md)。
