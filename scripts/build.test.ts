import { afterAll, expect, spyOn, test } from "bun:test";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import news from "awesome-hacker-news";
import { build } from "./build.ts";

const outdir = await mkdtemp(join(tmpdir(), "readhn-build-test-"));
afterAll(() => rm(outdir, { recursive: true, force: true }));

test("renders every source, inline styles, SVGs and the unchanged favicon", async () => {
  await build({ outdir, origin: "https://readhacker.news" });
  const html = await Bun.file(join(outdir, "index.html")).text();
  const css = (await Bun.file(join(outdir, "index.html")).text()).split("<style>")[1]!.split("</style>")[0]!;
  expect(html).toContain("<title>Hacker News Readers &amp; Apps | Read Hacker News</title>");
  expect(html).toContain('<link rel="canonical" href="https://readhacker.news/">');
  expect(html).toContain(`<style>${css}</style>`);
  expect(html.match(/<h2>/g)).toHaveLength(news.sources.length);
  expect(html.match(/<li>/g)).toHaveLength(news.sources.reduce((count, group) => count + group.items.length, 0));
  for (const group of news.sources) {
    expect(html).toContain(`<h2>${Bun.escapeHTML(group.name)}</h2>`);
    for (const source of group.items) {
      if (source.url !== undefined) expect(html).toContain(`href="${Bun.escapeHTML(source.url)}"`);
      else {
        expect(html).toContain(`${Bun.escapeHTML(source.name)}: ${Bun.escapeHTML(source.textReference)}`);
        expect(html).not.toContain(`href="${Bun.escapeHTML(source.textReference)}"`);
      }
      expect(html).toContain(Bun.escapeHTML(source.name));
      if (source.author) expect(html).toContain(Bun.escapeHTML(source.author.name));
    }
  }
  expect(html).toContain('class="logo"');
  expect(html).toContain('class="icon"');
  expect(html).toContain("Contribute directory entries");
  expect(html).not.toContain("<script");
  expect(css).toContain(".columns-panel");
  expect(css).toContain(".icon-link");
  expect(css).not.toContain("@import");
  expect(css).not.toContain("$white");
  expect(await Bun.file(join(outdir, "favicon.ico")).bytes())
    .toEqual(await Bun.file(new URL("../app/images/favicon.ico", import.meta.url)).bytes());
});

test("clean development and production builds emit real crawl files at MIME-ready paths", async () => {
  for (const production of [false, true]) {
    await rm(outdir, { recursive: true, force: true });
    await build({ outdir, production, origin: "https://readhacker.news" });
    const robots = Bun.file(join(outdir, "robots.txt"));
    expect(robots.type).toStartWith("text/plain");
    expect(await robots.text()).toBe(
      "User-agent: *\nAllow: /\n\nSitemap: https://readhacker.news/sitemap.xml\n",
    );
    const sitemap = Bun.file(join(outdir, "sitemap.xml"));
    expect(sitemap.type).toMatch(/^(application|text)\/xml/);
    expect(await sitemap.text()).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      '  <url><loc>https://readhacker.news/</loc></url>\n</urlset>\n',
    );
    expect(await Bun.file(join(outdir, "third-party-licenses.txt")).exists()).toBe(false);
    const html = await Bun.file(join(outdir, "index.html")).text();
    const license = await Bun.file(Bun.resolveSync("awesome-hacker-news/LICENSE", import.meta.dir)).text();
    expect(html).toContain(`<!-- awesome-hacker-news dataset license:\n${license}\n-->`);
    expect(license).toContain("Copyright (c) 2017-2018 Phil Rukin");
    expect(license).toContain("Permission is hereby granted");
    expect(html).toContain('<!-- GitHub icon: Font Awesome (https://fontawesome.com/), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); SVG CSS and ARIA attributes modified. -->');
    expect(html).not.toContain("<small>GitHub icon:");
    expect(html).toContain("SVG CSS and ARIA attributes modified");
    expect(html).toContain("Font Awesome Free");
    expect(html).not.toContain("third-party-licenses.txt");
    expect(html).not.toContain("<script");
    expect(await robots.text()).not.toBe(html);
    expect(await sitemap.text()).not.toContain("<lastmod>");
  }
});

