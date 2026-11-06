import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { endpoint, origin, pair, run, Store } from '../src/runtime/client.js';
const dirs: string[] = [];
// macOS /var is a symlink. Use the canonical private tmp directory for store tests.
import { realpathSync, chmodSync } from 'node:fs';
function dir() { const d = mkdtempSync(join(realpathSync(tmpdir()), 'runtime-fixture-')); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const token = 'cp_runtime_synthetic_test_only_123456789';
const cfg = () => ({ version: 1, origin: 'https://clawpanel.test', device_code: token, runtime_id: 'runtime-1', agent_id: 'agent-1', expires_at: new Date(Date.now() + 86400000).toISOString() });
const job = { id: 'job-1', lease_id: 'lease-1', agent_id: 'agent-1', message: 'synthetic message', session_key: 'session:test' };
function fake(fn: (url: string, init: RequestInit) => unknown): typeof fetch { return (async (url, init) => { const result = fn(String(url), init!); return result instanceof Response ? result : Response.json(result); }) as typeof fetch; }
function pairing() { return { pairing_id: 'pair-1', device_code: token, user_code: 'ABCD-1234', verification_url: 'https://clawpanel.test/dashboard/runtime?code=ABCD-1234', expires_at: new Date(Date.now() + 600000).toISOString() }; }
function journalName() { return 'journal-' + createHash('sha256').update('runtime-1:agent-1').digest('hex') + '.json'; }
function jobHash() { return createHash('sha256').update(job.id).digest('hex'); }
describe('runtime pairing', () => {
  it('writes only after browser approval, private scope and no secrets in output', async () => {
    const directory = dir(); const logs: string[] = []; let n = 0;
    await pair({ name: 'Omarchy', apiUrl: 'https://clawpanel.test' }, { directory, log: s => logs.push(s), sleep: async () => {}, fetch: fake((u, init) => {
      expect(init.redirect).toBe('error'); expect((init.headers as any).authorization).toBeUndefined();
      if (u.endsWith('/pairings')) return pairing();
      expect(new Store(directory).read('runtime.json')).toBeUndefined();
      return ++n === 1 ? { status: 'pending' } : { status: 'approved', ...cfg() };
    }) });
    expect(n).toBe(2); expect(new Store(directory).read('runtime.json')).toMatchObject({ device_code: token, agent_id: 'agent-1', runtime_id: 'runtime-1' });
    expect(statSync(join(directory, 'runtime.json')).mode & 0o777).toBe(0o600);
    expect(logs.join('')).not.toContain(token); expect(logs.join('')).toContain('ABCD-1234');
  });
  it.each(['revoked', 'expired', 'denied'])('never persists %s pairing', async status => {
    const directory = dir(); await expect(pair({ name: 'x', apiUrl: 'https://clawpanel.test' }, { directory, log: () => {}, sleep: async () => {}, fetch: fake(u => u.endsWith('/pairings') ? pairing() : { status }) })).rejects.toThrow();
    expect(new Store(directory).read('runtime.json')).toBeUndefined();
  });
  it('reconnect preserves old config until approval and rejects implicit overwrite', async () => {
    const directory = dir(); const s = new Store(directory); const previous = cfg(); s.write('runtime.json', previous); let requests = 0;
    const deps = { directory, log: () => {}, sleep: async () => {}, fetch: fake(u => { requests++; return u.endsWith('/pairings') ? pairing() : { status: 'revoked' }; }) };
    await expect(pair({ name: 'x', apiUrl: previous.origin }, deps)).rejects.toThrow('Already paired'); expect(requests).toBe(0);
    await expect(pair({ name: 'x', apiUrl: previous.origin, reconnect: true }, deps)).rejects.toThrow(); expect(s.read('runtime.json')).toEqual(previous);
    await pair({ name: 'x', apiUrl: previous.origin, reconnect: true }, { ...deps, fetch: fake(u => u.endsWith('/pairings') ? pairing() : { status: 'approved', ...cfg(), runtime_id: 'new-runtime' }) });
    expect(s.read('runtime.json')).toMatchObject({ runtime_id: 'new-runtime' });
  });
  it('rejects malicious approval origin before printing it or sending secret there', async () => {
    const directory = dir(); let calls = 0; const logs: string[] = [];
    await expect(pair({ name: 'x', apiUrl: 'https://clawpanel.test' }, { directory, log: s => logs.push(s), fetch: fake(() => { calls++; return { ...pairing(), verification_url: 'https://evil.test/' }; }) })).rejects.toThrow('Unsafe approval URL');
    expect(calls).toBe(1); expect(logs.join('')).not.toContain('evil.test');
  });
});
describe('foreground runtime', () => {
  it('keeps token at paired origin, adds scoped runtime headers, deduplicates repeated jobs', async () => {
    const directory = dir(); new Store(directory).write('runtime.json', cfg()); let runtime = 0; let results = 0; let polls = 0;
    await expect(run({ endpoint: 'http://127.0.0.1:8080/v1', model: 'hermes', runtimeApiKey: 'synthetic-local-key' }, { directory, sleep: async () => {}, log: () => {}, fetch: fake((u, init) => {
      expect(init.redirect).toBe('error'); const headers = init.headers as Record<string,string>; const body = JSON.parse(init.body as string);
      if (u.startsWith('http://127.0.0.1')) { runtime++; expect(u).toBe('http://127.0.0.1:8080/v1/chat/completions'); expect(headers.authorization).toBe('Bearer synthetic-local-key'); expect(headers['x-request-id']).toBe(job.id); expect(headers['x-session-key']).toBe(job.session_key); expect(body).toEqual({ model: 'hermes', messages: [{ role: 'user', content: job.message }], stream: false }); return { choices: [{ message: { content: 'synthetic reply' } }] }; }
      expect(new URL(u).origin).toBe('https://clawpanel.test'); expect(headers.authorization).toBe(`Bearer ${token}`);
      if (u.endsWith('/poll')) return ++polls <= 2 ? { job } : new Response('', { status: 401 });
      results++; expect(body).toEqual({ job_id: job.id, lease_id: job.lease_id, reply: 'synthetic reply' }); return { ok: true };
    }) })).rejects.toThrow('Authorization expired or revoked'); expect(runtime).toBe(1); expect(results).toBe(2);
  });
  it.each(['started', 'ready'])('recovers %s journal without executing runtime or needing redelivery', async state => {
    const directory = dir(); const s = new Store(directory); s.write('runtime.json', cfg());
    s.write(journalName(), { [jobHash()]: { job: job.id, lease: job.lease_id, state, ...(state === 'ready' ? { reply: 'cached reply' } : {}) } });
    let results = 0;
    await expect(run({ endpoint: 'http://127.0.0.1:8080/v1', model: 'hermes' }, { directory, sleep: async () => {}, fetch: fake((u, init) => {
      expect(u.startsWith('https://clawpanel.test/')).toBe(true);
      if (u.endsWith('/results')) { results++; const body = JSON.parse(init.body as string); if (state === 'started') expect(body.error).toContain('uncertain'); else expect(body.reply).toBe('cached reply'); return { ok: true }; }
      return new Response('', { status: 403 });
    }) })).rejects.toThrow('Authorization'); expect(results).toBe(1);
  });
  it('writes admission before calling runtime and reply before posting', async () => {
    const directory = dir(); const s = new Store(directory); s.write('runtime.json', cfg()); let polls = 0;
    await expect(run({ endpoint: 'http://127.0.0.1:8080/v1', model: 'x' }, { directory, sleep: async () => {}, fetch: fake(u => {
      if (u.endsWith('/poll')) return ++polls === 1 ? { job } : new Response('', { status: 401 });
      const journal = s.read<Record<string, any>>(journalName())!;
      if (u.startsWith('http:')) { expect(journal[jobHash()].state).toBe('started'); return { choices: [{ message: { content: 'reply' } }] }; }
      expect(journal[jobHash()]).toMatchObject({ state: 'ready', reply: 'reply' }); return {};
    }) })).rejects.toThrow('Authorization');
  });
  it('stops mismatched agent scope without calling runtime', async () => {
    const directory = dir(); new Store(directory).write('runtime.json', cfg()); let calls = 0;
    await expect(run({ endpoint: 'http://127.0.0.1:8080', model: 'x' }, { directory, fetch: fake(() => { calls++; return { job: { ...job, agent_id: 'wrong-agent' } }; }) })).rejects.toThrow('mismatched'); expect(calls).toBe(1);
  });
  it('retires expired result leases without repeating admission or wedging the queue', async () => {
    const directory = dir(); const store = new Store(directory); store.write('runtime.json', cfg());
    store.write(journalName(), { [jobHash()]: { job: job.id, lease: job.lease_id, state: 'ready', reply: 'cached' } });
    let results = 0; let polls = 0;
    await expect(run({ endpoint: 'http://127.0.0.1:8080', model: 'x' }, { directory, fetch: fake(u => {
      if (u.endsWith('/results')) { results++; return new Response('', { status: 409 }); }
      polls++; return new Response('', { status: 401 });
    }) })).rejects.toThrow('Authorization');
    expect(results).toBe(1); expect(polls).toBe(1);
    expect(store.read<Record<string, any>>(journalName())![jobHash()]).toMatchObject({ acknowledged: true, reply: 'cached' });
  });
  it('turns oversized replies into bounded generic errors', async () => {
    const directory = dir(); new Store(directory).write('runtime.json', cfg()); let polls = 0; let results = 0;
    await expect(run({ endpoint: 'http://127.0.0.1:8080', model: 'x' }, { directory, sleep: async () => {}, fetch: fake((u, init) => {
      if (u.endsWith('/poll')) return ++polls === 1 ? { job } : new Response('', { status: 401 });
      if (u.startsWith('http:')) return { choices: [{ message: { content: 'x'.repeat(16001) } }] };
      results++; const body = JSON.parse(init.body as string); expect(body.reply).toBeUndefined(); expect(body.error).toContain('uncertain'); expect(body.error.length).toBeLessThan(100); return {};
    }) })).rejects.toThrow('Authorization'); expect(results).toBe(1);
  });
  it('bounds transient retry count and backoff', async () => {
    const directory = dir(); new Store(directory).write('runtime.json', cfg()); let calls = 0; const delays: number[] = [];
    await expect(run({ endpoint: 'http://127.0.0.1:8080', model: 'x' }, { directory, log: () => {}, sleep: async ms => { delays.push(ms); }, fetch: fake(() => { calls++; return new Response('', { status: 503 }); }) })).rejects.toThrow('Ten consecutive');
    expect(calls).toBe(10); expect(Math.max(...delays)).toBe(30000);
  });
  it('honors abort and releases lock', async () => {
    const directory = dir(); new Store(directory).write('runtime.json', cfg()); const controller = new AbortController();
    await run({ endpoint: 'http://127.0.0.1:8080', model: 'x' }, { directory, signal: controller.signal, sleep: async () => { controller.abort(); }, fetch: fake(() => ({ job: null })) });
    expect(readdirSync(directory)).not.toContain('runtime.lock');
  });
});
describe('boundary checks', () => {
  it.each(['http://evil.test', 'https://x.test/path', 'https://user:pass@x.test', 'https://x.test?token=x'])('rejects API %s', value => expect(() => origin(value)).toThrow());
  it.each(['http://localhost:8080', 'https://evil.test', 'http://127.0.0.1?x=y', 'http://user:pass@127.0.0.1', 'http://127.0.0.1/#x'])('rejects endpoint %s', value => expect(() => endpoint(value)).toThrow());
  it('refuses symlink files and directories and concurrent clients', () => {
    const directory = dir(); const s = new Store(directory); const release = s.lock(); expect(() => s.lock()).toThrow('locked'); release();
    symlinkSync(join(directory, 'missing'), join(directory, 'runtime.json')); expect(() => s.write('runtime.json', cfg())).toThrow();
    const unsafe = dir(); chmodSync(unsafe, 0o777); expect(() => new Store(join(unsafe, 'child'))).toThrow('ancestor');
    const alias = join(dir(), 'alias'); symlinkSync(directory, alias); expect(() => new Store(alias)).toThrow('Unsafe');
  });
});
