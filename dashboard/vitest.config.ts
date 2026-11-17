import { defineConfig } from 'vitest/config';

// `npm test` runs two kinds of tests:
// - unit: plain functions from src/ and worker/, in Node (test/*.test.ts)
// - worker: the Worker itself in the Workers runtime, with a real local D1 and R2 (test/worker/)
// The app shows times in the household's zone (the frame's clock), and the tests are written for it.
// Set before the test workers start, so they run the same on a laptop as on CI's UTC machines.
process.env.TZ = 'America/Chicago';

export default defineConfig({
  test: {
    projects: [{ test: { name: 'unit', include: ['test/*.test.ts'], environment: 'node' } }, 'test/worker'],
  },
});
