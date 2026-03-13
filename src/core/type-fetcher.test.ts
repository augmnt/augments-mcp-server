/**
 * Tests for TypeFetcher
 *
 * Covers:
 *  - resolveVersion(): latest, specific version, dist-tags, errors
 *  - CDN racing: parallel fetches return first success
 *  - In-flight deduplication: concurrent calls share a single fetch
 *  - fetchWithRetry(): retries on 5xx and network failures
 *  - getPackageInfo(): npm registry metadata, 404 handling
 *  - Cache behaviour: second call returns cached result without re-fetching
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TypeFetcher } from '@/core/type-fetcher';

// ---------------------------------------------------------------------------
// Mock logger — prevents any stderr noise during tests
// ---------------------------------------------------------------------------
vi.mock('@/utils/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal NpmPackageInfo payload understood by TypeFetcher. */
function makePackageInfo(overrides: Partial<{
  name: string;
  latest: string;
  versions: string[];
}> = {}) {
  const { name = 'test-pkg', latest = '1.2.3', versions = ['1.2.3', '1.2.0', '1.1.0'] } = overrides;

  const versionMap = Object.fromEntries(
    versions.map((v) => [
      v,
      {
        name,
        version: v,
        types: 'index.d.ts',
        dist: { tarball: `https://registry.npmjs.org/${name}/-/${name}-${v}.tgz`, shasum: 'abc' },
      },
    ])
  );

  return {
    name,
    version: latest,
    'dist-tags': { latest },
    versions: versionMap,
  };
}

