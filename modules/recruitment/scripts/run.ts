import { closeDb } from "@aihot/backend/db";
import { runPipeline } from "../backend/pipeline.ts";
try { console.log(JSON.stringify({ at: new Date().toISOString(), ...await runPipeline() })); }
finally { await closeDb(); }
