/**
 * `clawpanel connect` — writes MCP client config so an agent (Claude
 * Code, Cursor, Codex, any MCP client) can reach ClawPanel.
 *
 * Two modes:
 *  - default: local, free, account-less stdio config (open-source server)
 *  - `--hosted --token <t>`: http config for the hosted server-side brain
 *
 * SCAFFOLD NOTE (ZEUG-546): clawpanel-web contained no connect CLI; the
 * web UI only offered a copy-paste mcpServers snippet. This CLI is the
 * new open-source implementation.
 */

import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  API_URL_DEFAULT,
  buildHostedConfig,
  buildLocalConfig,
  type ClientConfig,
} from "./config.js";

export interface ConnectOptions {
  workspaceDir: string;
  hosted: boolean;
  token?: string;
  apiUrl?: string;
  /** Write the config to this file (default: .mcp.json in workspaceDir). */
  outputFile?: string;
  /** Print the JSON instead of writing a file. */
  print: boolean;
}

export interface ConnectResult {
  config: ClientConfig;
  writtenTo?: string;
}

export const DEFAULT_MCP_CONFIG_FILE = ".mcp.json";

export function buildConnectConfig(opts: ConnectOptions): ClientConfig {
  if (opts.hosted) {
    const token = opts.token ?? process.env.CLAWPANEL_TOKEN;
    if (!token) {
      throw new Error("--hosted requires --token <token> or CLAWPANEL_TOKEN env var");
    }
    return buildHostedConfig(opts.apiUrl ?? API_URL_DEFAULT, token);
  }
  return buildLocalConfig(resolve(opts.workspaceDir));
}

export async function runConnect(opts: ConnectOptions): Promise<ConnectResult> {
  const config = buildConnectConfig(opts);
  if (opts.print) {
    return { config };
  }
  const outputFile = opts.outputFile ?? join(resolve(opts.workspaceDir), DEFAULT_MCP_CONFIG_FILE);
  await writeFile(outputFile, JSON.stringify(config, null, 2) + "\n", "utf8");
  return { config, writtenTo: outputFile };
}
