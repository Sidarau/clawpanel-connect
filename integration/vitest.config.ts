import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
const backend = resolve(process.env.CLAWPANEL_WEB_SOURCE ?? '../runtime-companion-20261106');
export default defineConfig({
  resolve: { alias: { 'runtime-web': backend, '@': resolve(backend, 'src') } },
  test: { include: ['integration/runtime-contract.test.ts'], testTimeout: 15000 },
});
