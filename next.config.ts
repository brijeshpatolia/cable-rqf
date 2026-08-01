import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,

  /**
   * pdf.js resolved by Node, not bundled by webpack.
   *
   * It loads its worker with a dynamic `import()` of a path relative to its own
   * file. Bundled, that path points into `.next/server/vendor-chunks/` where
   * the worker was never emitted, and every PDF upload fails with "Setting up
   * fake worker failed". Left external, Node resolves it from node_modules the
   * ordinary way.
   */
  /**
   * `@napi-rs/canvas` ships a compiled `.node` binary, which webpack has no
   * loader for and no business bundling. Same treatment as pdf.js: left
   * external so Node loads it the ordinary way.
   *
   * It is here because pdf.js will not *import* without `DOMMatrix`, which on
   * Node only exists if this package provides it. See `read-document.ts` for
   * why it is imported explicitly rather than left to pdf.js's own optional
   * require — that require lives inside a `catch`, which file tracing cannot
   * see, so the package never reached the deployed function and every PDF
   * upload failed in production while working perfectly here.
   */
  serverExternalPackages: ['pdfjs-dist', '@napi-rs/canvas'],

  /**
   * The worker, shipped because tracing will not find it on its own.
   *
   * This is the same failure as `@napi-rs/canvas`, one layer further in, and
   * it only became visible once that one was fixed. pdf.js has no worker to
   * talk to in a serverless function, so it falls back to running the worker
   * module in-process — a "fake worker" — which it loads with a dynamic
   * `import()` of a path computed from its own file location. File tracing
   * follows static imports; it cannot follow that one. `pdf.mjs` was deployed
   * and `pdf.worker.mjs` beside it was not, and every PDF upload failed with
   * *Setting up fake worker failed: Cannot find module …/pdf.worker.mjs*.
   *
   * `serverExternalPackages` does not cover this. That setting says "let Node
   * resolve it rather than bundling it", which is necessary and not
   * sufficient: Node can only resolve a file that was shipped.
   *
   * Named for every route rather than the one that reads documents. The
   * upload is a Server Action, actions are bundled with whatever renders their
   * form, and a route-specific include would be silently wrong the first time
   * an upload appeared on a second screen — which is precisely how the two
   * bugs above reached production. 2 MB of function size is the cheaper
   * mistake.
   *
   * The glob spans pnpm's content-addressed layout, so a version bump does not
   * quietly stop matching.
   */
  outputFileTracingIncludes: {
    '/**': ['./node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
  },
};

export default config;
