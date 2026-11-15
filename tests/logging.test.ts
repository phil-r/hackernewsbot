import { afterEach, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { AppError, safeError } from "../src/logging";
import { executeCron, runCron } from "../src/cron";
import { schema, pendingSchema } from "../src/db";
import * as persistence from "../src/db";
import * as delivery from "../src/delivery";
import * as formatting from "../src/story";

// Diagnostics must identify failures without recording credentials or response content.
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const canary = "CANARY-token-chat-url-title-body";

function memoryDb() {
  const db = new Database(":memory:");
  db.exec(schema);
  db.exec(pendingSchema);
  return db;
}

// Only the Telegram response varies; both stories are otherwise eligible to post.
function stubStories(onSend: () => Response | Promise<Response>) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("topstories.json")) return Response.json([1, 2]);
    if (url.endsWith("/item/1.json")) return Response.json({ id: 1, score: 150, time: 1, title: canary });
    if (url.endsWith("/item/2.json")) return Response.json({ id: 2, score: 150, time: 1, title: canary });
    if (url.startsWith("https://api.telegram.org/")) return onSend();
    throw new Error("Unexpected request");
  }) as typeof fetch;
}

test("safe error allowlists real Bun and SQLite shapes without arbitrary fields or causes", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY); INSERT INTO t VALUES (1)");
  try {
    try { db.exec("INSERT INTO t VALUES (1)"); } catch (error) {
      expect(safeError(error)).toMatchObject({ code: "SQLITE_CONSTRAINT_PRIMARYKEY", errno: 1555 });
    }
    expect(safeError(Object.assign(new TypeError(canary), { code: "ECONNREFUSED", errno: 0 })))
      .toEqual({ code: "ECONNREFUSED", errno: 0 });
    const error = Object.assign(new Error(canary), { name: canary, code: `SQLITE_CONSTRAINT_${canary}`, path: canary, url: canary, errno: canary });
    (error as any).cause = error;
    expect(safeError(error)).toEqual({ code: "UNKNOWN", causes: [{ code: "UNKNOWN" }, { code: "UNKNOWN" }, { code: "UNKNOWN" }] });
    expect(JSON.stringify(safeError(error))).not.toContain(canary);
  } finally {
    db.close();
  }
});

// These responses have the same quarantine contract, but different safe metadata.
const rejectedResponse = { ok: false, error_code: 429, description: canary,
  parameters: { retry_after: 12, other: canary } };
const sendFailures = [
  {
    name: "HTTP rejection preserves numeric Telegram diagnostics",
    respond: () => Response.json(rejectedResponse, { status: 429 }),
    expected: { code: "HTTP_ERROR", http_status: 429, telegram_error_code: 429, retry_after: 12 },
  },
  {
    name: "non-JSON HTTP error preserves the status, not the body",
    respond: () => new Response(canary, { status: 503 }),
    expected: { code: "HTTP_ERROR", http_status: 503 },
  },
  {
    name: "invalid successful JSON records a parse failure, not the body",
    respond: () => new Response(canary),
    expected: { code: "INVALID_JSON", http_status: 200 },
  },
  {
    name: "response-body timeout preserves its classification",
    respond: () => new Response(new ReadableStream({ start(controller) {
      controller.error(new DOMException(canary, "TimeoutError"));
    } })),
    expected: { code: "TimeoutError" },
  },
  {
    name: "response-body abort preserves its classification",
    respond: () => new Response(new ReadableStream({ start(controller) {
      controller.error(new DOMException(canary, "AbortError"));
    } })),
    expected: { code: "AbortError" },
  },
  {
    name: "HTTP response-body disconnection preserves status and network cause",
    respond: () => new Response(new ReadableStream({ start(controller) {
      controller.error(Object.assign(new TypeError(canary), { code: "ECONNRESET" }));
    } }), { status: 503 }),
    expected: { code: "HTTP_ERROR", http_status: 503, causes: [{ code: "ECONNRESET" }] },
  },
  {
    name: "Telegram rejection preserves numeric retry metadata",
    respond: () => Response.json(rejectedResponse),
    expected: { code: "TELEGRAM_REJECTED", telegram_error_code: 429, retry_after: 12 },
  },
  {
    name: "timeout records its classification, not the exception message",
    respond: () => { throw new DOMException(canary, "TimeoutError"); },
    expected: { code: "TimeoutError" },
  },
];

