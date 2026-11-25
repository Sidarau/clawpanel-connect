#!/usr/bin/env node
/**
 * clawpanel CLI — open-source connect client + MCP server (ZEUG-546).
 *
 *   clawpanel connect            # free: local stdio MCP config
 *   clawpanel connect --hosted --token <t> --runtime-key <key> [--api-url <u>]
 *   clawpanel serve              # start the local stdio MCP server
 *   clawpanel --version | --help
 */

import { fileURLToPath } from "node:url";
import { pair, run, RuntimeError } from "./runtime/client.js";
import { readJsonObject, readTaskUpdate, runTask } from "./task.js";
import { openSignIn } from "./login.js";
import { skillsCommand } from "./skills.js";
import { commerceCommand } from "./commerce.js";
import { runSquare } from "./square.js";
import { runConnect, runHermesConnect, runTomlConnect } from "./connect.js";
import { FREE_TIER } from "./config.js";
import { assignedWorkComment, assignedWorkDoctor, createAssignedWorkClient, runAssignedWorkServer } from "./mcp/assigned-work.js";
import { runStdioServer, resolveWorkspaceDir, SERVER_NAME, SERVER_VERSION } from "./mcp/server.js";

const HELP = `clawpanel — ClawPanel connect client + MCP server (open source, MIT)

USAGE
  clawpanel connect [options]        Write project MCP client config
  clawpanel login [--print]          Open ClawPanel sign-in
  clawpanel skills list|sync|run     Install or read a local workflow playbook
  clawpanel runtime pair --name NAME [--api-url ORIGIN]
  clawpanel runtime reconnect --name NAME [--api-url ORIGIN]
  clawpanel runtime run --endpoint http://127.0.0.1:PORT/v1 --model MODEL
  clawpanel task context [--api-url ORIGIN]
  clawpanel task update [--api-url ORIGIN] < update.json
  clawpanel work read
  clawpanel work doctor [--json]
  clawpanel work comment < comment.json
  clawpanel square list [--query TEXT] [--api-url ORIGIN]
  clawpanel square read TOPIC_ID [--api-url ORIGIN]
  clawpanel marketplace buy|sell [--json]
  clawpanel partner dashboard [--json]
  clawpanel partner share --code CODE [--json]
  clawpanel starter open [--json]
  clawpanel credits open [--json]
  clawpanel serve [options]          Start the local stdio MCP server
  clawpanel --version                Print version
  clawpanel --help                   Print this help

CONNECT OPTIONS
  --client <client>    claude (.mcp.json, default), codex, grok, or hermes
  --assigned-work      Use the enrolled run's assigned Work issue and comments
  --hosted             Point the agent at the hosted server-side brain (paid tier)
                       instead of the local open-source server (free tier)
  --token <token>      Bearer token for the hosted brain (or CLAWPANEL_TOKEN env)
  --runtime-key <key> Runtime possession key (or CLAWPANEL_RUNTIME_KEY env)
  --api-url <url>      Hosted API base URL (default: https://clawpanel.app)
  --output <file>      Write config to a specific file
  --print              Print the config instead of writing a file
  --workspace <dir>    Workspace directory for the local server (default: cwd)

TASK CONNECTION
  Create a named connection in ClawPanel's Connected AI task panel.
  Set CLAWPANEL_TOKEN and CLAWPANEL_RUNTIME_KEY in the private environment.
  Read task context before drafting an update. Update JSON on stdin requires
  task_id, task_version, settings_version, sop_revision, request_id (UUID),
  and summary. Responses are JSON on stdout.

ASSIGNED WORK
  Read the active run's assigned issue as JSON. A comment takes JSON with
  text and clientRequestId (UUID). Reuse that UUID when retrying the same comment.
  Use doctor to check the installed helper, run binding, and signed issue access.
  For Hermes, generate config with --client hermes --assigned-work --print.

SERVE OPTIONS
  --assigned-work      Start the MCP server for the enrolled Work run
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
  if (argv[0] === "task" && argv[1] !== "--help" && argv[1] !== "-h") {
    const action = argv[1];
    const rest = argv.slice(2);
    const { flags, command } = parseArgs(rest);
    if ((action !== "context" && action !== "update") || command
      || Object.keys(flags).some((key) => key !== "api-url")
      || (flags["api-url"] !== undefined && !stringFlag(flags, "api-url"))) {
      throw new Error("Use task context or task update with an optional --api-url ORIGIN.");
    }
    const result = await runTask(action, {
      apiUrl: stringFlag(flags, "api-url"),
      token: process.env.CLAWPANEL_TOKEN,
      runtimeKey: process.env.CLAWPANEL_RUNTIME_KEY,
      input: action === "update" ? await readTaskUpdate(process.stdin).catch((error: unknown) => {
        if (error instanceof SyntaxError) throw new Error("Send valid task update JSON on stdin.");
        throw error;
      }) : undefined,
    });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }
  if (argv[0] === "work" && argv[1] !== "--help" && argv[1] !== "-h") {
    const action = argv[1];
    if (action === "doctor" && (argv.length === 2 || (argv.length === 3 && argv[2] === "--json"))) {
      const report = await assignedWorkDoctor(process.env);
      if (argv[2] === "--json") {
        process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      } else {
        const status = { ready: "Ready", missing: "Missing", present: "Present", verified: "Verified",
          unchecked: "Unchecked", unconfirmed: "Unconfirmed", enrollment_refused: "Enrollment refused",
          run_or_grant_refused: "Run or project grant refused", issue_unavailable: "Assigned issue unavailable" };
        process.stdout.write([
          `Work helper  ${status[report.checks.launcher]}`,
          `Run binding  ${status[report.checks.binding]}`,
          `Issue access ${status[report.checks.assignedIssue]}`,
          ...(report.ready ? [] : ["Run this from an enrolled agent's active Work assignment."]),
        ].join("\n") + "\n");
      }
      return report.ready ? 0 : 1;
    }
    if (argv.length !== 2 || (action !== "read" && action !== "comment")) {
      throw new Error("Use clawpanel work read, work comment with JSON on stdin, or work doctor [--json].");
    }
    const client = createAssignedWorkClient(process.env);
    const comment = action === "comment" ? assignedWorkComment(await readJsonObject(process.stdin, "The Work comment", 256)
      .catch((error: unknown) => {
        if (error instanceof SyntaxError) throw new Error("Send valid Work comment JSON on stdin.");
        throw error;
      })) : undefined;
    process.stdout.write(JSON.stringify(await client(comment), null, 2) + "\n");
    return 0;
  }
  if (argv[0] === "login") {
    if (argv.length > 2 || (argv[1] && argv[1] !== "--print")) throw new Error("Use clawpanel login [--print].");
    process.stdout.write(openSignIn({ printOnly: argv[1] === "--print" }) + "\n");
    return 0;
  }
  if (argv[0] === "square" && argv[1] !== "--help" && argv[1] !== "-h") {
    const action = argv[1];
    const id = action === "read" ? argv[2] : undefined;
    const { flags, command } = parseArgs(argv.slice(action === "read" ? 3 : 2));
    const apiUrl = stringFlag(flags, "api-url");
    const query = stringFlag(flags, "query");
    if ((action !== "list" && action !== "read") || command
      || Object.keys(flags).some(key => key !== "api-url" && !(key === "query" && action === "list"))
      || flags["api-url"] === true || flags.query === true || (action === "read" && !id)) {
      throw new Error("Use square list [--query TEXT] or square read TOPIC_ID with an optional --api-url ORIGIN.");
    }
    process.stdout.write(JSON.stringify(await runSquare({ apiUrl, id, query }), null, 2) + "\n");
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
      const client = flags.client ?? "claude";
      if (client !== "claude" && client !== "codex" && client !== "grok" && client !== "hermes") {
        throw new Error("Choose --client claude, codex, grok, or hermes.");
      }
      const options = {
        workspaceDir: stringFlag(flags, "workspace") ?? process.cwd(),
        hosted: boolFlag(flags, "hosted"),
        assignedWork: boolFlag(flags, "assigned-work"),
        localEntry: { node: process.execPath, cli: fileURLToPath(import.meta.url) },
        token: stringFlag(flags, "token"),
        runtimeKey: stringFlag(flags, "runtime-key"),
        apiUrl: stringFlag(flags, "api-url"),
        outputFile: stringFlag(flags, "output"),
        print: boolFlag(flags, "print"),
      };
      if (client === "hermes") {
        const result = await runHermesConnect(options);
        process.stdout.write(result.writtenTo ? `Wrote Hermes MCP config to ${result.writtenTo}\n` : result.content);
        return 0;
      }
      if (client !== "claude") {
        const result = await runTomlConnect(options, client);
        const clientName = client === "codex" ? "Codex" : "Grok Build";
        process.stdout.write(result.writtenTo
          ? `Wrote ${clientName} MCP config to ${result.writtenTo}\n`
          : result.content);
        return 0;
      }
      const result = await runConnect(options);
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
      if (boolFlag(flags, "assigned-work")) {
        await runAssignedWorkServer(process.env);
        return 0;
      }
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
