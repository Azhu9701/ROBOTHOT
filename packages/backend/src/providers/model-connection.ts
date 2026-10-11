import { readFileSync, statSync } from "node:fs";
import { z } from "zod";
import { credential } from "../config.ts";
import type { ModelSpec } from "./llm.ts";

const sharedConfigSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  connection: z.object({
    id: z.literal("caileme"),
    baseUrl: z.string().url().refine((value) => {
      const url = new URL(value);
      return !url.username && !url.password && !url.search && !url.hash
        && (url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "127.0.0.1"));
    }),
    apiKey: z.string().trim().min(1).max(4096).regex(/^[^\r\n\u0000]+$/u),
  }),
});

/** Private snapshot for a single request; never serialize or log it. */
export function modelConnection(spec: ModelSpec) {
  const path = spec.service === "llm" ? process.env.AIMAN_MODEL_CONFIG_PATH : undefined;
  if (path) {
    try {
      if (statSync(path).size > 16_384) throw new Error();
      const raw = readFileSync(path, "utf8");
      if (Buffer.byteLength(raw) > 16_384) throw new Error();
      const value = sharedConfigSchema.parse(JSON.parse(raw));
      return { baseUrl: value.connection.baseUrl, apiKey: value.connection.apiKey, revision: value.revision };
    } catch {
      // An enabled shared connection must never fall back to a stale copied key.
      throw new Error("Shared AI connection is unavailable; check the AI workbench connection and read-only mount");
    }
  }
  return { baseUrl: credential("models", spec.baseUrlEnv), apiKey: credential("models", spec.apiKeyEnv), revision: null };
}

export function modelConfigured(spec: ModelSpec): boolean {
  try {
    const connection = modelConnection(spec);
    return Boolean(spec.model && connection.baseUrl && connection.apiKey);
  } catch {
    return false;
  }
}

/** Reads the same live /models catalog as the workbench; never falls back to presets. */
export async function sharedModelCatalog(spec: ModelSpec): Promise<string[]> {
  const { baseUrl, apiKey, revision } = modelConnection(spec);
  try {
    if (!baseUrl || !apiKey) throw new Error();
    const response = await fetch(baseUrl.replace(/\/$/, "") + "/models", {
      headers: { Authorization: "Bearer " + apiKey }, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 1_048_576) throw new Error();
        chunks.push(value);
      }
      const parsed = z.object({ data: z.array(z.object({ id: z.string().trim().min(1).max(200).regex(/^\S+$/u) })).max(5000) })
        .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      const current = modelConnection(spec);
      if (current.revision !== revision || current.baseUrl !== baseUrl || current.apiKey !== apiKey) throw new Error();
      return [...new Set(parsed.data.map(model => model.id))];
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
  } catch {
    throw Object.assign(new Error("共享模型目录读取失败，请刷新后重试"), { statusCode: 502 });
  }
}
