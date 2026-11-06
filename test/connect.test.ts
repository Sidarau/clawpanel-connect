import { mkdtemp, readFile, rm, writeFile, stat, symlink } from "node:fs/promises";
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
      runtimeKey: "runtime-abc",
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

describe("config file safety", () => {
  const hosted = { hosted: true, token: "fixture-token", runtimeKey: "fixture-key", print: false };
  it("creates private credential files", async () => {
    const result = await runConnect({ ...hosted, workspaceDir: dir });
    expect((await stat(result.writtenTo!)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(result.writtenTo!, "utf8")).mcpServers.clawpanel.headers["x-runtime-key"]).toBe("fixture-key");
  });
  it.each(['{"mcpServers":{"other":{"command":"other"}}}', '{invalid', '{"mcpServers":{"clawpanel":{"command":"original"}}}'])("preserves an existing file byte for byte", async (original) => {
    const path = join(dir, ".mcp.json");
    await writeFile(path, original, { mode: 0o644 });
    await expect(runConnect({ ...hosted, workspaceDir: dir })).rejects.toThrow(/already exists/);
    expect(await readFile(path, "utf8")).toBe(original);
    expect((await stat(path)).mode & 0o777).toBe(0o644);
  });
  it("does not follow output symlinks", async () => {
    const target = join(dir, "target");
    await writeFile(target, "untouched");
    await symlink(target, join(dir, ".mcp.json"));
    await expect(runConnect({ ...hosted, workspaceDir: dir })).rejects.toThrow(/already exists/);
    expect(await readFile(target, "utf8")).toBe("untouched");
  });
  it("does not create a file when runtime key validation fails", async () => {
    await expect(runConnect({ ...hosted, runtimeKey: "", workspaceDir: dir })).rejects.toThrow(/runtime-key/);
    await expect(stat(join(dir, ".mcp.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("parses runtime-key in both supported syntaxes", () => {
    expect(parseArgs(["connect", "--runtime-key", "fixture-key"]).flags["runtime-key"]).toBe("fixture-key");
    expect(parseArgs(["connect", "--runtime-key=fixture-key"]).flags["runtime-key"]).toBe("fixture-key");
  });
});

it.each(["token", "runtime-key"])("rejects explicit valueless --%s instead of falling back to environment", (flag) => {
  expect(() => parseArgs(["connect", `--${flag}`])).toThrow("requires a value");
  expect(() => parseArgs(["connect", `--${flag}`, "--print"])).toThrow("requires a value");
});
