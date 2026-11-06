/**
 * `clawpanel connect` — writes MCP client config so an agent (Claude
 * Code, Cursor, Codex, any MCP client) can reach ClawPanel.
 *
 * Two modes:
 *  - default: local, free, account-less stdio config (open-source server)
 *  - `--hosted --token <t> --runtime-key <key>`: http config for the hosted server-side brain
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
  runtimeKey?: string;
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
    if (!token?.trim()) {
      throw new Error("--hosted requires --token <token> or CLAWPANEL_TOKEN env var");
    }
    const runtimeKey = opts.runtimeKey ?? process.env.CLAWPANEL_RUNTIME_KEY;
    if (!runtimeKey?.trim()) {
      throw new Error("--hosted requires --runtime-key <key> or CLAWPANEL_RUNTIME_KEY env var");
    }
    return buildHostedConfig(opts.apiUrl ?? API_URL_DEFAULT, token, runtimeKey);
  }
  return buildLocalConfig(resolve(opts.workspaceDir));
}

export async function runConnect(opts: ConnectOptions): Promise<ConnectResult> {
  const config = buildConnectConfig(opts);
  if (opts.print) {
    return { config };
  }
  const outputFile = opts.outputFile ?? join(resolve(opts.workspaceDir), DEFAULT_MCP_CONFIG_FILE);
  // Exclusive creation refuses existing files (including symlinks). Never truncate
  // another server's config or put credentials in a pre-existing permissive file.
  try {
    await writeFile(outputFile, JSON.stringify(config, null, 2) + "\n", {
      encoding: "utf8", flag: "wx", mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Config already exists; it was not changed. Use --output with a new file and merge the clawpanel entry manually.");
    }
    throw error;
  }
  return { config, writtenTo: outputFile };
}
