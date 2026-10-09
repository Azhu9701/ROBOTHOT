# Jushen Home · ROBOTHOT

**Robotics news and a read-only entry point for Agents, with links back to the original sources.**

ROBOTHOT covers humanoids, quadrupeds, robot arms, mobile robots, embodied intelligence and open engineering. It collects public material, groups reports about the same event, and offers Chinese summaries, editorial picks, current topics and published daily, weekly and monthly reports.

[简体中文 / Full guide](README.md) · [Agent access](docs/agent.md) · [Sources and editorial boundaries](docs/robotics.md) · [Reusable Agent Skill](skills/robothot/SKILL.md) · [Jushen Home](https://aiman.world)

This repository contains the application and robotics configuration. It does not yet include a daily-news or paper file archive, or a verified public ROBOTHOT MCP endpoint. The Jushen Home website is not automatically the endpoint for this application.

## Agent access

Once an instance is running, connect a Streamable HTTP client to its `/api/mcp` endpoint. Public reads are anonymous and require no API key. The seven existing tools keep the `myhot_` prefix: `get_latest`, `search`, `get_hot_topics`, `get_story`, `get_daily`, `get_weekly`, and `get_monthly`. Read the live schema before calling them; the Agent guide describes their actual limits.

The website, MCP, Markdown, JSON API and RSS use the same public reading layer. A report is available only after the instance has successfully published it. Collection and model calls must be configured and enabled separately; for a local preview, follow the Chinese guide with both switches off.

## Reading responsibly

Summaries and model scores help with reading; they do not verify a product's capabilities. Preserve the source, date, model, units and test conditions. Distinguish simulation from hardware, teleoperation from autonomy, and prototypes or preorders from deliveries. Keep unknowns unknown. News, editorial grouping and the publisher vocabulary do not automatically become AIMAN product facts or industrial relationships.

The initial source list contains four feeds checked with this repository's collector. Chinese manufacturers and Chinese-language coverage remain incomplete, and the inherited selection thresholds still need calibration with robotics examples. Full-text display and redistribution remain off by default.

## Credits and license

Built on the [AIHOT](https://github.com/KKKKhazix/AIHOT) framework, with reading navigation and Agent-access presentation informed by [AI Safety HOT Hub](https://github.com/wuyoscar/AISafetyHot-Hub). Code licensing and upstream attribution are preserved in [LICENSE](LICENSE) and [NOTICE](NOTICE). Those licenses do not grant rights to republish source articles or third-party images.
