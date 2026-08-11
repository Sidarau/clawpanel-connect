/**
 * Shared configuration types and builders for the ClawPanel connect client.
 *
 * Part of the open-source (MIT) free surface of ClawPanel (ZEUG-546).
 */

export const API_URL_DEFAULT = "https://clawpanel.app";
export const MCP_PATH = "/api/mcp";

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
 * MCP server running via npx. No token required.
 */
export function buildLocalConfig(workspaceDir: string): ClientConfig {
  return {
    mcpServers: {
      clawpanel: {
        command: "npx",
        args: ["-y", "clawpanel@latest", "serve"],
        env: {
          CLAWPANEL_WORKSPACE: workspaceDir,
        },
      },
    },
  };
}

/**
 * Hosted config: connects to the ClawPanel server-side brain
 * (paid tier). Mirrors the snippet clawpanel-web's UI generates.
 */
export function buildHostedConfig(apiUrl: string, token: string): ClientConfig {
  const base = apiUrl.replace(/\/+$/, "");
  return {
    mcpServers: {
      clawpanel: {
        type: "http",
        url: `${base}${MCP_PATH}`,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  };
}
