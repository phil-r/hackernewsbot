import type news from "awesome-hacker-news";
import { siteCanonicalURL, description, title } from "./seo.ts";

type Sources = typeof news.sources;
type Source = Sources[number]["items"][number];

function href(url: string): string {
  const { protocol } = new URL(url);
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`Unsafe dataset URL: ${url}`);
  }
  // Validate the scheme without normalizing the dataset's original URL.
  return Bun.escapeHTML(url);
}

function sourceLink(source: Source, github: string): string {
  const repository = source.source?.type === "github"
    ? `<a class="icon-link" aria-label="Source code for ${Bun.escapeHTML(source.name)}" target="_blank" href="${href(source.source.url)}">${github}</a>`
    : "";
  const author = source.author
    ? ` by ${source.author.url
      ? `<a class="link" target="_blank" href="${href(source.author.url)}">${Bun.escapeHTML(source.author.name)}</a>`
      : Bun.escapeHTML(source.author.name)}`
    : "";
  if (!("url" in source) && typeof source.textReference !== "string") {
    throw new Error("Missing dataset URL or text reference");
  }
  const name = Bun.escapeHTML(source.name);
  const entry = "url" in source
    ? `<a class="link" target="_blank" href="${href(source.url!)}">${name}</a>`
    : `${name}: ${Bun.escapeHTML(source.textReference)}`;
  return `<li>${entry}${repository}${author}</li>`;
}

export async function renderPage(css: string, sources: Sources, canonicalURL = siteCanonicalURL()): Promise<string> {
  const [logo, github, datasetLicense] = await Promise.all([
    Bun.file(new URL("./images/logo.svg", import.meta.url)).text(),
    Bun.file(new URL("./images/github.svg", import.meta.url)).text(),
    Bun.file(Bun.resolveSync("awesome-hacker-news/LICENSE", import.meta.dir)).text(),
  ]);
  const groups = sources.map(group =>
    `<div class="columns-panel"><div class="columns-panel-content">` +
    `<h2>${Bun.escapeHTML(group.name)}</h2><ul>` +
    group.items.map(source => sourceLink(source, github)).join("") +
    `</ul></div></div>`
  ).join("");

  // CSS and local SVG files are trusted build inputs, not dataset text.
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><!-- awesome-hacker-news dataset license:
${datasetLicense}
-->` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${Bun.escapeHTML(title)}</title>` +
    `<meta name="description" content="${Bun.escapeHTML(description)}">` +
    `<link rel="canonical" href="${Bun.escapeHTML(canonicalURL)}">` +
    `<meta property="og:title" content="${Bun.escapeHTML(title)}">` +
    `<meta property="og:description" content="${Bun.escapeHTML(description)}">` +
    `<meta property="og:url" content="${Bun.escapeHTML(canonicalURL)}">` +
    `<meta property="og:type" content="website">` +
    `<meta name="twitter:card" content="summary">` +
    `<meta name="twitter:title" content="${Bun.escapeHTML(title)}">` +
    `<meta name="twitter:description" content="${Bun.escapeHTML(description)}">` +
    `<style>${css}</style></head><body>${logo}` +
    `<header class="message"><h1>Read Hacker News</h1>` +
    `<p>Explore Hacker News readers, apps, RSS feeds, newsletters, and command-line clients.</p></header>` +
    `<main class="columns" aria-label="Hacker News directory">${groups}</main>` +
    `<footer>Created by <a class="link" target="_blank" href="https://rukin.me">Phil Rukin</a> <br>` +
    `<a class="link" target="_blank" href="https://github.com/phil-r/awesome-hacker-news">Contribute directory entries</a> · ` +
    `<a class="link" href="https://github.com/phil-r/hackernewsbot">Website source</a>` +
    `<!-- GitHub icon: Font Awesome (https://fontawesome.com/), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); SVG CSS and ARIA attributes modified. -->` +
    `</footer></body></html>`;
}
