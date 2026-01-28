/**
 * Query Parser
 *
 * Extracts framework + concept from natural language queries.
 * Handles variations: "react useEffect", "useEffect in react", "react hooks cleanup".
 * Uses keyword matching + heuristics (no LLM needed).
 */

import { getLogger } from '@/utils/logger';

const logger = getLogger('query-parser');

/**
 * Parsed query result
 */
export interface ParsedQuery {
  /** The identified framework or package name */
  framework: string | null;
  /** The npm package name to look up types */
  packageName: string | null;
  /** The concept/API being queried */
  concept: string;
  /** Specific version if mentioned */
  version: string | null;
  /** Original query */
  originalQuery: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Additional context keywords */
  contextKeywords: string[];
}

/**
 * Framework alias mapping
 */
const FRAMEWORK_ALIASES: Record<string, { package: string; aliases: string[] }> = {
  // Frontend frameworks
  react: {
    package: 'react',
    aliases: ['reactjs', 'react.js', 'react js'],
  },
  'react-dom': {
    package: 'react-dom',
    aliases: ['reactdom', 'react dom'],
  },
  next: {
    package: 'next',
    aliases: ['nextjs', 'next.js', 'next js'],
  },
  vue: {
    package: 'vue',
    aliases: ['vuejs', 'vue.js', 'vue js', 'vue3'],
  },
  angular: {
    package: '@angular/core',
    aliases: ['angularjs', 'angular.js', 'ng'],
  },
  svelte: {
    package: 'svelte',
    aliases: ['sveltejs'],
  },
  solid: {
    package: 'solid-js',
    aliases: ['solidjs', 'solid.js', 'solid-js'],
  },

  // State management
  redux: {
    package: 'redux',
    aliases: ['reduxjs'],
  },
  zustand: {
    package: 'zustand',
    aliases: [],
  },
  jotai: {
    package: 'jotai',
    aliases: [],
  },
  recoil: {
    package: 'recoil',
    aliases: [],
  },

  // Data fetching
  'tanstack-query': {
    package: '@tanstack/react-query',
    aliases: ['react-query', 'tanstack query', 'react query'],
  },
  swr: {
    package: 'swr',
    aliases: [],
  },
  axios: {
    package: 'axios',
    aliases: [],
  },

  // Backend
  express: {
    package: 'express',
    aliases: ['expressjs', 'express.js'],
  },
  fastify: {
    package: 'fastify',
    aliases: [],
  },
  hono: {
    package: 'hono',
    aliases: [],
  },
  koa: {
    package: 'koa',
    aliases: ['koajs'],
  },

  // Database/ORM
  prisma: {
    package: '@prisma/client',
    aliases: ['prismajs', 'prisma orm'],
  },
  drizzle: {
    package: 'drizzle-orm',
    aliases: ['drizzle-orm', 'drizzle orm'],
  },
  mongoose: {
    package: 'mongoose',
    aliases: [],
  },
  typeorm: {
    package: 'typeorm',
    aliases: [],
  },

  // Validation
  zod: {
    package: 'zod',
    aliases: [],
  },
  yup: {
    package: 'yup',
    aliases: [],
  },
  joi: {
    package: 'joi',
    aliases: [],
  },

  // Testing
  jest: {
    package: 'jest',
    aliases: ['jestjs'],
  },
  vitest: {
    package: 'vitest',
    aliases: [],
  },
  playwright: {
    package: '@playwright/test',
    aliases: [],
  },
  cypress: {
    package: 'cypress',
    aliases: [],
  },

  // Utilities
  lodash: {
    package: 'lodash',
    aliases: ['_', 'lodash-es'],
  },
  ramda: {
    package: 'ramda',
    aliases: [],
  },
  dayjs: {
    package: 'dayjs',
    aliases: ['day.js'],
  },
  'date-fns': {
    package: 'date-fns',
    aliases: ['datefns'],
  },

  // API
  trpc: {
    package: '@trpc/server',
    aliases: ['tRPC', 't-rpc'],
  },
  graphql: {
    package: 'graphql',
    aliases: ['gql'],
  },

  // Full-stack
  remix: {
    package: '@remix-run/react',
    aliases: ['remix-run'],
  },
  astro: {
    package: 'astro',
    aliases: ['astrojs'],
  },

  // Node.js
  node: {
    package: '@types/node',
    aliases: ['nodejs', 'node.js'],
  },
};

