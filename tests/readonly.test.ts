import { expect, spyOn, test } from "bun:test";
import { constants, Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openDatabase, pendingSchema, schema } from "../src/db";
import { handleRequest } from "../src/http";
import { encode } from "../src/shortener";

// Every connection uses a disposable absolute path, never an inherited DATABASE_URL.
function fixture(run: (path: string, connect: (readonly?: boolean) => Database) => void) {
  const dir = mkdtempSync(join(tmpdir(), "hnbot-readonly-"));
  const path = join(dir, "history.sqlite");
  const old = process.env.DATABASE_URL;
  const connections: Database[] = [];
  const errors: unknown[] = [];
  process.env.DATABASE_URL = `file:${path}`;
  try {
    run(path, (readonly = false) => {
      const db = openDatabase({ requirePending: !readonly, readonly });
      connections.push(db);
      return db;
    });
  } catch (error) {
    errors.push(error);
  } finally {
    for (const db of connections.reverse()) {
      try { db.close(); } catch (error) { errors.push(error); }
    }
    if (old === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = old;
    try { rmSync(dir, { recursive: true, force: true }); } catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Readonly fixture failed");
}
function initialize(path: string, wal = false) {
  const db = new Database(path);
  try {
    if (wal) db.exec("PRAGMA journal_mode = WAL");
    db.exec(schema);
    db.exec(pendingSchema);
    insert(db, 1);
    if (wal) {
      // Test-only: Apple SQLite defaults to persistent WAL. Force a clean cold-start fixture.
      db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    }
  } finally { db.close(); }
}
function insert(db: Database, id: number) {
  db.query("INSERT INTO story_posts (id, title, score, url) VALUES (?, 'test', 150, ?)")
    .run(id, `https://example.test/${id}`);
}
function pragma(db: Database, name: string) {
  return Object.values(db.query(`PRAGMA ${name}`).get() as object)[0];
}
function redirect(db: Database, id: number) {
  const response = handleRequest(new Request(`https://local.test/s/${encode(id)}`), db);
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(`https://example.test/${id}`);
}

test("fixture attempts every close and restores its environment and directory after cleanup failure", () => {
  const old = process.env.DATABASE_URL;
  const failure = new Error("fixture close failed");
  const nativeClose = Database.prototype.close;
  let directory = "";
  let closes = 0;
  const close = spyOn(Database.prototype, "close").mockImplementation(function(this: Database) {
    nativeClose.call(this);
    if (++closes === 2) throw failure; // First close initializes; second starts fixture cleanup.
  });
  try {
    expect(() => fixture((path, connect) => {
      directory = dirname(path);
      initialize(path);
      connect();
      connect(true);
    })).toThrow(failure);
    expect(closes).toBe(3);
    expect(process.env.DATABASE_URL).toBe(old);
    expect(existsSync(directory)).toBe(false);
  } finally { close.mockRestore(); }
});

test("HTTP SQLite rejects DML and DDL, retains timeout/FULL, and does not change DELETE journal mode", () => {
  fixture((path, connect) => {
    initialize(path);
    const before = readFileSync(path);
    const reader = connect(true);
    expect(pragma(reader, "busy_timeout")).toBe(5000);
    expect(pragma(reader, "synchronous")).toBe(2);
    expect(pragma(reader, "journal_mode")).toBe("delete");
    redirect(reader, 1);
    for (const sql of [
      "INSERT INTO story_posts (id,title,score) VALUES (2,'bad',1)",
      "UPDATE story_posts SET title='bad' WHERE id=1",
      "DELETE FROM story_posts WHERE id=1",
      "CREATE TABLE forbidden (id INTEGER)",
    ]) {
      let error: any;
      try { reader.exec(sql); } catch (caught) { error = caught; }
      expect(error?.code).toBe("SQLITE_READONLY");
    }
    reader.close();
    expect(readFileSync(path)).toEqual(before);
    expect(existsSync(`${path}-wal`)).toBe(false);
    const writer = connect(); // Posting defaults remain writable, including pending intents.
    insert(writer, 2);
    writer.exec("INSERT INTO pending_deliveries(id,post_json,chat_id) VALUES(2,'{}','test')");
    expect(pragma(writer, "busy_timeout")).toBe(5000);
    expect(pragma(writer, "synchronous")).toBe(2);
  });
});

// app.test.ts covers history-only HTTP startup; reliability.test.ts covers validation before listening.
test("readonly rejects missing/incompatible history without creating or migrating it", () => {
  fixture((path, connect) => {
    expect(() => connect(true)).toThrow();
    expect(existsSync(path)).toBe(false);
    const setup = new Database(path);
    setup.exec("CREATE TABLE story_posts (id INTEGER PRIMARY KEY)");
    setup.close();
    const before = readFileSync(path);
    expect(() => connect(true)).toThrow("Incompatible database schema");
    expect(readFileSync(path)).toEqual(before);
  });
});

test("readonly schema failure closes the connection and preserves the original error if cleanup fails", () => {
  fixture((path) => {
    const setup = new Database(path);
    setup.close();
    const nativeClose = Database.prototype.close;
    const cleanupFailure = new Error("cleanup failed");
    const report = spyOn(Database.prototype, "close").mockImplementation(function(this: Database) {
      nativeClose.call(this);
      throw cleanupFailure;
    });
    const errors: unknown[] = [];
    try {
      expect(() => openDatabase({ readonly: true, requirePending: false }, error => errors.push(error)))
        .toThrow("Incompatible database schema");
      expect(report).toHaveBeenCalledTimes(1);
      expect(errors).toEqual([cleanupFailure]);
    } finally { report.mockRestore(); }
  });
});

test("WAL cold start without sidecars: read or explicitly report runtime bootstrap failure", () => {
  fixture((path, connect) => {
    initialize(path, true);
    expect(existsSync(`${path}-wal`)).toBe(false);
    expect(existsSync(`${path}-shm`)).toBe(false);
    let reader: Database;
    try { reader = connect(true); } catch (error) {
      expect((error as { code?: string }).code).toBe("SQLITE_CANTOPEN");
      console.warn("Readonly WAL cold start failed with SQLITE_CANTOPEN; a writable bootstrap is required on this runtime.");
      return; // Do not substitute a writer and pretend readonly cold start succeeded.
    }
    redirect(reader, 1);
    const writer = connect(); // A successful cold-start reader must also see later writer commits.
    insert(writer, 2);
    redirect(reader, 2);
  });
});

// Two useful connection orders, not every open/close permutation. Cold start is tested above.
for (const closesFirst of ["reader", "writer"] as const) {
  test(`WAL checkpoint/recreation with ${closesFirst} closing first`, () => {
    fixture((path, connect) => {
      initialize(path, true);
      const writer = connect(); // Establish sidecars even on runtimes requiring writable bootstrap.
      const reader = connect(true);
      writer.exec("PRAGMA wal_autocheckpoint = 0");
      reader.exec("BEGIN");
      redirect(reader, 1); // Pin a snapshot while the writer commits.
      insert(writer, 2);
      expect(reader.query("SELECT id FROM story_posts WHERE id=2").get()).toBeNull();
      reader.exec("COMMIT");
      redirect(reader, 2);
      expect(statSync(`${path}-wal`).size).toBeGreaterThan(0);
      expect(writer.query("PRAGMA wal_checkpoint(TRUNCATE)").get())
        .toEqual({ busy: 0, log: 0, checkpointed: 0 });
      expect(statSync(`${path}-wal`).size).toBe(0);
      if (closesFirst === "writer") {
        writer.close();
        redirect(reader, 2);
        const nextWriter = connect(); // Reader predates this writer.
        insert(nextWriter, 3);
        redirect(reader, 3);
        nextWriter.close();
        reader.close();
      } else {
        reader.close();
        insert(writer, 3);
        const nextReader = connect(true); // Writer predates this reader.
        redirect(nextReader, 3);
        nextReader.close();
        writer.close();
      }
      const cleanup = connect();
      cleanup.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      cleanup.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
      cleanup.close();
      expect(existsSync(`${path}-wal`)).toBe(false);
      expect(existsSync(`${path}-shm`)).toBe(false);
      const restartedWriter = connect();
      const restartedReader = connect(true);
      expect(existsSync(`${path}-wal`)).toBe(true);
      expect(existsSync(`${path}-shm`)).toBe(true);
      redirect(restartedReader, 3);
      insert(restartedWriter, 4);
      redirect(restartedReader, 4);
    });
  });
}

// chmod is meaningful only for non-root POSIX users; this is not cross-identity ACL evidence.
const permissionTest = process.getuid?.() !== undefined && process.getuid() !== 0
  ? test : test.skip;
permissionTest("readonly filesystem: existing readable WAL/SHM permits reads and live commits", () => {
  fixture((path, connect) => {
    initialize(path, true);
    const writer = connect();
    insert(writer, 2);
    const dir = dirname(path);
    try {
      chmodSync(path, 0o400);
      chmodSync(`${path}-wal`, 0o400);
      chmodSync(`${path}-shm`, 0o400);
      chmodSync(dir, 0o500);
      const reader = connect(true);
      redirect(reader, 2);
      // Writer already owns writable handles; chmod does not revoke those handles.
      insert(writer, 3);
      redirect(reader, 3);
      reader.close();
    } finally {
      chmodSync(dir, 0o700);
      for (const file of [path, `${path}-wal`, `${path}-shm`]) {
        if (existsSync(file)) chmodSync(file, 0o600);
      }
    }
  });
});

permissionTest("readonly filesystem: absent WAL/SHM cannot cold-start in a nonwritable directory", () => {
  fixture((path, connect) => {
    initialize(path, true);
    expect(existsSync(`${path}-wal`)).toBe(false);
    expect(existsSync(`${path}-shm`)).toBe(false);
    const dir = dirname(path);
    try {
      chmodSync(path, 0o400);
      chmodSync(dir, 0o500);
      let error: unknown;
      try { connect(true); } catch (caught) { error = caught; }
      // SQLite reports this denied bootstrap differently on macOS and Linux.
      expect(["SQLITE_CANTOPEN", "SQLITE_READONLY_DIRECTORY"])
        .toContain((error as { code?: string } | undefined)?.code ?? "");
    } finally {
      chmodSync(dir, 0o700);
      chmodSync(path, 0o600);
    }
  });
});

test("long-lived readonly HTTP connection sees a separate process commit in WAL", () => {
  fixture((path, connect) => {
    initialize(path, true);
    const bootstrap = connect();
    // Keep the writer open: this case specifically tests live multi-process WAL access.
    const reader = connect(true);
    redirect(reader, 1);
    const child = Bun.spawnSync([process.execPath, "--no-env-file", "-e", `
      import { openDatabase } from ${JSON.stringify(new URL("../src/db.ts", import.meta.url).href)};
      const db = openDatabase();
      try {
        db.exec("INSERT INTO story_posts(id,title,score,url) VALUES(2,'child',150,'https://example.test/2')");
      } finally { db.close(); }
    `], { env: { DATABASE_URL: `file:${path}` }, timeout: 3000, killSignal: "SIGKILL" });
    expect(child.stderr.toString()).toBe("");
    expect(child.exitCode).toBe(0);
    redirect(reader, 2);
    bootstrap.close();
  });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`HTTP CLI ${signal} drains the listener before closing its readonly database`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "hnbot-shutdown-"));
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      const path = join(dir, "history.sqlite");
      initialize(path);
      // Run the real CLI body without its project .env loader. Bind only an ephemeral loopback port.
      const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8")
        .replace('import "./environment";', "")
        .replace('"./db"', JSON.stringify(new URL("../src/db.ts", import.meta.url).href))
        .replace('"./http"', JSON.stringify(new URL("../src/http.ts", import.meta.url).href));
      const entry = join(dir, "index.ts");
      writeFileSync(entry, `
        import { Database } from "bun:sqlite";
        const nativeClose = Database.prototype.close;
        Database.prototype.close = function(...args) {
          console.log("database closed");
          return nativeClose.apply(this, args);
        };
        const nativeServe = Bun.serve;
        Bun.serve = options => {
          const server = nativeServe({ ...options, hostname: "127.0.0.1", port: 0 });
          const stop = server.stop.bind(server);
          server.stop = async (...args) => {
            await stop(...args);
            console.log("listener drained");
          };
          return server;
        };
      ` + source + '\nconsole.log("signals installed");\n');
      const proc = Bun.spawn([process.execPath, "--no-env-file", entry], {
        env: { DATABASE_URL: `file:${path}`, PORT: "8080", HOST: "127.0.0.1" },
        stdout: "pipe", stderr: "pipe",
      });
      child = proc;
      // Kill independently of awaited stream reads, before the test runner's own deadline.
      watchdog = setTimeout(() => proc.kill("SIGKILL"), 3000);
      const output = proc.stdout.getReader();
      let ready = "";
      while (!ready.includes("signals installed")) {
        const chunk = await output.read();
        if (chunk.done) break;
        ready += new TextDecoder().decode(chunk.value);
      }
      expect(ready).toContain("Server listening on port");
      expect(ready).toContain("signals installed");
      proc.kill(signal);
      let rest = "";
      while (true) {
        const chunk = await output.read();
        if (chunk.done) break;
        rest += new TextDecoder().decode(chunk.value);
      }
      expect(await proc.exited).toBe(0);
      expect(await new Response(proc.stderr).text()).toBe("");
      expect(rest.trim().split("\n")).toEqual(["listener drained", "database closed"]);
    } finally {
      clearTimeout(watchdog);
      child?.kill("SIGKILL"); // Teardown must not depend on the shutdown handler under test.
      try {
        if (child) await child.exited;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }, 10000);
}
