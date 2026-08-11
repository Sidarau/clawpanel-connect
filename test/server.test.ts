import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createWorkspaceServer, TOOL_NAMES } from "../src/mcp/server.js";

/**
 * Extract joined text from a tool result. Accepts `unknown` on purpose:
 * the SDK's callTool return type carries a `[x: string]: unknown` index
 * signature, which breaks plain property access.
 */
function textOf(result: unknown): string {
  if (!result || typeof result !== "object" || !("content" in result)) return "";
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : ""))
    .join("");
}

let dir: string;
let client: Client;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clawpanel-server-"));
  const server = createWorkspaceServer({ workspaceDir: dir, runCap: 3 });
  client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterEach(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

describe("MCP server", () => {
  it("lists the expected tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(Object.values(TOOL_NAMES).sort());
  });

  it("returns workspace status with free-tier info", async () => {
    const result = await client.callTool({ name: TOOL_NAMES.status, arguments: {} });
    const text = textOf(result);
    expect(text).toContain(dir);
    expect(text).toContain('"tier": "free"');
  });

  it("appends and reads a note", async () => {
    await client.callTool({
      name: TOOL_NAMES.noteAppend,
      arguments: { name: "decisions.md", content: "Use MCP as the integration boundary." },
    });
    const read = await client.callTool({
      name: TOOL_NAMES.noteRead,
      arguments: { name: "decisions.md" },
    });
    const text = textOf(read);
    expect(text).toContain("MCP as the integration boundary");
  });

  it("rejects path traversal in note names", async () => {
    const result = await client.callTool({
      name: TOOL_NAMES.noteRead,
      arguments: { name: "../secret.md" },
    });
    expect(result.isError).toBe(true);
  });

  it("enforces the free-tier run cap", async () => {
    for (let i = 0; i < 3; i += 1) {
      const ok = await client.callTool({ name: TOOL_NAMES.runConsume, arguments: {} });
      expect(ok.isError).toBeFalsy();
    }
    const over = await client.callTool({ name: TOOL_NAMES.runConsume, arguments: {} });
    expect(over.isError).toBe(true);
    const status = await client.callTool({ name: TOOL_NAMES.runStatus, arguments: {} });
    const text = textOf(status);
    expect(text).toContain('"remaining": 0');
  });
});
