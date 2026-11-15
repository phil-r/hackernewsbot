import "./environment";
import type { Database } from "bun:sqlite";
import { hasStory, openDatabase } from "./db";
import { formatPost, type Story, type Post } from "./story";
import { claimDelivery, finalizeDelivery, isPending, rememberDelivery } from "./delivery";
import { AppError, runLog, type RunLog, type Stage } from "./logging";

const HN_API_URL = "https://hacker-news.firebaseio.com/v0";
const REQUEST_TIMEOUT_MS = 10_000;

// Telegram may return useful numeric diagnostics even on non-2xx responses.
async function json(url: string, init?: RequestInit, telegram = false): Promise<any> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  let body: any;
  try { body = await response.json(); }
  catch (error) {
    if (!response.ok) throw Object.assign(
      new AppError("HTTP_ERROR", "HTTP request failed", { http_status: response.status }),
      error instanceof SyntaxError ? {} : { cause: error },
    );
    if (!(error instanceof SyntaxError)) throw error;
    throw new AppError("INVALID_JSON", "Invalid JSON response", { http_status: response.status });
  }
  const details = { http_status: response.status,
    telegram_error_code: telegram ? body?.error_code : undefined,
    retry_after: telegram ? body?.parameters?.retry_after : undefined };
  if (!response.ok) throw new AppError("HTTP_ERROR", "HTTP request failed", details);
  if (telegram && (body?.ok !== true || !Number.isSafeInteger(body.result?.message_id) || body.result.message_id <= 0))
    throw new AppError(body?.ok === false ? "TELEGRAM_REJECTED" : "INVALID_RESPONSE", "Unconfirmed delivery", details);
  return body;
}

function quarantine(db: Database, log: RunLog, stage: Stage, error: unknown, id: number, messageId?: number) {
  log.counts.quarantined++;
  log.counts.failures++;
  // Log the original failure first; the committed intent survives even if this update fails.
  const diagnostic = log.failure(stage, error, id, messageId);
  try {
    const result = db.query("UPDATE pending_deliveries SET diagnostic = ? WHERE id = ?").run(JSON.stringify(diagnostic), id);
    if (result.changes !== 1) throw new AppError("DIAGNOSTIC_MISSING", "Missing delivery intent");
  } catch (updateError) { log.failure("diagnostic_update", updateError, id, messageId); }
}

async function processStories(db: Database, token: string, chatId: string, baseUrl: string, log: RunLog): Promise<void> {
  let stage: Stage = "hn_top";
  let storyId: number | undefined;
  let itemFailures = 0;
  try {
    const ids = await json(`${HN_API_URL}/topstories.json`);
    stage = "validation";
    if (!Array.isArray(ids) || !ids.every((id) => Number.isSafeInteger(id) && id > 0))
      throw new AppError("INVALID_TOP", "Invalid top stories response");
    for (const id of new Set<number>(ids)) {
      storyId = id;
      // Preclaim DB errors remain fatal, never mistaken for HN item errors.
      stage = "history";
      if (hasStory(db, id)) { log.counts.skipped++; continue; }
      stage = "pending";
      if (isPending(db, id)) { log.counts.skipped++; continue; }
      let post: Post;
      try {
        stage = "hn_item";
        const story: Story | null = await json(`${HN_API_URL}/item/${id}.json`);
        stage = "validation";
        if (!story || typeof story.score !== "number" || story.score < 150) { log.counts.skipped++; continue; }
        if (story.id !== id || typeof story.title !== "string" || !Number.isFinite(story.time) ||
            (story.url != null && typeof story.url !== "string") || (story.text != null && typeof story.text !== "string"))
          throw new AppError("INVALID_STORY", "Invalid story");
        stage = "format";
        post = formatPost(story, baseUrl);
      } catch (error) {
        log.counts.failures++; itemFailures++;
        log.failure(stage, error, id);
        continue;
      }
      // Stop at this candidate, even if another run claims it or delivery fails.
      // No network side effect until the exact post and destination commit.
      stage = "claim";
      if (!claimDelivery(db, post, chatId)) { log.counts.skipped++; break; }
      let messageId: number;
      try {
        const response = await json(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: post.message, parse_mode: "HTML",
            disable_notification: true, reply_markup: { inline_keyboard: [post.buttons] } }),
        }, true);
        messageId = response.result.message_id;
      } catch (error) {
        // Even explicit rejections require operator review; never retry automatically.
        quarantine(db, log, "telegram_send", error, id);
        break;
      }
      // Sent counts confirmed Telegram sends, even if local reconciliation is needed.
      log.counts.sent++;
      log.sent(id, messageId);
      try { rememberDelivery(db, id, messageId); }
      catch (error) { quarantine(db, log, "remember", error, id, messageId); break; }
      try { finalizeDelivery(db, id); }
      catch (error) { quarantine(db, log, "finalize", error, id, messageId); }
      break;
    }
  } catch (error) {
    log.counts.failures++;
    log.failure(stage, error, storyId);
    throw error;
  }
  if (itemFailures) throw new AppError("STORY_FAILURES", `${itemFailures} stories failed`);
}

/** One scheduled pass selects at most one eligible story in HN rank order. */
export async function runCron(db: Database, token: string, chatId: string, baseUrl: string): Promise<void> {
  const log = runLog();
  let failed = true;
  try { await processStories(db, token, chatId, baseUrl, log); failed = false; }
  finally { log.end(failed); }
}

export function cronConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID || "@hacker_news_feed";
  const baseUrl = (process.env.BASE_URL || "https://readhacker.news").replace(/\/$/, "");
  if (!token || !/^[\w:-]+$/.test(token)) throw new AppError("CONFIG_TOKEN", "TELEGRAM_BOT_TOKEN is required");
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new AppError("CONFIG_ORIGIN", "BASE_URL must be an HTTP(S) origin"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new AppError("CONFIG_ORIGIN", "BASE_URL must be an HTTP(S) origin");
  return { token, chatId, baseUrl: url.origin };
}

// Own startup and cleanup here so every event, including early failures, shares one run ID.
export async function executeCron(): Promise<void> {
  const log = runLog();
  let db: Database | undefined;
  let stage: Stage = "config";
  let failed = false;
  let original: unknown;
  try {
    const config = cronConfig();
    stage = "db_open";
    db = openDatabase({}, (error) => { log.counts.failures++; log.failure("db_close", error); });
    stage = "hn_top";
    await processStories(db, config.token, config.chatId, config.baseUrl, log);
  } catch (error) {
    failed = true; original = error;
    if (stage === "config" || stage === "db_open") { log.counts.failures++; log.failure(stage, error); }
  } finally {
    try { db?.close(); }
    catch (error) {
      log.counts.failures++; log.failure("db_close", error);
      if (!failed) { failed = true; original = error; }
    }
    log.end(failed);
  }
  if (failed) throw original;
}

if (import.meta.main) {
  try { await executeCron(); } catch { process.exitCode = 1; }
}
