// Build-only origin, deliberately independent of the bot's BASE_URL and .env loader.
export function siteCanonicalURL(origin = "https://readhacker.news"): string {
  const url = new URL(origin);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash || /[?#]/.test(origin)) {
    throw new Error("SITE_ORIGIN must be an HTTP(S) origin without credentials, path, query or fragment");
  }
  return url.href;
}
export const title = "Hacker News Readers & Apps | Read Hacker News";
export const description = "Find Hacker News readers for web and iOS, plus RSS feeds, email newsletters, Telegram channels, and command-line clients.";
