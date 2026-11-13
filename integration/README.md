# Cross-repository runtime contract fixture

Run from the connect-client repository:

```sh
CLAWPANEL_WEB_SOURCE=../runtime-companion-20261106 \
  ./node_modules/.bin/vitest run --config integration/vitest.config.ts
```

The web path must contain the runtime HTTP/service/memory-store modules and its
installed dependencies. Default is the sibling runtime-companion-20261106 tree.
Normal `npm test` intentionally excludes this optional cross-repository fixture.

The test executes actual exported client `pair`/`run`, web `runtimeHTTP`, service
commands and `MemoryRuntimeStore`. Only browser identity and the production
Postgres adapter are replaced. API HTTP Requests/Responses pass through the real
web handler in-process, without a web server or DNS. The fake bot binds an
OS-assigned port on 127.0.0.1 and receives real HTTP requests. Everything is
synthetic; no real account, grant, pairing, credential or paid API is used.
The temporary private config/journal is deleted in teardown.

Assertions cover:
- Pairing creation, failed unauthenticated approval, then explicit simulated
  authenticated browser approval and client scope persistence.
- A synthetic user message stored in the memory adapter, then actual service
  enqueue, client poll, local fake bot response and backend result persistence.
- A successful result with a deliberately lost acknowledgment, process restart,
  cached result resubmission and backend idempotency: exactly one local bot call
  and one reply stored for that job.
- Explicit reconnect creates a newly approved scope and retires the previous
  runtime; old bearer polling is rejected.
- A second job completes under the new scope, then authenticated revocation
  causes the foreground client to stop.

This proves HTTP/service/client compatibility and memory-adapter behavior, not
Postgres migrations/RLS, real browser authentication, deployment, genuine bot
integration, or exactly-once remote tools.

Observed 2026-11-06: integration 1/1 passed, with two total fake bot calls for two
unique queued jobs. Baseline unit suite remains separately runnable.