for (const { name, respond, expected } of sendFailures) {
  test(name, async () => {
    const db = memoryDb();
    const log = spyOn(console, "error").mockImplementation(() => {});
    let sends = 0;
    stubStories(() => {
      sends++;
      if (sends === 1) return respond();
      return Response.json({ ok: true, result: { message_id: 99 } });
    });

    try {
      await runCron(db, canary, canary, "https://example.test");

      expect(persistence.findUrl(db, 1)).toBeNull();
      expect(persistence.findUrl(db, 2)).toBe("https://news.ycombinator.com/item?id=2");
      // A failed response does not prove Telegram did not send it: never retry automatically.
      expect(db.query("SELECT id, telegram_message_id FROM pending_deliveries").all())
        .toEqual([{ id: 1, telegram_message_id: null }]);
      const events = log.mock.calls.map(([line]) => JSON.parse(String(line)));
      const failures = events.filter(e => e.event === "failure");
      expect(failures).toEqual([expect.objectContaining({ stage: "telegram_send", story_id: 1, ...expected })]);
      const failure = failures[0];
      expect(events.at(-1)).toMatchObject({ event: "run_end", sent: 1, quarantined: 1, skipped: 0, failures: 1, duration_ms: expect.any(Number) });
      expect(new Set(events.map(e => e.run_id)).size).toBe(1);
      const row = db.query("SELECT diagnostic FROM pending_deliveries WHERE id=1").get() as { diagnostic: string };
      expect(JSON.parse(row.diagnostic)).toEqual(failure);
      expect(JSON.stringify(events) + row.diagnostic).not.toContain(canary);
    } finally {
      log.mockRestore();
      db.close();
    }
  });
}

test("diagnostic write failure reports separately, preserves intent, and continues", async () => {
  const db = memoryDb();
  db.exec("CREATE TRIGGER fail_diagnostic BEFORE UPDATE OF diagnostic ON pending_deliveries WHEN NEW.id=1 BEGIN SELECT RAISE(ABORT, 'CANARY-token-chat-url-title-body'); END");
  const log = spyOn(console, "error").mockImplementation(() => {});
  stubStories(() => {
    throw Object.assign(new TypeError(canary), { code: "ECONNREFUSED", errno: 0 });
  });

  try {
    await runCron(db, canary, canary, "https://example.test");
    const events = log.mock.calls.map(([line]) => JSON.parse(String(line)));

    expect(events.filter(e => e.event === "failure").map(e => e.stage)).toEqual(["telegram_send", "diagnostic_update", "telegram_send"]);
    expect(db.query("SELECT diagnostic FROM pending_deliveries WHERE id=1").get()).toEqual({ diagnostic: "intent" });
    // A diagnostic-write error adds an event, not a second story failure.
    expect(events.at(-1)).toMatchObject({ quarantined: 2, failures: 2 });
    expect(JSON.stringify(events)).not.toContain(canary);
  } finally {
    log.mockRestore();
    db.close();
  }
});

test("untrusted error metadata, app codes, and numeric bounds cannot leak credentials", () => {
  for (const error of [
    { message: canary, stack: canary, path: canary, url: canary, code: canary, name: canary, cause: { code: canary, name: canary } },
    { code: `SQLITE_IOERR_${canary}`, errno: canary, name: canary },
    new AppError(canary, canary, { http_status: canary as any, telegram_error_code: canary as any, retry_after: canary as any }),
    new AppError("HTTP_ERROR", canary, { http_status: 999, telegram_error_code: -1, retry_after: 86401 }),
  ]) {
    expect(JSON.stringify(safeError(error))).not.toContain(canary);
  }
  expect(safeError(new AppError("HTTP_ERROR", canary, { retry_after: Infinity }))).toEqual({ code: "HTTP_ERROR" });
  expect(safeError({ code: "SQLITE_BUSY_SNAPSHOT", errno: 517 })).toEqual({ code: "SQLITE_BUSY_SNAPSHOT", errno: 517 });
});

