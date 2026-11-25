import { Readable } from "node:stream";
import { API_URL_DEFAULT, apiOrigin } from "./config.js";
import { readJsonObject } from "./task.js";

const publicTopicId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function runSquare(opts: { apiUrl?: string; id?: string; query?: string }) {
  const query = opts.query?.trim() ?? "";
  if (opts.id !== undefined && !publicTopicId.test(opts.id)) throw new Error("Use the UUID from a Public Square topic link.");
  if (query.length > 120) throw new Error("Use a Public Square search of up to 120 characters.");
  const url = new URL("/api/square", apiOrigin(opts.apiUrl ?? API_URL_DEFAULT));
  if (opts.id) url.searchParams.set("topic", opts.id);
  if (query) url.searchParams.set("q", query);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  }).catch(() => { throw new Error("Public Square could not be reached."); });
  if (response.status === 404 && opts.id) throw new Error("The published topic is unavailable.");
  if (!response.ok || !response.body) throw new Error(`Public Square returned HTTP ${response.status}.`);
  const data = await readJsonObject(Readable.fromWeb(response.body), "The Public Square response", 2048)
    .catch(() => { throw new Error("Public Square returned an invalid response."); });
  if (opts.id ? !("topic" in (data as object)) : !Array.isArray((data as { topics?: unknown }).topics)) {
    throw new Error("Public Square returned an invalid response.");
  }
  return data;
}