/**
 * Common API patterns and their associated frameworks
 */
const API_PATTERNS: Record<string, string[]> = {
  // React hooks
  usestate: ['react'],
  useeffect: ['react'],
  usecontext: ['react'],
  usereducer: ['react'],
  usecallback: ['react'],
  usememo: ['react'],
  useref: ['react'],
  uselayouteffect: ['react'],
  useimperativehandle: ['react'],
  usedebugvalue: ['react'],
  usetransition: ['react'],
  usedeferredvalue: ['react'],
  useid: ['react'],
  usesyncexternalstore: ['react'],
  useinsertioneffect: ['react'],
  useformstatus: ['react-dom'],
  useformstate: ['react-dom'],
  useoptimistic: ['react'],
  useactionstate: ['react'],

  // React DOM
  createportal: ['react-dom'],
  flushsync: ['react-dom'],
  hydrateroot: ['react-dom'],
  createroot: ['react-dom'],

  // Next.js
  useRouter: ['next'],
  usepathname: ['next'],
  usesearchparams: ['next'],
  useselectedlayoutsegment: ['next'],
  useselectedlayoutsegments: ['next'],
  getserversideprops: ['next'],
  getstaticprops: ['next'],
  getstaticpaths: ['next'],
  generatemetadata: ['next'],
  generatestaticparams: ['next'],

  // Vue
  ref: ['vue'],
  reactive: ['vue'],
  computed: ['vue'],
  watch: ['vue'],
  watcheffect: ['vue'],
  onmounted: ['vue'],
  onunmounted: ['vue'],
  provide: ['vue'],
  inject: ['vue'],
  defineprop: ['vue'],
  defineemits: ['vue'],

  // Prisma
  findmany: ['prisma'],
  findunique: ['prisma'],
  findfirst: ['prisma'],
  create: ['prisma'],
  update: ['prisma'],
  delete: ['prisma'],
  upsert: ['prisma'],

  // Zod
  z: ['zod'],
  string: ['zod'],
  number: ['zod'],
  object: ['zod'],
  array: ['zod'],
  union: ['zod'],
  literal: ['zod'],
  optional: ['zod'],
  nullable: ['zod'],
  parse: ['zod'],
  safeParse: ['zod'],
  infer: ['zod'],

  // Express
  router: ['express'],
  middleware: ['express'],

  // TanStack Query
  usequery: ['tanstack-query'],
  usemutation: ['tanstack-query'],
  useinfinitequery: ['tanstack-query'],
  queryclient: ['tanstack-query'],
};

/**
 * Version patterns for extraction
 */
const VERSION_PATTERNS = [
  /v?(\d+(?:\.\d+)?(?:\.\d+)?(?:-[\w.]+)?)/i, // v19, 19, 19.0, 19.0.0, 19.0.0-beta.1
  /version\s*(\d+(?:\.\d+)?(?:\.\d+)?)/i, // version 19
  /@(\d+(?:\.\d+)?(?:\.\d+)?)/i, // @19
];

/**
 * Context keywords that modify the query
 */
const CONTEXT_KEYWORDS = [
  'cleanup',
  'async',
  'await',
  'callback',
  'hook',
  'hooks',
  'component',
  'server',
  'client',
  'ssr',
  'ssg',
  'api',
  'route',
  'routing',
  'auth',
  'authentication',
  'state',
  'props',
  'children',
  'render',
  'lifecycle',
  'effect',
  'side-effect',
  'mutation',
  'query',
  'fetch',
  'cache',
  'caching',
  'validation',
  'form',
  'input',
  'error',
  'loading',
  'suspense',
  'boundary',
  'lazy',
  'dynamic',
  'import',
  'export',
  'module',
  'type',
  'types',
  'typescript',
  'generic',
  'generics',
];

