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
npx clawpanel@latest connect --hosted --token <your-token>
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
clawpanel connect [--hosted] [--token <t>] [--api-url <u>]
                  [--output <f>] [--print] [--workspace <dir>]
clawpanel serve [--workspace <dir>]
clawpanel --version | --help
```

`connect` without `--hosted` writes the free local config. `connect --hosted`
requires `--token` (or the `CLAWPANEL_TOKEN` env var) and writes the hosted
HTTP config.

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