test("rejects missing CSS output before writing existing output", async () => {
  const sentinel = join(outdir, "keep.txt");
  await Bun.write(sentinel, "keep");
  const buildMock = spyOn(Bun, "build").mockResolvedValue({
    success: true, outputs: [], logs: [],
  });
  try {
    await expect(build({ outdir, origin: "https://readhacker.news" })).rejects.toThrow("CSS build produced no CSS output");
    expect(await Bun.file(sentinel).text()).toBe("keep");
  } finally {
    buildMock.mockRestore();
  }
});

test("unsafe dataset links fail the build before writing existing output", async () => {
  const source = news.sources[0]?.items[0];
  if (!source || source.url === undefined) throw new Error("Expected a dataset source");
  const originalURL = source.url;
  const sentinel = join(outdir, "keep.txt");
  await Bun.write(sentinel, "keep");
  source.url = "javascript:alert(1)";
  try {
    await expect(build({ outdir, origin: "https://readhacker.news" })).rejects.toThrow("Unsafe dataset URL");
    expect(await Bun.file(sentinel).text()).toBe("keep");
  } finally {
    source.url = originalURL;
  }
});

test("production builds minify CSS without deleting unrelated files", async () => {
  await build({ outdir, origin: "https://readhacker.news" });
  const developmentCSS = (await Bun.file(join(outdir, "index.html")).text()).split("<style>")[1]!.split("</style>")[0]!;
  await Bun.write(join(outdir, "bundle.js"), "stale webpack output");
  await build({ production: true, outdir, origin: "https://readhacker.news" });
  const css = (await Bun.file(join(outdir, "index.html")).text()).split("<style>")[1]!.split("</style>")[0]!;
  expect(css.length).toBeLessThan(developmentCSS.length);
  expect(css).toContain("1500px");
  expect(css).toContain("1023px");
  expect(css).toContain("500px");
  expect(css).toContain(".logo:hover");
  expect(await Bun.file(join(outdir, "bundle.js")).text()).toBe("stale webpack output");
});

test("fork canonical origin changes all SEO outputs without using bot BASE_URL", async () => {
  const old = process.env.BASE_URL;
  process.env.BASE_URL = "https://shortlinks.example";
  try {
    await build({ outdir, origin: "https://fork.example:8443" });
    const html = await Bun.file(join(outdir, "index.html")).text();
    expect(html).toContain('<link rel="canonical" href="https://fork.example:8443/">');
    expect(html).toContain('<meta property="og:url" content="https://fork.example:8443/">');
    expect(html).not.toContain("shortlinks.example");
    expect(await Bun.file(join(outdir, "robots.txt")).text()).toContain("https://fork.example:8443/sitemap.xml");
    expect(await Bun.file(join(outdir, "sitemap.xml")).text()).toContain("<loc>https://fork.example:8443/</loc>");
    for (const origin of ["", "javascript:alert(1)", "https://user:pass@example.com", "https://example.com/path", "https://example.com?q=x", "https://example.com#", "//example.com"]) {
      await expect(build({ outdir, origin })).rejects.toThrow();
      expect(await Bun.file(join(outdir, "index.html")).text()).toBe(html);
    }
  } finally {
    if (old === undefined) delete process.env.BASE_URL;
    else process.env.BASE_URL = old;
  }
});

test("standalone CLI builds without bot configuration and ignores project and mode env files", async () => {
  const root = join(import.meta.dir, "..");
  const dir = await mkdtemp(join(tmpdir(), "readhn-cli-test-"));
  try {
    for (const name of ["app"])
      await cp(join(root, name), join(dir, name), { recursive: true });
    await cp(join(root, "scripts/build.ts"), join(dir, "scripts/build.ts"));
    await symlink(join(root, "node_modules"), join(dir, "node_modules"));
    // Were any of these auto-loaded, canonical validation would fail.
    for (const name of [".env", ".env.local", ".env.production"])
      await Bun.write(join(dir, name), "SITE_ORIGIN=not-a-url\n");
    const result = Bun.spawnSync([process.execPath, "--no-env-file", join(dir, "scripts/build.ts"), "--production"], {
      cwd: dir, env: { NODE_ENV: "production", SITE_ORIGIN: "https://cli.example" },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    expect(await Bun.file(join(dir, "static/index.html")).text()).toContain('href="https://cli.example/"');
    // No external origin: still must not read .env, and no bot config is present.
    const defaults = Bun.spawnSync([process.execPath, "--no-env-file", join(dir, "scripts/build.ts")], {
      cwd: dir, env: { NODE_ENV: "production" },
    });
    expect(defaults.exitCode).toBe(0);
    expect(await Bun.file(join(dir, "static/index.html")).text()).toContain('href="https://readhacker.news/"');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
