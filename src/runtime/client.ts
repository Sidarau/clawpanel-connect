import { constants, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, fstatSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

export class RuntimeError extends Error {}
class Stopped extends RuntimeError {}
class ResultConflict extends RuntimeError {}
type Config = { version: 1; origin: string; device_code: string; runtime_id: string; agent_id: string; expires_at: string };
type Entry = { state: 'started' | 'ready'; job: string; acknowledged?: boolean; lease: string; reply?: string; error?: string };
type Journal = Record<string, Entry>;
export type Dependencies = { fetch?: typeof fetch; signal?: AbortSignal; sleep?: (ms: number) => Promise<void>; log?: (text: string) => void; directory?: string };
function fail(message: string): never { throw new RuntimeError(message); }
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
function record(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) return fail('Invalid response'); return v as Record<string, unknown>; }
function text(v: unknown, max: number): string { if (typeof v !== 'string' || !v.length || v.length > max) return fail('Invalid response'); return v; }
export function origin(input: string): string {
  let u: URL; try { u = new URL(input); } catch { return fail('Invalid API URL'); }
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/' || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(u.hostname)))) return fail('API must be an HTTPS origin (numeric loopback HTTP allowed for development)');
  return u.origin;
}
export function endpoint(input: string): string {
  let u: URL; try { u = new URL(input); } catch { return fail('Invalid runtime endpoint'); }
  if (!['http:', 'https:'].includes(u.protocol) || !['127.0.0.1', '[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash) return fail('Runtime endpoint must be numeric loopback HTTP/HTTPS without credentials, query or fragment');
  u.pathname = u.pathname.replace(/\/$/, '') + '/chat/completions';
  return u.href;
}
/** Private store; refuse symlinks in every path component and unsafe ownership/modes. */
export class Store {
  readonly directory: string;
  constructor(directory = join(homedir(), '.config', 'clawpanel')) {
    this.directory = resolve(directory);
    let path: string = sep;
    for (const part of this.directory.split(sep).filter(Boolean)) {
      path = join(path, part);
      if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
      const st = lstatSync(path);
      if (st.isSymbolicLink() || !st.isDirectory()) fail('Unsafe config directory');
      const trustedOwner = st.uid === 0 || st.uid === process.getuid?.();
      const protectedTemp = st.uid === 0 && (st.mode & 0o1000) !== 0;
      if (!trustedOwner || ((st.mode & 0o022) !== 0 && !protectedTemp)) fail('Unsafe writable config ancestor');
    }
    const st = lstatSync(this.directory);
    if ((st.mode & 0o077) || st.uid !== process.getuid?.()) fail('Config directory must be owned by you with mode 0700');
  }
  read<T>(name: string): T | undefined {
    const path = join(this.directory, name);
    let fd: number;
    try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; return fail('Cannot safely read config file'); }
    try {
      const st = fstatSync(fd);
      if (!st.isFile() || st.uid !== process.getuid?.() || (st.mode & 0o077) || st.nlink !== 1 || st.size > 8_000_000) fail('Unsafe config file');
      return JSON.parse(readFileSync(fd, 'utf8')) as T;
    } finally { closeSync(fd); }
  }
  write(name: string, value: unknown) {
    this.read(name); // Validate existing target before replacement.
    const tmp = join(this.directory, `.tmp-${randomUUID()}`);
    const fd = openSync(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, join(this.directory, name));
    const dir = openSync(this.directory, constants.O_RDONLY); try { fsyncSync(dir); } finally { closeSync(dir); }
  }
  lock(): () => void {
    const path = join(this.directory, 'runtime.lock');
    let fd: number; try { fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); } catch { return fail('Runtime is locked. Stop other clients; after a crash remove runtime.lock manually before retrying.'); }
    writeFileSync(fd, String(process.pid)); closeSync(fd);
    return () => unlinkSync(path);
  }
}
function config(store: Store): Config {
  const c = store.read<Config>('runtime.json');
  if (!c || c.version !== 1 || origin(c.origin) !== c.origin || !/^cp_runtime_[A-Za-z0-9_-]{16,256}$/.test(c.device_code) || !identifier(c.runtime_id) || !identifier(c.agent_id) || !Number.isFinite(Date.parse(c.expires_at))) return fail('No valid runtime pairing. Run runtime pair.');
  if (Date.parse(c.expires_at) <= Date.now()) return fail('Runtime pairing expired. Use runtime reconnect.');
  return c;
}
function context(d: Dependencies) {
  const signal = d.signal ?? new AbortController().signal;
  return { signal, log: d.log ?? ((s: string) => process.stdout.write(s + '\n')),
    sleep: d.sleep ?? ((ms: number) => new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Stopped('Stopped'));
      const abort = () => { clearTimeout(timer); reject(new Stopped('Stopped')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
      signal.addEventListener('abort', abort, { once: true });
    })),
    async request(url: string, body: unknown, token?: string, extra: Record<string, string> = {}) {
      if (signal.aborted) throw new Stopped('Stopped');
      let response: Response;
      try { response = await (d.fetch ?? fetch)(url, { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra }, body: JSON.stringify(body) }); }
      catch { if (signal.aborted) throw new Stopped('Stopped'); throw new RuntimeError('Request failed or timed out'); }
      if (response.status === 409 && new URL(url).pathname === '/api/runtime/results') throw new ResultConflict('Lease no longer accepts results');
      if (response.status === 401 || response.status === 403) throw new Stopped('Authorization expired or revoked');
      if (response.status >= 400 && response.status < 500 && response.status !== 429) throw new Stopped('Request rejected; manual review required');
      if (!response.ok) throw new RuntimeError('Request rejected');
      // Bound decoded response bytes, even when Content-Length is absent or false.
      const reader = response.body?.getReader(); if (!reader) return fail('Empty response');
      let size = 0; const chunks: Uint8Array[] = [];
      try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 131072) { await reader.cancel(); return fail('Response too large'); } chunks.push(value); } } finally { reader.releaseLock(); }
      try { return record(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { return fail('Invalid response'); }
    }
  };
}
export async function pair(options: { name: string; apiUrl: string; reconnect?: boolean }, d: Dependencies = {}) {
  const api = origin(options.apiUrl); if (!options.name.trim() || options.name.length > 80 || /[\x00-\x1f\x7f]/.test(options.name)) fail('Invalid runtime name');
  const s = new Store(d.directory); const release = s.lock();
  try {
    if (s.read('runtime.json') && !options.reconnect) fail('Already paired. Use runtime reconnect explicitly.');
    const c = context(d);
    c.log('Pairing requires browser approval. Review the account and selected agent. Approval permits this foreground client to receive that agent’s messages and return replies for up to 30 days. Reconnect replaces the local pairing only after approval; revoke the old pairing in ClawPanel.');
    const p = await c.request(api + '/api/runtime/pairings', { name: options.name, adapter: 'openai-compatible' });
    if (!identifier(p.pairing_id) || typeof p.device_code !== 'string' || !/^cp_runtime_[A-Za-z0-9_-]{16,256}$/.test(p.device_code)) fail('Invalid pairing response');
    const code = text(p.user_code, 32); if (!/^[A-Z0-9-]+$/.test(code)) fail('Invalid approval code');
    const u = new URL(text(p.verification_url, 2048));
    if (u.origin !== api || u.pathname !== '/dashboard/runtime' || u.searchParams.size !== 1 || u.searchParams.get('code') !== code || u.username || u.password || u.hash || u.href.includes(p.device_code) || /[\x00-\x1f\x7f]/.test(String(p.verification_url))) fail('Unsafe approval URL');
    const deadline = Date.parse(text(p.expires_at, 64)); if (!Number.isFinite(deadline) || deadline <= Date.now() || deadline > Date.now() + 610_000) fail('Invalid pairing expiry');
    c.log(`Open ${u.href}\nApproval code: ${code}`);
    while (Date.now() < deadline) {
      await c.sleep(3000);
      const status = await c.request(api + '/api/runtime/pairings/status', { device_code: p.device_code });
      if (status.status === 'pending') continue;
      if (status.status !== 'approved') fail('Pairing denied, expired or revoked');
      if (!identifier(status.runtime_id) || !identifier(status.agent_id) || typeof status.expires_at !== 'string' || !Number.isFinite(Date.parse(status.expires_at)) || Date.parse(status.expires_at) <= Date.now() || Date.parse(status.expires_at) > Date.now() + 31 * 86400000) fail('Invalid approved scope');
      s.write('runtime.json', { version: 1, origin: api, device_code: p.device_code, runtime_id: status.runtime_id, agent_id: status.agent_id, expires_at: status.expires_at } satisfies Config);
      c.log('Runtime paired. Start runtime run in the foreground with your local endpoint and model.'); return;
    }
    fail('Pairing expired');
  } finally { release(); }
}
export async function run(options: { endpoint: string; model: string; runtimeApiKey?: string }, d: Dependencies = {}) {
  const target = endpoint(options.endpoint);
  if (!options.model.trim() || options.model.length > 256 || /[\x00-\x1f\x7f]/.test(options.model)) fail('Invalid model');
  const s = new Store(d.directory); const release = s.lock();
  try {
    const cfg = config(s); const c = context(d);
    if (options.runtimeApiKey === cfg.device_code) fail('Runtime key must not be the ClawPanel credential');
    const journalName = 'journal-' + createHash('sha256').update(cfg.runtime_id + ':' + cfg.agent_id).digest('hex') + '.json';
    const journal = s.read<Journal>(journalName) ?? {};
    async function postResult(body: unknown) {
      try { await c.request(cfg.origin + '/api/runtime/results', body, cfg.device_code); }
      catch (e) { if (!(e instanceof ResultConflict)) throw e; /* Keep admission, retire expired result. */ }
    }
    if (!journal || typeof journal !== 'object' || Array.isArray(journal) || Object.keys(journal).length > 128) fail('Invalid journal');
    for (const [key, entry] of Object.entries(journal)) {
      if (!entry || !identifier(entry.job) || !identifier(entry.lease) || createHash('sha256').update(entry.job).digest('hex') !== key || !['started', 'ready'].includes(entry.state) || (entry.reply !== undefined && (typeof entry.reply !== 'string' || entry.reply.length > 16000)) || (entry.error !== undefined && typeof entry.error !== 'string')) fail('Invalid journal');
    }
    let backoff = 3000; let failures = 0;
    while (!c.signal.aborted) {
      if (Date.parse(cfg.expires_at) <= Date.now()) throw new Stopped('Runtime pairing expired');
      try {
        // Recover results even if the backend never re-delivers a leased job.
        for (const [key, cached] of Object.entries(journal)) {
          if (cached.acknowledged) continue;
          const ready: Entry = cached.state === 'started' ? { job: cached.job, state: 'ready', lease: cached.lease, error: 'Runtime outcome uncertain after interruption; not retried automatically.' } : cached;
          journal[key] = ready; s.write(journalName, journal);
          await postResult({ job_id: ready.job, lease_id: ready.lease, ...(ready.reply !== undefined ? { reply: ready.reply } : { error: ready.error }) });
          ready.acknowledged = true; s.write(journalName, journal);
        }
        const polled = await c.request(cfg.origin + '/api/runtime/poll', {}, cfg.device_code);
        if (polled.job === null) { failures = 0; backoff = 3000; await c.sleep(3000); continue; }
        const job = record(polled.job);
        if (!identifier(job.id) || !identifier(job.lease_id) || job.agent_id !== cfg.agent_id || typeof job.message !== 'string' || job.message.length > 32000 || typeof job.session_key !== 'string' || !/^[a-zA-Z0-9:_-]{1,256}$/.test(job.session_key)) throw new Stopped('Invalid or mismatched job scope');
        const key = createHash('sha256').update(job.id).digest('hex');
        let entry = Object.hasOwn(journal, key) ? journal[key] : undefined;
        if (entry && (entry.lease !== job.lease_id || !['started', 'ready'].includes(entry.state))) throw new Stopped('Journal lease mismatch; manual review required');
        if (!entry) {
          // Fail closed rather than evict admission records and risk executing old jobs again.
          if (Object.keys(journal).length >= 128) throw new Stopped('Local journal is full; review and reconnect with a new runtime before continuing');
          entry = { job: job.id, state: 'started', lease: job.lease_id }; journal[key] = entry;
          s.write(journalName, journal);
          try {
            const response = await c.request(target, { model: options.model, messages: [{ role: 'user', content: job.message }], stream: false }, options.runtimeApiKey, { 'x-request-id': job.id, 'x-session-key': job.session_key });
            const choices = response.choices; const choice = Array.isArray(choices) ? record(choices[0]) : fail('Invalid runtime response');
            entry = { job: job.id, state: 'ready', lease: job.lease_id, reply: text(record(choice.message).content, 16000) };
          } catch { entry = { job: job.id, state: 'ready', lease: job.lease_id, error: 'Runtime outcome uncertain; not retried automatically.' }; }
        } else if (entry.state === 'started') entry = { job: job.id, state: 'ready', lease: job.lease_id, error: 'Runtime outcome uncertain after interruption; not retried automatically.' };
        journal[key] = entry; s.write(journalName, journal);
        await postResult({ job_id: job.id, lease_id: job.lease_id, ...(entry.reply !== undefined ? { reply: entry.reply } : { error: entry.error }) });
        entry.acknowledged = true; s.write(journalName, journal);
        failures = 0; backoff = 3000; await c.sleep(3000);
      } catch (e) {
        if (e instanceof Stopped) throw e;
        if (!(e instanceof RuntimeError)) throw new Stopped('Local storage failed; stopped without repeating runtime work');
        if (++failures >= 10) throw new Stopped('Ten consecutive failures; stopped. Restart after checking the connection.');
        c.log('Connection or storage error. Retrying without repeating admitted runtime jobs.');
        await c.sleep(backoff); backoff = Math.min(backoff * 2, 30000);
      }
    }
  } finally { release(); }
}
