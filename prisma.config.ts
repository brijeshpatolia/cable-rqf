import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';

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
    url: env('DIRECT_URL'),
  },
  adapter: async () => new PrismaPg({ connectionString: env('DIRECT_URL') }),
});
