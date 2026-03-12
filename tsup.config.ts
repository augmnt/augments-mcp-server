import { defineConfig } from 'tsup';
import path from 'path';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  external: ['@modelcontextprotocol/sdk', 'zod', 'typescript'],
  esbuildOptions(options) {
    options.alias = {
      '@': path.resolve(import.meta.dirname, 'src'),
    };
  },
  banner: {
    js: '#!/usr/bin/env node',
  },
});
