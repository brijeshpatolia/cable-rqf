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
  serverExternalPackages: ['pdfjs-dist'],
};

export default config;
