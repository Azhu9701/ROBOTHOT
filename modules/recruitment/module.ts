import { defineModule } from "@aihot/contracts/modules";
export default defineModule({ name: "recruitment", pages: [{ path: "jobs", file: "web/page.tsx" }], apiPaths: [/^\/api\/v1\/jobs(?:\/|$)/] });
