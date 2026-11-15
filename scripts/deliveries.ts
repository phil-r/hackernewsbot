import { openDatabase } from "../src/db";
import { finalizeDelivery, rememberDelivery } from "../src/delivery";
import { safeError } from "../src/logging";

let db: ReturnType<typeof openDatabase> | undefined;
try {
  await import("../src/environment");
  const [command, rawId, argument, ...extra] = process.argv.slice(2);
  const id = Number(rawId);
  const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
  if (extra.length || !(
    (command === "list" && rawId === undefined) ||
    (command === "delivered" && positive(id) && (argument === undefined || positive(Number(argument)))) ||
    (command === "release" && positive(id) && argument === "--confirmed-not-delivered")
  )) {
    console.error("Usage: deliveries list | delivered STORY_ID [MESSAGE_ID] | release STORY_ID --confirmed-not-delivered");
    throw new Error("Invalid arguments");
  }
  // Stop/drain the scheduler before reconciliation; list is safe while cron runs.
  db = openDatabase();
  if (command === "list") {
    console.log(JSON.stringify(db.query("SELECT id, chat_id, telegram_message_id, diagnostic, created FROM pending_deliveries ORDER BY id").all(), null, 2));
  } else if (command === "delivered") {
    if (argument !== undefined) rememberDelivery(db, id, Number(argument));
    finalizeDelivery(db, id);
    console.log(`Recorded story ${id}; no message sent`);
  } else {
    const result = db.query("DELETE FROM pending_deliveries WHERE id = ? AND telegram_message_id IS NULL").run(id);
    if (result.changes !== 1) throw new Error("Missing intent or confirmed delivery; refusing release");
    console.log(`Released story ${id}; eligible on a future top-list pass`);
  }
} catch (error) {
  console.error(JSON.stringify(safeError(error)));
  process.exitCode = 1;
} finally {
  try { db?.close(); } catch (error) {
    console.error(JSON.stringify(safeError(error)));
    process.exitCode = 1;
  }
}