/**
 * Query parser for extracting framework and concept from natural language
 */
export class QueryParser {
  /**
   * Parse a natural language query into structured components
   */
  parse(query: string): ParsedQuery {
    const normalizedQuery = query.toLowerCase().trim();
    const tokens = this.tokenize(normalizedQuery);

    logger.debug('Parsing query', { query, tokens });

    // Extract version first (before other parsing affects it)
    const version = this.extractVersion(query);

    // Try to identify framework
    const frameworkResult = this.identifyFramework(tokens, normalizedQuery);

    // Extract concept (what's left after removing framework)
    const concept = this.extractConcept(
      tokens,
      frameworkResult.framework,
      normalizedQuery
    );

    // Extract context keywords
    const contextKeywords = this.extractContextKeywords(tokens);

    // Calculate confidence
    const confidence = this.calculateConfidence(
      frameworkResult,
      concept,
      contextKeywords
    );

    const result: ParsedQuery = {
      framework: frameworkResult.framework,
      packageName: frameworkResult.packageName,
      concept,
      version,
      originalQuery: query,
      confidence,
      contextKeywords,
    };

    logger.debug('Parsed query result', {
      framework: result.framework,
      packageName: result.packageName,
      concept: result.concept,
      version: result.version,
      confidence: result.confidence,
    });
    return result;
  }

  /**
   * Tokenize query string
   */
  private tokenize(query: string): string[] {
    return query
      .replace(/[^\w\s-@/.]/g, ' ') // Remove special chars except -, @, /, .
      .split(/\s+/)
      .filter((t) => t.length > 0);
  }

  /**
   * Identify framework from tokens
   */
  private identifyFramework(
    tokens: string[],
    normalizedQuery: string
  ): { framework: string | null; packageName: string | null; confidence: number } {
    let bestMatch: {
      framework: string;
      packageName: string;
      confidence: number;
    } | null = null;

    // Check for direct framework mentions
    for (const [framework, info] of Object.entries(FRAMEWORK_ALIASES)) {
      // Check framework name
      if (tokens.includes(framework) || tokens.includes(framework.replace(/-/g, ''))) {
        const confidence = 1.0;
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { framework, packageName: info.package, confidence };
        }
      }

      // Check aliases
      for (const alias of info.aliases) {
        const aliasLower = alias.toLowerCase();
        if (normalizedQuery.includes(aliasLower)) {
          const confidence = 0.9;
          if (!bestMatch || confidence > bestMatch.confidence) {
            bestMatch = { framework, packageName: info.package, confidence };
          }
        }
      }
    }

    // If no direct framework match, try to infer from API patterns
    if (!bestMatch) {
      for (const token of tokens) {
        const normalizedToken = token.toLowerCase().replace(/[^a-z]/g, '');
        if (API_PATTERNS[normalizedToken]) {
          const frameworks = API_PATTERNS[normalizedToken];
          if (frameworks.length === 1) {
            const framework = frameworks[0];
            const info = FRAMEWORK_ALIASES[framework];
            if (info) {
              bestMatch = {
                framework,
                packageName: info.package,
                confidence: 0.8,
              };
              break;
            }
          }
        }
      }
    }

