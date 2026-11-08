import { expect, test } from "bun:test";
import type news from "awesome-hacker-news";
import { renderPage } from "../app/render.ts";

type Source = (typeof news.sources)[number]["items"][number];

function render(items: Source[], name = "Readers") {
  return renderPage("a > b { color: red; }", [{ name, items }]);
}

test("preserves the document, content order and trusted inline assets", async () => {
  const html = await render([
    { name: "First", url: "https://example.com/first" },
    { name: "Second", url: "http://example.com/second" },
  ]);
  expect(html).toStartWith('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><!-- awesome-hacker-news dataset license:\n');
  expect(html).toContain("<style>a > b { color: red; }</style>");
  expect(html).toContain(await Bun.file(new URL("../app/images/logo.svg", import.meta.url)).text());
  expect(html).toContain('<header class="message"><h1>Read Hacker News</h1><p>Explore Hacker News readers, apps, RSS feeds, newsletters, and command-line clients.</p></header>');
  expect(html).toContain('<main class="columns" aria-label="Hacker News directory"><div class="columns-panel"><div class="columns-panel-content"><h2>Readers</h2><ul>');
  expect(html.indexOf(">First</a>")).toBeLessThan(html.indexOf(">Second</a>"));
  expect(html).toContain('href="https://rukin.me">Phil Rukin</a>');
  expect(html).toContain('href="https://github.com/phil-r/awesome-hacker-news">Contribute directory entries</a>');
  expect(html).toEndWith("</footer></body></html>");
});

test("declares the charset within the first 1024 bytes before the full dataset license", async () => {
  const html = await render([]);
  const prefix = new TextDecoder().decode(new TextEncoder().encode(html).slice(0, 1024));
  expect(prefix).toContain('<meta charset="utf-8">');
  const license = await Bun.file(Bun.resolveSync("awesome-hacker-news/LICENSE", import.meta.dir)).text();
  expect(html).toContain(`<!-- awesome-hacker-news dataset license:\n${license}\n-->`);
  expect(html.indexOf('<meta charset="utf-8">')).toBeLessThan(html.indexOf('<!-- awesome-hacker-news dataset license:'));
});

test("includes escaped SEO metadata and viewport exactly once inside the head", async () => {
  const html = await render([]);
  const head = html.slice(html.indexOf("<head>") + 6, html.indexOf("</head>"));
  const metadata = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Hacker News Readers &amp; Apps | Read Hacker News</title>',
    '<meta name="description" content="Find Hacker News readers for web and iOS, plus RSS feeds, email newsletters, Telegram channels, and command-line clients.">',
    '<link rel="canonical" href="https://readhacker.news/">',
  ];
  for (const tag of metadata) {
    expect(head).toContain(tag);
    expect(html.split(tag)).toHaveLength(2);
  }
  expect(html.match(/<title>/g)).toHaveLength(1);
  expect(html.match(/rel="canonical"/g)).toHaveLength(1);
  expect(html).not.toContain("Readers & Apps");
  expect(html).not.toContain("<script");
});

test("renders optional authors and only GitHub source links", async () => {
  const html = await render([
    { name: "Bare", url: "https://example.com" },
    { name: "Named", url: "https://example.com", author: { name: "Writer" } },
    { name: "Linked", url: "https://example.com", author: { name: "Author", url: "http://author.example" }, source: { type: "github", url: "https://github.com/example/repo" } },
    { name: "Other", url: "https://example.com", source: { type: "other", url: "https://not-rendered.example" } },
  ]);
  expect(html).toContain(">Bare</a></li>");
  expect(html).toContain(">Named</a> by Writer</li>");
  expect(html).toContain(' by <a class="link" target="_blank" href="http://author.example">Author</a>');
  const github = await Bun.file(new URL("../app/images/github.svg", import.meta.url)).text();
  expect(html).toContain(`<a class="icon-link" aria-label="Source code for Linked" target="_blank" href="https://github.com/example/repo">${github}</a>`);
  expect(html.match(/class="icon-link"/g)).toHaveLength(1);
  expect(html).not.toContain("https://not-rendered.example");
});

test("escapes all dataset text and quoted URL attributes without normalizing URLs", async () => {
  const text = `<script>"O'Reilly" & friends</script>`;
  const url = `https://EXAMPLE.com:443/a/../b?q="'&<>`;
  const html = await render([
    { name: text, url, author: { name: text, url }, source: { type: "github", url } },
    { name: "Unlinked", url, author: { name: text } },
  ], text);
  expect(html.split(`href="${Bun.escapeHTML(url)}"`)).toHaveLength(5);
  expect(html.split(Bun.escapeHTML(text))).toHaveLength(6);
  expect(html).not.toContain(text);
  expect(html).not.toContain('href="https://example.com/b');
});

for (const url of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\nscript:alert(1)", "data:text/html,test", "ftp://example.com", "//example.com", "/relative"]) {
  test(`rejects unsafe dataset URL ${JSON.stringify(url)} in every rendered link`, async () => {
    await expect(render([{ name: "Unsafe", url }])).rejects.toThrow();
    await expect(render([{ name: "Unsafe", url: "https://example.com", author: { name: "Author", url } }])).rejects.toThrow();
    await expect(render([{ name: "Unsafe", url: "https://example.com", source: { type: "github", url } }])).rejects.toThrow();
  });
}
