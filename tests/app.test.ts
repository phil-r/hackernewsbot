import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema, openDatabase, findUrl } from "../src/db";
import { encode } from "../src/shortener";
import { formatPost } from "../src/story";
import { handleRequest } from "../src/http";
import { runCron, cronConfig } from "../src/cron";
import { parsePort } from "../src/index";

// Restore the offline guard after each stub; use only disposable in-memory databases.
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const story = {
  id: 21447853,
  title: "A & B < C",
  time: 100000,
  score: 150,
  url: "https://example.com/",
  descendants: 12,
};
function memoryDb() {
  const db = new Database(":memory:");
  db.exec(schema);
  return db;
}

describe("short links", () => {
  test("redirects, missing records, invalid IDs and static pages", async () => {
    const db = memoryDb();
    const request = (path: string) =>
      handleRequest(new Request("http://localhost" + path), db);
    const short = encode(story.id);
    expect(request(`/c/${short}`).headers.get("location")).toBe(
      `https://news.ycombinator.com/item?id=${story.id}`,
    );
    expect(request(`/s/${short}`).status).toBe(503);
    expect(request(`/s/${short}`).headers.get("retry-after")).toBe("5");
    expect(request("/s/0").status).toBe(400);
    // Encoded digits stay invalid, rather than becoming valid Bun-native route params.
    expect(request("/c/%34").status).toBe(400);
    expect(handleRequest(new Request(`http://localhost/c/${short}`, { method: "HEAD" }), db).headers.get("location")).toBe(
      `https://news.ycombinator.com/item?id=${story.id}`,
    );
    expect(handleRequest(new Request("http://localhost/", { method: "HEAD" }), db).status).toBe(200);
    expect(request("/cron").status).toBe(404);
    expect(request("/").status).toBe(200);
    expect(await request("/robots.txt").text()).toContain("User-agent");
    db.query(
      "INSERT INTO story_posts (id,title,message,url,short_url,short_hn_url,score) VALUES (?,?,?,?,?,?,?)",
    ).run(story.id, "x", "x", story.url, "x", "x", 150);
    expect(request(`/s/${short}`).headers.get("location")).toBe(story.url);
    db.close();
  });
});

test("formats external and self posts", () => {
  const now = story.time * 1000 + 4 * 3600_000;
  const post = formatPost(story, "https://readhacker.news", now);
  expect(post.message).toContain(
    "<b>A &amp; B &lt; C</b> (🔥 Score: 150+ in 4 hours)",
  );
  expect(post.message).toContain("<b>Comments:</b>");
  expect(post.buttons).toEqual([
    { text: "Read", url: story.url },
    {
      text: "12+ Comments",
      url: `https://news.ycombinator.com/item?id=${story.id}`,
    },
  ]);
  const self = formatPost(
    { ...story, url: undefined, text: "hello<p>world &#x27;test&#x27;" },
    "https://x",
    now,
  );
  expect(self.shortUrl).toBe(self.shortHnUrl);
  expect(self.message).not.toContain("<b>Comments:</b>");
  expect(self.message).toContain("hello\nworld 'test'");
  expect(self.buttons.length).toBe(1);
});

test("cron filters, deduplicates and only saves confirmed deliveries", async () => {
  const db = memoryDb();
  let telegramCalls = 0;
  let fail = true;
  const seen: string[] = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    seen.push(url);
    if (url.endsWith("/topstories.json")) return Response.json([1, 2, 3, 4, 4]);
    if (url.endsWith("/item/1.json"))
      return Response.json({ ...story, id: 1, score: 149 });
    if (url.endsWith("/item/2.json"))
      return Response.json({ ...story, id: 2, score: undefined });
    if (url.endsWith("/item/3.json")) return Response.json(null);
    if (url.endsWith("/item/4.json")) return Response.json({ ...story, id: 4 });
    if (url.includes("api.telegram.org")) {
      telegramCalls++;
      const body = JSON.parse(String(init?.body));
      expect(body.chat_id).toBe("@test");
      expect(body.parse_mode).toBe("HTML");
      expect(body.disable_notification).toBe(true);
      expect(body.reply_markup.inline_keyboard[0]).toHaveLength(2);
      return Response.json(
        fail ? { ok: false } : { ok: true, result: { message_id: 99 } },
      );
    }
    throw new Error("Unexpected network request");
  }) as typeof fetch;
  await expect(
    runCron(db, "fake", "@test", "https://readhacker.news"),
  ).rejects.toThrow();
  expect(findUrl(db, 4)).toBeNull();
  fail = false;
  await runCron(db, "fake", "@test", "https://readhacker.news");
  expect(findUrl(db, 4)).toBe(story.url);
  await runCron(db, "fake", "@test", "https://readhacker.news");
  expect(telegramCalls).toBe(2);
  expect(seen.filter((url) => url.endsWith("/item/4.json"))).toHaveLength(2);
  db.close();
});

test("requires initialized database and valid configuration", () => {
  const dir = mkdtempSync(join(tmpdir(), "hnbot-"));
  const old = { ...process.env };
  try {
    process.env.DATABASE_URL = `file:${join(dir, "data.sqlite")}`;
    expect(() => openDatabase()).toThrow();
    const db = new Database(join(dir, "data.sqlite"), { create: true });
    db.exec(schema);
    db.close();
    const opened = openDatabase();
    opened.close();
    process.env.TELEGRAM_BOT_TOKEN = "123:fake";
    process.env.BASE_URL = "https://readhacker.news";
    expect(cronConfig().token).toBe("123:fake");
    for (const suffix of ["", "/", "?", "#"]) {
      process.env.BASE_URL = `https://example.com${suffix}`;
      const { baseUrl } = cronConfig();
      expect(baseUrl).toBe("https://example.com");
      const post = formatPost(story, baseUrl);
      expect(post.shortUrl).toBe(`https://example.com/s/${encode(story.id)}`);
      expect(post.shortHnUrl).toBe(`https://example.com/c/${encode(story.id)}`);
    }
    for (const invalid of [
      "https://example.com/path",
      "https://user:password@example.com",
      "https://example.com?query=value",
      "https://example.com#fragment",
    ]) {
      process.env.BASE_URL = invalid;
      expect(() => cronConfig()).toThrow();
    }
    expect(parsePort("8080")).toBe(8080);
    expect(() => parsePort("0")).toThrow();
  } finally {
    process.env = old;
    rmSync(dir, { recursive: true, force: true });
  }
});
