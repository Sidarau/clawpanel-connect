#!/usr/bin/env node
/**
 * clawpanel CLI — open-source connect client + MCP server (ZEUG-546).
 *
 *   npx clawpanel@latest connect            # free: local stdio MCP config
 *   npx clawpanel@latest connect --hosted --token <t> --runtime-key <key> [--api-url <u>]
 *   npx clawpanel@latest serve              # start the local stdio MCP server
 *   npx clawpanel@latest --version | --help
 */

import { fileURLToPath } from "node:url";
import { pair, run, RuntimeError } from "./runtime/client.js";
import { openSignIn } from "./login.js";
import { skillsCommand } from "./skills.js";
import { commerceCommand } from "./commerce.js";
import { runConnect } from "./connect.js";
import { FREE_TIER } from "./config.js";
import { runStdioServer, resolveWorkspaceDir, SERVER_NAME, SERVER_VERSION } from "./mcp/server.js";

const HELP = `clawpanel — ClawPanel connect client + MCP server (open source, MIT)

USAGE
  clawpanel connect [options]        Write MCP client config (.mcp.json)
  clawpanel login [--print]          Open ClawPanel sign-in
  clawpanel skills list|sync|run     Install or read a local workflow playbook
  clawpanel runtime pair --name NAME [--api-url ORIGIN]
  clawpanel runtime reconnect --name NAME [--api-url ORIGIN]
  clawpanel runtime run --endpoint http://127.0.0.1:PORT/v1 --model MODEL
  clawpanel marketplace buy|sell [--json]
  clawpanel partner dashboard [--json]
  clawpanel partner share --code CODE [--json]
  clawpanel starter open [--json]
  clawpanel credits open [--json]
  clawpanel serve [options]          Start the local stdio MCP server
  clawpanel --version                Print version
  clawpanel --help                   Print this help

CONNECT OPTIONS
  --hosted             Point the agent at the hosted server-side brain (paid tier)
                       instead of the local open-source server (free tier)
  --token <token>      Bearer token for the hosted brain (or CLAWPANEL_TOKEN env)
  --runtime-key <key> Runtime possession key (or CLAWPANEL_RUNTIME_KEY env)
  --api-url <url>      Hosted API base URL (default: https://clawpanel.app)
  --output <file>      Write config to a specific file (default: .mcp.json)
  --print              Print the config JSON instead of writing a file
  --workspace <dir>    Workspace directory for the local server (default: cwd)

SERVE OPTIONS
  --workspace <dir>    Workspace directory (default: cwd; env CLAWPANEL_WORKSPACE)

FREE TIER
  ${FREE_TIER.maxWorkspaces} workspace, ${FREE_TIER.runCapPerWorkspace} runs per workspace.
  The paid tier (server-side brain: memory distillation, governance, approvals,
  vault, audit, hosted graphs, marketplace) is served at
  https://clawpanel.app/api/mcp — see README.md for the open-core split.
`;

interface ParsedArgs {
  command: string | undefined;
  flags: Record<string, string | boolean>;
}

/** Minimal, dependency-free flag parser. Supports --flag, --flag value, --flag=value. */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  let command: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      if (eq !== -1) {
        flags[name] = arg.slice(eq + 1);
      } else if (i + 1 < argv.length && !(argv[i + 1] as string).startsWith("-")) {
        flags[name] = argv[i + 1] as string;
        i += 1;
      } else {
        flags[name] = true;
      }
    } else if (arg === "-v" || arg === "-h") {
      flags[arg === "-v" ? "version" : "help"] = true;
    } else {
      positionals.push(arg);
    }
  }

  for (const name of ["token", "runtime-key"]) {
    if (flags[name] === true) throw new Error(`--${name} requires a value`);
  }
  command = positionals[0];
  return { command, flags };
}

export function stringFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

