import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { queueProcessing } from "@aihot/backend/jobs/content";
import { getBoss, QUEUES, stopBoss } from "@aihot/backend/jobs/queue";
import { unsupportedConfig } from "@aihot/backend/sources/config-keys";

const T = tag();
after(async () => { await stopBoss(); await closeDb(); });

test("a new priority source runs ahead of the research backlog, while history and signals stay behind live editorial work", async () => {
  const source = async (name: string, priority: number, mode = "editorial") => {
    const id = `priority-${name}-${T}`;
    await sql`INSERT INTO sources(id,name,kind,config,tier,participation_mode,next_fetch_at)
      VALUES(${id},${name},'rss',${sql.json({ processingPriority: priority, fetchPublicContent: true })},'T1',${mode},'2100-01-01')`;
    return id;
  };
  const research = await source("research", 0);
  const official = await source("official", 3);
  const archive = await source("archive", 5);
  const signal = await source("signal", 5, "hot_signal");
  const article = async (sourceId: string, name: string, opts: { history?: boolean; bare?: boolean } = {}) => {
    const a = await upsertMaterial({ sourceId, url: `https://example.org/${T}/${name}`, title: `Robot release ${name}`, via: "fetch", publishedAt: new Date(Date.now() - (opts.history ? 7 * 86400000 : 0)),
      bodyText: opts.bare ? null : "A robot framework release with reusable installation and benchmark details.", bodyStatus: opts.bare ? "pending" : "ok", backfill: opts.history ? "initial archive" : null });
    await queueProcessing(a.articleId);
    return a.articleId;
  };
  for (let i = 0; i < 20; i++) await article(research, `paper-${i}`);
  const historical = await article(archive, "history", { history: true });
  const discussion = await article(signal, "discussion");
  const release = await article(official, "release");
  const extraction = await article(official, "needs-body", { bare: true });
  const boss = await getBoss();
  const [first] = await boss.fetch<{ articleId: string }>(QUEUES.analyze, { priority: true });
  assert.equal(first?.data.articleId, release, "the new release must not wait behind earlier papers");
  const rows = await sql`SELECT name,priority,data->>'articleId' AS article FROM pgboss.job WHERE data->>'articleId' IN ${sql([historical, discussion, extraction])}`;
  assert.equal(rows.find(r => r.article === historical)?.priority, -2, "source priority must not turn archive imports into live work");
  assert.equal(rows.find(r => r.article === discussion)?.priority, -1, "discussion evidence still waits behind live reports");
  assert.equal(rows.find(r => r.article === extraction)?.priority, 3, "body extraction respects source priority too");
});

test("source processing priority is an explicit bounded integer with unchanged default configuration", () => {
  assert.deepEqual(unsupportedConfig("rss", { feedUrl: "https://example.org/feed.xml" }), []);
  for (const processingPriority of [0, 3, 5]) assert.deepEqual(unsupportedConfig("rss", { processingPriority }), []);
  for (const processingPriority of [-1, 6, 1.5, "3", null]) assert.deepEqual(unsupportedConfig("rss", { processingPriority }), ["processingPriority"]);
});
