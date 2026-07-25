/**
 * The layering rule, enforced.
 *
 * docs/ARCHITECTURE.md §1 states these rules and says "a violation is a build
 * failure, not a code review comment". Until now that was an aspiration — the
 * repo had no enforcement. This file makes it true, and it lands *before* the
 * first Prisma import exists, because the whole point is to stop that import
 * reaching the wrong layer.
 *
 *     app/      Next routes, server actions, components
 *       ↓
 *     modules/  business logic — imports core/ only
 *       ↓
 *     core/     Decimal, Money, Result, brands — imports nothing
 *
 *     infra/    Prisma, mail, storage. Implements ports declared in modules/.
 *               Injected at the composition root; imported by nobody inward.
 */
module.exports = {
  forbidden: [
    {
      name: 'core-imports-nothing',
      severity: 'error',
      comment:
        'core/ is the vocabulary every other layer speaks. It may depend on ' +
        'nothing but itself and decimal.js.',
      from: { path: '^src/core' },
      to: {
        pathNot: ['^src/core', 'node_modules/decimal\\.js'],
      },
    },
    {
      name: 'modules-are-pure',
      severity: 'error',
      comment:
        'modules/ holds the cost engine and the matcher. It must stay free of ' +
        'Prisma, Next, React and infra/ so it is testable in microseconds and ' +
        'portable to a worker, a CLI, or an API without moving a line.',
      from: { path: '^src/modules', pathNot: '\\.test\\.ts$' },
      to: {
        path: [
          '^src/app',
          '^src/infra',
          '^src/ui',
          'node_modules/(next|react|react-dom)/',
          'node_modules/@prisma/',
          'node_modules/\\.prisma/',
          'node_modules/pg/',
        ],
      },
    },
    {
      name: 'no-cross-module-internals',
      severity: 'error',
      comment:
        'Modules talk to each other only through their public surface. ' +
        'Reaching into another module\'s internals is how a codebase seizes up.',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/',
        pathNot: [
          '^src/modules/$1/',
          '^src/modules/[^/]+/(index|types|ports)\\.ts$',
        ],
      },
    },
    {
      name: 'ui-holds-no-business-logic',
      severity: 'error',
      comment:
        'ui/ is the design system. It renders domain types but must not reach ' +
        'into infra/ — that is what keeps the gallery renderable without a database.',
      from: { path: '^src/ui' },
      to: { path: '^src/infra' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'A cycle means the boundary was drawn in the wrong place.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Dead file — nothing imports it.',
      from: {
        orphan: true,
        pathNot: [
          '\\.(json|css)$',
          '^src/app/',
          '^scripts/',
          '\\.config\\.(ts|js|mjs|cjs)$',
          '^\\.dependency-cruiser\\.cjs$',
        ],
      },
      to: {},
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
