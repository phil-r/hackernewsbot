import { watch } from "node:fs";
import { join } from "node:path";

import { staticResponse } from "../src/static.ts";

async function build(): Promise<void> {
  // Fresh process per build reloads renderer modules as well as CSS and SVG inputs.
  const child = Bun.spawn([process.execPath, "--no-env-file", join(import.meta.dir, "build.ts")], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (await child.exited !== 0) throw new Error("Build failed; waiting for the next edit");
}

await build();

let timer: ReturnType<typeof setTimeout> | undefined;
let rebuilding: Promise<void> = Promise.resolve();
watch(new URL("../app/", import.meta.url), { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    rebuilding = rebuilding.then(() => build()).catch(console.error);
  }, 50);
});
console.log("Watching app/ for changes");

if (process.argv.includes("--serve")) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: Number(process.env.PORT || 9000),
    fetch(request) {
      if (request.method !== "GET" && request.method !== "HEAD")
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      return staticResponse(request) ?? new Response("Not found", { status: 404 });
    },
  });
  console.log(`Serving ${server.url} (reload the browser after changes)`);
}
