import { afterEach, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as persistence from "../src/db";
import { runCron } from "../src/cron";
import { formatPost } from "../src/story";
import { claimDelivery, finalizeDelivery, rememberDelivery } from "../src/delivery";

// Durable intents prevent duplicate sends; SQLite triggers exercise real rollback and recovery.
const offlineFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = offlineFetch; });
const story = { id: 1, title: "Test", time: 1577836800, score: 150 };

test("ambiguous send quarantines only that story across reopen and absence from top list", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hnbot-delivery-"));
  const path = join(dir, "posts.sqlite");
  let db = new Database(path);
  db.exec(persistence.schema);
  // A separate schema is explicitly provisioned, never created by cron.
  db.exec(persistence.pendingSchema);
  let ids = [1, 2];
  let sends = 0;
  const log = spyOn(console, "error").mockImplementation(() => {});
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("topstories.json")) return Response.json(ids);
    const match = /\/item\/(\d+)\.json$/.exec(url);
    if (match) return Response.json({ ...story, id: Number(match[1]) });
    sends++;
    if (sends === 1) throw new DOMException("secret-token network failure", "TimeoutError");
    return Response.json({ ok: true, result: { message_id: 99 } });
  }) as typeof fetch;

  try {
    await runCron(db, "secret-token", "@test", "https://x");
    expect(persistence.hasStory(db, 1)).toBe(false);
    expect(persistence.hasStory(db, 2)).toBe(true);
    db.close();
    db = new Database(path);
    ids = [];
    await runCron(db, "secret-token", "@test", "https://x");
    ids = [1, 2];
    await runCron(db, "secret-token", "@test", "https://x");
    expect(sends).toBe(2);
    const pending = db.query("SELECT * FROM pending_deliveries").all() as any[];
    expect(pending).toHaveLength(1);
    expect(JSON.parse(pending[0].post_json)).toMatchObject({ id: 1, title: "Test" });
    expect(pending[0].chat_id).toBe("@test");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-token");
    const failure = log.mock.calls.map(([line]) => JSON.parse(String(line))).find(e => e.event === "failure");
    expect(failure).toMatchObject({ stage: "telegram_send", code: "TimeoutError", story_id: 1 });
    expect(JSON.parse(pending[0].diagnostic)).toEqual(failure);
    const listed = Bun.spawnSync([process.execPath, "--no-env-file", "scripts/deliveries.ts", "list"],
      { env: { ...process.env, DATABASE_URL: `file:${path}` } });
    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(JSON.parse(listed.stdout.toString())[0].diagnostic)).toEqual(failure);
  } finally {
    log.mockRestore();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

function memoryDb() {
  const db = new Database(":memory:");
  db.exec(persistence.schema);
  db.exec(persistence.pendingSchema);
  return db;
}
function stubStories(onSend: () => Response | Promise<Response>, ids = [1, 2]) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("topstories.json")) return Response.json(ids);
    const match = /\/item\/(\d+)\.json$/.exec(url);
    if (match) return Response.json({ ...story, id: Number(match[1]) });
    return onSend();
  }) as typeof fetch;
}

test("intent write failure is fatal and causes zero sends", async () => {
  const db = memoryDb();
  let sends = 0;
  db.exec("CREATE TRIGGER fail_intent BEFORE INSERT ON pending_deliveries BEGIN SELECT RAISE(ABORT, 'disk write failure'); END");
  stubStories(() => {
    sends++;
    return Response.json({});
  });

  try {
    await expect(runCron(db, "fake", "@test", "https://x")).rejects.toThrow();
    expect(sends).toBe(0);
    expect(db.query("SELECT * FROM story_posts").all()).toEqual([]);
  } finally {
    db.close();
  }
});

