import type { Database } from "bun:sqlite";
import { findUrl } from "./db";
import { decode } from "./shortener";
import { HN_ITEM_URL } from "./story";

// Exact allowlist: never turn an arbitrary URL path into a filesystem path.
const files: Record<string, string> = {
  "/": "index.html",
  "/favicon.ico": "favicon.ico",
  "/robots.txt": "robots.txt",
};
// Keep legacy paths and raw IDs listener-free; Bun route params would percent-decode IDs.
export function handleRequest(request: Request, db: Database): Response {
  const path = new URL(request.url).pathname;
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  if (Object.hasOwn(files, path))
    return new Response(
      Bun.file(new URL(`../static/${files[path]}`, import.meta.url)),
    );
  const match = /^\/(s|c)\/([^/]+)$/.exec(path);
  if (!match)
    return new Response("Sorry, Nothing at this URL.", { status: 404 });
  let id: number;
  try {
    id = decode(match[2]!);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  if (match[1] === "c")
    return Response.redirect(`${HN_ITEM_URL}${id}`, 302);
  const url = findUrl(db, id);
  // Legacy 503 allows retries when historical URL mappings are unavailable.
  if (!url)
    return new Response("<h1>Service Unavailable</h1><p>Try again later</p>", {
      status: 503,
      headers: {
        "Retry-After": "5",
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  return Response.redirect(url, 302);
}