/** A minimal Response-like object accepted by the mocked global.fetch. */
function mockResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  const headerMap = new Map(Object.entries(headers));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k: string) => headerMap.get(k) ?? null,
    },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('TypeFetcher', () => {
  let fetcher: TypeFetcher;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetcher = new TypeFetcher();
    // clearCache also resets the module-level CDN circuit breaker
    fetcher.clearCache();
    // Speed up backoff delays during tests
    vi.spyOn(global, 'setTimeout').mockImplementation((fn: () => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
  });

  // -------------------------------------------------------------------------
  // getPackageInfo
  // -------------------------------------------------------------------------

  describe('getPackageInfo()', () => {
    it('returns parsed package info on a successful npm response', async () => {
      const info = makePackageInfo({ name: 'react', latest: '18.2.0', versions: ['18.2.0'] });

      vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse(info));

      const result = await fetcher.getPackageInfo('react');

      expect(result).not.toBeNull();
      expect(result!.name).toBe('react');
      expect(result!['dist-tags'].latest).toBe('18.2.0');
    });

    it('returns null when the package is not found (404)', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse(null, 404));

      const result = await fetcher.getPackageInfo('definitely-not-a-real-pkg');

      expect(result).toBeNull();
    });

    it('returns null when the registry returns a non-404 error', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse(null, 500));

      const result = await fetcher.getPackageInfo('bad-pkg');

      expect(result).toBeNull();
    });

    it('returns null when the registry response cannot be parsed as JSON', async () => {
      const badJsonResponse = {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.reject(new SyntaxError('bad json')),
        text: () => Promise.resolve('not json'),
      } as unknown as Response;

      vi.spyOn(global, 'fetch').mockResolvedValueOnce(badJsonResponse);

      const result = await fetcher.getPackageInfo('malformed-pkg');

      expect(result).toBeNull();
    });

    it('returns null when fetch throws a network error', async () => {
      // fetchWithRetry makes retries=1 by default; mock two failures
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await fetcher.getPackageInfo('offline-pkg');

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Cache behaviour
  // -------------------------------------------------------------------------

  describe('cache behaviour', () => {
    it('returns cached package info on the second call without re-fetching', async () => {
      const info = makePackageInfo({ name: 'lodash', latest: '4.17.21', versions: ['4.17.21'] });
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse(info));

      await fetcher.getPackageInfo('lodash');
      await fetcher.getPackageInfo('lodash');

      // fetch should have been called exactly once (first call hit network; second was cached)
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('re-fetches after the cache TTL has expired', async () => {
      const info = makePackageInfo({ name: 'express', latest: '4.18.0', versions: ['4.18.0'] });
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse(info));

      await fetcher.getPackageInfo('express');

      // Manually expire the package info cache by back-dating the fetchedAt timestamp
      // @ts-expect-error — accessing private field for testing
      const cached = fetcher.packageInfoCache.get('express');
      if (cached) {
        cached.fetchedAt = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago > 30 min TTL
      }

      await fetcher.getPackageInfo('express');

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('returns cached TypeDefinitionResult on the second fetchTypes call', async () => {
      const info = makePackageInfo({ name: 'zod', latest: '3.22.4', versions: ['3.22.4'] });
      const typeContent = 'export declare const z: unknown;';

      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((url) => {
        const u = String(url);
        if (u.includes('registry.npmjs.org')) {
          return Promise.resolve(mockResponse(info));
        }
        // CDN calls (unpkg / jsdelivr)
        return Promise.resolve(mockResponse(typeContent));
      });

      const first = await fetcher.fetchTypes('zod', '3.22.4');
      const second = await fetcher.fetchTypes('zod', '3.22.4');

      expect(first).not.toBeNull();
      expect(second).toBe(first); // exact same reference from cache

      // npm registry called once; CDN called once (one of the two races wins first)
      const cdnCalls = fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('unpkg.com') || String(url).includes('jsdelivr')
      );
      // At most 2 CDN calls for the first fetch (both race participants); zero for the second
      expect(cdnCalls.length).toBeLessThanOrEqual(2);
    });

    it('clearCache() forces a fresh network fetch', async () => {
      const info = makePackageInfo({ name: 'axios', latest: '1.6.0', versions: ['1.6.0'] });
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse(info));

      await fetcher.getPackageInfo('axios');
      fetcher.clearCache();
      await fetcher.getPackageInfo('axios');

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // In-flight deduplication
  // -------------------------------------------------------------------------

  describe('in-flight deduplication', () => {
    it('concurrent getPackageInfo calls share a single network request', async () => {
      const info = makePackageInfo({ name: 'vue', latest: '3.4.0', versions: ['3.4.0'] });

      let resolveFirst!: (v: Response) => void;
      const firstPromise = new Promise<Response>((res) => { resolveFirst = res; });

      const fetchSpy = vi.spyOn(global, 'fetch').mockReturnValue(firstPromise);

      // Fire three concurrent calls — none awaited yet
      const [r1, r2, r3] = await Promise.all([
        fetcher.getPackageInfo('vue'),
        fetcher.getPackageInfo('vue'),
        fetcher.getPackageInfo('vue'),
      ].map(async (p) => {
        // Resolve the held fetch before the concurrent group settles
        if (fetchSpy.mock.calls.length > 0 && resolveFirst) {
          resolveFirst(mockResponse(info));
          resolveFirst = () => {}; // no-op subsequent invocations
        }
        return p;
      }));

      // All three should return the same data
      expect(r1).not.toBeNull();
      expect(r2?.name).toBe(r1?.name);
      expect(r3?.name).toBe(r1?.name);

      // Only one real network call should have been made
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('concurrent fetchTypes calls share a single type-fetch request', async () => {
      const info = makePackageInfo({ name: 'immer', latest: '10.0.3', versions: ['10.0.3'] });
      const typeContent = 'export declare function produce<T>(base: T): T;';

      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((url) => {
        if (String(url).includes('registry.npmjs.org')) {
          return Promise.resolve(mockResponse(info));
        }
        return Promise.resolve(mockResponse(typeContent));
      });

      const [r1, r2] = await Promise.all([
        fetcher.fetchTypes('immer', '10.0.3'),
        fetcher.fetchTypes('immer', '10.0.3'),
      ]);

      expect(r1).not.toBeNull();
      expect(r2).toBe(r1);

      // CDN calls should be at most 2 (both race legs of a single type-fetch)
      const cdnCalls = fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('unpkg.com') || String(url).includes('jsdelivr')
      );
      expect(cdnCalls.length).toBeLessThanOrEqual(2);
    });
  });

  // -------------------------------------------------------------------------
  // CDN racing
  // -------------------------------------------------------------------------

  describe('CDN racing (fetchFromCdn)', () => {
    it('returns content when the first CDN (unpkg) succeeds', async () => {
      const info = makePackageInfo({ name: 'dayjs', latest: '1.11.0', versions: ['1.11.0'] });
      const typeContent = 'export declare const dayjs: unknown;';

      vi.spyOn(global, 'fetch').mockImplementation((url) => {
        const u = String(url);
        if (u.includes('registry.npmjs.org')) return Promise.resolve(mockResponse(info));
        if (u.includes('unpkg.com')) return Promise.resolve(mockResponse(typeContent));
        // jsdelivr never resolves in this scenario
        return new Promise(() => {});
      });

      const result = await fetcher.fetchTypes('dayjs', '1.11.0');

      expect(result).not.toBeNull();
      expect(result!.content).toBe(typeContent);
    });

    it('falls back to jsdelivr when unpkg fails', async () => {
      const info = makePackageInfo({ name: 'date-fns', latest: '2.30.0', versions: ['2.30.0'] });
      const typeContent = 'export declare function format(date: Date, fmt: string): string;';

      vi.spyOn(global, 'fetch').mockImplementation((url) => {
        const u = String(url);
        if (u.includes('registry.npmjs.org')) return Promise.resolve(mockResponse(info));
        if (u.includes('unpkg.com')) return Promise.resolve(mockResponse(null, 500));
        if (u.includes('jsdelivr')) return Promise.resolve(mockResponse(typeContent));
        return Promise.resolve(mockResponse(null, 404));
      });

      const result = await fetcher.fetchTypes('date-fns', '2.30.0');

      expect(result).not.toBeNull();
      expect(result!.content).toBe(typeContent);
    });

    it('returns null when all CDNs fail', async () => {
      const info = makePackageInfo({ name: 'clsx', latest: '2.0.0', versions: ['2.0.0'] });

      vi.spyOn(global, 'fetch').mockImplementation((url) => {
        const u = String(url);
        if (u.includes('registry.npmjs.org')) return Promise.resolve(mockResponse(info));
        // Both CDNs fail
        return Promise.resolve(mockResponse(null, 500));
      });

      const result = await fetcher.fetchTypes('clsx', '2.0.0');

      expect(result).toBeNull();
    });

    it('uses both unpkg and jsdelivr URLs when racing', async () => {
      const info = makePackageInfo({ name: 'ms', latest: '2.1.3', versions: ['2.1.3'] });
      const typeContent = 'export declare function ms(value: string): number;';

      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((url) => {
        if (String(url).includes('registry.npmjs.org')) return Promise.resolve(mockResponse(info));
        return Promise.resolve(mockResponse(typeContent));
      });

      await fetcher.fetchTypes('ms', '2.1.3');

      const cdnUrls = fetchSpy.mock.calls
        .map(([url]) => String(url))
        .filter((u) => u.includes('unpkg.com') || u.includes('jsdelivr'));

      const hasUnpkg = cdnUrls.some((u) => u.includes('unpkg.com'));
      const hasJsdelivr = cdnUrls.some((u) => u.includes('jsdelivr'));
      expect(hasUnpkg).toBe(true);
      expect(hasJsdelivr).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // fetchWithRetry — retry logic
  // -------------------------------------------------------------------------

  describe('fetchWithRetry / retry logic', () => {
    it('succeeds on the second attempt after a 5xx response', async () => {
      const info = makePackageInfo({ name: 'chalk', latest: '5.3.0', versions: ['5.3.0'] });

      const fetchSpy = vi.spyOn(global, 'fetch')
        // First attempt: 500
        .mockResolvedValueOnce(mockResponse(null, 500))
        // Second attempt: success
        .mockResolvedValueOnce(mockResponse(info));


      const result = await fetcher.getPackageInfo('chalk');

      expect(result).not.toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('succeeds on retry after a transient network error', async () => {
      const info = makePackageInfo({ name: 'got', latest: '13.0.0', versions: ['13.0.0'] });

      const fetchSpy = vi.spyOn(global, 'fetch')
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce(mockResponse(info));

      vi.spyOn(global, 'setTimeout').mockImplementation((fn: () => void) => {
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      });

      const result = await fetcher.getPackageInfo('got');

      expect(result).not.toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('respects max retries and returns null after all attempts fail', async () => {
      // fetchWithRetry defaults to retries=1, so two total attempts
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse(null, 500));

      vi.spyOn(global, 'setTimeout').mockImplementation((fn: () => void) => {
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      });

      const result = await fetcher.getPackageInfo('always-fails');

      // getPackageInfo swallows the thrown error and returns null
      expect(result).toBeNull();
      // Should not exceed retries+1 = 2 attempts
      expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('retries on a 429 rate-limit response and succeeds', async () => {
      const info = makePackageInfo({ name: 'ky', latest: '1.2.0', versions: ['1.2.0'] });

      const fetchSpy = vi.spyOn(global, 'fetch')
        .mockResolvedValueOnce(mockResponse(null, 429, { 'Retry-After': '0.001' }))
        .mockResolvedValueOnce(mockResponse(info));

      vi.spyOn(global, 'setTimeout').mockImplementation((fn: () => void) => {
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      });

      const result = await fetcher.getPackageInfo('ky');

      expect(result).not.toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // resolveVersion
  // -------------------------------------------------------------------------

  describe('resolveVersion() (exercised via fetchTypes)', () => {
    it('resolves "latest" to the dist-tags.latest version', async () => {
      const info = makePackageInfo({ name: 'ramda', latest: '0.29.1', versions: ['0.29.1'] });
      const typeContent = 'export declare const R: unknown;';

      vi.spyOn(global, 'fetch').mockImplementation((url) => {
        if (String(url).includes('registry.npmjs.org')) return Promise.resolve(mockResponse(info));
        return Promise.resolve(mockResponse(typeContent));
      });

      const result = await fetcher.fetchTypes('ramda');

      expect(result).not.toBeNull();
      expect(result!.version).toBe('0.29.1');
    });

    it('resolves a specific version string directly', async () => {
      const info = makePackageInfo({ name: 'semver', latest: '7.5.4', versions: ['7.5.4', '7.4.0'] });
      const typeContent = 'export declare function valid(v: string): string | null;';

      vi.spyOn(global, 'fetch').mockImplementation((url) => {
        if (String(url).includes('registry.npmjs.org')) return Promise.resolve(mockResponse(info));
        return Promise.resolve(mockResponse(typeContent));
      });

      const result = await fetcher.fetchTypes('semver', '7.4.0');

      expect(result).not.toBeNull();
      expect(result!.version).toBe('7.4.0');
    });

    it('resolves a dist-tag (e.g., "next") to the tagged version', async () => {
      const info = makePackageInfo({ name: 'react', latest: '18.2.0', versions: ['18.2.0', '19.0.0-rc.0'] });
      (info['dist-tags'] as Record<string, string>)['next'] = '19.0.0-rc.0';
      const typeContent = 'export declare const React: unknown;';

      vi.spyOn(global, 'fetch').mockImplementation((url) => {
        if (String(url).includes('registry.npmjs.org')) return Promise.resolve(mockResponse(info));
        return Promise.resolve(mockResponse(typeContent));
      });

      const result = await fetcher.fetchTypes('react', 'next');

      expect(result).not.toBeNull();
      expect(result!.version).toBe('19.0.0-rc.0');
    });

    it('returns null when the package does not exist in the registry', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse(null, 404));

      const result = await fetcher.fetchTypes('totally-fake-package-xyz');

      expect(result).toBeNull();
    });

    it('returns null for a version that does not exist in the package', async () => {
      const info = makePackageInfo({ name: 'mime', latest: '3.0.0', versions: ['3.0.0'] });

      vi.spyOn(global, 'fetch').mockImplementation((url) => {
        if (String(url).includes('registry.npmjs.org')) return Promise.resolve(mockResponse(info));
        return Promise.resolve(mockResponse(null, 404));
      });

      const result = await fetcher.fetchTypes('mime', '99.0.0');

      expect(result).toBeNull();
    });

    it('resolves a major version prefix (e.g., "4") to the latest 4.x.x', async () => {
      const info = makePackageInfo({
        name: 'express',
        latest: '5.0.0',
        versions: ['5.0.0', '4.18.2', '4.17.1'],
      });
      const typeContent = 'export declare function express(): unknown;';

      vi.spyOn(global, 'fetch').mockImplementation((url) => {
        if (String(url).includes('registry.npmjs.org')) return Promise.resolve(mockResponse(info));
        return Promise.resolve(mockResponse(typeContent));
      });

      const result = await fetcher.fetchTypes('express', '4');

      expect(result).not.toBeNull();
      expect(result!.version).toBe('4.18.2');
    });
  });

  // -------------------------------------------------------------------------
  // fetchSpecificTypeFile
  // -------------------------------------------------------------------------

  describe('fetchSpecificTypeFile()', () => {
    it('fetches a specific .d.ts path from CDN', async () => {
      const info = makePackageInfo({ name: 'react', latest: '18.2.0', versions: ['18.2.0'] });
      const content = '/// <reference types="react" />';

      vi.spyOn(global, 'fetch').mockImplementation((url) => {
        if (String(url).includes('registry.npmjs.org')) return Promise.resolve(mockResponse(info));
        return Promise.resolve(mockResponse(content));
      });

      const result = await fetcher.fetchSpecificTypeFile('react', '18.2.0', 'jsx-runtime.d.ts');

      expect(result).not.toBeNull();
      expect(result!.filePath).toBe('jsx-runtime.d.ts');
      expect(result!.content).toBe(content);
    });

    it('returns null when the specific file is not found on any CDN', async () => {
      const info = makePackageInfo({ name: 'react', latest: '18.2.0', versions: ['18.2.0'] });

      vi.spyOn(global, 'fetch').mockImplementation((url) => {
        if (String(url).includes('registry.npmjs.org')) return Promise.resolve(mockResponse(info));
        return Promise.resolve(mockResponse(null, 404));
      });

      const result = await fetcher.fetchSpecificTypeFile('react', '18.2.0', 'does-not-exist.d.ts');

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getVersions
  // -------------------------------------------------------------------------

  describe('getVersions()', () => {
    it('returns latest, sorted versions, and tags', async () => {
      const info = makePackageInfo({
        name: 'typescript',
        latest: '5.4.5',
        versions: ['5.4.5', '5.3.3', '5.2.2', '4.9.5'],
      });

      vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse(info));

      const result = await fetcher.getVersions('typescript');

      expect(result).not.toBeNull();
      expect(result!.latest).toBe('5.4.5');
      // Sorted descending
      expect(result!.versions[0]).toBe('5.4.5');
      expect(result!.versions[result!.versions.length - 1]).toBe('4.9.5');
    });

    it('returns null when the package does not exist', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse(null, 404));

      const result = await fetcher.getVersions('ghost-package');

      expect(result).toBeNull();
    });
  });
});
