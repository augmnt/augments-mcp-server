/**
 * Integration tests for v4 tools
 *
 * Tests searchApis parallelization, getApiContext flow,
 * error handling, and Promise.allSettled behavior with mocked core modules.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ========== Mock Setup ==========

// Track call order and timing for parallelization verification
const callLog: { fn: string; arg: string; time: number }[] = [];
let mockStartTime = 0;

function logCall(fn: string, arg: string) {
  callLog.push({ fn, arg, time: Date.now() - mockStartTime });
}

// Mock type content for test packages
const MOCK_TYPES: Record<string, string> = {
  react: `
declare function useState<S>(initialState: S | (() => S)): [S, (value: S) => void];
declare function useEffect(effect: () => void | (() => void), deps?: readonly any[]): void;
declare function useCallback<T extends Function>(callback: T, deps: readonly any[]): T;
declare function useMemo<T>(factory: () => T, deps: readonly any[]): T;
declare function useRef<T>(initialValue: T): { current: T };
`,
  next: `
declare function useRouter(): NextRouter;
declare function usePathname(): string;
declare function useSearchParams(): URLSearchParams;
interface NextRouter { push(url: string): void; replace(url: string): void; }
`,
  vue: `
declare function ref<T>(value: T): { value: T };
declare function reactive<T extends object>(target: T): T;
declare function computed<T>(getter: () => T): { readonly value: T };
declare function watch(source: any, callback: Function): void;
`,
  zod: `
declare function object(shape: Record<string, any>): ZodObject;
declare function string(): ZodString;
declare function number(): ZodNumber;
interface ZodObject { parse(data: unknown): any; safeParse(data: unknown): { success: boolean; data?: any; error?: any }; }
`,
  express: `
declare function Router(): ExpressRouter;
interface ExpressRouter {
  get(path: string, handler: Function): void;
  post(path: string, handler: Function): void;
  use(middleware: Function): void;
}
`,
};

vi.mock('@/core', () => {
  const mockQueryParser = {
    parse: vi.fn((query: string) => {
      logCall('parse', query);
      // Simple parsing: first word as framework, rest as concept
      const parts = query.toLowerCase().split(/\s+/);
      const knownFrameworks: Record<string, string> = {
        react: 'react',
        next: 'next',
        vue: 'vue',
        zod: 'zod',
        express: 'express',
        usestate: 'react',
        useeffect: 'react',
      };

      let framework = null;
      let packageName = null;
      let concept = query;

      for (const part of parts) {
        if (knownFrameworks[part]) {
          framework = knownFrameworks[part];
          packageName = framework;
          concept = parts.filter((p) => p !== part).join(' ') || part;
          break;
        }
      }

      return {
        framework,
        packageName,
        concept,
        version: null,
        originalQuery: query,
        confidence: framework ? 0.8 : 0.2,
        contextKeywords: [],
      };
    }),
    getPackageName: vi.fn((framework: string) => {
      const map: Record<string, string> = {
        react: 'react',
        next: 'next',
        vue: 'vue',
        zod: 'zod',
        express: 'express',
      };
      return map[framework] || framework;
    }),
    getKnownFrameworks: vi.fn(() => ['react', 'next', 'vue', 'zod', 'express']),
    suggestAlternatives: vi.fn((query: string) => {
      const primary = mockQueryParser.parse(query);
      if (primary.framework) return [primary];
      return [
        primary,
        { ...primary, framework: 'react', packageName: 'react', confidence: 0.1 },
        { ...primary, framework: 'vue', packageName: 'vue', confidence: 0.1 },
      ];
    }),
  };

  const mockTypeFetcher = {
    fetchTypes: vi.fn(async (pkg: string, _version?: string) => {
      logCall('fetchTypes', pkg);
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 10));

      if (pkg === 'error-package') {
        throw new Error('Network error');
      }

      const content = MOCK_TYPES[pkg];
      if (!content) return null;

      return {
        packageName: pkg,
        version: '1.0.0',
        content,
        filePath: 'index.d.ts',
        source: 'bundled' as const,
        fetchedAt: Date.now(),
      };
    }),
    getBarrelExportPaths: vi.fn(() => []),
    fetchSpecificTypeFile: vi.fn(async () => null),
    fetchReadme: vi.fn(async () => null),
  };

  const mockTypeParser = {
    searchApis: vi.fn((content: string, query: string) => {
      logCall('searchApis', query);
      const defs: Array<{
        name: string;
        kind: string;
        signature: string;
        description?: string;
        deprecated?: boolean;
        examples?: string[];
      }> = [];

      const funcRegex = /declare function (\w+)/g;
      let match;
      while ((match = funcRegex.exec(content)) !== null) {
        const name = match[1];
        if (
          name.toLowerCase().includes(query.toLowerCase()) ||
          query.toLowerCase().split(/\s+/).every((q) => name.toLowerCase().includes(q))
        ) {
          defs.push({
            name,
            kind: 'function',
            signature: `function ${name}(...)`,
          });
        }
      }
      return defs;
    }),
    extractApiSignature: vi.fn((content: string, concept: string) => {
      logCall('extractApiSignature', concept);
      const regex = new RegExp(`declare function (${concept}\\w*)`, 'i');
      const match = content.match(regex);
      if (!match) return null;

      return {
        name: match[1],
        signature: `function ${match[1]}(...)`,
        description: `Mock description for ${match[1]}`,
        parameters: [{ name: 'arg', type: 'any', optional: false }],
        returnType: 'any',
        relatedTypes: {},
      };
    }),
  };

  const mockVersionRegistry = {
    resolveVersion: vi.fn(async (pkg: string, _version?: string) => {
      logCall('resolveVersion', pkg);
      if (MOCK_TYPES[pkg]) return '1.0.0';
      return null;
    }),
  };

  const mockExampleExtractor = {
    getExamplesForConcept: vi.fn(async (framework: string, concept: string) => {
      logCall('getExamplesForConcept', `${framework}:${concept}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return [
        {
          code: `// Example for ${concept}`,
          language: 'typescript',
          source: 'mock-source.md',
          concepts: [concept.toLowerCase()],
        },
      ];
    }),
    getDocSource: vi.fn((framework: string) => {
      // Simulate having doc sources for known frameworks
      const known = ['react', 'next', 'vue', 'zod', 'express'];
      return known.includes(framework) ? { repo: `mock/${framework}`, docsPath: 'docs', branch: 'main' } : null;
    }),
  };

  return {
    getQueryParser: () => mockQueryParser,
    getTypeFetcher: () => mockTypeFetcher,
    getTypeParser: () => mockTypeParser,
    getVersionRegistry: () => mockVersionRegistry,
    getExampleExtractor: () => mockExampleExtractor,
  };
});

vi.mock('@/utils/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('v4 integration tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callLog.length = 0;
    mockStartTime = Date.now();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('searchApis parallelization', () => {
    it('calls fetchTypes for all frameworks concurrently', async () => {
      const { searchApis } = await import('./search-apis');

      const result = await searchApis({
        query: 'use',
        frameworks: ['react', 'vue', 'zod'],
      });

      // All frameworks should be searched
      expect(result.frameworksSearched).toContain('react');
      expect(result.frameworksSearched).toContain('vue');
      expect(result.frameworksSearched).toContain('zod');

      // fetchTypes should have been called for each
      const fetchCalls = callLog.filter((c) => c.fn === 'fetchTypes');
      expect(fetchCalls.length).toBe(3);

      // Verify parallelism: all fetchTypes calls should start at roughly the same time
      const fetchTimes = fetchCalls.map((c) => c.time);
      const timeDiff = Math.max(...fetchTimes) - Math.min(...fetchTimes);
      expect(timeDiff).toBeLessThan(50); // All start within 50ms = parallel
    });

    it('handles partial framework failures gracefully', async () => {
      const { searchApis } = await import('./search-apis');

      const result = await searchApis({
        query: 'use',
        frameworks: ['react', 'error-package', 'vue'],
      });

      // Should still have results from successful frameworks
      expect(result.frameworksSearched).toContain('react');
      expect(result.frameworksSearched).toContain('vue');
      expect(result.frameworksSearched).not.toContain('error-package');
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('handles all frameworks failing', async () => {
      const { searchApis } = await import('./search-apis');

      const result = await searchApis({
        query: 'use',
        frameworks: ['error-package', 'nonexistent'],
      });

      expect(result.frameworksSearched.length).toBe(0);
      expect(result.results.length).toBe(0);
    });

    it('returns results sorted by relevance across frameworks', async () => {
      const { searchApis } = await import('./search-apis');

      const result = await searchApis({
        query: 'use',
        frameworks: ['react', 'vue'],
      });

      // Should have results from both frameworks
      expect(result.results.length).toBeGreaterThan(0);

      // Results should be sorted by relevance (descending)
      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i - 1].relevance).toBeGreaterThanOrEqual(
          result.results[i].relevance
        );
      }
    });

    it('uses default frameworks when none specified', async () => {
      const { searchApis } = await import('./search-apis');

      const result = await searchApis({
        query: 'use',
      });

      // Should have searched default frameworks
      expect(result.frameworksSearched.length).toBeGreaterThan(0);
    });
  });

  describe('getApiContext parallel fetching', () => {
    it('fetches types and examples in parallel', async () => {
      const { getApiContext } = await import('./get-api-context');

      const result = await getApiContext({
        query: 'react useEffect',
        includeExamples: true,
        maxExamples: 2,
      });

      expect(result.framework).toBe('react');
      expect(result.api).not.toBeNull();

      // Both fetchTypes and getExamplesForConcept should have been called
      const fetchTypesCalls = callLog.filter((c) => c.fn === 'fetchTypes');
      const exampleCalls = callLog.filter((c) => c.fn === 'getExamplesForConcept');

      expect(fetchTypesCalls.length).toBeGreaterThan(0);
      expect(exampleCalls.length).toBeGreaterThan(0);

      // They should start at roughly the same time (parallel)
      const fetchTime = fetchTypesCalls[0].time;
      const exampleTime = exampleCalls[0].time;
      expect(Math.abs(fetchTime - exampleTime)).toBeLessThan(50);
    });

    it('skips examples when includeExamples is false', async () => {
      const { getApiContext } = await import('./get-api-context');

      const result = await getApiContext({
        query: 'react useState',
        includeExamples: false,
      });

      expect(result.examples.length).toBe(0);

      // getExamplesForConcept should NOT have been called
      const exampleCalls = callLog.filter((c) => c.fn === 'getExamplesForConcept');
      expect(exampleCalls.length).toBe(0);
    });

    it('returns notes when framework not identified', async () => {
      const { getApiContext } = await import('./get-api-context');

      const result = await getApiContext({
        query: 'completely unknown query',
      });

      expect(result.framework).toBe('');
      expect(result.api).toBeNull();
      expect(result.notes.length).toBeGreaterThan(0);
      expect(result.notes[0]).toContain('Could not identify');
    });

    it('uses explicit framework override', async () => {
      const { getApiContext } = await import('./get-api-context');

      const result = await getApiContext({
        query: 'useState',
        framework: 'react',
      });

      expect(result.framework).toBe('react');
      expect(result.packageName).toBe('react');
    });

    it('handles version resolution failure', async () => {
      const { getApiContext } = await import('./get-api-context');

      const result = await getApiContext({
        query: 'nonexistent-pkg someApi',
        framework: 'nonexistent-pkg',
      });

      expect(result.api).toBeNull();
      expect(result.notes.length).toBeGreaterThan(0);
    });

    it('respects maxExamples limit', async () => {
      const { getApiContext } = await import('./get-api-context');

      const result = await getApiContext({
        query: 'react useEffect',
        includeExamples: true,
        maxExamples: 1,
      });

      expect(result.examples.length).toBeLessThanOrEqual(1);
    });
  });

  describe('error resilience', () => {
    it('searchApis completes even with fetch errors', async () => {
      const { searchApis } = await import('./search-apis');

      // Mix valid and invalid frameworks
      const result = await searchApis({
        query: 'use',
        frameworks: ['react', 'error-package', 'vue', 'nonexistent'],
      });

      // Should have partial results
      expect(result.frameworksSearched.length).toBe(2);
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('getApiContext returns gracefully on type fetch failure', async () => {
      const { getApiContext } = await import('./get-api-context');

      const result = await getApiContext({
        query: 'react useState',
        framework: 'error-package',
      });

      // Should not throw, should return with notes
      expect(result.notes.length).toBeGreaterThan(0);
    });
  });

  describe('detectIntent', () => {
    it('"how does useEffect work?" → "howto"', async () => {
      const { detectIntent } = await import('./get-api-context');
      expect(detectIntent('how does useEffect work?')).toBe('howto');
    });

    it('"what does useEffect do?" → "howto"', async () => {
      const { detectIntent } = await import('./get-api-context');
      expect(detectIntent('what does useEffect do?')).toBe('howto');
    });

    it('"tell me about useState" → "howto"', async () => {
      const { detectIntent } = await import('./get-api-context');
      expect(detectIntent('tell me about useState')).toBe('howto');
    });

    it('"useEffect signature" → "reference"', async () => {
      const { detectIntent } = await import('./get-api-context');
      expect(detectIntent('useEffect signature')).toBe('reference');
    });

    it('"react useEffect" → "balanced"', async () => {
      const { detectIntent } = await import('./get-api-context');
      expect(detectIntent('react useEffect')).toBe('balanced');
    });
  });
});
