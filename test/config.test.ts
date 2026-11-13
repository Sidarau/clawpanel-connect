import { describe, expect, it } from "vitest";
import { FREE_TIER, buildHostedConfig, buildLocalConfig } from "../src/config.js";
import { buildConnectConfig } from "../src/connect.js";

describe("buildLocalConfig", () => {
  it("produces a stdio entry pointing at the npx package", () => {
    const config = buildLocalConfig("/tmp/ws");
    const entry = config.mcpServers.clawpanel;
    expect(entry).toBeDefined();
    if (!entry || "type" in entry) throw new Error("expected stdio entry");
    expect(entry.command).toBe("npx");
    expect(entry.args).toContain("clawpanel@latest");
    expect(entry.args).toContain("serve");
    expect(entry.env?.CLAWPANEL_WORKSPACE).toBe("/tmp/ws");
  });
});

describe("buildHostedConfig", () => {
  it("produces an http entry mirroring the clawpanel-web UI snippet", () => {
    const config = buildHostedConfig("https://clawpanel.app", "tok-123", "runtime-123");
    const entry = config.mcpServers.clawpanel;
    if (!entry || !("type" in entry)) throw new Error("expected http entry");
    expect(entry.type).toBe("http");
    expect(entry.url).toBe("https://clawpanel.app/api/mcp");
    expect(entry.headers?.Authorization).toBe("Bearer tok-123");
    expect(entry.headers?.["x-runtime-key"]).toBe("runtime-123");
  });

  it("normalizes trailing slashes on the api url", () => {
    const config = buildHostedConfig("https://clawpanel.app/", "t", "runtime-123");
    const entry = config.mcpServers.clawpanel;
    if (!entry || !("type" in entry)) throw new Error("expected http entry");
    expect(entry.url).toBe("https://clawpanel.app/api/mcp");
  });
});

describe("buildConnectConfig", () => {
  it("throws when --hosted is set without a token", () => {
    expect(() =>
      buildConnectConfig({ workspaceDir: "/tmp", hosted: true, print: false }),
    ).toThrow(/--token|CLAWPANEL_TOKEN/);
  });

  it("reads CLAWPANEL_TOKEN env for hosted mode", () => {
    const previous = process.env.CLAWPANEL_TOKEN;
    process.env.CLAWPANEL_TOKEN = "env-tok";
    try {
      const config = buildConnectConfig({ workspaceDir: "/tmp", hosted: true, runtimeKey: "runtime-123", print: false });
      const entry = config.mcpServers.clawpanel;
      if (!entry || !("type" in entry)) throw new Error("expected http entry");
      expect(entry.headers?.Authorization).toBe("Bearer env-tok");
    } finally {
      if (previous === undefined) delete process.env.CLAWPANEL_TOKEN;
      else process.env.CLAWPANEL_TOKEN = previous;
    }
  });
});

describe("free tier constants", () => {
  it("documents 1 workspace and a run cap", () => {
    expect(FREE_TIER.maxWorkspaces).toBe(1);
    expect(FREE_TIER.runCapPerWorkspace).toBeGreaterThan(0);
  });
});

describe("hosted security contract", () => {
  it.each(["", " ", "a\r\nb"])("rejects invalid credentials %j", (credential) => {
    expect(() => buildHostedConfig("https://clawpanel.app", credential, "key")).toThrow();
    expect(() => buildHostedConfig("https://clawpanel.app", "token", credential)).toThrow();
  });
  it.each([
    "http://clawpanel.app", "ftp://example.com", "not-a-url",
    "https://user:password@example.com", "https://example.com/path",
    "https://example.com?token=secret", "https://example.com#fragment",
    "http://localhost.example.com", "http://192.168.1.1", "http://0.0.0.0",
  ])("rejects unsafe destination %s", (url) => {
    expect(() => buildHostedConfig(url, "token", "key")).toThrow(/HTTPS origin/);
  });
  it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])("allows loopback development %s", (url) => {
    expect(buildHostedConfig(url, "token", "key").mcpServers.clawpanel).toMatchObject({ url: `${url}/api/mcp` });
  });
  it("requires runtime possession even with a token", () => {
    expect(() => buildConnectConfig({ workspaceDir: "/tmp", hosted: true, token: "t", runtimeKey: "", print: true })).toThrow(/runtime-key/);
  });
  it("reads environment credentials and gives explicit flags precedence", () => {
    const before = { token: process.env.CLAWPANEL_TOKEN, key: process.env.CLAWPANEL_RUNTIME_KEY };
    process.env.CLAWPANEL_TOKEN = "env-token";
    process.env.CLAWPANEL_RUNTIME_KEY = "env-key";
    try {
      const opts = { workspaceDir: "/tmp", hosted: true, print: true };
      expect(buildConnectConfig(opts).mcpServers.clawpanel).toMatchObject({ headers: { Authorization: "Bearer env-token", "x-runtime-key": "env-key" } });
      expect(buildConnectConfig({ ...opts, token: "flag-token", runtimeKey: "flag-key" }).mcpServers.clawpanel).toMatchObject({ headers: { Authorization: "Bearer flag-token", "x-runtime-key": "flag-key" } });
      expect(() => buildConnectConfig({ ...opts, runtimeKey: " " })).toThrow(/runtime-key/);
      expect(buildConnectConfig({ ...opts, hosted: false }).mcpServers.clawpanel).not.toHaveProperty("headers");
    } finally {
      if (before.token === undefined) delete process.env.CLAWPANEL_TOKEN; else process.env.CLAWPANEL_TOKEN = before.token;
      if (before.key === undefined) delete process.env.CLAWPANEL_RUNTIME_KEY; else process.env.CLAWPANEL_RUNTIME_KEY = before.key;
    }
  });
});
