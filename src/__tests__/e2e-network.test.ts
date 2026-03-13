/**
 * End-to-end network tests — guarded by AUGMENTS_E2E=1
 *
 * These tests make real HTTP calls to npm, GitHub, and CDNs.
 * Run with: AUGMENTS_E2E=1 npm test
 */
import { describe, it, expect, beforeAll } from 'vitest';

const isE2E = process.env.AUGMENTS_E2E === '1';

describe.skipIf(!isE2E)('e2e network tests', () => {
  // Allow generous timeouts for real network calls
  const TIMEOUT = 30_000;

  describe('npm registry', () => {
    it('fetches react package metadata', async () => {
      const res = await fetch('https://registry.npmjs.org/react', {
        headers: { Accept: 'application/vnd.npm.install-v1+json' },
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.name).toBe('react');
      expect(data['dist-tags']?.latest).toBeDefined();
    }, TIMEOUT);

    it('fetches scoped package metadata', async () => {
      const res = await fetch('https://registry.npmjs.org/@tanstack/react-query', {
        headers: { Accept: 'application/vnd.npm.install-v1+json' },
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.name).toBe('@tanstack/react-query');
    }, TIMEOUT);
  });

  describe('CDN type definitions', () => {
    it('fetches .d.ts from esm.sh', async () => {
      const res = await fetch('https://esm.sh/zod@3.22.4', {
        headers: { Accept: 'text/typescript' },
        redirect: 'follow',
      });
      // esm.sh may redirect; we just check we don't get a hard error
      expect(res.status).toBeLessThan(500);
    }, TIMEOUT);

    it('fetches .d.ts from unpkg', async () => {
      const res = await fetch('https://unpkg.com/zod@3.22.4/index.d.ts');
      expect(res.ok).toBe(true);
      const text = await res.text();
      expect(text).toContain('export');
    }, TIMEOUT);
  });

  describe('GitHub API', () => {
    it('lists repo contents', async () => {
      const res = await fetch(
        'https://api.github.com/repos/colinhacks/zod/contents/README.md',
        { headers: { Accept: 'application/vnd.github.v3+json' } }
      );
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.name).toBe('README.md');
    }, TIMEOUT);

    it('searches issues', async () => {
      const res = await fetch(
        'https://api.github.com/search/issues?q=repo:vercel/next.js+is:issue+hydration&per_page=3',
        { headers: { Accept: 'application/vnd.github.v3+json' } }
      );
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.items).toBeDefined();
    }, TIMEOUT);
  });

  describe('tool integration (real network)', () => {
    it('getApiContext returns results for react useState', async () => {
      const { getApiContext } = await import('../tools/v4/get-api-context');
      const result = await getApiContext({
        query: 'react useState',
        includeExamples: true,
        maxExamples: 1,
      });
      expect(result.framework).toBe('react');
      expect(result.packageName).toBe('react');
      expect(result.version).toBeTruthy();
    }, TIMEOUT);

    it('searchApis finds results across frameworks', async () => {
      const { searchApis } = await import('../tools/v4/search-apis');
      const result = await searchApis({
        query: 'state management',
        frameworks: ['react', 'vue'],
        limit: 3,
      });
      expect(result.frameworksSearched.length).toBeGreaterThan(0);
    }, TIMEOUT);

    it('getVersionInfo returns version data', async () => {
      const { getVersionInfo } = await import('../tools/v4/get-version-info');
      const result = await getVersionInfo({ framework: 'zod' });
      expect(result.framework).toBe('zod');
      expect(result.latestVersion).toBeTruthy();
    }, TIMEOUT);

    it('comparePackages compares two packages', async () => {
      const { comparePackages } = await import('../tools/v4/compare-packages');
      const result = await comparePackages({
        packages: ['zod', 'yup'],
      });
      expect(result.packages.length).toBe(2);
    }, TIMEOUT);

    it('diagnoseError matches a known error', async () => {
      const { diagnoseError } = await import('../tools/v4/diagnose-error');
      const result = await diagnoseError({
        error: 'Objects are not valid as a React child',
        package: 'react',
      });
      expect(result.error).toBeTruthy();
    }, TIMEOUT);
  });
});
