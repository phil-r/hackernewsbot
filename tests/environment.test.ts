import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("env loading is project-relative, excludes mode files, and preserves external values", () => {
  // A separate module copy/process bypasses the offline preload mock without reading real .env.
  const dir = mkdtempSync(join(tmpdir(), "hnbot-env-"));
  try {
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "elsewhere"));
    copyFileSync(new URL("../src/environment.ts", import.meta.url), join(dir, "src/environment.ts"));
    writeFileSync(join(dir, ".env"), 'FROM_ROOT=root\nEXTERNAL=file\nEMPTY=file\nLITERAL="$EXTERNAL"\n');
    writeFileSync(join(dir, ".env.local"), "FROM_LOCAL=wrong\n");
    writeFileSync(join(dir, ".env.production"), "FROM_MODE=wrong\n");
    writeFileSync(join(dir, "elsewhere/.env"), "FROM_ROOT=wrong\n");
    const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", `
      await import(${JSON.stringify(pathToFileURL(join(dir, "src/environment.ts")).href)});
      console.log(JSON.stringify([process.env.FROM_ROOT, process.env.EXTERNAL,
        process.env.EMPTY, process.env.LITERAL, process.env.FROM_LOCAL, process.env.FROM_MODE]));
    `], { cwd: join(dir, "elsewhere"), env: { NODE_ENV: "production", EXTERNAL: "external", EMPTY: "" } });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual(["root", "external", "", "$EXTERNAL", null, null]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
