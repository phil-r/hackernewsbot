import { openDatabase, pendingSchema, validateTable } from "../src/db";
import { safeError } from "../src/logging";

let db: ReturnType<typeof openDatabase> | undefined;
try {
  await import("../src/environment");
  // Validate existing history first; never create a missing database or history table.
  const database = openDatabase(false);
  db = database;
  db.transaction(() => {
    const existing = database.query("SELECT name FROM sqlite_master WHERE name = 'pending_deliveries'").get();
    if (!existing) database.exec(pendingSchema);
    validateTable(database, "pending_deliveries", pendingSchema);
  }).immediate();
  console.log("Delivery quarantine schema ready; history unchanged");
} catch (error) {
  console.error(JSON.stringify(safeError(error)));
  process.exitCode = 1;
} finally {
  try { db?.close(); } catch (error) {
    console.error(JSON.stringify(safeError(error)));
    process.exitCode = 1;
  }
}
