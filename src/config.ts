/**
 * Shared configuration types and builders for the ClawPanel connect client.
 *
 * Part of the open-source (MIT) free surface of ClawPanel (ZEUG-546).
 */

export const API_URL_DEFAULT = "https://clawpanel.app";
export const MCP_PATH = "/api/mcp";
export const WORK_TOOLS = ["work_issue_read", "work_issue_comment", "work_issue_checklist"] as const;

export const WORK_RUN_ENV = [
  "CLAWPANEL_AGENT_WORK_CONFIG",
  "PAPERCLIP_AGENT_ID",
  "PAPERCLIP_COMPANY_ID",
  "PAPERCLIP_TASK_ID",
  "PAPERCLIP_RUN_ID",
] as const;

/**
 * Free-tier limits of the open surface. The hosted server-side brain
 * (memory distillation, governance, approvals, vault, audit, hosted
 * graphs, marketplace) is the paid tier — see README.md for the
 * open-core split.
 */
export const FREE_TIER = {
  /** Free accounts get a single workspace. */
  maxWorkspaces: 1,
  /** Free-tier run cap per workspace (local counter enforced by the CLI/MCP server). */
  runCapPerWorkspace: 100,
} as const;

export interface StdioMcpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface HttpMcpServerEntry {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerEntry = StdioMcpServerEntry | HttpMcpServerEntry;

export interface ClientConfig {
  mcpServers: Record<string, McpServerEntry>;
}

/**
 * Free, local, account-less config: point the agent at the open-source
 * MCP server using the current installed entry point. No token required.
 */
export function buildLocalConfig(
  workspaceDir: string,
  local?: { node: string; cli: string },
  assignedWork = false,
): { mcpServers: { clawpanel: StdioMcpServerEntry } } {
  if (assignedWork && !local) throw new Error("Start Connect from the installed ClawPanel CLI.");
  return {
    mcpServers: {
      clawpanel: {
        command: local?.node ?? "npx",
        args: local ? [local.cli, "serve", ...(assignedWork ? ["--assigned-work"] : [])] : ["-y", "clawpanel@latest", "serve"],
        env: assignedWork
          ? Object.fromEntries(WORK_RUN_ENV.map((name) => [name, "${" + name + "}"]))
          : { CLAWPANEL_WORKSPACE: workspaceDir },
      },
    },
  };
}

/**
 * Hosted config: connects to the ClawPanel server-side brain
 * (paid tier). Mirrors the snippet clawpanel-web's UI generates.
 */
export function buildHostedConfig(apiUrl: string, token: string, runtimeKey: string): ClientConfig {
  if (!token?.trim() || /[\r\n]/.test(token)) throw new Error("A nonempty bearer token is required");
  if (!runtimeKey?.trim() || /[\r\n]/.test(runtimeKey)) throw new Error("A nonempty runtime key is required");
  return {
    mcpServers: {
      clawpanel: {
        type: "http",
        url: hostedMcpUrl(apiUrl),
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          "x-runtime-key": runtimeKey.trim(),
        },
      },
    },
  };
}

export function apiOrigin(apiUrl: string): string {
  let url: URL;
  try { url = new URL(apiUrl); } catch { throw new Error("Hosted API URL must be a valid HTTPS origin"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username || url.password || url.search || url.hash ||
      !/^\/*$/.test(url.pathname)) {
    throw new Error("Hosted API URL must be an HTTPS origin (HTTP allowed only for localhost, 127.0.0.1, or [::1]) without credentials, path, query, or fragment");
  }
  return url.origin;
}

export function hostedMcpUrl(apiUrl: string): string {
  return `${apiOrigin(apiUrl)}${MCP_PATH}`;
}
