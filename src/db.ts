import { Database } from "bun:sqlite";
import { AppError } from "./logging";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("..", import.meta.url));
// Shared by initialization and startup validation; row existence deduplicates history.
// Legacy exports may omit these four text fields. NULL means unknown, not invented data.
export const schema = `CREATE TABLE story_posts (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  text TEXT,
  message TEXT,
  url TEXT,
  short_url TEXT,
  short_hn_url TEXT,
  score INTEGER NOT NULL,
  telegram_message_id INTEGER,
  created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

// Intents have no expiry: a crashed sender may already have delivered the message.
export const pendingSchema = `CREATE TABLE pending_deliveries (
  id INTEGER PRIMARY KEY,
  post_json TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  telegram_message_id INTEGER,
  diagnostic TEXT NOT NULL DEFAULT 'intent',
  created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

// Treat file: as a filename, not a URI; relative paths are rooted at the project.
export function databasePath(url = process.env.DATABASE_URL): string {
  if (!url?.startsWith("file:"))
    throw new AppError("CONFIG_DATABASE", "DATABASE_URL must be a file: filename");
  const filename = url.slice(5);
  if (
    !filename ||
    filename === ":memory:" ||
    /[?#\0%]/.test(filename) ||
    filename.startsWith("//")
  )
    throw new AppError("CONFIG_DATABASE", "Unsupported DATABASE_URL");
  return resolve(root, filename);
}

// Never create an empty production database implicitly: missing history can cause reposts.
export function openDatabase(requirePending = true, onCleanupError?: (error: unknown) => void): Database {
  const path = databasePath();
  if (!statSync(path).isFile())
    throw new AppError("DATABASE_FILE", "Database must be an existing file");
  const db = new Database(path, {
    readwrite: true,
    create: false,
    strict: true,
  });
  try {
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL");
    validateTable(db, "story_posts", schema);
    if (requirePending) validateTable(db, "pending_deliveries", pendingSchema);
    return db;
  } catch (error) {
    try { db.close(); } catch (cleanupError) { onCleanupError?.(cleanupError); }
    throw error;
  }
}

export function validateTable(db: Database, name: string, expected: string): void {
  const definition = db.query<{ sql: string }, [string]>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(name);
  // Ignore SQL presentation only; reject schema drift before serving or posting.
  const canonical = (sql: string) => sql.replace(/[\s"`\[\];]/g, "").toUpperCase();
  if (!definition || canonical(definition.sql) !== canonical(expected))
    throw new AppError("DATABASE_SCHEMA", "Incompatible database schema");
}

// Historical rows are already processed even without a URL or Telegram message ID.
export function hasStory(db: Database, id: number): boolean {
  return db.query<{ id: number }, [number]>(
    "SELECT id FROM story_posts WHERE id = ?",
  ).get(id) !== null;
}

export function findUrl(db: Database, id: number): string | null {
  return (
    db.query<{ url: string | null }, [number]>("SELECT url FROM story_posts WHERE id = ?")
      .get(id)?.url ?? null
  );
}
