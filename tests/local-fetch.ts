// Loaded by the offline preload before it replaces global fetch.
const nativeFetch = globalThis.fetch;
export function localFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password)
    throw new Error("Test HTTP probes must use IPv4 loopback");
  return nativeFetch(url, { ...init, redirect: "error" });
}
