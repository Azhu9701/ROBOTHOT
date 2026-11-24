// The sign-in throttle exists to make guessing expensive. It must count rejected passwords only:
// counting every request, including correct ones, locks out the operator (and any service that signs
// in on every run) after ten sign-ins from one address, which is ordinary traffic rather than an
// attack. A server misconfiguration is reported as "unset" and must not consume the budget either,
// or the person who has to fix it is the first one locked out.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import { config } from "@aihot/backend/config";
import { closeDb } from "@aihot/backend/db";
import { registerAdminAuth } from "../apps/api/src/routes/admin-auth.ts";

const PASSWORD = `throttle-password-${Date.now()}`;
const original = { password: config.adminPassword, secret: process.env.SESSION_SECRET };
const app = Fastify({ logger: false });
registerAdminAuth(app);
let base = "";

const realFetch = globalThis.fetch;

/** Posts the sign-in form the way the browser and the internal clients do. */
async function sign(password: string) {
  const body = new URLSearchParams({ password, return: "/admin" });
  const response = await realFetch(`${base}/api/auth/password`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual",
  });
  assert.equal(response.status, 303);
  return String(response.headers.get("location"));
}

before(async () => {
  base = await app.listen({ host: "127.0.0.1", port: 0 });
  config.adminPassword = PASSWORD;
  process.env.SESSION_SECRET = "test-throttle-secret-0123456789";
});

after(async () => {
  globalThis.fetch = realFetch;
  await app.close();
  config.adminPassword = original.password;
  if (original.secret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = original.secret;
  await closeDb();
});

test("repeated correct sign-ins from one address are never throttled", async () => {
  // Twelve is past the ten-per-address ceiling, so counting successes would fail here.
  for (let i = 0; i < 12; i += 1) {
    assert.equal(await sign(PASSWORD), "/admin", `sign-in ${i + 1} was throttled`);
  }
});

test("a server misconfiguration is reported as unset and consumes no budget", async () => {
  config.adminPassword = "short";
  assert.match(await sign(PASSWORD), /error=unset/);
  config.adminPassword = PASSWORD;
});

test("rejected passwords exhaust the per-address budget", async () => {
  let throttled = 0;
  for (let i = 0; i < 12; i += 1) {
    if ((await sign(`wrong-password-${i}`)).includes("error=too-many")) throttled += 1;
  }
  // Ten wrong guesses are answered, everything after them is refused.
  assert.equal(throttled, 2);
});
