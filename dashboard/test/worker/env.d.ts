// Bindings only the tests have (test/worker/vitest.config.ts)
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
  }
}
