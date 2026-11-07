import { mock } from "bun:test";

// Tests must never use real credentials or reach external services.
mock.module("../src/environment", () => ({}));
globalThis.fetch = (async () => {
  throw new Error("Unexpected network request in test");
}) as unknown as typeof fetch;
