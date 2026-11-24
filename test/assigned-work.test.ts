import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { runConnect, runTomlConnect } from "../src/connect.js";
import { assignedWorkComment, createAssignedWorkClient, createAssignedWorkServer } from "../src/mcp/assigned-work.js";

const agentId = "550e8400-e29b-41d4-a716-446655440001";
const issueId = "550e8400-e29b-41d4-a716-446655440002";
const requestId = "550e8400-e29b-41d4-a716-446655440003";
const runEnv = {
  CLAWPANEL_AGENT_WORK_CONFIG: "/fixture/agent-work.json",
  PAPERCLIP_AGENT_ID: agentId,
  PAPERCLIP_COMPANY_ID: "550e8400-e29b-41d4-a716-446655440004",
  PAPERCLIP_TASK_ID: issueId,
  PAPERCLIP_RUN_ID: "550e8400-e29b-41d4-a716-446655440005",
};

describe("assigned Work MCP", () => {
  it("exposes only the assigned issue and attributed comments", async () => {
    const handler = vi.fn(async (_comment?: { text: string; clientRequestId: string }) => ({ task: { id: issueId } }));
    const server = createAssignedWorkServer(handler);
    const client = new Client({ name: "test", version: "1" });
    const [left, right] = InMemoryTransport.createLinkedPair();
    await server.connect(right);
    await client.connect(left);
    try {
      const tools = (await client.listTools()).tools;
      expect(tools.map((tool) => tool.name)).toEqual(["work_issue_read", "work_issue_comment"]);
      expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
      expect((await client.callTool({ name: "work_issue_read", arguments: { taskId: issueId } })).isError).toBe(true);
      expect((await client.callTool({ name: "work_issue_comment", arguments: { text: " ", clientRequestId: requestId } })).isError).toBe(true);
      expect(handler).not.toHaveBeenCalled();
      expect((await client.callTool({ name: "work_issue_read" })).structuredContent).toEqual({ task: { id: issueId } });
      const note = { text: "Verified the assigned issue.", clientRequestId: requestId };
      await client.callTool({ name: "work_issue_comment", arguments: note });
      expect(handler.mock.calls).toEqual([[undefined], [note]]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("validates the same attributed comment for CLI and MCP callers", () => {
    const note = { text: "Work receipt", clientRequestId: requestId };
    expect(assignedWorkComment(note)).toEqual(note);
    expect(() => assignedWorkComment({ ...note, issueId })).toThrow("request UUID");
    expect(() => assignedWorkComment({ ...note, text: " ".repeat(10) })).toThrow("request UUID");
    expect(() => assignedWorkComment({ ...note, clientRequestId: "unbound" })).toThrow("request UUID");
  });

  it("requires the managed run identity before launching a helper", () => {
    expect(() => createAssignedWorkClient({})).toThrow("enrolled agent");
    expect(() => createAssignedWorkClient({ ...runEnv, PAPERCLIP_RUN_ID: "" })).toThrow("active Work run");
  });

  it.skipIf(process.platform === "win32")("forwards only run fields and rejects an unconfirmed receipt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawpanel-enrolled-fixture-"));
    try {
      const file = join(dir, "clawpanel-work-fixture");
      await writeFile(file, `#!/bin/sh
test -z "$UNRELATED_SECRET" || exit 10
case "$1" in
  "") printf '%s\n' '{"agent_id":"${agentId}","task":{"id":"${issueId}"}}';;
  --comment-stdin)
    IFS= read -r supplied || test -n "$supplied" || exit 11
    case "$supplied" in
      *wrong*) printf '%s\n' '{"agent_id":"${agentId}","message":{"kind":"user"}}';;
      *revoked*) printf '%s\n' 'Local Work returned HTTP 403.' >&2; exit 1;;
      *${requestId}*) printf '%s\n' '{"agent_id":"${agentId}","message":{"kind":"agent","fromAgentId":"${agentId}"}}';;
      *) exit 12;;
    esac;;
  *) exit 13;;
esac
`);
      await chmod(file, 0o700);
      const helper = createAssignedWorkClient({ ...runEnv, UNRELATED_SECRET: "fixture-secret" }, file);
      await expect(helper()).resolves.toMatchObject({ task: { id: issueId } });
      await expect(helper({ text: "checked", clientRequestId: requestId })).resolves.toMatchObject({ message: { fromAgentId: agentId } });
      await expect(helper({ text: "wrong", clientRequestId: requestId })).rejects.toThrow("did not confirm");
      await expect(helper({ text: "revoked", clientRequestId: requestId })).rejects.toThrow("HTTP 403");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("generates client configs with run variable names and no captured credentials", async () => {
    const options = {
      workspaceDir: "/project", hosted: false, assignedWork: true, print: true,
      localEntry: { node: "/fixture/node", cli: "/fixture/cli.js" },
    };
    expect((await runConnect(options)).config.mcpServers.clawpanel).toMatchObject({
      args: ["/fixture/cli.js", "serve", "--assigned-work"],
      env: { CLAWPANEL_AGENT_WORK_CONFIG: "${CLAWPANEL_AGENT_WORK_CONFIG}", PAPERCLIP_RUN_ID: "${PAPERCLIP_RUN_ID}" },
    });
    const codex = (await runTomlConnect(options, "codex")).content;
    expect(codex).toContain('args = ["/fixture/cli.js", "serve", "--assigned-work"]');
    expect(codex).toMatch(/env_vars = \[.*"PAPERCLIP_RUN_ID"/);
    expect(codex).not.toContain("/project");
    await expect(runConnect({ ...options, hosted: true })).rejects.toThrow("either --hosted or --assigned-work");
    await expect(runTomlConnect({ ...options, hosted: true }, "codex")).rejects.toThrow("either --hosted or --assigned-work");
  });
});
