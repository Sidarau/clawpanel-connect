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

import { lstat, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  API_URL_DEFAULT,
  buildHostedConfig,
  buildLocalConfig,
  hostedMcpUrl,
  type ClientConfig,
} from "./config.js";

export interface ConnectOptions {
  workspaceDir: string;
  hosted: boolean;
  localEntry?: { node: string; cli: string };
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
  return buildLocalConfig(resolve(opts.workspaceDir), opts.localEntry);
}

export async function runConnect(opts: ConnectOptions): Promise<ConnectResult> {
  const config = buildConnectConfig(opts);
  if (opts.print) {
    return { config };
  }
  const outputFile = opts.outputFile ?? join(resolve(opts.workspaceDir), DEFAULT_MCP_CONFIG_FILE);
  await writeNewConfig(outputFile, JSON.stringify(config, null, 2) + "\n");
  return { config, writtenTo: outputFile };
}

export async function runCodexConnect(opts: ConnectOptions): Promise<{ content: string; writtenTo?: string }> {
  const workspace = resolve(opts.workspaceDir);
  const lines = ["[mcp_servers.clawpanel]"];
  if (opts.hosted) {
    if (opts.token !== undefined || opts.runtimeKey !== undefined) {
      throw new Error("Codex reads CLAWPANEL_TOKEN and CLAWPANEL_RUNTIME_KEY from its environment. Omit credential flags.");
    }
    lines.push(
      `url = ${tomlString(hostedMcpUrl(opts.apiUrl ?? API_URL_DEFAULT))}`,
      'bearer_token_env_var = "CLAWPANEL_TOKEN"',
      'env_http_headers = { "x-runtime-key" = "CLAWPANEL_RUNTIME_KEY" }',
    );
  } else {
    if (!opts.localEntry) throw new Error("Start Connect from the installed ClawPanel CLI.");
    const { node, cli } = opts.localEntry;
    lines.push(
      `command = ${tomlString(node)}`,
      `args = [${tomlString(cli)}, "serve"]`,
      `env = { CLAWPANEL_WORKSPACE = ${tomlString(workspace)} }`,
    );
  }
  const content = lines.join("\n") + "\n";
  if (opts.print) return { content };
  const codexDir = join(workspace, ".codex");
  const outputFile = opts.outputFile ?? join(codexDir, "config.toml");
  if (opts.outputFile === undefined) {
    try {
      await mkdir(codexDir, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!(await lstat(codexDir)).isDirectory()) throw new Error("The project's .codex path must be a directory.");
    }
  }
  await writeNewConfig(outputFile, content);
  return { content, writtenTo: outputFile };
}

function tomlString(value: string): string {
  return JSON.stringify(value).replace(/\u007f/g, "\\u007F");
}

async function writeNewConfig(outputFile: string, content: string): Promise<void> {
  // Exclusive creation preserves existing config, including symlinks.
  try {
    await writeFile(outputFile, content, {
      encoding: "utf8", flag: "wx", mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Config already exists; it was not changed. Use --output with a new file and merge the clawpanel entry manually.");
    }
    throw error;
  }
}