export function boolFlag(flags: Record<string, string | boolean>, name: string): boolean {
  return flags[name] === true;
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] === "login") {
    if (argv.length > 2 || (argv[1] && argv[1] !== "--print")) throw new Error("Use clawpanel login [--print].");
    process.stdout.write(openSignIn({ printOnly: argv[1] === "--print" }) + "\n");
    return 0;
  }
  if (argv[0] === "skills") {
    process.stdout.write(await skillsCommand(argv.slice(1)) + "\n");
    return 0;
  }
  if (["marketplace", "partner", "starter", "credits"].includes(argv[0] ?? "")) {
    const { json, data } = commerceCommand(argv);
    process.stdout.write((json ? JSON.stringify(data) : ("shareText" in data ? data.shareText : `${data.url}\n${data.handoff}`)) + "\n");
    return 0;
  }
  if (argv[0] === "runtime") {
    const action = argv[1];
    const { flags } = parseArgs(argv.slice(2));
    const allowed = action === "run" ? ["endpoint", "model"] : ["name", "api-url"];
    if (!['pair', 'reconnect', 'run'].includes(action ?? '') || Object.keys(flags).some(k => !allowed.includes(k))) throw new RuntimeError('Use runtime pair/reconnect --name NAME [--api-url ORIGIN], or runtime run --endpoint URL --model MODEL. Runtime API keys use CLAWPANEL_LOCAL_RUNTIME_API_KEY environment only.');
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      if (action === 'run') await run({ endpoint: stringFlag(flags, 'endpoint') ?? '', model: stringFlag(flags, 'model') ?? '', runtimeApiKey: process.env.CLAWPANEL_LOCAL_RUNTIME_API_KEY }, { signal: controller.signal });
      else await pair({ name: stringFlag(flags, 'name') ?? '', apiUrl: stringFlag(flags, 'api-url') ?? 'https://clawpanel.app', reconnect: action === 'reconnect' }, { signal: controller.signal });
    } catch (e) { if (!controller.signal.aborted) throw e; }
    finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
    return 0;
  }
  const { command, flags } = parseArgs(argv);

  if (flags.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (flags.version) {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return 0;
  }

  switch (command) {
    case undefined:
      process.stdout.write(HELP);
      return 0;
    case "connect": {
      const result = await runConnect({
        workspaceDir: stringFlag(flags, "workspace") ?? process.cwd(),
        hosted: boolFlag(flags, "hosted"),
        localEntry: { node: process.execPath, cli: fileURLToPath(import.meta.url) },
        token: stringFlag(flags, "token"),
        runtimeKey: stringFlag(flags, "runtime-key"),
        apiUrl: stringFlag(flags, "api-url"),
        outputFile: stringFlag(flags, "output"),
        print: boolFlag(flags, "print"),
      });
      if (result.writtenTo) {
        process.stdout.write(`Wrote MCP config for ClawPanel to ${result.writtenTo}\n`);
        process.stdout.write(
          "Start your agent's MCP client; the 'clawpanel' server will be picked up automatically.\n",
        );
      } else {
        process.stdout.write(JSON.stringify(result.config, null, 2) + "\n");
      }
      return 0;
    }
    case "serve": {
      const workspaceDir = resolveWorkspaceDir(
        stringFlag(flags, "workspace") ?? process.env.CLAWPANEL_WORKSPACE,
      );
      process.stderr.write(
        `${SERVER_NAME} ${SERVER_VERSION} MCP server (stdio) — workspace: ${workspaceDir}\n`,
      );
      await runStdioServer({ workspaceDir });
      return 0;
    }
    default: {
      process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
      return 1;
    }
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    const message = process.argv[2] === "runtime" ? (err instanceof RuntimeError ? err.message : "Runtime stopped or failed. Check pairing, private storage, and endpoint configuration.") : (err instanceof Error ? err.message : String(err));
    process.stderr.write(`error: ${message}\n`);
    process.exitCode = 1;
  });
