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
import { modelConnection, sharedModelCatalog } from "@aihot/backend/providers/model-connection";

const directory = await mkdtemp(join(tmpdir(), "shared-model-test-"));
const file = join(directory, "connection.json");
const provider = await stub((_hit, req) => {
  if (req.url === "/v1/models") return { data: [{ id: "robot-task-model" }, { id: "live/model-v4" }, { id: "live/model-v4" }] };
  const body = JSON.parse(req.body);
  // Match the production failure: reasoning consumes the short task's entire output allowance.
  if (body.messages?.some((m: { content: unknown }) => m.content === "reasoning-budget-regression") && body.max_tokens <= 1200) {
    return { choices: [{ message: { content: "" }, finish_reason: "length" }], usage: { completion_tokens: 1200, completion_tokens_details: { reasoning_tokens: 1198 } } };
  }
  return { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
});
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
    if (input === provider.url + "/v1/models") return fetcher(input, init);
    assert.equal(input, provider.url + "/v1/chat/completions");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer rotated-key");
    return fetcher(input, init);
  };
  try {
    await chatJson({ model: "default", purpose: "invariant_test", subject, promptVersion: "shared-1", system: "s", user: "u", schema: z.object({ ok: z.boolean() }) });
  } finally { globalThis.fetch = fetcher; }
  assert.equal(provider.hits(), 2);
  const [receipt] = await sql`SELECT service, model, request FROM receipts WHERE subject = ${subject}`;
  assert.equal(receipt!.service, "llm");
  assert.equal(receipt!.model, "robot-task-model");
  assert.ok(!JSON.stringify(receipt).includes("rotated-key"));
  const overview = await modelsOverview(1);
  assert.deepEqual(overview.connection, { source: "workbench", configured: true, revision: 2, model: "robot-task-model" });
  assert.ok(!JSON.stringify(overview).includes("rotated-key"));
  assert.ok(overview.choices.some((choice) => choice.key === "robot-task-model"));
  assert.ok(!overview.choices.some((choice) => choice.key === "deepseek-flash"));
  await assert.rejects(switchModel("score", "deepseek-flash", "must reject unconfigured provider", "test"), /实时目录/);
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


test("live catalog IDs are saved, executed through shared credentials and audited under llm", async () => {
  await save(3, "catalog-key");
  const overview = await modelsOverview(1);
  assert.deepEqual(overview.choices.map(m => m.key), ["robot-task-model", "live/model-v4"]);
  await switchModel("score", "live/model-v4", "real catalog selection", "test");
  const { modelFor } = await import("@aihot/backend/editorial/models");
  assert.equal(await modelFor("score"), "live/model-v4");
  const subject = "live-catalog-" + tag();
  const fetcher = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (input === provider.url + "/v1/models") return fetcher(input, init);
    assert.equal(input, provider.url + "/v1/chat/completions");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer catalog-key");
    assert.equal(JSON.parse(String(init?.body)).model, "live/model-v4");
    return fetcher(input, init);
  };
  try { await chatJson({ model: await modelFor("score"), purpose: "invariant_test", subject, promptVersion: "catalog-1", system: "s", user: "u", schema: z.object({ ok: z.boolean() }) }); }
  finally { globalThis.fetch = fetcher; }
  const [receipt] = await sql`SELECT service, model FROM receipts WHERE subject = ${subject}`;
  assert.equal(receipt!.service, "llm");
  assert.equal(receipt!.model, "live/model-v4");
  await assert.rejects(switchModel("score", "invented-model", "reject", "test"), /实时目录/);
  await switchModel("score", null, "restore default", "test");
});

test("catalog failures never expose provider bodies or fall back to static names", async () => {
  await save(4, "catalog-key");
  const fetcher = globalThis.fetch;
  try {
    for (const response of [new Response('secret-provider-body', { status: 401 }), new Response('{"data":[{"id":"bad id"}]}'), new Response('x'.repeat(1_048_577))]) {
      globalThis.fetch = async () => response;
      await assert.rejects(sharedModelCatalog(MODELS.default!), /共享模型目录读取失败/);
    }
    globalThis.fetch = async () => new Response('{}');
    const overview = await modelsOverview(1);
    assert.deepEqual(overview.choices, []);
    assert.equal(overview.catalogError, "共享模型目录读取失败，请刷新后重试");
    assert.ok(!JSON.stringify(overview).includes("catalog-key"));
    globalThis.fetch = async () => new Response('{"data":[]}');
    const subject = "catalog-removed-" + tag();
    await assert.rejects(chatJson({ model: "live/model-v4", purpose: "invariant_test", subject, promptVersion: "removed", system: "s", user: "u", schema: z.object({ ok: z.boolean() }) }), /未发起付费调用/);
    const [row] = await sql`SELECT count(*)::int AS n FROM receipts WHERE subject = ${subject}`;
    assert.equal(row!.n, 0);
  } finally { globalThis.fetch = fetcher; }
});

test("live catalog selections retain the explicit reasoning allowance and record the full request limit", async () => {
  await save(5, "reasoning-test-key");
  const previous = process.env.LLM_REASONING_TOKENS;
  process.env.LLM_REASONING_TOKENS = "4096";
  const subject = "shared-reasoning-" + tag();
  try {
    const result = await chatJson({ model: "live/model-v4", purpose: "invariant_test", subject, promptVersion: "reasoning-budget-1", system: "s", user: "reasoning-budget-regression", maxTokens: 1200, schema: z.object({ ok: z.boolean() }) });
    assert.equal(result.data.ok, true);
    const [receipt] = await sql`SELECT service, model, request FROM receipts WHERE subject = ${subject}`;
    assert.equal(receipt!.service, "llm");
    assert.equal(receipt!.model, "live/model-v4");
    assert.equal(receipt!.request.maxTokens, 5296);
  } finally {
    if (previous === undefined) delete process.env.LLM_REASONING_TOKENS;
    else process.env.LLM_REASONING_TOKENS = previous;
  }
});


test("shared catalog selections retain explicit operator request fields without borrowing preset fields", async () => {
  await save(6, "extra-test-key");
  const previous = process.env.LLM_EXTRA_JSON;
  process.env.LLM_EXTRA_JSON = JSON.stringify({ thinking: { type: "enabled" }, reasoning_effort: "low" });
  const originalFetch = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/chat/completions")) bodies.push(JSON.parse(String(init?.body)));
    return originalFetch(input, init);
  };
  try {
    for (const model of ["default", "live/model-v4"]) await chatJson({ model, purpose: "invariant_test", subject: tag(), promptVersion: "explicit-extra-1", system: "s", user: "u", schema: z.object({ ok: z.boolean() }) });
    assert.equal(bodies.length, 2);
    for (const body of bodies) {
      assert.equal(body.reasoning_effort, "low");
      assert.deepEqual(body.thinking, { type: "enabled" });
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.LLM_EXTRA_JSON; else process.env.LLM_EXTRA_JSON = previous;
  }
});
