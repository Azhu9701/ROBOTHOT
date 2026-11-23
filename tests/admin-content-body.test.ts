// The admin body channel exists so internal pipelines can work on an article's own text. It must not
// become a licence grant: the same article that admin reads in full stays a summary on every public
// exit while the source has not allowed full text, and an uncaptured body is reported as such instead
// of being passed off as empty text.
import { createHmac } from "node:crypto";
import { config } from "@aihot/backend/config";
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial, type XPostData } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { sha256 } from "@aihot/backend/lib/ids";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const app = await buildApp();
let n = 0;

after(async () => {
  await app.close();
  await stopBoss();
  await closeDb();
});

async function source(options: { full?: boolean } = {}): Promise<string> {
  n += 1;
  const id = `body-${T}-${n}`;
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, site_fulltext, syndicate_fulltext)
    VALUES (${id}, '正文通道测试', 'rss', 'T1', 'editorial', ${options.full ?? false}, false)`;
  return id;
}

let signedIn: Promise<Record<string, string>> | null = null;

async function session(): Promise<Record<string, string>> {
  signedIn ??= (async () => {
    const token = `admin-session-body-${T}`;
    const [user] = await sql`INSERT INTO admin_users (display_name) VALUES ('正文审查') RETURNING id`;
    const claims = { appId: "test-body-app", unionId: "test-body-user", email: null };
    process.env.FEISHU_LOGIN_APP_ID = claims.appId;
    process.env.FEISHU_LOGIN_APP_SECRET = "test-app-secret";
    config.adminUnionIds = [claims.unionId];
    const binding = createHmac("sha256", process.env.SESSION_SECRET!).update(JSON.stringify(["admin-session-v1", "feishu", claims])).digest("hex");
    await sql`INSERT INTO admin_sessions (id_hash, user_id, csrf_token, expires_at, auth_method, auth_binding, auth_claims)
      VALUES (${sha256(token)}, ${user!.id}, 'body-csrf', now() + interval '1 hour', 'feishu', ${binding}, ${sql.json(claims)})`;
    return { cookie: `aihot_admin=${token}`, "x-csrf-token": "body-csrf" };
  })();
  return signedIn;
}

async function published(sourceId: string, body: { bodyText: string | null; bodyHtml?: string | null; bodyStatus: "ok" | "none"; xPost?: XPostData | null }) {
  const { articleId } = await upsertMaterial({
    sourceId, url: `https://example.com/${T}-${n}-${Math.random()}`, title: `正文 ${T}`,
    bodyText: body.bodyText, bodyHtml: body.bodyHtml ?? null, bodyStatus: body.bodyStatus, xPost: body.xPost ?? null,
    via: "fetch", publishedAt: new Date(),
  });
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, reason_zh, score, selected)
    VALUES (${articleId}, 1, 'rule', 'pass', 'ai-models', ${`标题-${T}`}, ${`摘要-${T}`}, '理由', 90, true)`;
  await publishArticle(articleId, { releasedAt: new Date(Date.now() - 60_000) });
  return articleId;
}

const body = async (id: string, headers: Record<string, string>) => {
  const res = await app.inject({ method: "GET", url: `/api/admin/content/${id}/body`, headers });
  return { status: res.statusCode, json: res.statusCode === 200 ? JSON.parse(res.body) : null, headers: res.headers };
};

test("an unlicensed source's body is readable for internal work and still withheld from the public exit", async () => {
  const sourceId = await source();
  const main = `INTERNAL-BODY-${T}`;
  const id = await published(sourceId, { bodyText: main, bodyHtml: `<p>${main}</p>`, bodyStatus: "ok" });
  const headers = await session();
  const [publication] = await sql`SELECT body_mode FROM publications WHERE article_id = ${id}`;
  assert.equal(publication!.body_mode, "summary");

  const internal = await body(id, headers);
  assert.equal(internal.status, 200);
  assert.equal(internal.json.origin, "article");
  assert.equal(internal.json.body_status, "ok");
  assert.equal(internal.json.text, main);
  assert.equal(internal.json.body_chars, [...main].length);
  assert.equal(internal.json.site_fulltext, false);
  assert.equal(internal.json.syndicate_fulltext, false);
  assert.equal(internal.headers["cache-control"], "no-store");

  const [chain] = await sql`SELECT length(body_text) AS n FROM articles WHERE id = ${id}`;
  const listed = JSON.parse((await app.inject({ method: "GET", url: `/api/admin/content/${id}`, headers })).body);
  assert.equal(listed.article.body_chars, chain!.n, "the chain and the body channel count the same characters");

  const original = JSON.parse((await app.inject({ method: "GET", url: `/api/site/items/${id}/original` })).body);
  assert.equal(original.body, null, "the public exit keeps withholding the body");
  assert.ok(!(await app.inject({ method: "GET", url: `/api/site/items/${id}` })).body.includes(main));
  await sql`UPDATE sources SET site_fulltext = true WHERE id = ${sourceId}`;
});

test("an article that carries its own post reports where the text came from", async () => {
  const sourceId = await source({ full: true });
  const main = `POST-BODY-${T}`;
  const xPost: XPostData = { tweetId: `${Date.now()}${n}`, authorName: "作者", handle: "author", text: main, media: [] };
  const id = await published(sourceId, { bodyText: null, bodyStatus: "none", xPost });
  const response = await body(id, await session());
  assert.equal(response.status, 200);
  assert.equal(response.json.origin, "x_post");
  assert.equal(response.json.text, main);
});

test("an uncaptured body is reported as missing, not as empty text", async () => {
  const sourceId = await source();
  const id = await published(sourceId, { bodyText: null, bodyStatus: "none" });
  const response = await body(id, await session());
  assert.equal(response.status, 200);
  assert.equal(response.json.origin, "none");
  assert.equal(response.json.text, "");
  assert.equal(response.json.body_chars, 0);
});

test("the body channel needs an admin session and an existing article", async () => {
  const sourceId = await source();
  const id = await published(sourceId, { bodyText: `GUARDED-${T}`, bodyStatus: "ok" });
  assert.equal((await body(id, {})).status, 401);
  const headers = await session();
  assert.equal((await body("no-such-article", headers)).status, 404);
  const [row] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE subject = ${`content:no-such-article`}`;
  assert.equal(row!.n, 0, "a read never writes an audit entry");
});
