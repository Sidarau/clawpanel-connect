import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConnect } from "../src/connect.js";
import { parseArgs } from "../src/cli.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clawpanel-connect-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("runConnect", () => {
  it("writes .mcp.json with a local stdio config by default", async () => {
    const result = await runConnect({ workspaceDir: dir, hosted: false, print: false });
    expect(result.writtenTo).toBe(join(dir, ".mcp.json"));
    const raw = await readFile(join(dir, ".mcp.json"), "utf8");
    const parsed = JSON.parse(raw) as { mcpServers: Record<string, unknown> };
    expect(parsed.mcpServers.clawpanel).toBeDefined();
    const entry = parsed.mcpServers.clawpanel as { command?: string };
    expect(entry.command).toBe("npx");
  });

  it("writes a hosted config when --hosted with a token", async () => {
    const result = await runConnect({
      workspaceDir: dir,
      hosted: true,
      token: "tok-abc",
      print: false,
    });
    expect(result.writtenTo).toBe(join(dir, ".mcp.json"));
    const raw = await readFile(join(dir, ".mcp.json"), "utf8");
    const parsed = JSON.parse(raw) as { mcpServers: Record<string, { type?: string; headers?: Record<string, string> }> };
    expect(parsed.mcpServers.clawpanel?.type).toBe("http");
    expect(parsed.mcpServers.clawpanel?.headers?.Authorization).toBe("Bearer tok-abc");
  });

  it("prints JSON without writing a file when --print", async () => {
    const result = await runConnect({ workspaceDir: dir, hosted: false, print: true });
    expect(result.writtenTo).toBeUndefined();
    expect(result.config.mcpServers.clawpanel).toBeDefined();
  });

  it("honors --output", async () => {
    const out = join(dir, "custom.json");
    const result = await runConnect({
      workspaceDir: dir,
      hosted: false,
      print: false,
      outputFile: out,
    });
    expect(result.writtenTo).toBe(out);
    await expect(readFile(out, "utf8")).resolves.toContain("mcpServers");
  });
});

describe("parseArgs", () => {
  it("parses command + flags, both syntaxes", () => {
    const { command, flags } = parseArgs([
      "connect",
      "--hosted",
      "--token",
      "abc",
      "--api-url=https://x.app",
      "--print",
    ]);
    expect(command).toBe("connect");
    expect(flags.hosted).toBe(true);
    expect(flags.token).toBe("abc");
    expect(flags["api-url"]).toBe("https://x.app");
    expect(flags.print).toBe(true);
  });

  it("treats -v as version and -h as help", () => {
    expect(parseArgs(["-v"]).flags.version).toBe(true);
    expect(parseArgs(["-h"]).flags.help).toBe(true);
  });
});