    return (
      bestMatch || {
        framework: null,
        packageName: null,
        confidence: 0,
      }
    );
  }

  /**
   * Extract the concept being queried
   */
  private extractConcept(
    tokens: string[],
    framework: string | null,
    normalizedQuery: string
  ): string {
    // Remove framework and its aliases from tokens
    let conceptTokens = [...tokens];

    if (framework) {
      const info = FRAMEWORK_ALIASES[framework];
      if (info) {
        // Remove framework name
        conceptTokens = conceptTokens.filter(
          (t) => t !== framework && t !== framework.replace(/-/g, '')
        );

        // Remove aliases
        for (const alias of info.aliases) {
          const aliasTokens = alias.toLowerCase().split(/\s+/);
          conceptTokens = conceptTokens.filter(
            (t) => !aliasTokens.includes(t)
          );
        }
      }
    }

    // Remove common prepositions and articles
    const stopWords = new Set(['in', 'for', 'with', 'the', 'a', 'an', 'to', 'how', 'what', 'why', 'when', 'using', 'use']);
    conceptTokens = conceptTokens.filter((t) => !stopWords.has(t));

    // Remove version strings
    conceptTokens = conceptTokens.filter((t) => !t.match(/^v?\d+(\.\d+)*$/));

    // Check if the first token looks like an API name (camelCase starting with lowercase)
    // If so, use just that as the primary concept
    if (conceptTokens.length > 0) {
      const firstToken = conceptTokens[0];
      // Check for hook pattern (useXxx)
      if (firstToken.match(/^use[a-z]+$/i)) {
        return firstToken;
      }
      // Check for camelCase pattern
      if (firstToken.match(/^[a-z]+[A-Z]/)) {
        return firstToken;
      }
    }

    // Join remaining tokens
    let concept = conceptTokens.join(' ').trim();

    // If empty, try to extract from original query
    if (!concept) {
      // Look for API names (camelCase or PascalCase)
      const apiMatch = normalizedQuery.match(/\b([a-z]+[A-Z][a-zA-Z]*)\b/);
      if (apiMatch) {
        concept = apiMatch[1];
      }
    }

    return concept || normalizedQuery;
  }

  /**
   * Extract version from query
   */
  private extractVersion(query: string): string | null {
    for (const pattern of VERSION_PATTERNS) {
      const match = query.match(pattern);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  /**
   * Extract context keywords from tokens
   */
  private extractContextKeywords(tokens: string[]): string[] {
    return tokens.filter((t) =>
      CONTEXT_KEYWORDS.includes(t.toLowerCase())
    );
  }

  /**
   * Calculate confidence score for the parsed query
   */
  private calculateConfidence(
    frameworkResult: { framework: string | null; confidence: number },
    concept: string,
    contextKeywords: string[]
  ): number {
    let confidence = 0;

    // Framework identification contributes 40%
    if (frameworkResult.framework) {
      confidence += frameworkResult.confidence * 0.4;
    }

    // Concept extraction contributes 40%
    if (concept && concept.length > 0) {
      // Longer, more specific concepts are better
      const conceptScore = Math.min(concept.length / 20, 1);
      confidence += conceptScore * 0.4;
    }

    // Context keywords contribute 20%
    const contextScore = Math.min(contextKeywords.length / 3, 1);
    confidence += contextScore * 0.2;

    return Math.round(confidence * 100) / 100;
  }

  /**
   * Suggest alternative interpretations for a query
   */
  suggestAlternatives(query: string): ParsedQuery[] {
    const primary = this.parse(query);
    const alternatives: ParsedQuery[] = [primary];

    // If no framework was identified, suggest common frameworks
    if (!primary.framework) {
      const commonFrameworks = ['react', 'vue', 'next', 'express'];
      for (const framework of commonFrameworks) {
        const info = FRAMEWORK_ALIASES[framework];
        if (info) {
          alternatives.push({
            ...primary,
            framework,
            packageName: info.package,
            confidence: primary.confidence * 0.5,
          });
        }
      }
    }

    return alternatives;
  }

  /**
   * Get package name from framework name
   */
  getPackageName(framework: string): string | null {
    const normalizedFramework = framework.toLowerCase();
    const info = FRAMEWORK_ALIASES[normalizedFramework];
    return info?.package || null;
  }

  /**
   * Get all known frameworks
   */
  getKnownFrameworks(): string[] {
    return Object.keys(FRAMEWORK_ALIASES);
  }

  /**
   * Check if a string looks like an API name
   */
  isApiName(str: string): boolean {
    // camelCase or PascalCase
    return /^[a-z]+[A-Z]|^[A-Z][a-z]/.test(str);
  }
}

// Singleton instance
let instance: QueryParser | null = null;

export function getQueryParser(): QueryParser {
  if (!instance) {
    instance = new QueryParser();
  }
  return instance;
}
