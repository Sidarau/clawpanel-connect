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
  WORK_RUN_ENV,
  WORK_TOOLS,
  type ClientConfig,
} from "./config.js";

export interface ConnectOptions {
  workspaceDir: string;
  hosted: boolean;
  assignedWork?: boolean;
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
  checkConnectionMode(opts);
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
  return buildLocalConfig(resolve(opts.workspaceDir), opts.localEntry, opts.assignedWork);
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

export async function runTomlConnect(opts: ConnectOptions, client: "codex" | "grok"): Promise<{ content: string; writtenTo?: string }> {
  checkConnectionMode(opts);
  const workspace = resolve(opts.workspaceDir);
  const clientName = client === "codex" ? "Codex" : "Grok Build";
  const lines = ["[mcp_servers.clawpanel]"];
  if (opts.hosted) {
    if (opts.token !== undefined || opts.runtimeKey !== undefined) {
      throw new Error(clientName + " reads CLAWPANEL_TOKEN and CLAWPANEL_RUNTIME_KEY from its environment. Omit credential flags.");
    }
    lines.push(`url = ${tomlString(hostedMcpUrl(opts.apiUrl ?? API_URL_DEFAULT))}`);
    if (client === "codex") {
      lines.push('bearer_token_env_var = "CLAWPANEL_TOKEN"',
        'env_http_headers = { "x-runtime-key" = "CLAWPANEL_RUNTIME_KEY" }');
    } else {
      lines.push('headers = { Authorization = "Bearer ${CLAWPANEL_TOKEN}", "x-runtime-key" = "${CLAWPANEL_RUNTIME_KEY}" }');
    }
  } else {
    if (!opts.localEntry) throw new Error("Start Connect from the installed ClawPanel CLI.");
    const config = buildLocalConfig(workspace, opts.localEntry, opts.assignedWork);
    const { command, args, env } = config.mcpServers.clawpanel;
    lines.push(
      `command = ${tomlString(command)}`,
      `args = [${args.map(tomlString).join(", ")}]`,
      opts.assignedWork && client === "codex"
        ? `env_vars = [${WORK_RUN_ENV.map(tomlString).join(", ")}]`
        : `env = { ${Object.entries(env ?? {}).map(([key, value]) => `${key} = ${tomlString(value)}`).join(", ")} }`,
    );
  }
  const content = lines.join("\n") + "\n";
  if (opts.print) return { content };
  const configDir = join(workspace, "." + client);
  const outputFile = opts.outputFile ?? join(configDir, "config.toml");
  if (opts.outputFile === undefined) {
    try {
      await mkdir(configDir, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!(await lstat(configDir)).isDirectory()) throw new Error(`The project's .${client} path must be a directory.`);
    }
  }
  await writeNewConfig(outputFile, content);
  return { content, writtenTo: outputFile };
}

export async function runHermesConnect(opts: ConnectOptions): Promise<{ content: string; writtenTo?: string }> {
  checkConnectionMode(opts);
  if (!opts.localEntry || !opts.assignedWork) throw new Error("Use the installed CLI with --client hermes --assigned-work.");
  if (!opts.print && !opts.outputFile) throw new Error("Use --print or choose a new Hermes config path with --output.");
  const { mcpServers: { clawpanel } } = buildLocalConfig(resolve(opts.workspaceDir), opts.localEntry, true);
  const content = JSON.stringify({ mcp_servers: { clawpanel: {
    ...clawpanel,
    tools: { include: WORK_TOOLS, prompts: false, resources: false },
  } } }, null, 2) + "\n";
  if (opts.print || !opts.outputFile) return { content };
  await writeNewConfig(opts.outputFile, content);
  return { content, writtenTo: opts.outputFile };
}

function checkConnectionMode(opts: ConnectOptions): void {
  if (opts.hosted && opts.assignedWork) throw new Error("Choose either --hosted or --assigned-work.");
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
