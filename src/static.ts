// Exact allowlist: never turn an arbitrary URL path into a filesystem path.
const files: Record<string, [string, string]> = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/favicon.ico": ["favicon.ico", "image/x-icon"],
  "/robots.txt": ["robots.txt", "text/plain; charset=utf-8"],
  "/sitemap.xml": ["sitemap.xml", "application/xml; charset=utf-8"],
};

export function staticResponse(request: Request): Response | undefined {
  const path = new URL(request.url).pathname;
  if (!Object.hasOwn(files, path)) return;
  const [name, type] = files[path]!;
  const file = Bun.file(new URL(`../static/${name}`, import.meta.url));
  return new Response(request.method === "HEAD" ? null : file, {
    headers: { "Content-Type": type, "Content-Length": String(file.size) },
  });
}
