import { defineConfig } from 'vitest/config';
// Cross-repository integration fixtures are opt-in and never required by npm test.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
