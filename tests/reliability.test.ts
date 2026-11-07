import { afterEach, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as persistence from "../src/db";
import { runCron } from "../src/cron";
import { startServer } from "../src/index";
import { handleRequest } from "../src/http";
import { encode } from "../src/shortener";

// Per-test fetch stubs and disposable SQLite files keep failures offline and isolated.
const offlineFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = offlineFetch; });
const item = { id: 1, title: "Test", time: 1577836800, score: 150, text: "original<p>text" };
function memoryDb() {
  const db = new Database(":memory:");
  db.exec(persistence.schema);
  return db;
}
const failures = [
  ["HTTP", () => new Response("unavailable", { status: 503 })],
  ["invalid JSON", () => new Response("not JSON")],
  ["network rejection", () => { throw new Error("secret must not be logged"); }],
] as const;

for (const [name, fail] of failures) {
  test(`topstories ${name} fails without sending or saving`, async () => {
    const db = memoryDb();
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return fail(); }) as unknown as typeof fetch;
    try {
      await expect(runCron(db, "fake", "@test", "https://x")).rejects.toThrow();
      expect(calls).toBe(1);
      expect(db.query("SELECT * FROM story_posts").all()).toEqual([]);
    } finally { db.close(); }
  });
}

for (const shape of [null, {}, ["1"], [0], [1.5]]) {
  test(`rejects invalid topstories shape ${JSON.stringify(shape)}`, async () => {
    const db = memoryDb();
    globalThis.fetch = (async () => Response.json(shape)) as unknown as typeof fetch;
    try { await expect(runCron(db, "fake", "@test", "https://x")).rejects.toThrow("Invalid top stories"); }
    finally { db.close(); }
  });
}

for (const stage of ["item", "telegram"] as const) {
  const cases = stage === "telegram" ? [...failures,
    ["missing message ID", () => Response.json({ ok: true, result: {} })],
    ["fractional message ID", () => Response.json({ ok: true, result: { message_id: 1.5 } })],
    ["rejected message", () => Response.json({ ok: false })],
  ] as const : failures;
  for (const [name, fail] of cases) {
    test(`${stage} ${name} does not save failure; later story still posts and run rejects`, async () => {
      const db = memoryDb();
      let telegramCalls = 0;
      const log = spyOn(console, "error").mockImplementation(() => {});
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("topstories.json")) return Response.json([1, 2]);
        if (url.endsWith("/item/1.json")) return stage === "item" ? fail() : Response.json(item);
        if (url.endsWith("/item/2.json")) return Response.json({ ...item, id: 2 });
        if (url.startsWith("https://api.telegram.org/")) {
          telegramCalls++;
          if (stage === "telegram" && telegramCalls === 1) return fail();
          return Response.json({ ok: true, result: { message_id: 99 } });
        }
        throw new Error("Unexpected request");
      }) as unknown as typeof fetch;
      try {
        await expect(runCron(db, "fake", "@test", "https://x")).rejects.toThrow("1 stories failed");
        expect(persistence.findUrl(db, 1)).toBeNull();
        expect(persistence.findUrl(db, 2)).toBe("https://news.ycombinator.com/item?id=2");
        expect(log.mock.calls).toEqual([["Failed to process story 1"]]);
      } finally { log.mockRestore(); db.close(); }
    });
  }
}

test("149 is skipped, 150 and 151 post; all columns survive reopening and suppress item fetch/send", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hnbot-parity-"));
  const path = join(dir, "posts.sqlite");
  let db = new Database(path);
  db.exec(persistence.schema);
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("topstories.json")) return Response.json([1, 2, 3, 3]);
    const match = /\/item\/(\d+)\.json$/.exec(url);
    if (match) { const id = Number(match[1]); return Response.json({ ...item, id, score: 148 + id }); }
    if (url.startsWith("https://api.telegram.org/")) return Response.json({ ok: true, result: { message_id: 99 } });
    throw new Error("Unexpected request");
  }) as unknown as typeof fetch;
  try {
    await runCron(db, "fake", "@test", "https://x");
    expect(db.query("SELECT id FROM story_posts ORDER BY id").all()).toEqual([{ id: 2 }, { id: 3 }]);
    const row = db.query("SELECT * FROM story_posts WHERE id=2").get() as Record<string, unknown>;
    expect(row).toEqual({ id: 2, title: "Test", text: item.text, score: 150,
      message: expect.stringContaining("\noriginal\ntext\n"), url: "https://news.ycombinator.com/item?id=2",
      short_url: "https://x/c/4", short_hn_url: "https://x/c/4", telegram_message_id: 99, created: expect.any(String) });
    db.close();
    db = new Database(path);
    requests.length = 0;
    await runCron(db, "fake", "@test", "https://x");
    expect(requests).toEqual(["https://hacker-news.firebaseio.com/v0/topstories.json", "https://hacker-news.firebaseio.com/v0/item/1.json"]);
    for (const route of ["s", "c"]) {
      const response = handleRequest(new Request(`https://x/${route}/${encode(2)}`), db);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(row.url as string);
    }
    for (const path of ["/unknown", "/s/", "/c/a/extra", "/cron"])
      expect(handleRequest(new Request(`https://x${path}`), db).status).toBe(404);
    expect(handleRequest(new Request("https://x/c/4", { method: "POST" }), db).status).toBe(405);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("startup validates SQLite before listening and closes it if listener startup fails", () => {
  const db = memoryDb();
  const open = spyOn(persistence, "openDatabase");
  const serve = spyOn(Bun, "serve").mockImplementation(() => { throw new Error("listener failed"); });
  try {
    open.mockImplementation(() => { throw new Error("invalid database"); });
    expect(() => startServer()).toThrow("invalid database");
    expect(serve).not.toHaveBeenCalled();
    open.mockImplementation(() => db);
    expect(() => startServer()).toThrow("listener failed");
    expect(() => db.query("SELECT 1").get()).toThrow();
  } finally { open.mockRestore(); serve.mockRestore(); db.close(); }
});

test("HTTP binding defaults to all interfaces and supports isolated loopback", () => {
  const oldHost = process.env.HOST;
  const db = memoryDb();
  const open = spyOn(persistence, "openDatabase").mockImplementation(() => db);
  const hosts: unknown[] = [];
  const serve = spyOn(Bun, "serve").mockImplementation((options: any) => {
    hosts.push(options.hostname);
    return {} as any;
  });
  try {
    delete process.env.HOST;
    startServer();
    process.env.HOST = "127.0.0.1";
    startServer();
    expect(hosts).toEqual(["0.0.0.0", "127.0.0.1"]);
  } finally {
    if (oldHost === undefined) delete process.env.HOST;
    else process.env.HOST = oldHost;
    open.mockRestore(); serve.mockRestore(); db.close();
  }
});

test("importing entrypoints neither listens nor fetches nor opens a database", () => {
  const index = new URL("../src/index.ts", import.meta.url).href;
  const cron = new URL("../src/cron.ts", import.meta.url).href;
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", `
    Bun.serve = () => { throw new Error("unexpected listener"); };
    globalThis.fetch = () => { throw new Error("unexpected fetch"); };
    await import(${JSON.stringify(index)});
    await import(${JSON.stringify(cron)});
  `], { env: { PORT: "invalid", DATABASE_URL: "invalid", TELEGRAM_BOT_TOKEN: "invalid" } });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toBe("");
  expect(result.stderr.toString()).toBe("");
});
