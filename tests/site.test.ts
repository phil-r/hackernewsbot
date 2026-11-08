import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import news from "awesome-hacker-news";
import { siteCanonicalURL } from "../app/seo.ts";
import { handleRequest } from "../src/http";
import { localFetch } from "./local-fetch";

// package test/CI build first; these are real release bytes, not renderer fixtures.
test("generated site is delivered through the production handler with exact GET/HEAD assets", async () => {
  const db = new Database(":memory:");
  try {
    const request = (path: string, method = "GET") => handleRequest(new Request(`http://localhost${path}`, { method }), db);
    for (const [path, filename, mime] of [
      ["/", "index.html", "text/html"],
      ["/robots.txt", "robots.txt", "text/plain"],
      ["/sitemap.xml", "sitemap.xml", "application/xml"],
      ["/favicon.ico", "favicon.ico", "image/x-icon"],
    ]) {
      const expected = await Bun.file(new URL(`../static/${filename}`, import.meta.url)).bytes();
      const response = request(path!);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toStartWith(mime!);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(expected);
      const head = request(path!, "HEAD");
      expect(head.status).toBe(200);
      expect(head.headers.get("content-type")).toBe(response.headers.get("content-type"));
      expect(head.headers.get("content-length")).toBe(String(expected.length));
      expect(await head.text()).toBe("");
      const post = request(path!, "POST");
      expect(post.status).toBe(405);
      expect(post.headers.get("allow")).toBe("GET, HEAD");
    }
    const html = await request("/").text();
    const canonicalURL = siteCanonicalURL(process.env.SITE_ORIGIN);
    expect(html).toContain(`<link rel="canonical" href="${Bun.escapeHTML(canonicalURL)}">`);
    expect(html).toContain(`<meta property="og:url" content="${Bun.escapeHTML(canonicalURL)}">`);
    expect(html).toContain('<meta name="twitter:card" content="summary">');
    expect(html).not.toContain("og:image");
    expect(html).not.toContain("twitter:image");
    expect(html).toContain('<main id="directory" class="columns"');
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain('https://github.com/phil-r/hackernewsbot');
    expect(html).toContain('https://github.com/phil-r/awesome-hacker-news');
    expect(html).toContain('aria-label="Source code for ');
    expect(html).not.toContain('<script');
    for (const group of news.sources) for (const entry of group.items) {
      if (entry.url !== undefined) expect(html).toContain(`href="${Bun.escapeHTML(entry.url)}"`);
      else expect(html).toContain(`${Bun.escapeHTML(entry.name)}: ${Bun.escapeHTML(entry.textReference)}`);
    }
    expect(await request('/robots.txt').text()).toContain(`Sitemap: ${canonicalURL}sitemap.xml`);
    const sitemap = await request('/sitemap.xml').text();
    expect(sitemap.match(/<loc>/g)).toHaveLength(1);
    expect(sitemap).toContain(`<loc>${Bun.escapeHTML(canonicalURL)}</loc>`);
    expect(sitemap).not.toContain('lastmod');
    const license = await Bun.file(Bun.resolveSync("awesome-hacker-news/LICENSE", import.meta.dir)).text();
    expect(html).toContain(`<!-- awesome-hacker-news dataset license:\n${license}\n-->`);
    expect(html).toContain('<!-- GitHub icon: Font Awesome (https://fontawesome.com/), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); SVG CSS and ARIA attributes modified. -->');
    expect(html).not.toContain("<small>GitHub icon:");
    expect(html).not.toContain("third-party-licenses.txt");
    for (const path of ['/third-party-licenses.txt', '/index.html', '/cron', '/missing', '/styles.css', '/app/render.ts', '/.env', '/data.sqlite', '/%2e%2e/.env', '/%2Frobots.txt', '/robots.txt/extra', '/sitemap.xml/', '/toString', '/__proto__']) {
      expect(request(path).status).toBe(404);
      expect(request(path, 'HEAD').status).toBe(404);
    }
  } finally {
    db.close();
  }
});

test("test network escape hatch rejects external URLs and credentials", () => {
  for (const url of ['https://example.com', 'http://localhost:9000', 'http://user:pass@127.0.0.1:9000'])
    expect(() => localFetch(url)).toThrow('loopback');
});
