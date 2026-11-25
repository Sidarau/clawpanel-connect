import { afterEach, expect, test, vi } from "vitest";
import { runSquare } from "../src/square.js";

const id = "b530e8c6-fc21-4324-9bc0-38164c1c47ae";

afterEach(() => vi.unstubAllGlobals());

test("searches published topics without sending credentials or following redirects", async () => {
  const fetch = vi.fn(async () => Response.json({ topics: [] }));
  vi.stubGlobal("fetch", fetch);
  expect(await runSquare({ query: " release + review " })).toEqual({ topics: [] });
  expect(fetch).toHaveBeenCalledWith(new URL("https://clawpanel.app/api/square?q=release+%2B+review"), {
    headers: { Accept: "application/json" }, redirect: "error", signal: expect.any(AbortSignal),
  });
});

test("handles removed topics and validates identifiers without a request", async () => {
  const fetch = vi.fn(async () => Response.json({ error: "topic_not_found" }, { status: 404 }));
  vi.stubGlobal("fetch", fetch);
  await expect(runSquare({ id: "private/path" })).rejects.toThrow("UUID");
  await expect(runSquare({ apiUrl: "https://key@example.com" })).rejects.toThrow("without credentials");
  expect(fetch).not.toHaveBeenCalled();
  await expect(runSquare({ id })).rejects.toThrow("published topic is unavailable");
});
