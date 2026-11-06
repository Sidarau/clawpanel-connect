# ZEUG-828 staged outbound companion

Scope: source-build CLI, separate from native PR680. No installation, launch
agent, live sign-in, credentials, pairing, bot requests, deployment or publication.
Goal/dispatch/BAMA loaded. Managed refresh verified revision
`af5ed87de1455ecc721b688883283fb19ff6f518`, 2355 files. Read-only workspace boot
reported pre-existing root aliases and `.tmp-pf`; these were preserved. Actual
source is the connect-client Git repository, new manual runtime-client worktree
from reviewed compatibility commit `4a99adec000c73da0cfbfbe014ecd63d4415ab9c`.

Dispatch prescription: ZEUG-828; script/auth; current selected Codex session,
local native worker; high effort; medium risk staged synthetic-only changes;
no incremental paid resources authorized; checker independent parent-arranged
reviewer (same provider available, separate required Claude gate outstanding).
Acceptance: `npm test`, `npm run typecheck`, `npm run build`; fixture assertions
cover approval/denial, scope, exact origin, separate runtime key, replay, uncertain
restart, revocation, symlinks, reconnect and abort. No UI changes in this repo.

Implementation adds `runtime pair`, `runtime reconnect`, `runtime run`.
Persistent-access actions are only implemented, never executed in this task.
Journal capacity is 128 without unsafe eviction. Review README restrictions.
Remaining: independent security review, required release review, backend/CLI
cross-contract check and authorized live end-to-end smoke test. No merge,
production deployment, npm publication or native signing is claimed.

Loop suitability (zeug-loop): manual foreground trigger; repeated queued chat
jobs only; project boundary is one approved ClawPanel agent and operator-selected
local runtime. Private journal plus lock is persistent state. This file is the
handoff. Verifier is the synthetic test suite. 128 admissions/runtime, 60-second
request timeout, 10 consecutive transient failures, credential expiry/revocation,
invalid scope, permanent 4xx and SIGINT/SIGTERM are hard stops. Job ID admission
and exact lease result replay prevent local duplicates. Human browser approval
is required at pairing; no scheduler/daemon installed. Stop foreground process
and revoke server pairing to disable. Credentials never reach logs or the local
runtime. Success criterion: one local admission per unique job with durable
result recovery. Unattended readiness and real tool exactly-once execution are
not claimed.

Independent review follow-up: result HTTP409 now retires stale result delivery
without deleting admission; replies align to server max16000; unsafe writable
ancestors are refused (root-owned sticky temp permitted for synthetic fixtures).
Regression suite passed: 69 tests, strict typecheck, build. No real network calls.

Cross-repository integration proof (2026-11-06):
`./node_modules/.bin/vitest run --config integration/vitest.config.ts` passed 1/1
against the sibling runtime-companion-20261106 working tree (backend base HEAD
b58bb4c2276537187423ff07cab0f54e9f3bdbc3 plus staged runtime implementation).
Actual client functions, actual web HTTP/service code and injected memory adapter
completed pair/authenticated approval/enqueue/poll/local HTTP bot/result, lost-ACK
restart, reconnect and revoke. Two unique jobs generated exactly two fake bot
calls and two persisted fixture replies. Normal tests passed 69/69, typecheck and
build passed. See integration/README.md for repeatable command and evidence limits.
