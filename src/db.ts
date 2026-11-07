import { Database } from "bun:sqlite";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("..", import.meta.url));
// Shared by initialization and startup validation; IDs also deduplicate confirmed posts.
export const schema = `CREATE TABLE story_posts (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  text TEXT,
  message TEXT NOT NULL,
  url TEXT NOT NULL,
  short_url TEXT NOT NULL,
  short_hn_url TEXT NOT NULL,
  score INTEGER NOT NULL,
  telegram_message_id INTEGER,
  created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

// Treat file: as a filename, not a URI; relative paths are rooted at the project.
export function databasePath(url = process.env.DATABASE_URL): string {
  if (!url?.startsWith("file:"))
    throw new Error("DATABASE_URL must be a file: filename");
  const filename = url.slice(5);
  if (
    !filename ||
    filename === ":memory:" ||
    /[?#\0%]/.test(filename) ||
    filename.startsWith("//")
  )
    throw new Error("Unsupported DATABASE_URL");
  return resolve(root, filename);
}

// Never create an empty production database implicitly: missing history can cause reposts.
export function openDatabase(): Database {
  const path = databasePath();
  if (!statSync(path).isFile())
    throw new Error("Database must be an existing file");
  const db = new Database(path, {
    readwrite: true,
    create: false,
    strict: true,
  });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const definition = db
      .query(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'story_posts'",
      )
      .get() as { sql: string } | null;
    // Ignore SQL presentation only; reject schema drift before serving or posting.
    const canonical = (sql: string) =>
      sql.replace(/[\s"`\[\];]/g, "").toUpperCase();
    if (!definition || canonical(definition.sql) !== canonical(schema))
      throw new Error("Incompatible database schema");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function findUrl(db: Database, id: number): string | null {
  return (
    db.query<{ url: string }, [number]>("SELECT url FROM story_posts WHERE id = ?")
      .get(id)?.url ?? null
  );
}
