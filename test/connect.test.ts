import { mkdtemp, readFile, rm, writeFile, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConnect, runTomlConnect } from "../src/connect.js";
import { WORK_RUN_ENV } from "../src/config.js";
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

describe("Codex project config", () => {
  const localEntry = { node: "/opt/ClawPanel Tools/node", cli: "/opt/ClawPanel Tools/cli.js" };
  const local = { hosted: false, print: false, localEntry };

  it("uses the installed CLI and the selected folder", async () => {
    const result = await runTomlConnect({ ...local, workspaceDir: dir }, "codex");
    expect(result.writtenTo).toBe(join(dir, ".codex", "config.toml"));
    expect(result.content).toBe([
      "[mcp_servers.clawpanel]",
      'command = "/opt/ClawPanel Tools/node"',
      'args = ["/opt/ClawPanel Tools/cli.js", "serve"]',
      `env = { CLAWPANEL_WORKSPACE = ${JSON.stringify(dir)} }`,
      "",
    ].join("\n"));
    expect(await readFile(result.writtenTo!, "utf8")).toBe(result.content);
  });

  it("declares hosted credential references without writing values", async () => {
    const result = await runTomlConnect({ workspaceDir: dir, hosted: true, print: true }, "codex");
    expect(result.content).toBe([
      "[mcp_servers.clawpanel]",
      'url = "https://clawpanel.app/api/mcp"',
      'bearer_token_env_var = "CLAWPANEL_TOKEN"',
      'env_http_headers = { "x-runtime-key" = "CLAWPANEL_RUNTIME_KEY" }',
      "",
    ].join("\n"));
    expect(result.writtenTo).toBeUndefined();
    await expect(stat(join(dir, ".codex"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(runTomlConnect({
      workspaceDir: dir, hosted: true, print: false, token: "fixture-token", runtimeKey: "fixture-key",
    }, "codex")).rejects.toThrow(/Omit credential flags/);
    await expect(runTomlConnect({
      workspaceDir: dir, hosted: true, print: true, apiUrl: "https://clawpanel.app/other/path",
    }, "codex")).rejects.toThrow(/HTTPS origin/);
  });

  it("preserves existing config and refuses a symlinked .codex directory", async () => {
    const outputFile = join(dir, "existing.toml");
    await writeFile(outputFile, "[mcp_servers.other]\n");
    await expect(runTomlConnect({ ...local, workspaceDir: dir, outputFile }, "codex")).rejects.toThrow(/already exists/);
    expect(await readFile(outputFile, "utf8")).toBe("[mcp_servers.other]\n");
    await symlink(dir, join(dir, ".codex"), "dir");
    await expect(runTomlConnect({ ...local, workspaceDir: dir }, "codex")).rejects.toThrow(/must be a directory/);
    await expect(stat(join(dir, "config.toml"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("Grok Build project config", () => {
  it("connects the installed CLI to assigned Work using run environment references", async () => {
    const opts = { workspaceDir: dir, hosted: false, assignedWork: true, print: false,
      localEntry: { node: "/opt/ClawPanel Tools/node", cli: "/opt/ClawPanel Tools/cli.js" } };
    const result = await runTomlConnect(opts, "grok");
    expect(result.writtenTo).toBe(join(dir, ".grok", "config.toml"));
    expect(result.content).toContain('"serve", "--assigned-work"');
    for (const name of WORK_RUN_ENV) expect(result.content).toContain(name + ' = "${' + name + '}"');
    expect(await readFile(result.writtenTo!, "utf8")).toBe(result.content);
    await expect(runTomlConnect(opts, "grok")).rejects.toThrow(/already exists/);
  });

  it("references hosted authorization headers without writing credential values", async () => {
    const opts = { workspaceDir: dir, hosted: true, print: true };
    const result = await runTomlConnect(opts, "grok");
    expect(result.content).toContain('Authorization = "Bearer ${CLAWPANEL_TOKEN}"');
    expect(result.content).toContain('"x-runtime-key" = "${CLAWPANEL_RUNTIME_KEY}"');
    await expect(runTomlConnect({ ...opts, token: "fixture-token" }, "grok")).rejects.toThrow(/Omit credential flags/);
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
