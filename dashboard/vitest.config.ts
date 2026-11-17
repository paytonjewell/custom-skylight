import { defineConfig } from 'vitest/config';

// `npm test` runs two kinds of tests:
// - unit: plain functions from src/ and worker/, in Node (test/*.test.ts)
// - worker: the Worker itself in the Workers runtime, with a real local D1 and R2 (test/worker/)
export default defineConfig({
  test: {
    projects: [{ test: { name: 'unit', include: ['test/*.test.ts'], environment: 'node' } }, 'test/worker'],
  },
});
