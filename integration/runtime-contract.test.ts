/** Cross-repository fixture: real client + HTTP validation + service + memory adapter.
 * Only browser identity and database custody are mocked. The bot is real loopback HTTP.
 */
import { expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pair, run, Store } from '../src/runtime/client';
const injected = vi.hoisted(() => ({ store: null as any, session: null as any }));
vi.mock('@/lib/hermes/auth', () => ({ getSessionTenant: async () => injected.session }));
vi.mock('runtime-web/src/lib/runtime/store', () => ({
  PostgresRuntimeStore: class { command(action: any, input: any) { return injected.store.command(action, input); } },
}));
import { runtimeHTTP, type Endpoint } from 'runtime-web/src/lib/runtime/http';
import { enqueueRuntimeMessage } from 'runtime-web/src/lib/runtime/service';
import { MemoryRuntimeStore } from 'runtime-web/src/lib/runtime/memory-store';

it('pairs with authenticated approval, delivers once, resumes lost result ACK, reconnects and stops on revoke', async () => {
  const oldEnabled = process.env.CLAWPANEL_RUNTIME_ENABLED;
  process.env.CLAWPANEL_RUNTIME_ENABLED = '1';
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'claw-contract-fixture-'));
  const db = new MemoryRuntimeStore(); injected.store = db;
  const tenantId = randomUUID(), userId = randomUUID(), agentId = randomUUID();
  db.members.add(`${tenantId}:${userId}`); db.agents.set(agentId, tenantId);
  const api = 'https://clawpanel.integration.invalid'; // In-process only, never resolved.
  let botCalls = 0;
  const bot = createServer(async (req, res) => {
    try {
      expect(req.url).toBe('/v1/chat/completions');
      expect(req.headers.authorization).toBe('Bearer fixture-local-key');
      expect(req.headers['x-session-key']).toMatch(/^[a-f0-9]{32}$/);
      expect(req.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
      const parts = []; for await (const chunk of req) parts.push(chunk);
      const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
      expect(body.model).toBe('fixture-model'); expect(body.messages[0].role).toBe('user');
      botCalls++; res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: `fixture reply ${botCalls}` } }] }));
    } catch { res.writeHead(500); res.end('{}'); }
  });
  await new Promise<void>(resolve => bot.listen(0, '127.0.0.1', resolve));
  const address = bot.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const botOrigin = `http://127.0.0.1:${address.port}`;
  const options = { endpoint: `${botOrigin}/v1`, model: 'fixture-model', runtimeApiKey: 'fixture-local-key' };
  const endpointMap: Record<string, Endpoint> = {
    '/api/runtime/pairings': 'create', '/api/runtime/pairings/status': 'status',
    '/api/runtime/pairings/approve': 'approve', '/api/runtime/poll': 'poll', '/api/runtime/results': 'result',
  };
  let loseResultAck = false; let activeAbort: AbortController | undefined;
  const transport: typeof fetch = async (url, init) => {
    const u = new URL(String(url)); expect(init?.redirect).toBe('error');
    if (u.origin === botOrigin) return fetch(url, init);
    expect(u.origin).toBe(api); // Any attempt to leave the injected API/bot fails.
    const ep = endpointMap[u.pathname]; if (!ep) throw new Error('Unknown fixture endpoint');
    const response = await runtimeHTTP(new Request(String(url), init), ep);
    if (ep === 'result' && loseResultAck && response.ok) {
      loseResultAck = false; activeAbort?.abort(); throw new Error('Synthetic network lost result ACK');
    }
    return response;
  };
  const approve = async () => {
    const pending = [...db.devices.values()].find(d => d.status === 'pending'); expect(pending).toBeDefined();
    const request = () => new Request(`${api}/api/runtime/pairings/approve`, { method: 'POST', headers: { 'content-type': 'application/json', origin: api }, body: JSON.stringify({ user_code: pending!.user_code, agent_id: agentId }) });
    injected.session = null;
    expect((await runtimeHTTP(request(), 'approve')).status).toBe(401);
    injected.session = { tenantId, user: { id: userId } }; // Explicit simulated browser approval.
    expect((await runtimeHTTP(request(), 'approve')).status).toBe(200);
  };
  const enqueue = async (runtimeId: string) => {
    const messageId = randomUUID();
    db.messages.set(messageId, { id: messageId, tenant_id: tenantId, user_id: userId, agent_id: agentId, role: 'user', content: 'Synthetic persisted user message' });
    return enqueueRuntimeMessage({ tenantId, userId, agentId, runtimeId, messageId }, db);
  };
  try {
    const logs: string[] = [];
    await pair({ name: 'Fixture Omarchy', apiUrl: api }, { directory, fetch: transport, log: s => logs.push(s), sleep: approve });
    const local = new Store(directory); const first = local.read<any>('runtime.json');
    expect(logs.join('')).not.toContain(first.device_code);
    expect(db.devices.get(first.runtime_id)?.status).toBe('approved');
    const queued = await enqueue(first.runtime_id); expect(queued.status).toBe('queued');
    loseResultAck = true; activeAbort = new AbortController();
    await expect(run(options, { directory, fetch: transport, signal: activeAbort.signal, sleep: async () => {}, log: () => {} })).rejects.toThrow('Stopped');
    expect(botCalls).toBe(1); expect(db.jobs.get(queued.job_id)?.status).toBe('completed');
    expect([...db.messages.values()].filter(m => m.role === 'agent')).toHaveLength(1);
    // Resume resends cached reply; actual backend accepts same lease idempotently.
    activeAbort = new AbortController();
    await run(options, { directory, fetch: transport, signal: activeAbort.signal, sleep: async () => { activeAbort!.abort(); } });
    expect(botCalls).toBe(1); expect([...db.messages.values()].filter(m => m.role === 'agent')).toHaveLength(1);
    // Reconnect uses a new human-approved pairing and rotates the existing scope.
    await pair({ name: 'Fixture reconnect', apiUrl: api, reconnect: true }, { directory, fetch: transport, log: () => {}, sleep: approve });
    const second = local.read<any>('runtime.json'); expect(second.runtime_id).not.toBe(first.runtime_id);
    expect(db.devices.get(first.runtime_id)?.status).toBe('revoked');
    const revokedPoll = await runtimeHTTP(new Request(`${api}/api/runtime/poll`, { method: 'POST', headers: { authorization: `Bearer ${first.device_code}` } }), 'poll');
    expect(revokedPoll.status).toBe(401);
    await enqueue(second.runtime_id);
    await expect(run(options, { directory, fetch: transport, sleep: async () => {
      const revoked = await runtimeHTTP(new Request(`${api}/api/runtime/devices/${second.runtime_id}`, { method: 'POST', headers: { origin: api } }), 'revoke', second.runtime_id);
      expect(revoked.status).toBe(200);
    } })).rejects.toThrow('Authorization expired or revoked');
    expect(botCalls).toBe(2); expect([...db.messages.values()].filter(m => m.role === 'agent')).toHaveLength(2);
  } finally {
    await new Promise<void>((resolve, reject) => bot.close(err => err ? reject(err) : resolve()));
    rmSync(directory, { recursive: true, force: true });
    injected.store = null; injected.session = null;
    if (oldEnabled === undefined) delete process.env.CLAWPANEL_RUNTIME_ENABLED; else process.env.CLAWPANEL_RUNTIME_ENABLED = oldEnabled;
  }
});