test("history insert failure retains the confirmed intent and allows operator finalization", async () => {
  const db = memoryDb();
  const log = spyOn(console, "error").mockImplementation(() => {});
  db.exec("CREATE TRIGGER fail_finalization BEFORE INSERT ON story_posts WHEN NEW.id = 1 BEGIN SELECT RAISE(ABORT, 'failure'); END");
  let sends = 0;
  stubStories(() => {
    sends++;
    return Response.json({ ok: true, result: { message_id: 100 + sends } });
  });

  try {
    await runCron(db, "fake", "@test", "https://x");

    expect(persistence.hasStory(db, 1)).toBe(false);
    expect(persistence.hasStory(db, 2)).toBe(true);
    expect(db.query("SELECT telegram_message_id FROM pending_deliveries WHERE id = 1").get())
      .toEqual({ telegram_message_id: 101 });
    const failures = log.mock.calls.map(([line]) => JSON.parse(String(line))).filter(e => e.event === "failure");
    expect(failures[0]).toMatchObject({ stage: "finalize",
      code: "SQLITE_CONSTRAINT_TRIGGER", story_id: 1, message_id: 101 });
    expect(failures.map(e => e.stage)).toEqual(["finalize"]);
    expect(JSON.parse((db.query("SELECT diagnostic FROM pending_deliveries WHERE id=1").get() as any).diagnostic)).toEqual(failures[0]);
    // Pending intents never retry, even after a confirmed send failed to save locally.
    await runCron(db, "fake", "@test", "https://x");

    expect(sends).toBe(2);
    db.exec("DROP TRIGGER fail_finalization");

    finalizeDelivery(db, 1);
    expect(db.query("SELECT * FROM pending_deliveries").all()).toEqual([]);
    expect(db.query("SELECT telegram_message_id FROM story_posts WHERE id = 1").get()).toEqual({ telegram_message_id: 101 });
  } finally {
    log.mockRestore();
    db.close();
  }
});

test("intent deletion failure rolls back history and retains the confirmed intent", async () => {
  const db = memoryDb();
  const log = spyOn(console, "error").mockImplementation(() => {});
  db.exec("CREATE TRIGGER fail_finalization BEFORE DELETE ON pending_deliveries WHEN OLD.id = 1 BEGIN SELECT RAISE(ABORT, 'failure'); END");
  let sends = 0;
  stubStories(() => {
    sends++;
    return Response.json({ ok: true, result: { message_id: 100 + sends } });
  });

  try {
    await runCron(db, "fake", "@test", "https://x");

    expect(persistence.hasStory(db, 1)).toBe(false);
    expect(persistence.hasStory(db, 2)).toBe(true);
    expect(db.query("SELECT telegram_message_id FROM pending_deliveries WHERE id = 1").get())
      .toEqual({ telegram_message_id: 101 });
    const failures = log.mock.calls.map(([line]) => JSON.parse(String(line))).filter(e => e.event === "failure");
    expect(failures[0]).toMatchObject({ stage: "finalize",
      code: "SQLITE_CONSTRAINT_TRIGGER", story_id: 1, message_id: 101 });
    expect(failures.map(e => e.stage)).toEqual(["finalize"]);
    expect(JSON.parse((db.query("SELECT diagnostic FROM pending_deliveries WHERE id=1").get() as any).diagnostic)).toEqual(failures[0]);
    // Pending intents never retry, even after a confirmed send failed to save locally.
    await runCron(db, "fake", "@test", "https://x");

    expect(sends).toBe(2);
    db.exec("DROP TRIGGER fail_finalization");

    finalizeDelivery(db, 1);
    expect(db.query("SELECT * FROM pending_deliveries").all()).toEqual([]);
    expect(db.query("SELECT telegram_message_id FROM story_posts WHERE id = 1").get()).toEqual({ telegram_message_id: 101 });
  } finally {
    log.mockRestore();
    db.close();
  }
});

