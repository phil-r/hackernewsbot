import { resolve, join } from "node:path";
import { renderPage } from "../app/render.ts";
import { siteCanonicalURL } from "../app/seo.ts";
import news from "awesome-hacker-news";

const root = resolve(import.meta.dir, "..");
export const outputDir = join(root, "static");

interface BuildOptions {
  production?: boolean;
  outdir?: string;
  origin?: string;
}

export async function build({ production = false, outdir = outputDir, origin = process.env.SITE_ORIGIN }: BuildOptions = {}): Promise<void> {
  const canonicalURL = siteCanonicalURL(origin);
  const result = await Bun.build({
    entrypoints: [join(root, "app/styles/index.css")],
    minify: production,
  });
  if (!result.success) throw new AggregateError(result.logs, "CSS build failed");
  const cssOutput = result.outputs.find(file => file.path.endsWith(".css"));
  if (!cssOutput) throw new Error("CSS build produced no CSS output");
  const css = await cssOutput.text();
  const html = await renderPage(css, news.sources, canonicalURL);

  // Only write generated filenames; never recursively delete a deployment directory.
  await Promise.all([
    Bun.write(join(outdir, "index.html"), html),
    Bun.write(join(outdir, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${canonicalURL}sitemap.xml\n`),
    Bun.write(join(outdir, "sitemap.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      `  <url><loc>${Bun.escapeHTML(canonicalURL)}</loc></url>\n</urlset>\n`),
    // Copy bytes rather than BunFile: Bun's macOS file-copy fast path can emit
    // a change event for the source, spuriously triggering a running dev build.
    Bun.write(join(outdir, "favicon.ico"), await Bun.file(join(root, "app/images/favicon.ico")).bytes()),
  ]);
  console.log(`Built ${outdir}${production ? " (production)" : ""}`);
}

if (import.meta.main) {
  await build({ production: process.argv.includes("--production") });
}
