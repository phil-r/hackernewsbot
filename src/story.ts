import { decodeHTML } from "entities/decode";
import { encode } from "./shortener";

export const HN_ITEM_URL = "https://news.ycombinator.com/item?id=";
const HOT_AGE_MS = 4 * 3600_000;
const COLD_AGE_MS = 2 * 86400_000;

/** Story data fetched from the Hacker News API, before message formatting. */
export type Story = {
  id: number;
  title: string;
  score: number;
  time: number;
  url?: string;
  text?: string;
  descendants?: number;
};
/** Formatted Telegram message, buttons, and story fields ready for delivery and storage. */
export type Post = {
  id: number;
  title: string;
  text: string | null;
  message: string;
  url: string;
  shortUrl: string;
  shortHnUrl: string;
  score: number;
  buttons: { text: string; url: string }[];
};

// Escape decoded title text so source entities never become Telegram markup.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// HN bodies contain HTML: keep Telegram-supported markup, unlike plain-text titles.
function storyText(text: string): string {
  return text
    .replace(
      /<a\s+((?:[^"'<>]|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a>/gi,
      (_, attributes: string, body: string) => {
        // Read whole attributes so href-like text inside another value stays inert.
        const href = [...attributes.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|[^\s"'=<>`]+))?/g)]
          .find((attribute) => attribute[1]!.toLowerCase() === "href");
        const url = href?.[2] ?? href?.[3];
        if (url === undefined) return body;
        // Preserve existing entities; only escape literal attribute delimiters.
        return `<a href="${url.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}">${body}</a>`;
      },
    )
    .replace(/<p>/gi, "\n")
    .replace(/<\/p>/gi, "")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2f;/gi, "/")
    .replace(
      /<(?!\/?(?:b|strong|i|em|u|s|strike|del|code|pre)(?:\s|>)|a\s+href=(?:"[^"]*"|'[^']*')\s*>|\/a>)[^>]*>/gi,
      "",
    );
}

// Preserve published age wording: positive elapsed time intentionally says "in …".
function legacyAge(elapsed: number): string {
  const seconds = Math.trunc(elapsed / 1000);
  const future = seconds > 0;
  let count = Math.abs(seconds);
  let unit = 0;
  const divisors = [60, 60, 24, 7, 365 / 7 / 12, 12];
  while (unit < divisors.length && count >= divisors[unit]!) {
    count /= divisors[unit]!;
    unit++;
  }
  count = Math.floor(count);
  if (unit === 0 && count < 10) return future ? "a while" : "just now";
  const name = ["second", "minute", "hour", "day", "week", "month", "year"][unit];
  const duration = `${count} ${name}${count === 1 ? "" : "s"}`;
  return future ? `in ${duration}` : `${duration} ago`;
}

// External stories have article and discussion links; self posts share the discussion URL.
export function formatPost(
  story: Story,
  baseUrl: string,
  now = Date.now(),
): Post {
  const id = encode(story.id);
  const hnUrl = `${HN_ITEM_URL}${story.id}`;
  const shortHnUrl = `${baseUrl}/c/${id}`;
  const shortUrl = story.url ? `${baseUrl}/s/${id}` : shortHnUrl;
  const elapsed = now - story.time * 1000;
  const ago = legacyAge(elapsed);
  // Hot and cold markers include the exact age boundaries.
  const status =
    elapsed <= HOT_AGE_MS ? "🔥 " : elapsed >= COLD_AGE_MS ? "❄️ " : "";
  let message = `<b>${escapeHtml(decodeHTML(story.title))}</b> (${status}Score: ${story.score}+ ${ago})\n\n<b>Link:</b> ${shortUrl}\n`;
  const buttons: Post["buttons"] = [];
  if (story.url) {
    message += `<b>Comments:</b> ${shortHnUrl}\n`;
    buttons.push({ text: "Read", url: story.url });
  }
  buttons.push({ text: `${story.descendants ?? 0}+ Comments`, url: hnUrl });
  if (story.text) message += `\n${storyText(story.text)}\n`;
  return {
    id: story.id,
    title: story.title,
    text: story.text ?? null,
    message,
    url: story.url || hnUrl,
    shortUrl,
    shortHnUrl,
    score: story.score,
    buttons,
  };
}
