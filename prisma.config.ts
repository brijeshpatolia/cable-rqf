import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 configuration.
 *
 * Connection URLs live here rather than in schema.prisma — Prisma 7 removed
 * `url`/`directUrl` from the schema language and made driver adapters
 * mandatory.
 *
 * Everything here uses DIRECT_URL. Against Neon that matters: the pooled
 * endpoint cannot reliably run DDL, so migrations must take the direct one.
 * The pooled URL is used only by the running app, which builds its own client.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Read directly rather than through prisma/config's `env`, which throws
    // when the variable is absent. `generate` needs no database; only
    // `migrate` does, and that fails with a clear message of its own.
    url: process.env['DIRECT_URL'] ?? '',
  },
});
