// The Worker tests: worker/index.ts runs in the Workers runtime (Miniflare) with a local D1 that has
// every migration applied (setup.ts), and R2. Test values here win over a local .dev.vars.
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineProject } from 'vitest/config';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const staticFile = (req: Request) => new Response(`static file ${new URL(req.url).pathname}`);

export default defineProject(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: here('../../wrangler.jsonc') },
      miniflare: {
        // Test values only (see .dev.vars.example), never the real household's
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(here('../../migrations')),
          DASHBOARD_PIN: '135790',
          FAMILY: JSON.stringify([
            { id: 'john', name: 'John' },
            { id: 'mary', name: 'Mary' },
          ]),
          HOME_TZ: 'America/Chicago',
          APP_UPLOAD_TOKEN: 'test-upload-token-0123456789abcdef0123456789',
        },
        // The app's built files (dist/) aren't needed: this stands in for them, so a test can see
        // which requests reach the static files and which the Worker answers itself
        serviceBindings: {
          ASSETS: staticFile,
        },
      },
    }),
  ],
  test: {
    name: 'worker',
    include: ['**/*.test.ts'],
    setupFiles: ['./setup.ts'],
  },
}));