test("message-ID write failure keeps the intent without automatically resending", async () => {
  const db = memoryDb();
  const log = spyOn(console, "error").mockImplementation(() => {});
  db.exec("CREATE TRIGGER fail_finalization BEFORE UPDATE ON pending_deliveries WHEN NEW.id = 1 BEGIN SELECT RAISE(ABORT, 'failure'); END");
  let sends = 0;
  stubStories(() => {
    sends++;
    return Response.json({ ok: true, result: { message_id: 100 + sends } });
  });

  try {
    await runCron(db, "fake", "@test", "https://x");

    expect(persistence.hasStory(db, 1)).toBe(false);
    expect(persistence.hasStory(db, 2)).toBe(true);
    expect(db.query("SELECT telegram_message_id FROM pending_deliveries WHERE id = 1").get())
      .toEqual({ telegram_message_id: null });
    const failures = log.mock.calls.map(([line]) => JSON.parse(String(line))).filter(e => e.event === "failure");
    expect(failures[0]).toMatchObject({ stage: "remember",
      code: "SQLITE_CONSTRAINT_TRIGGER", story_id: 1, message_id: 101 });
    expect(failures.map(e => e.stage)).toEqual(["remember", "diagnostic_update"]);

    // Pending intents never retry, even after a confirmed send failed to save locally.
    await runCron(db, "fake", "@test", "https://x");

    expect(sends).toBe(2);
    db.exec("DROP TRIGGER fail_finalization");
    rememberDelivery(db, 1, 101);
    finalizeDelivery(db, 1);
    expect(db.query("SELECT * FROM pending_deliveries").all()).toEqual([]);
    expect(db.query("SELECT telegram_message_id FROM story_posts WHERE id = 1").get()).toEqual({ telegram_message_id: 101 });
  } finally {
    log.mockRestore();
    db.close();
  }
});

