/**
 * ClawPanel open-source MCP server.
 *
 * SCAFFOLD NOTE (ZEUG-546): clawpanel-web had no standalone MCP server
 * code — it exposes a hosted HTTP MCP endpoint at `/api/mcp` (the paid
 * server-side brain). This local, stdio-transport server is the new
 * open-source free surface: workspace-scoped notes + a free-tier run
 * counter, fully offline. It intentionally does NOT reimplement the paid
 * brain (memory distillation, governance, approvals, vault, audit).
 */

import { createRequire } from "node:module";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, isAbsolute, resolve, sep } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { marketplace, partner, commerceCommand } from "../commerce.js";
import { FREE_TIER } from "../config.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { name: string; version: string };

export const SERVER_NAME = "clawpanel";
export const SERVER_VERSION = pkg.version;

export interface WorkspaceServerOptions {
  workspaceDir: string;
  /** Override the free-tier run cap (used by tests). */
  runCap?: number;
}

export const TOOL_NAMES = {
  status: "workspace_status",
  marketplace: "clawpanel_marketplace_contact",
  partner: "clawpanel_partner_referral",
  starter: "clawpanel_starter_open",
  noteList: "workspace_note_list",
  noteRead: "workspace_note_read",
  noteAppend: "workspace_note_append",
  runStatus: "workspace_run_status",
  runConsume: "workspace_run_consume",
} as const;

const NOTE_DIR = ".clawpanel/notes";
const STATE_FILE = ".clawpanel/state.json";
const NOTE_NAME_RE = /^[a-zA-Z0-9._-]+\.md$/;

interface WorkspaceState {
  runs: number;
}

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

/** Resolve a note name to an absolute path, refusing path traversal. */
function notePath(workspaceDir: string, name: string): string | null {
  if (!NOTE_NAME_RE.test(name)) return null;
  const root = resolve(workspaceDir);
  const candidate = resolve(root, NOTE_DIR, name);
  return candidate.startsWith(root + sep) || candidate === root ? candidate : null;
}

