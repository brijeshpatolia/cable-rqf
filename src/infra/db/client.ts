import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * The Prisma client, as a lazily-constructed module-scope singleton.
 *
 * **Lazy on purpose.** `next build` imports every route module to analyse it,
 * so a client constructed at import time would demand `DATABASE_URL` during
 * the build — and a build should not need a database. The proxy below defers
 * construction to the first actual query, which happens at request time when
 * the variable is really there.
 *
 * The global cache handles the other direction: Next reloads modules on every
 * edit in development, and a client per reload would open a new pool each save
 * and exhaust Postgres within a few of them.
 *
 * In production on Vercel, module scope is per-instance and Fluid keeps
 * instances warm, so one pool is reused across many requests. That is why
 * `@prisma/adapter-pg` over node-postgres is right here rather than the HTTP
 * serverless driver — this is a Node-runtime app, not edge.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function create(): PrismaClient {
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString === '') {
    throw new Error(
      'DATABASE_URL is not set. The app cannot serve a request without a ' +
        'database — see .env.local.example. (Set USE_MEMORY_ADAPTER=1 to run ' +
        'the app against the imported snapshot instead.)',
    );
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

function client(): PrismaClient {
  const existing = globalForPrisma.prisma;
  if (existing !== undefined) return existing;

  const created = create();
  // Cached in every environment, not just development: on a warm serverless
  // instance this is what stops each request opening its own pool.
  globalForPrisma.prisma = created;
  return created;
}

/**
 * Behaves exactly like a PrismaClient, but does not exist until first touched.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(client() as object, property, receiver) as unknown;
  },
  has(_target, property) {
    return Reflect.has(client() as object, property);
  },
}) as PrismaClient;
