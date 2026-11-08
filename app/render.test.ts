import { expect, test } from "bun:test";
import news from "awesome-hacker-news";
import { renderPage } from "./render.ts";

type Source = typeof news.sources[number]["items"][number];
const render = (entry: Source) => renderPage("", [{ name: "Test", items: [entry] }]);

test("renders the published active dataset, including Gopher, without graveyard entries", async () => {
  const html = await renderPage("", news.sources);
  expect(html.match(/<h2>/g)).toHaveLength(news.sources.length);
  expect(html.match(/<li>/g)).toHaveLength(news.sources.reduce((count, group) => count + group.items.length, 0));
  expect(html).toContain("HN Gopher: gopher://hngopher.com/1</li>");
  expect(html).not.toContain('href="gopher:');
  expect(html).not.toContain("TiledHN");
  expect(html).not.toContain("graveyard");
});

test("text references and names are escaped plain text, never anchors", async () => {
  const name = '<img src=x onerror="alert(1)"> &';
  const textReference = 'gopher://example/<script>"&';
  const html = await render({ name, textReference });
  expect(html).toContain(`<li>${Bun.escapeHTML(name)}: ${Bun.escapeHTML(textReference)}</li>`);
  expect(html).not.toContain(`<img src=x`);
  expect(html).not.toContain(`href="${Bun.escapeHTML(textReference)}"`);
});

test("actual links still require HTTP(S), including author and repository URLs", async () => {
  for (const url of ["javascript:alert(1)", "data:text/html,unsafe", "gopher://example/1", "not a URL"]) {
    await expect(render({ name: "Bad", url })).rejects.toThrow();
    await expect(render({ name: "Bad", textReference: "safe text", url } as unknown as Source)).rejects.toThrow();
    await expect(render({ name: "Bad", url: "https://example.com", author: { name: "Bad", url } })).rejects.toThrow();
    await expect(render({ name: "Bad", textReference: "safe text", source: { type: "github", url } })).rejects.toThrow();
  }
});

test("broken entries fail rather than disappearing or falling back to text", async () => {
  await expect(render({ name: "Missing" } as Source)).rejects.toThrow("Missing dataset URL or text reference");
  await expect(render({ name: "Broken", url: undefined, textReference: "fallback" } as unknown as Source)).rejects.toThrow();
});
