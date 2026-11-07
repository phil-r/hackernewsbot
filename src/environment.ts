import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// Load only project-root .env regardless of CWD; external values (even empty) win.
// Bun auto-loading includes local/mode files and expands variables; parseEnv does neither.
const path = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(path)) {
  const parsed = parseEnv(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
