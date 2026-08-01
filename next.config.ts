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
};

export default config;
