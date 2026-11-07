import "../src/environment";
import { Database } from "bun:sqlite";
import { closeSync, openSync, unlinkSync } from "node:fs";
import { databasePath, schema } from "../src/db";

const path = databasePath();
// Exclusive creation prevents overwriting an existing database.
closeSync(openSync(path, "wx", 0o600));
try {
  const db = new Database(path, { readwrite: true });
  try {
    db.exec(schema);
  } finally {
    db.close();
  }
} catch (error) {
  unlinkSync(path);
  throw error;
}
console.log("Database initialized");