for (const recheck of ["pending", "finalized history"]) {
  test(`overlapping runs recheck ${recheck} at claim and send once`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "hnbot-claims-"));
    const path = join(dir, "posts.sqlite");
    const first = new Database(path);
    first.exec(persistence.schema);
    first.exec(persistence.pendingSchema);
    first.exec("INSERT INTO story_posts (id, title, score) VALUES (2, 'legacy', 150)");
    const second = new Database(path);
    let sends = 0;
    const items = [Promise.withResolvers<Response>(), Promise.withResolvers<Response>()];
    const fetched = Promise.withResolvers<void>();
    const sending = Promise.withResolvers<void>();
    const reply = Promise.withResolvers<void>();
    let itemReads = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("topstories.json")) return Response.json([1, 2]);
      if (url.endsWith("/item/1.json")) {
        const item = items[itemReads++]!;
        if (itemReads === 2) fetched.resolve();
        return item.promise;
      }
      sends++;
      sending.resolve();
      await reply.promise;
      return Response.json({ ok: true, result: { message_id: 99 } });
    }) as typeof fetch;
    try {
      const run = runCron(first, "fake", "@test", "https://x");
      const competitor = runCron(second, "fake", "@test", "https://x");
      // Both runs passed preliminary history/pending reads before either claims.
      await fetched.promise;
      items[0]!.resolve(Response.json(story));
      await sending.promise;
      expect(second.query("SELECT id FROM pending_deliveries").all()).toEqual([{ id: 1 }]);
      if (recheck === "finalized history") {
        reply.resolve();
        await run;
        expect(second.query("SELECT * FROM pending_deliveries").all()).toEqual([]);
      }
      items[1]!.resolve(Response.json(story));
      await competitor;
      reply.resolve();
      await run;
      expect(sends).toBe(1);
      expect(second.query("SELECT * FROM pending_deliveries").all()).toEqual([]);
      expect(second.query("SELECT telegram_message_id FROM story_posts WHERE id = 1").get()).toEqual({ telegram_message_id: 99 });
      expect(second.query("SELECT telegram_message_id FROM story_posts WHERE id = 2").get()).toEqual({ telegram_message_id: null });
    } finally {
      reply.resolve();
      first.close();
      second.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("explicit migration refuses missing history, preserves legacy rows, and is repeatable", () => {
  const dir = mkdtempSync(join(tmpdir(), "hnbot-migration-"));
  const path = join(dir, "posts.sqlite");
  const env = { ...process.env, DATABASE_URL: `file:${path}` };
  const invoke = (script: string, ...args: string[]) => Bun.spawnSync(
    [process.execPath, "--no-env-file", `scripts/${script}.ts`, ...args], { env },
  );
  try {
    for (const script of ["migrate-deliveries", "deliveries"]) {
      const failed = invoke(script, ...(script === "deliveries" ? ["list"] : []));
      expect(failed.exitCode).not.toBe(0);
      expect(JSON.parse(failed.stderr.toString()).code).toBe("ENOENT");
      expect(failed.stderr.toString()).not.toContain(path);
    }
    let db = new Database(path);
    expect(invoke("migrate-deliveries").exitCode).not.toBe(0);
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'story_posts'").get()).toBeNull();
    db.exec(persistence.schema);
    db.exec("INSERT INTO story_posts (id, title, score) VALUES (2, 'legacy', 150)");
    db.close();
    expect(invoke("migrate-deliveries").exitCode).toBe(0);
    expect(invoke("migrate-deliveries").exitCode).toBe(0);
    const oldUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = env.DATABASE_URL;
    try { db = persistence.openDatabase(); }
    finally {
      if (oldUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = oldUrl;
    }
    expect(db.query("SELECT id, telegram_message_id FROM story_posts").all())
      .toEqual([{ id: 2, telegram_message_id: null }]);
    expect(db.query("SELECT * FROM pending_deliveries").all()).toEqual([]);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("operator reconciliation requires confirmation and refuses conflicting confirmed IDs", () => {
  const dir = mkdtempSync(join(tmpdir(), "hnbot-reconciliation-"));
  const path = join(dir, "posts.sqlite");
  const env = { ...process.env, DATABASE_URL: `file:${path}` };
  // Block network even in the CLI child: reconciliation must only change local state.
  const reconcile = (...args: string[]) => Bun.spawnSync(
    [process.execPath, "--no-env-file", "-e", `
      globalThis.fetch = () => { throw new Error("Reconciliation must not send"); };
      process.argv = [process.execPath, "scripts/deliveries.ts", ...${JSON.stringify(args)}];
      await import("./scripts/deliveries.ts");
    `], { env },
  );
  let db = new Database(path);
  db.exec(persistence.schema);
  db.exec(persistence.pendingSchema);
  db.exec("INSERT INTO story_posts (id, title, score) VALUES (2, 'legacy', 150)");
  try {
    const post = formatPost(story, "https://x");
    expect(claimDelivery(db, post, "@test")).toBe(true);
    db.close();
    const listed = reconcile("list");
    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout.toString())).toMatchObject([{ id: 1, diagnostic: "intent" }]);
    // An unconfirmed intent requires explicit acknowledgement before release.
    expect(reconcile("release", "1").exitCode).not.toBe(0);
    expect(reconcile("delivered", "1").exitCode).not.toBe(0);
    expect(reconcile("delivered", "1", "99").exitCode).toBe(0);
    db = new Database(path);
    expect(db.query("SELECT id, telegram_message_id FROM story_posts ORDER BY id").all())
      .toEqual([{ id: 1, telegram_message_id: 99 }, { id: 2, telegram_message_id: null }]);
    expect(db.query("SELECT * FROM pending_deliveries").all()).toEqual([]);
    expect(claimDelivery(db, { ...post, id: 3 }, "@test")).toBe(true);
    rememberDelivery(db, 3, 100);
    // Once the ID is known, an operator cannot release it or substitute another ID.
    expect(reconcile("release", "3", "--confirmed-not-delivered").exitCode).not.toBe(0);
    const conflict = reconcile("delivered", "3", "101");
    expect(conflict.exitCode).not.toBe(0);
    expect(JSON.parse(conflict.stderr.toString())).toEqual({ code: "MISSING_OR_CONFLICTING_INTENT" });
    expect(claimDelivery(db, { ...post, id: 4 }, "@test")).toBe(true);
    expect(reconcile("release", "4", "--confirmed-not-delivered").exitCode).toBe(0);
    db.close();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
