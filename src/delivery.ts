import type { Database } from "bun:sqlite";
import { AppError } from "./logging";
import { hasStory } from "./db";
import type { Post } from "./story";

export function isPending(db: Database, id: number): boolean {
  return (
    db.query("SELECT id FROM pending_deliveries WHERE id = ?").get(id) !== null
  );
}

// The immediate transaction serializes competing senders, including their history check.
export function claimDelivery(db: Database, post: Post, chatId: string): boolean {
  return db
    .transaction(() => {
      if (hasStory(db, post.id) || isPending(db, post.id)) {
        return false;
      }

      db.query(`
        INSERT INTO pending_deliveries (id, post_json, chat_id)
        VALUES (?, ?, ?)
      `).run(post.id, JSON.stringify(post), chatId);
      return true;
    })
    .immediate();
}

export function rememberDelivery(
  db: Database,
  id: number,
  messageId: number,
): void {
  const result = db.query(`
    UPDATE pending_deliveries
    SET telegram_message_id = ?, diagnostic = 'confirmed'
    WHERE id = ?
      AND (telegram_message_id IS NULL OR telegram_message_id = ?)
  `).run(messageId, id, messageId);

  if (result.changes !== 1) {
    throw new AppError("MISSING_OR_CONFLICTING_INTENT", "Delivery intent is missing or has a different confirmed message ID");
  }
}

// Either both history and intent removal commit, or the recoverable intent survives.
export function finalizeDelivery(db: Database, id: number): void {
  db.transaction(() => {
    const pending = db
      .query<
        { post_json: string; telegram_message_id: number | null },
        [number]
      >(
        `SELECT post_json, telegram_message_id
         FROM pending_deliveries
         WHERE id = ?`,
      )
      .get(id);

    if (
      !pending ||
      !Number.isSafeInteger(pending.telegram_message_id) ||
      pending.telegram_message_id! <= 0
    ) {
      throw new AppError("UNCONFIRMED_INTENT", "Delivery needs a confirmed message ID");
    }

    const post: Post = JSON.parse(pending.post_json);
    if (post.id !== id) {
      throw new AppError("MISMATCHED_INTENT", "Mismatched delivery intent");
    }

    db.query(`
      INSERT INTO story_posts (
        id, title, text, message, url, short_url, short_hn_url, score,
        telegram_message_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      post.id,
      post.title,
      post.text,
      post.message,
      post.url,
      post.shortUrl,
      post.shortHnUrl,
      post.score,
      pending.telegram_message_id,
    );
    db.query("DELETE FROM pending_deliveries WHERE id = ?").run(id);
  }).immediate();
}