async function loadState(workspaceDir: string): Promise<WorkspaceState> {
  try {
    const raw = await readFile(resolve(workspaceDir, STATE_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<WorkspaceState>;
    return { runs: typeof parsed.runs === "number" ? parsed.runs : 0 };
  } catch {
    return { runs: 0 };
  }
}

async function saveState(workspaceDir: string, state: WorkspaceState): Promise<void> {
  const dir = resolve(workspaceDir, ".clawpanel");
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(workspaceDir, STATE_FILE), JSON.stringify(state, null, 2), "utf8");
}

export function createWorkspaceServer(opts: WorkspaceServerOptions): Server {
  const workspaceDir = resolve(opts.workspaceDir);
  const runCap = opts.runCap ?? FREE_TIER.runCapPerWorkspace;

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        "ClawPanel open-source MCP server. Free tier: one local workspace, " +
        `capped at ${runCap} runs. Paid server-side brain (memory distillation, ` +
        "governance, approvals, vault, audit, hosted graphs) is served at " +
        "https://clawpanel.app/api/mcp with a bearer token from `clawpanel connect --hosted`.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: TOOL_NAMES.marketplace,
        description: "Get the official ClawPanel workflow or skill marketplace contact and next step. Does not transact.",
        inputSchema: { type: "object", properties: { action: { type: "string", enum: ["buy", "sell"] } }, required: ["action"] },
      },
      {
        name: TOOL_NAMES.partner,
        description: "Open the partner dashboard or prepare a disclosed referral link with your own code. Does not publish or send.",
        inputSchema: { type: "object", properties: { action: { type: "string", enum: ["dashboard", "share"] }, code: { type: "string" } }, required: ["action"] },
      },
      {
        name: TOOL_NAMES.starter,
        description: "Get the signed-in destination for using ClawPanel Assistant and topping up prepaid credits.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: TOOL_NAMES.status,
        description: "ClawPanel workspace status: path, free-tier info.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: TOOL_NAMES.noteList,
        description: "List markdown notes stored in the local workspace.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: TOOL_NAMES.noteRead,
        description: "Read a markdown note by name (e.g. 'decisions.md').",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
      {
        name: TOOL_NAMES.noteAppend,
        description: "Append text to a markdown note (created if missing).",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            content: { type: "string" },
          },
          required: ["name", "content"],
        },
      },
      {
        name: TOOL_NAMES.runStatus,
        description: `Free-tier run usage for this workspace (cap: ${runCap}).`,
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: TOOL_NAMES.runConsume,
        description: "Consume one free-tier run; errors when the cap is reached.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    switch (name) {
      case TOOL_NAMES.marketplace:
        return args.action === "buy" || args.action === "sell"
          ? textResult(JSON.stringify(marketplace(args.action))) : errorResult("Choose buy or sell.");
      case TOOL_NAMES.partner:
        if (args.action !== "dashboard" && args.action !== "share") return errorResult("Choose dashboard or share.");
        try { return textResult(JSON.stringify(partner(args.action, args.code))); }
        catch (error) { return errorResult(error instanceof Error ? error.message : "Invalid referral code."); }
      case TOOL_NAMES.starter:
        return textResult(JSON.stringify(commerceCommand(["starter", "open"]).data));
      case TOOL_NAMES.status: {
        return textResult(
          JSON.stringify(
            {
              workspace: workspaceDir,
              tier: "free",
              runCap,
              noteDir: resolve(workspaceDir, NOTE_DIR),
              hostedBrain: "https://clawpanel.app/api/mcp (paid tier)",
            },
            null,
            2,
          ),
        );
      }
      case TOOL_NAMES.noteList: {
        try {
          const dir = resolve(workspaceDir, NOTE_DIR);
          const names = await readdir(dir).catch(() => [] as string[]);
          const notes = names.filter((n) => NOTE_NAME_RE.test(n)).sort();
          return textResult(notes.length ? notes.join("\n") : "(no notes yet)");
        } catch (err) {
          return errorResult(`Failed to list notes: ${String(err)}`);
        }
      }
      case TOOL_NAMES.noteRead: {
        const name = typeof args.name === "string" ? args.name : "";
        const path = notePath(workspaceDir, name);
        if (!path) return errorResult(`Invalid note name: ${JSON.stringify(name)}`);
        try {
          return textResult(await readFile(path, "utf8"));
        } catch {
          return errorResult(`Note not found: ${name}`);
        }
      }
      case TOOL_NAMES.noteAppend: {
        const name = typeof args.name === "string" ? args.name : "";
        const content = typeof args.content === "string" ? args.content : "";
        const path = notePath(workspaceDir, name);
        if (!path) return errorResult(`Invalid note name: ${JSON.stringify(name)}`);
        await mkdir(resolve(workspaceDir, NOTE_DIR), { recursive: true });
        await writeFile(path, `${content}${content.endsWith("\n") ? "" : "\n"}`, {
          encoding: "utf8",
          flag: "a",
        });
        return textResult(`Appended to ${name}`);
      }
      case TOOL_NAMES.runStatus: {
        const state = await loadState(workspaceDir);
        return textResult(
          JSON.stringify({ runsUsed: state.runs, runCap, remaining: Math.max(0, runCap - state.runs) }, null, 2),
        );
      }
      case TOOL_NAMES.runConsume: {
        const state = await loadState(workspaceDir);
        if (state.runs >= runCap) {
          return errorResult(
            `Free-tier run cap (${runCap}) reached for this workspace. ` +
              "Upgrade to the hosted brain for uncapped runs.",
          );
        }
        state.runs += 1;
        await saveState(workspaceDir, state);
        return textResult(
          JSON.stringify({ runsUsed: state.runs, runCap, remaining: Math.max(0, runCap - state.runs) }, null, 2),
        );
      }
      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  });

  return server;
}

export function resolveWorkspaceDir(input: string | undefined): string {
  if (input && isAbsolute(input)) return resolve(input);
  return resolve(input ?? process.cwd());
}

export async function runStdioServer(opts: WorkspaceServerOptions): Promise<void> {
  const server = createWorkspaceServer(opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export { join, sep };
