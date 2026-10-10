import { stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { z } from "zod";
import { closeDb, sql } from "@aihot/backend/db";
import { modelsOverview, switchModel } from "@aihot/backend/admin/models";
import { MODELS, chatJson } from "@aihot/backend/providers/llm";
import { modelConnection } from "@aihot/backend/providers/model-connection";

const directory = await mkdtemp(join(tmpdir(), "shared-model-test-"));
const file = join(directory, "connection.json");
const provider = await stub(() => ({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
Object.assign(process.env, { AIMAN_MODEL_CONFIG_PATH: file, LLM_MODEL: "robot-task-model", LLM_BASE_URL: "https://stale.invalid", LLM_API_KEY: "stale-key" });
const save = async (revision: number, apiKey: string) => {
  await writeFile(file + ".tmp", JSON.stringify({ version: 1, revision, connection: { id: "caileme", baseUrl: provider.url + "/v1", apiKey }, defaultSelection: { model: "chat-model", api: "anthropic-messages" } }), { mode: 0o600 });
  await rename(file + ".tmp", file);
};
after(async () => { await provider.close(); await closeDb(); await rm(directory, { recursive: true, force: true }); });

test("shared connection rotates without restarting, while each task retains its model and budget receipts", async () => {
  await save(1, "initial-key");
  const snapshot = modelConnection(MODELS.default!);
  assert.equal(snapshot.apiKey, "initial-key");
  await save(2, "rotated-key");
  assert.equal(snapshot.apiKey, "initial-key");
  assert.equal(modelConnection(MODELS.default!).apiKey, "rotated-key");
  const subject = "shared-test-" + tag();
  const fetcher = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(input, provider.url + "/v1/chat/completions");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer rotated-key");
    return fetcher(input, init);
  };
  try {
    await chatJson({ model: "default", purpose: "invariant_test", subject, promptVersion: "shared-1", system: "s", user: "u", schema: z.object({ ok: z.boolean() }) });
  } finally { globalThis.fetch = fetcher; }
  assert.equal(provider.hits(), 1);
  const [receipt] = await sql`SELECT service, model, request FROM receipts WHERE subject = ${subject}`;
  assert.equal(receipt!.service, "llm");
  assert.equal(receipt!.model, "robot-task-model");
  assert.ok(!JSON.stringify(receipt).includes("rotated-key"));
  const overview = await modelsOverview(1);
  assert.deepEqual(overview.connection, { source: "workbench", configured: true, revision: 2, model: "robot-task-model" });
  assert.ok(!JSON.stringify(overview).includes("rotated-key"));
  assert.ok(overview.choices.some((choice) => choice.key === "default"));
  assert.ok(!overview.choices.some((choice) => choice.key === "deepseek-flash"));
  await assert.rejects(switchModel("score", "deepseek-flash", "must reject unconfigured provider", "test"), /not configured/);
});

test("missing, malformed and oversized shared configuration fails before spending and never uses the stale environment key", async () => {
  await writeFile(file, '{"secret":"do-not-expose"}');
  const before = provider.hits();
  const ask = () => chatJson({ model: "default", purpose: "invariant_test", subject: tag(), promptVersion: "shared-fail", system: "s", user: "u", schema: z.object({ ok: z.boolean() }) });
  await assert.rejects(ask(), (error: unknown) => error instanceof Error && /Shared AI connection/.test(error.message) && !error.message.includes("do-not-expose"));
  await writeFile(file, "x".repeat(16_385));
  await assert.rejects(ask(), /Shared AI connection/);
  await rm(file);
  await assert.rejects(ask(), /Shared AI connection/);
  assert.equal(provider.hits(), before);
  const overview = await modelsOverview(1);
  assert.equal(overview.connection?.configured, false);
  assert.ok(!overview.choices.some((choice) => choice.key === "default"));
});
