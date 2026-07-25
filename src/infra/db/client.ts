import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * The Prisma client, as a module-scope singleton.
 *
 * Next.js reloads modules on every edit in development, so a client created
 * per import would open a new connection pool each time and exhaust Postgres
 * within a few saves. The global cache is the documented way round it.
 *
 * In production on Vercel, module scope is per-instance and Fluid keeps
 * instances warm, so one pool is reused across many requests — which is why
 * `@prisma/adapter-pg` over node-postgres is the right choice here rather than
 * the HTTP serverless driver. This is a Node-runtime app, not edge.
 *
 * The pooled `DATABASE_URL` is used at runtime. Migrations take `DIRECT_URL`
 * separately, via prisma.config.ts — against Neon the pooled endpoint cannot
 * reliably run DDL.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function create(): PrismaClient {
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString === '') {
    throw new Error(
      'DATABASE_URL is not set. The app cannot start without a database — ' +
        'see .env.local.example.',
    );
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? create();

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma;
}
