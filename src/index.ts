import "./environment";
import { openDatabase } from "./db";
import { handleRequest } from "./http";

export function parsePort(value = "8080"): number {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
    throw new Error("Invalid PORT");
  return Number(value);
}
// Return both resources to the owner; a failed listener must not leak the database.
export function startServer() {
  const port = parsePort(process.env.PORT);
  const db = openDatabase(); // Validate before opening the listener.
  try {
    const server = Bun.serve({
      port,
      fetch: (request) => handleRequest(request, db),
    });
    return { server, db };
  } catch (error) {
    db.close();
    throw error;
  }
}

// Importing opens no server/database; only the CLI owns signals and graceful shutdown.
if (import.meta.main) {
  try {
    const { server, db } = startServer();
    console.log(`Server listening on port ${server.port}`);
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      try {
        await server.stop(); // Drain active requests before closing SQLite.
      } catch {
        console.error("HTTP shutdown failed");
        process.exitCode = 1;
      } finally {
        db.close();
      }
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch {
    console.error("Server startup failed; check PORT and database");
    process.exitCode = 1;
  }
}
