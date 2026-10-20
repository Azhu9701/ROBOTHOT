# 机器人资讯配置与证据边界

ROBOTHOT 面向机器人产业读者与 Agent：整机、具身模型、感知／导航／操作／控制、部件、ROS、仿真、部署、安全和产业消息。通用AI新闻只有原文明确说明机器人联系时才通过预筛；传统机器人无需因为没有写“AI”而被排除。

## 初始信源

以下四个RSS地址在2026-10-10通过本仓库真实采集器试读，均返回有标题和日期的条目。试读验证了订阅地址与内容存在，不证明今后持续可用，也不证明每条主张成立。

| 信源 | 订阅地址 | 分级与阅读范围 |
|---|---|---|
| NVIDIA Robotics | [RSS](https://developer.nvidia.com/blog/category/robotics/feed/) | T1，厂商一手发布与工程文章；效果主张仍需核验 |
| arXiv cs.RO | [RSS](https://rss.arxiv.org/rss/cs.RO) | T1，直接论文材料；预印本不等于已通过同行评审，不绑定到某家公司 |
| Open Robotics Discourse | [RSS](https://discourse.openrobotics.org/latest.rss) | T2，开放社区投稿，不把所有作者都视为官方，也不绑定为同一公司 |
| Berkeley AI Research | [RSS](https://bair.berkeley.edu/blog/feed.xml) | T1，研究者一手文章；广谱研究须经机器人相关性预筛 |

Boston Dynamics 的 `/feed/` 本次返回空订阅；The Robot Report 在真实采集器中返回403，Hugging Face连接失败，虽然另一个HTTP客户端能读到订阅，也未纳入种子。宇树目前只配置官方身份词和主题，未凭猜测添加采集地址。中国厂商、中文媒体和公众号的覆盖仍需补充已验证信源，付费采集服务没有因此启用。

2026-10-20 用现有采集器验证并新增以下官方来源。GitHub JSON 接口保留发布正文与原链接并排除 `prerelease=true`；Early Access 等状态仍以原文为准，不能只看布尔标记。

| 信源 | 采集入口 | 验证范围 |
|---|---|---|
| IsaacLab | [官方 Releases](https://api.github.com/repos/isaac-sim/IsaacLab/releases?per_page=10) | 今日 v3.0.0 为正式发布，NVIDIA 官网确认仓库身份 |
| MuJoCo | [官方 Releases](https://api.github.com/repos/google-deepmind/mujoco/releases?per_page=10) | 最新 3.16.0 发布于 10 月 14 日，官网确认仓库身份 |
| LeRobot | [官方 Releases](https://api.github.com/repos/huggingface/lerobot/releases?per_page=10) | 最新 v0.6.1 发布于 8 月 3 日，Hugging Face 文档确认仓库身份 |
| Figure | [官方新闻](https://www.figure.ai/news) | 21 条标题／日期可读，按日期排序避免旧置顶充当新消息；3 篇正文可读 |
| Physical Intelligence | [官方博客](https://www.pi.website/blog) | 8 条标题／日期可读，3 篇正文可读；只有日历日的日期不代表精确发布时间 |

这五个新增源首次回填为 0，先建立监控起点，再按原有近 48 小时发现规则收录新消息；旧版本、旧新闻不会借接入时间变成今日资讯。NVIDIA RSS 和新增官方来源的实时处理优先级设为 3，原有研究源默认 0，让新发布不被论文积压挡住；不删除积压，也不改变精选标准。

每个源默认只发摘要和原文链接，`site_fulltext`／`syndicate_fulltext` 均关闭。原有四个 RSS 首次回填最多 8 条，新增五源首次回填为 0。

种子由 `scripts/seed.ts` 导入，只补充不存在的ID；不会覆盖管理员配置，删除种子项也不会删除或停用数据库中的旧源。已有实例改用机器人范围时，在后台核对旧AI源、订阅频率与已公开内容；本次代码更新不执行生产清理。

## 分类、身份与兼容

保留原有分类key、内容类型、主题slug与MCP前缀。新增人形、四足、机械臂、移动机器人、安全、ROS标签与主题，并把宇树与Boston Dynamics加入新闻编辑词表和防冒名校验。旧AI主题链接仍可读取，主题目录优先列机器人主题。

词表是资讯主体识别配置，不是AIMAN的canonical identity。产品型号不作为公司别名，`G1`、`Go2`、`Atlas`、`Spot`不能仅凭名称匹配成公司。没有匹配到的身份或关系保持未知，不自动写入聚身之家的产品库和产业图谱。

## 精选与写作

保留两次独立评分、五维权重、来源分级门槛、预算与安全规则。只把读者对象、相关性和实例调整到机器人领域。优先收录有明确任务、测试条件、代码／权重或实际交付状态的变化；广告、预告、剪辑演示和无数据合作新闻不自动成为能力证据。

厂商声明只足以证明其声明或发布动作，不能自动证明效果。原型／试点／预售／交付、仿真／实机、遥操作／自主分开写，保留单位、样本量、环境和对照条件。

**门槛仍是上游AI示例的60／65／76，尚未用机器人金标样本校准。** 本地自动测试验证接口和程序行为，不证明模型能准确选出机器人消息；付费实样评估需在采集和模型调用得到授权后按 [精选校准](selection.md) 执行，再判断是否调整数字。

## 公开内容与聚身之家

网站、MCP、API、Markdown、RSS复用 `packages/backend/src/publication/`；本次没有新增平行数据库、模型入口或生产写入。ROBOTHOT的摘要、评分、编辑关系和厂商词表不自动进入AIMAN事实层。

参考Hub的日报／论文文件归档暂未接入：需要先确定ROBOTHOT实际发布地址、稳定的公开内容、更正／撤稿同步与发布授权。仓库不制造空日报、论文引用或承诺未经验证的更新时间。