test("history lookup failure stops before sending", async () => {
  const db = memoryDb();
  const log = spyOn(console, "error").mockImplementation(() => {});
  const error = Object.assign(new Error(canary), { code: "SQLITE_IOERR_WRITE", errno: 778 });
  const mock = spyOn(persistence, "hasStory").mockImplementation(() => { throw error; });
  let sends = 0;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    if (url.endsWith("topstories.json")) return Response.json([1]);
    if (url.includes("/item/")) return Response.json({ id: 1, score: 150, time: 1, title: canary });
    sends++;
    return Response.json({});
  }) as typeof fetch;

  try {
    await expect(runCron(db, canary, canary, "https://example.test")).rejects.toThrow();

    const events = log.mock.calls.map(([line]) => JSON.parse(String(line)));

    expect(events.filter(e => e.event === "failure")).toEqual([expect.objectContaining({ stage: "history", story_id: 1 })]);
    expect(events.at(-1)).toMatchObject({ sent: 0, quarantined: 0, failures: 1, failed: true });
    expect(sends).toBe(0);
    expect(JSON.stringify(events)).not.toContain(canary);
  } finally {
    mock.mockRestore();
    log.mockRestore();
    db.close();
  }
});

test("pending-intent lookup failure stops before sending", async () => {
  const db = memoryDb();
  const log = spyOn(console, "error").mockImplementation(() => {});
  const error = Object.assign(new Error(canary), { code: "SQLITE_IOERR_WRITE", errno: 778 });
  const mock = spyOn(delivery, "isPending").mockImplementation(() => { throw error; });
  let sends = 0;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    if (url.endsWith("topstories.json")) return Response.json([1]);
    if (url.includes("/item/")) return Response.json({ id: 1, score: 150, time: 1, title: canary });
    sends++;
    return Response.json({});
  }) as typeof fetch;

  try {
    await expect(runCron(db, canary, canary, "https://example.test")).rejects.toThrow();

    const events = log.mock.calls.map(([line]) => JSON.parse(String(line)));

    expect(events.filter(e => e.event === "failure")).toEqual([expect.objectContaining({ stage: "pending", story_id: 1 })]);
    expect(events.at(-1)).toMatchObject({ sent: 0, quarantined: 0, failures: 1, failed: true });
    expect(sends).toBe(0);
    expect(JSON.stringify(events)).not.toContain(canary);
  } finally {
    mock.mockRestore();
    log.mockRestore();
    db.close();
  }
});

test("claim failure stops before sending", async () => {
  const db = memoryDb();
  const log = spyOn(console, "error").mockImplementation(() => {});
  const error = Object.assign(new Error(canary), { code: "SQLITE_IOERR_WRITE", errno: 778 });
  const mock = spyOn(delivery, "claimDelivery").mockImplementation(() => { throw error; });
  let sends = 0;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    if (url.endsWith("topstories.json")) return Response.json([1]);
    if (url.includes("/item/")) return Response.json({ id: 1, score: 150, time: 1, title: canary });
    sends++;
    return Response.json({});
  }) as typeof fetch;

  try {
    await expect(runCron(db, canary, canary, "https://example.test")).rejects.toThrow();

    const events = log.mock.calls.map(([line]) => JSON.parse(String(line)));

    expect(events.filter(e => e.event === "failure")).toEqual([expect.objectContaining({ stage: "claim", story_id: 1 })]);
    expect(events.at(-1)).toMatchObject({ sent: 0, quarantined: 0, failures: 1, failed: true });
    expect(sends).toBe(0);
    expect(JSON.stringify(events)).not.toContain(canary);
  } finally {
    mock.mockRestore();
    log.mockRestore();
    db.close();
  }
});

