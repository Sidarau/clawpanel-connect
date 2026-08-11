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
    const config = buildHostedConfig("https://clawpanel.app", "tok-123");
    const entry = config.mcpServers.clawpanel;
    if (!entry || !("type" in entry)) throw new Error("expected http entry");
    expect(entry.type).toBe("http");
    expect(entry.url).toBe("https://clawpanel.app/api/mcp");
    expect(entry.headers?.Authorization).toBe("Bearer tok-123");
  });

  it("normalizes trailing slashes on the api url", () => {
    const config = buildHostedConfig("https://clawpanel.app/", "t");
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
      const config = buildConnectConfig({ workspaceDir: "/tmp", hosted: true, print: false });
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
