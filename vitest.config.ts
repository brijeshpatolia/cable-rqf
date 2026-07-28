import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  /*
    `tsconfig.json` sets `jsx: "preserve"` so Next owns the transform, which
    leaves esbuild on its default — the classic runtime, calling a `React`
    global that nothing in this codebase imports. Any test that renders a
    component then fails with "React is not defined". The automatic runtime is
    what Next compiles with, so this only tells vitest the same thing.
  */
  esbuild: { jsx: 'automatic' },

  test: { include: ['src/**/*.test.ts', 'tests/**/*.test.ts'] },
});
