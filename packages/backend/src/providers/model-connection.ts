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
  const path = spec.key === "default" ? process.env.AIMAN_MODEL_CONFIG_PATH : undefined;
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
