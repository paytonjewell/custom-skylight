// Runs before each Worker test file: bring the local D1 up to date with migrations/
import { applyD1Migrations, env } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