test("formatting failure rejects the run without sending", async () => {
  const db = memoryDb();
  const log = spyOn(console, "error").mockImplementation(() => {});
  const error = Object.assign(new Error(canary), { code: "SQLITE_IOERR_WRITE", errno: 778 });
  const mock = spyOn(formatting, "formatPost").mockImplementation(() => { throw error; });
  let sends = 0;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    if (url.endsWith("topstories.json")) return Response.json([1]);
    if (url.includes("/item/")) return Response.json({ id: 1, score: 150, time: 1, title: canary });
    sends++;
    return Response.json({});
  }) as typeof fetch;

  try {
    await expect(runCron(db, canary, canary, "https://example.test")).rejects.toThrow();

    const events = log.mock.calls.map(([line]) => JSON.parse(String(line)));

    expect(events.filter(e => e.event === "failure")).toEqual([expect.objectContaining({ stage: "format", story_id: 1 })]);
    expect(events.at(-1)).toMatchObject({ sent: 0, quarantined: 0, failures: 1, failed: true });
    expect(sends).toBe(0);
    expect(JSON.stringify(events)).not.toContain(canary);
  } finally {
    mock.mockRestore();
    log.mockRestore();
    db.close();
  }
});

test("invalid story rejects the run without sending", async () => {
  const db = memoryDb();
  const log = spyOn(console, "error").mockImplementation(() => {});
  let sends = 0;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    if (url.endsWith("topstories.json")) return Response.json([1]);
    if (url.includes("/item/")) return Response.json({ id: 1, score: 150, time: 1, title: null });
    sends++;
    return Response.json({});
  }) as typeof fetch;

  try {
    await expect(runCron(db, canary, canary, "https://example.test")).rejects.toThrow();

    const events = log.mock.calls.map(([line]) => JSON.parse(String(line)));

    expect(events.filter(e => e.event === "failure")).toEqual([expect.objectContaining({ stage: "validation", story_id: 1 })]);
    expect(events.at(-1)).toMatchObject({ sent: 0, quarantined: 0, failures: 1, failed: true });
    expect(sends).toBe(0);
    expect(JSON.stringify(events)).not.toContain(canary);
  } finally {
    log.mockRestore();
    db.close();
  }
});

test("missing credentials fail safely before opening the database", async () => {
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const log = spyOn(console, "error").mockImplementation(() => {});
  const open = spyOn(persistence, "openDatabase");
  delete process.env.TELEGRAM_BOT_TOKEN;

  try {
    await expect(executeCron()).rejects.toThrow();

    const events = log.mock.calls.map(([line]) => JSON.parse(String(line)));

    expect(events.find(e => e.event === "failure")).toMatchObject({ stage: "config", code: "CONFIG_TOKEN" });
    expect(open).not.toHaveBeenCalled();
    expect(JSON.stringify(events)).not.toContain(canary);
  } finally {
    open.mockRestore();
    log.mockRestore();
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = oldToken;
  }
});

test("database-open failure logs a safe schema classification", async () => {
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldBase = process.env.BASE_URL;
  process.env.TELEGRAM_BOT_TOKEN = canary;
  process.env.BASE_URL = "https://example.test";
  const log = spyOn(console, "error").mockImplementation(() => {});
  const open = spyOn(persistence, "openDatabase").mockImplementation(() => {
    throw new AppError("DATABASE_SCHEMA", canary);
  });

  try {
    await expect(executeCron()).rejects.toThrow();

    const events = log.mock.calls.map(([line]) => JSON.parse(String(line)));

    expect(events.find(e => e.event === "failure")).toMatchObject({ stage: "db_open", code: "DATABASE_SCHEMA" });
    expect(JSON.stringify(events)).not.toContain(canary);
  } finally {
    open.mockRestore();
    log.mockRestore();
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = oldToken;
    if (oldBase === undefined) delete process.env.BASE_URL;
    else process.env.BASE_URL = oldBase;
  }
});

