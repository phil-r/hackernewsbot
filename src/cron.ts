import "./environment";
import type { Database } from "bun:sqlite";
import { findUrl, openDatabase } from "./db";
import { formatPost, type Story } from "./story";

const HN_API_URL = "https://hacker-news.firebaseio.com/v0";
const REQUEST_TIMEOUT_MS = 10_000;

// Reject HTTP/JSON failures; callers validate each service's response shape.
async function json(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, {
    ...init,
    // Bound stalled jobs; a Telegram timeout does not prove the send failed.
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** One scheduled pass; caller owns the DB and must prevent overlapping runs.
 * Top-list failures abort immediately; item failures continue, then reject the run.
 */
export async function runCron(
  db: Database,
  token: string,
  chatId: string,
  baseUrl: string,
): Promise<void> {
  const ids = await json(
    `${HN_API_URL}/topstories.json`,
  );
  if (
    !Array.isArray(ids) ||
    !ids.every((id) => Number.isSafeInteger(id) && id > 0)
  )
    throw new Error("Invalid top stories response");
  let failures = 0;
  // Sequential requests keep both API traffic and posting concurrency bounded.
  for (const id of new Set<number>(ids)) {
    try {
      if (findUrl(db, id)) continue;
      const story: Story | null = await json(
        `${HN_API_URL}/item/${id}.json`,
      );
      // The posting threshold is inclusive.
      if (!story || typeof story.score !== "number" || story.score < 150)
        continue;
      if (
        story.id !== id ||
        typeof story.title !== "string" ||
        !Number.isFinite(story.time) ||
        (story.url != null && typeof story.url !== "string") ||
        (story.text != null && typeof story.text !== "string")
      )
        throw new Error("Invalid story");
      const post = formatPost(story, baseUrl);
      // Send before saving: failed/ambiguous sends may retry, never mark them delivered.
      const response = await json(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: post.message,
            parse_mode: "HTML",
            disable_notification: true,
            reply_markup: { inline_keyboard: [post.buttons] },
          }),
        },
      );
      if (!response?.ok || !Number.isSafeInteger(response.result?.message_id))
        throw new Error("Telegram rejected message");
      // A crash/insert failure here can still duplicate an already-delivered message.
      db.query(
        `INSERT INTO story_posts (id,title,text,message,url,short_url,short_hn_url,score,telegram_message_id) VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        post.id,
        post.title,
        post.text,
        post.message,
        post.url,
        post.shortUrl,
        post.shortHnUrl,
        post.score,
        response.result.message_id,
      );
    } catch {
      // Avoid logging request URLs, which can contain the bot token.
      console.error(`Failed to process story ${id}`);
      failures++;
    }
  }
  if (failures) throw new Error(`${failures} stories failed`);
}

// Validate sender credentials and the public origin before opening SQLite or sending.
export function cronConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID || "@hacker_news_feed";
  const baseUrl = (process.env.BASE_URL || "https://readhacker.news").replace(
    /\/$/,
    "",
  );
  if (!token || !/^[\w:-]+$/.test(token))
    throw new Error("TELEGRAM_BOT_TOKEN is required");
  const url = new URL(baseUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("BASE_URL must be an HTTP(S) origin");
  return { token, chatId, baseUrl: url.origin };
}

// Externally scheduled one-shot process; the HTTP server never invokes this.
if (import.meta.main) {
  let db: Database | undefined;
  try {
    const config = cronConfig();
    db = openDatabase();
    await runCron(db, config.token, config.chatId, config.baseUrl);
  } catch {
    console.error(
      "Cron failed; check configuration, database and service availability",
    );
    process.exitCode = 1;
  } finally {
    db?.close();
  }
}
