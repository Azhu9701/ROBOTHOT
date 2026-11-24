import type { WebModule } from "../../apps/web/app/modules.ts";
import { IconUser } from "../../apps/web/app/components/icons.tsx";
const web: WebModule = { name: "recruitment", sidebar: { section: "内容", items: [{ to: "/jobs", label: "机器人招聘", icon: IconUser }] },
  tools: [{ to: "/jobs", label: "机器人招聘", icon: <IconUser /> }] };
export default web;
