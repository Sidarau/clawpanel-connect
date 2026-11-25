import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
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
type WorkRefusal = "enrollment_refused" | "run_or_grant_refused" | "issue_unavailable"
  | "configuration_refused" | "signing_identity_refused" | "receipt_mismatch";

class WorkRefused extends Error {
  constructor(readonly reason: WorkRefusal, message: string) {
    super(message);
  }
}

const localRefusals = new Map<string, WorkRefusal>([
  ["Local Work requires an absolute private path without symbolic links.", "configuration_refused"],
  ["The local Work file, socket, and parent directories must be private to this account.", "configuration_refused"],
  ["The runtime agent, company and assigned issue must match an approved local Work configuration.", "configuration_refused"],
  ["The local signing key does not match the enrolled agent.", "signing_identity_refused"],
  ["The local Work server binding changed.", "receipt_mismatch"],
  ["The local Work server did not confirm this run.", "receipt_mismatch"],
  ["The local Work server returned a different issue.", "receipt_mismatch"],
]);

function workEnvironment(env: NodeJS.ProcessEnv) {
  return Object.fromEntries(WORK_RUN_ENV.map((name) => [name, env[name] ?? ""]));
}

function bindingIssues(env: ReturnType<typeof workEnvironment>) {
  return WORK_RUN_ENV.flatMap((field): { field: typeof WORK_RUN_ENV[number]; problem: "missing" | "invalid" }[] => {
    const value = env[field];
    if (!value) return [{ field, problem: "missing" }];
    const valid = field === "CLAWPANEL_AGENT_WORK_CONFIG" ? isAbsolute(value) : uuid.test(value);
    return valid ? [] : [{ field, problem: "invalid" }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Delegate only the enrolled run's two operations to the installed Work client. */
export function createAssignedWorkClient(
  env: NodeJS.ProcessEnv,
  executable = join(homedir(), ".local", "bin", "clawpanel-work"),
): WorkClient {
  const runEnv = workEnvironment(env);
  if (bindingIssues(runEnv).length > 0) throw new Error(unavailable);
  return (comment) => new Promise((resolve, reject) => {
    const args = comment ? ["--comment-stdin"] : [];
    const unconfirmed = comment
      ? "Work did not confirm the comment. Reopen the assigned issue or retry with the same request ID."
      : "Work could not read this assigned issue. Check the agent enrollment and project grant.";
    const child = execFile(executable, args, {
      env: { PATH: "/usr/bin:/bin", ...runEnv }, timeout: 65_000, maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr.trim();
        const denied = /^Local Work returned HTTP (401|403|404)\.$/.exec(detail);
        const status = denied?.[1];
        const reason = status === "401" ? "enrollment_refused" : status === "403" ? "run_or_grant_refused" : "issue_unavailable";
        const local = localRefusals.get(detail);
        reject(status ? new WorkRefused(reason, `Work refused this run or issue (HTTP ${status}).`)
          : local ? new WorkRefused(local, unconfirmed) : new Error(unconfirmed));
        return;
      }
      try {
        const result: unknown = JSON.parse(stdout);
        if (!isRecord(result) || result.agent_id !== runEnv.PAPERCLIP_AGENT_ID
          || result.run_id !== runEnv.PAPERCLIP_RUN_ID) throw new WorkRefused("receipt_mismatch", unconfirmed);
        if (!comment && (!isRecord(result.task) || result.task.id !== runEnv.PAPERCLIP_TASK_ID)) throw new WorkRefused("receipt_mismatch", unconfirmed);
        if (comment && (!isRecord(result.message) || result.message.kind !== "agent"
          || result.message.fromAgentId !== runEnv.PAPERCLIP_AGENT_ID || result.message.fromUserId != null)) throw new WorkRefused("receipt_mismatch", unconfirmed);
        resolve(result);
      } catch (error) {
        reject(error instanceof WorkRefused ? error : new Error(unconfirmed));
      }
    });
    child.stdin?.on("error", () => { /* The child status determines the outcome. */ });
    child.stdin?.end(comment ? JSON.stringify(comment) : undefined);
  });
}

const workRecovery = {
  unchecked: "Run Work Doctor again from the managed assignment.",
  unconfirmed: "Check the installed Work helper and gateway connection on the enrolled host, then reopen the assignment.",
  enrollment_refused: "Check that the signing connection is active for this agent in the Work gateway.",
  run_or_grant_refused: "Check that this run is active and the enrolled actor still has access to this project.",
  issue_unavailable: "Check that the issue still exists and is assigned to this enrolled actor.",
  configuration_refused: "Check the enrolled Work configuration and its private permissions on the runner host.",
  signing_identity_refused: "Check that the runner’s signing key matches its enrolled Work connection.",
  receipt_mismatch: "Check that the Work helper, gateway and launcher agree on the active run before retrying.",
};

/** Inspect this run without returning paths, identifiers, or issue content. */
export async function assignedWorkDoctor(
  env: NodeJS.ProcessEnv,
  executable = join(homedir(), ".local", "bin", "clawpanel-work"),
) {
  const launcher = await Promise.all([access(executable, constants.X_OK), stat(executable)])
    .then(([, entry]) => entry.isFile() ? "ready" as const : "missing" as const, () => "missing" as const);
  const problems = bindingIssues(workEnvironment(env));
  const binding = problems.length === 0 ? "present" as const : "missing" as const;
  let assignedIssue: "unchecked" | "verified" | "unconfirmed" | WorkRefusal = "unchecked";
  if (launcher === "ready" && binding === "present") {
    try {
      await createAssignedWorkClient(env, executable)();
      assignedIssue = "verified";
    } catch (error) {
      assignedIssue = error instanceof WorkRefused ? error.reason : "unconfirmed";
    }
  }
  const nextAction = launcher === "missing" ? "Install the enrolled Work helper on the runner host."
    : binding === "missing" ? "Start the agent from its managed Work assignment and check the listed launcher fields."
    : assignedIssue === "verified" ? undefined : workRecovery[assignedIssue];
  return { ready: assignedIssue === "verified", checks: { launcher, binding, assignedIssue },
    ...(problems.length ? { bindingIssues: problems } : {}), ...(nextAction ? { nextAction } : {}) };
}

export function assignedWorkComment(value: unknown): Comment {
  if (!isRecord(value)) throw new Error("Supply comment text and a request UUID.");
  const { text, clientRequestId } = value;
  if (Object.keys(value).length !== 2 || typeof text !== "string" || !text.trim() || text.length > maxCommentLength
    || typeof clientRequestId !== "string" || !uuid.test(clientRequestId)) {
    throw new Error("Supply comment text and a request UUID.");
  }
  return { text, clientRequestId };
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
      try {
        comment = assignedWorkComment(args);
      } catch (error) {
        return failure((error as Error).message);
      }
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
