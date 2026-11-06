# ClawPanel Connect

The open-source connect client and MCP server for
[ClawPanel](https://clawpanel.app) — a shared intelligence workspace for
people and AI agents.

```bash
npx clawpanel@latest connect     # free: connect an agent to a local workspace
npx clawpanel@latest serve       # free: run the local MCP server (stdio)
```

## The open-core split

ClawPanel is built on an **open-core** model. This repository is the open
wedge; the server-side brain is the paid service.

| Surface | Open (this repo, MIT) | Paid (clawpanel.app) |
| --- | --- | --- |
| Connect client | `npx clawpanel@latest connect` — one-line agent onboarding | — |
| MCP server | Local stdio server: workspace notes, free-tier run counter | Hosted HTTP MCP at `https://clawpanel.app/api/mcp` |
| Graph compiler | Roadmap (see below) | Hosted graphs |
| Server-side brain | — | Memory distillation, governance, approvals, vault, audit, hosted graphs, marketplace |

The rule: **your client is free; your brain is the service.** Customer content
stays portable — retrieval, governance, memory distillation, synchronization,
audit, and hosted operations are what you pay for.

### Free tier limits

- **1 workspace** per free account/install.
- **100 runs** per workspace, enforced locally by the MCP server
  (`workspace_run_consume` errors when the cap is reached).
- Local-only memory (notes in `.clawpanel/notes/`). No sync, no hosted
  graphs, no governance.

Upgrade to the hosted brain for uncapped runs, cross-agent memory
distillation, approvals, vault, and audit.

## Quickstart

### Free — local workspace (no account)

```bash
cd your-project
npx clawpanel@latest connect
```

Writes `.mcp.json` pointing your MCP client (Claude Code, Cursor, Codex, any
MCP client) at the local server:

```json
{
  "mcpServers": {
    "clawpanel": {
      "command": "npx",
      "args": ["-y", "clawpanel@latest", "serve"],
      "env": { "CLAWPANEL_WORKSPACE": "/path/to/your-project" }
    }
  }
}
```

The server exposes workspace-scoped tools (`workspace_status`,
`workspace_note_list`, `workspace_note_read`, `workspace_note_append`,
`workspace_run_status`, `workspace_run_consume`) — fully offline.

### Hosted — the paid server-side brain

```bash
npx clawpanel@latest connect --hosted --token <your-token> --runtime-key <your-runtime-key>
# optional: --api-url https://clawpanel.app
```

Writes the HTTP config for the hosted brain at
`<api-url>/api/mcp`. Tokens are issued from your ClawPanel account (the
web app's Connect flow).

### Other flags

```text
--output <file>   write config to a custom path (default ./.mcp.json)
--print           print the config JSON instead of writing a file
--workspace <dir> workspace directory (default: cwd)
```

## CLI reference

```text
clawpanel connect [--hosted] [--token <t>] [--runtime-key <key>] [--api-url <u>]
                  [--output <f>] [--print] [--workspace <dir>]
clawpanel serve [--workspace <dir>]
clawpanel --version | --help
```

`connect` without `--hosted` writes the free local config. `connect --hosted`
requires both `--token` (or `CLAWPANEL_TOKEN`) and `--runtime-key` (or
`CLAWPANEL_RUNTIME_KEY`). It writes `Authorization: Bearer …` and `x-runtime-key`
headers. Missing or blank credentials fail closed. Supply the token and matching
runtime key from the same Connect issuance; a legacy token alone cannot connect.
Prefer environment variables provisioned by your secret manager to avoid shell
history/process-argument exposure. Explicit flags take precedence over environment
variables. `--api-url` accepts an HTTPS origin only, without credentials, path,
query, or fragment. For local development, HTTP is allowed only for `localhost`,
`127.0.0.1`, or `[::1]` (with an optional port).

Config files are created exclusively with owner-only permissions (`0600` on POSIX).
An existing file or symlink is never overwritten, including existing ClawPanel
entries. If `.mcp.json` exists, use `--output` with a new filename and manually
merge only the `clawpanel` entry into your client's private config, preserving
other servers. Keep credential files out of version control and restrict their
permissions. `--print` outputs credentials in plaintext; avoid logs, shared
terminals, and CI output. Local mode does not require or include hosted credentials.

## Status: initial open-source scaffold (ZEUG-546)

> **SCAFFOLD NOTICE.** Before this release, `clawpanel-web` contained no
> standalone connect CLI and no standalone MCP server — the web app only
> offered a copy-paste `mcpServers` snippet for its hosted `/api/mcp`
> endpoint. The CLI and local MCP server in this repo are the first
> open-source implementations, scaffolded standalone and verified by tests.
> The hosted HTTP MCP endpoint remains the paid brain; the web app's
> Connect flow (`POST /api/mcp/tokens` + `/api/mcp`) is closed source.

### Roadmap

- [x] `npx clawpanel@latest connect` (local + hosted configs)
- [x] Local stdio MCP server (notes + free-tier run counter)
- [ ] **Graph compiler** — compile workspace knowledge + plans into a
      portable graph artifact (planned; not yet extracted from the web app's
      plan compiler, which remains part of the paid brain)
- [ ] MCP config auto-detection for more clients (Claude Code, Cursor,
      Codex verified; more TBD)
- [ ] HTTP transport for the local server (LAN/remote access)

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest — CLI + in-memory MCP protocol tests
npm run build       # tsc -> dist/
```

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) © 2026 Sidarau / Zeug Lab.

## Outbound runtime companion (staged, not yet published)

This is separate from `connect` (MCP configuration) and the native desktop app.
It connects an **already running, operator-managed local OpenAI-compatible bot**
to one browser-approved ClawPanel agent. It does not install Hermes/Grok, sign in
for you, start a shell, or install a background service. Requires Node 20.3+.
The runtime API must be deployed before pairing can succeed. These commands
refer to this source build, not the currently published npm package:

```sh
npm run build
node dist/cli.js runtime pair --name Omarchy --api-url https://clawpanel.app
# Open the printed URL yourself, sign in, review account/agent, and approve.
node dist/cli.js runtime run --endpoint http://127.0.0.1:8080/v1 --model YOUR_MODEL
```

The endpoint is a base URL; `/chat/completions` is appended. Only numeric IPv4
or IPv6 loopback HTTP/HTTPS addresses are accepted. Provide the existing local
runtime's API key through `CLAWPANEL_LOCAL_RUNTIME_API_KEY` in the environment,
never as an argument. No provider defaults or paid calls are configured.
The server cannot choose the endpoint/model or request a command. A connected
bot may have its own tools: configure its permissions separately. Messages and
session/request IDs are forwarded to that bot; no device credential is.

Pairing expires after ten minutes without browser approval. Approved access
expires at the server's date (up to 30 days); revoke it in ClawPanel. The device
credential is written only after approval to `~/.config/clawpanel/runtime.json`
(mode 0600, directory 0700). Existing unsafe permissions or symlinks are refused,
not silently repaired. All API calls stay at the exact configured HTTPS origin
(numeric loopback HTTP permitted for development), with redirects disabled.
The approval URL must match `/dashboard/runtime?code=SHORTCODE` at that origin.
No tokens or message contents are logged. Journal files contain cached replies,
so protect this private directory and exclude it from shared backups.

Run is foreground only. Ctrl-C/SIGTERM stops it; requests have a 60-second timeout
and failed connections use bounded 3–30 second backoff, stopping after ten
consecutive failures. Other permanent 4xx responses stop immediately. Revoked/expired access
stops the client. `runtime reconnect --name NAME --api-url ORIGIN` explicitly
replaces local credentials **only after** new browser approval. It does not
revoke the old server pairing; do that in ClawPanel. Neither command auto-opens
approval nor stores account passwords.

The private journal is fsynced before each runtime admission and before posting
its result. Cached results are resent idempotently after restart. Interrupted
admissions report an uncertain failure and are never automatically re-executed.
This is **best-effort at-most-once local admission**, not exactly-once remote tool
execution. It depends on preserving the journal and reliable local storage.
A new lease for an existing job is refused. A result rejected as an expired lease
(HTTP 409) is retired locally without deleting its admission record, so later
jobs can proceed. Replies over 16000 characters become bounded generic errors. To prevent replay after eviction,
the journal fails closed at 128 jobs instead of pruning history. At capacity,
review jobs, revoke the old runtime and explicitly reconnect as a new runtime;
old journals remain private and must not be deleted while their runtime is active.
This intentionally conservative staging limit needs a server-backed safe-retention
policy before unattended long-running usage. A process lock prevents concurrent
clients; after a crash, confirm all clients stopped before manually removing
`~/.config/clawpanel/runtime.lock`. Never remove it while a client is running.

Verification uses synthetic in-memory fake HTTP, not live pairing or bot calls:
`npm test && npm run typecheck && npm run build`.
