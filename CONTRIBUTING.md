# Contributing to ClawPanel Connect

Thanks for helping build the open-source surface of ClawPanel. This repo is
the free/open wedge: the connect client and the local MCP server. The paid
server-side brain (memory distillation, governance, approvals, vault, audit,
hosted graphs, marketplace) is **not** open source — see the open-core split
in [README.md](./README.md).

## Ground rules

- **MIT licensed.** Everything you contribute must be compatible with the MIT
  license. Do not copy code from other projects without noting its license.
- **No secrets, ever.** Never commit tokens, keys, `.env` files, or personal
  data. If you find a secret, report it privately instead of opening an issue.
- **Keep the free surface self-contained.** The CLI and MCP server must work
  offline and without an account. Do not add required calls to paid services.
- **TypeScript strict.** New code must typecheck with `npm run typecheck`.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest (CLI + MCP protocol tests)
npm run build       # tsc -> dist/
```

The MCP server is exercised end-to-end in tests via the SDK's in-memory
transport (`test/server.test.ts`); keep that pattern when adding tools.

## Submitting changes

1. Fork the repo and create a feature branch (`feat/...`, `fix/...`).
2. Make small, focused commits.
3. Run `npm run typecheck && npm test && npm run build` locally.
4. Open a pull request; CI runs the same checks on Node 20/22/24.

## Reporting issues

- Bugs: include the `clawpanel --version` output, OS, and Node version.
- Feature requests: describe the workflow, not the implementation.
- Security: do **not** open a public issue — report privately to the
  maintainers.

## License

By contributing you agree that your contributions are licensed under the
[MIT License](./LICENSE).
