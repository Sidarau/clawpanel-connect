import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { WORK_RUN_ENV } from "../config.js";
import { SERVER_NAME, SERVER_VERSION } from "./server.js";

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const unavailable = "Assigned Work requires an enrolled agent and an active Work run on this machine.";
const readTool = "work_issue_read";
const commentTool = "work_issue_comment";
const maxCommentLength = 32_000;

type Comment = { text: string; clientRequestId: string };
type WorkClient = (comment?: Comment) => Promise<Record<string, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Delegate only the enrolled run's two operations to the installed Work client. */
export function createAssignedWorkClient(
  env: NodeJS.ProcessEnv,
  executable = join(homedir(), ".local", "bin", "clawpanel-work"),
): WorkClient {
  const runEnv = Object.fromEntries(WORK_RUN_ENV.map((name) => [name, env[name] ?? ""]));
  if (!isAbsolute(runEnv.CLAWPANEL_AGENT_WORK_CONFIG ?? "")
    || !WORK_RUN_ENV.slice(1).every((name) => uuid.test(runEnv[name] ?? ""))) {
    throw new Error(unavailable);
  }
  return (comment) => new Promise((resolve, reject) => {
    const args = comment ? ["--comment-stdin"] : [];
    const unconfirmed = comment
      ? "Work did not confirm the comment. Reopen the assigned issue or retry with the same request ID."
      : "Work could not read this assigned issue. Check the agent enrollment and project grant.";
    const child = execFile(executable, args, {
      env: { PATH: "/usr/bin:/bin", ...runEnv }, timeout: 65_000, maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const denied = /^Local Work returned HTTP (401|403|404)\.$/.exec(stderr.trim());
        reject(new Error(denied ? `Work refused this run or issue (HTTP ${denied[1]}).` : unconfirmed));
        return;
      }
      try {
        const result: unknown = JSON.parse(stdout);
        if (!isRecord(result) || result.agent_id !== runEnv.PAPERCLIP_AGENT_ID) throw new Error(unconfirmed);
        if (!comment && (!isRecord(result.task) || result.task.id !== runEnv.PAPERCLIP_TASK_ID)) throw new Error(unconfirmed);
        if (comment && (!isRecord(result.message) || result.message.kind !== "agent"
          || result.message.fromAgentId !== runEnv.PAPERCLIP_AGENT_ID || result.message.fromUserId != null)) throw new Error(unconfirmed);
        resolve(result);
      } catch {
        reject(new Error(unconfirmed));
      }
    });
    child.stdin?.on("error", () => { /* The child status determines the outcome. */ });
    child.stdin?.end(comment ? JSON.stringify(comment) : undefined);
  });
}

function failure(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

export function createAssignedWorkServer(client: WorkClient): Server {
  const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, {
    capabilities: { tools: {} },
    instructions: "Use work_issue_read for the current assigned Work issue and its discussion. Post evidence with work_issue_comment when the run calls for an attributed update.",
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: readTool,
        description: "Read the Work issue assigned to this run, with its planning details and comments.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      {
        name: commentTool,
        description: "Post an attributed comment on this run's assigned Work issue. Use a new request UUID for a new comment and reuse it to retry the same comment.",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string", minLength: 1, maxLength: maxCommentLength }, clientRequestId: { type: "string", format: "uuid" } },
          required: ["text", "clientRequestId"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const args = params.arguments ?? {};
    let comment: Comment | undefined;
    if (params.name === readTool) {
      if (Object.keys(args).length) return failure("The issue is selected by the active Work run.");
    } else if (params.name === commentTool) {
      const { text, clientRequestId } = args;
      if (Object.keys(args).length !== 2 || typeof text !== "string" || !text.trim() || text.length > maxCommentLength
        || typeof clientRequestId !== "string" || !uuid.test(clientRequestId)) {
        return failure("Supply comment text and a request UUID.");
      }
      comment = { text, clientRequestId };
    } else {
      return failure("Unknown assigned Work tool.");
    }
    try {
      const result = await client(comment);
      return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      return failure(error instanceof Error ? error.message : "Assigned Work is unavailable.");
    }
  });
  return server;
}

export async function runAssignedWorkServer(env: NodeJS.ProcessEnv): Promise<void> {
  await createAssignedWorkServer(createAssignedWorkClient(env)).connect(new StdioServerTransport());
}