test("cleanup logs its own failure without replacing the original network error", async () => {
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldBase = process.env.BASE_URL;
  process.env.TELEGRAM_BOT_TOKEN = canary;
  process.env.BASE_URL = "https://example.test";
  const db = memoryDb();
  const log = spyOn(console, "error").mockImplementation(() => {});
  const open = spyOn(persistence, "openDatabase").mockImplementation(() => db);
  const close = spyOn(db, "close").mockImplementation(() => { throw new Error(canary); });
  const original = Object.assign(new TypeError(canary), { code: "ECONNREFUSED", errno: 0 });
  globalThis.fetch = (async () => { throw original; }) as unknown as typeof fetch;

  try {
    await expect(executeCron()).rejects.toBe(original);

    const events = log.mock.calls.map(([line]) => JSON.parse(String(line)));

    expect(events.filter(e => e.event === "failure").map(e => e.stage)).toEqual(["hn_top", "db_close"]);
    expect(new Set(events.map(e => e.run_id)).size).toBe(1);
    expect(events.at(-1)).toMatchObject({ failures: 2, failed: true });
    expect(JSON.stringify(events)).not.toContain(canary);
  } finally {
    close.mockRestore();
    open.mockRestore();
    log.mockRestore();
    db.close();
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = oldToken;
    if (oldBase === undefined) delete process.env.BASE_URL;
    else process.env.BASE_URL = oldBase;
  }
});

test("unknown errors serialize only allowlisted causes within a bounded diagnostic", () => {
  const error = { code: canary, message: canary, stack: canary, path: canary, url: canary,
    cause: Object.assign(new TypeError(canary), { code: "ECONNREFUSED", errno: 0,
      cause: { name: canary, code: canary } }) };

  const diagnostic = safeError(error);

  expect(diagnostic).toEqual({ code: "UNKNOWN", causes: [{ code: "ECONNREFUSED", errno: 0 }, { code: "UNKNOWN" }] });
  expect(JSON.stringify(diagnostic).length).toBeLessThan(1024);
  expect(JSON.stringify(diagnostic)).not.toContain(canary);
});

test("quarantined stories are skipped on the next run, with fresh run IDs and accurate counters", async () => {
  const db = memoryDb();
  const log = spyOn(console, "error").mockImplementation(() => {});
  const error = { code: canary, message: canary,
    cause: Object.assign(new TypeError(canary), { code: "ECONNREFUSED", errno: 0, cause: { code: canary } }) };
  let sends = 0;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    if (url.endsWith("topstories.json")) return Response.json([1, 2, 2]);
    if (url.endsWith("/item/1.json")) return Response.json({ id: 1, score: 150, time: 1, title: canary });
    if (url.endsWith("/item/2.json")) return Response.json({ id: 2, score: 149, time: 1, title: canary });
    sends++;
    throw error;
  }) as typeof fetch;

  try {
    await runCron(db, canary, canary, "https://example.test");
    await runCron(db, canary, canary, "https://example.test");
    const events = log.mock.calls.map(([line]) => JSON.parse(String(line)));
    const ends = events.filter(e => e.event === "run_end");
    expect(ends[0]).toMatchObject({ quarantined: 1, skipped: 1, failures: 1, sent: 0 });
    expect(ends[1]).toMatchObject({ quarantined: 0, skipped: 2, failures: 0, sent: 0 });
    expect(ends[0].run_id).not.toBe(ends[1].run_id);
    expect(sends).toBe(1);
    const diagnostic = (db.query("SELECT diagnostic FROM pending_deliveries WHERE id=1").get() as any).diagnostic;
    expect(JSON.parse(diagnostic)).toMatchObject({ code: "UNKNOWN", causes: [{ code: "ECONNREFUSED", errno: 0 }, { code: "UNKNOWN" }] });
    expect(diagnostic.length).toBeLessThan(1024);
    expect(JSON.stringify(events) + diagnostic).not.toContain(canary);
  } finally {
    log.mockRestore();
    db.close();
  }
});
