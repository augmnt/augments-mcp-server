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
    aliases: ['react-query', 'tanstack query', 'react query', '@tanstack/react-query', '@tanstack/query'],
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
    package: '@trpc/client',
    aliases: ['tRPC', 't-rpc', '@trpc/client', '@trpc/server'],
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

  // BaaS / Database Services
  supabase: {
    package: '@supabase/supabase-js',
    aliases: ['supabase-js', '@supabase'],
  },
  firebase: {
    package: 'firebase',
    aliases: ['firebase-js'],
  },

  // Form handling
  'react-hook-form': {
    package: 'react-hook-form',
    aliases: ['rhf', 'react hook form'],
  },
  formik: {
    package: 'formik',
    aliases: [],
  },

  // Animation
  'framer-motion': {
    package: 'framer-motion',
    aliases: ['framer', 'motion'],
  },
  gsap: {
    package: 'gsap',
    aliases: ['greensock'],
  },

  // Styling
  'styled-components': {
    package: 'styled-components',
    aliases: ['styled'],
  },
  emotion: {
    package: '@emotion/react',
    aliases: ['@emotion'],
  },

  // Phase 3.4: Expanded aliases (+15 packages)
  shadcn: {
    package: '@radix-ui/react-slot',
    aliases: ['shadcn-ui', 'shadcn/ui'],
  },
  clerk: {
    package: '@clerk/nextjs',
    aliases: ['clerk-js', '@clerk'],
  },
  'next-auth': {
    package: 'next-auth',
    aliases: ['nextauth', 'auth.js', 'authjs'],
  },
  lucia: {
    package: 'lucia',
    aliases: ['lucia-auth'],
  },
  tailwindcss: {
    package: 'tailwindcss',
    aliases: ['tailwind', 'tw'],
  },
  'headless-ui': {
    package: '@headlessui/react',
    aliases: ['headlessui', '@headlessui'],
  },
  radix: {
    package: '@radix-ui/react-dialog',
    aliases: ['radix-ui', '@radix-ui', 'radix ui'],
  },
  tiptap: {
    package: '@tiptap/react',
    aliases: ['@tiptap'],
  },
  three: {
    package: 'three',
    aliases: ['threejs', 'three.js'],
  },
  d3: {
    package: 'd3',
    aliases: ['d3js', 'd3.js'],
  },
  'socket.io': {
    package: 'socket.io',
    aliases: ['socketio', 'socket-io'],
  },
  bullmq: {
    package: 'bullmq',
    aliases: ['bull-mq'],
  },
  ioredis: {
    package: 'ioredis',
    aliases: [],
  },
  resend: {
    package: 'resend',
    aliases: [],
  },
  uploadthing: {
    package: 'uploadthing',
    aliases: ['upload-thing'],
  },
};

/**
 * Common API patterns and their associated frameworks.
 * Only include patterns that are specific enough to avoid false positives.
 * Generic words (create, update, delete, string, number, object, array, etc.) are excluded.
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
  usepathname: ['next'],
  usesearchparams: ['next'],
  useselectedlayoutsegment: ['next'],
  useselectedlayoutsegments: ['next'],
  getserversideprops: ['next'],
  getstaticprops: ['next'],
  getstaticpaths: ['next'],
  generatemetadata: ['next'],
  generatestaticparams: ['next'],

  // Vue (only specific enough patterns)
  reactive: ['vue'],
  watcheffect: ['vue'],
  onmounted: ['vue'],
  onunmounted: ['vue'],
  defineprops: ['vue'],
  defineemits: ['vue'],
  definecomponent: ['vue'],

  // Prisma (only unique method names)
  findmany: ['prisma'],
  findunique: ['prisma'],
  findfirst: ['prisma'],
  upsert: ['prisma'],

  // Zod (only specific enough patterns)
  safeparse: ['zod'],
  zodschema: ['zod'],

  // TanStack Query
  usequery: ['tanstack-query'],
  usemutation: ['tanstack-query'],
  useinfinitequery: ['tanstack-query'],
  queryclient: ['tanstack-query'],
  usesuspensequery: ['tanstack-query'],

  // Supabase
  createclient: ['supabase'],
  supabaseclient: ['supabase'],
  fromauthheader: ['supabase'],

  // tRPC
  createtrpcproxyclient: ['trpc'],
  createtrpcclient: ['trpc'],
  inittrpc: ['trpc'],
  trpcrouter: ['trpc'],

  // React Hook Form
  useform: ['react-hook-form'],
  useformcontext: ['react-hook-form'],
  usecontroller: ['react-hook-form'],
  usewatch: ['react-hook-form'],
  usefieldarray: ['react-hook-form'],

  // Framer Motion (only specific patterns)
  useanimate: ['framer-motion'],
  animatepresence: ['framer-motion'],
};

/**
 * Version patterns for extraction.
 * Require explicit version markers (v, @, version) to prevent matching
 * port numbers, issue numbers, or other numeric tokens.
 */
const VERSION_PATTERNS = [
  /\bv(\d+(?:\.\d+)?(?:\.\d+)?(?:-[\w.]+)?)\b/i, // v19, v19.0, v19.0.0, v19.0.0-beta.1
  /\bversion\s+(\d+(?:\.\d+)?(?:\.\d+)?)\b/i, // version 19
  /@(\d+(?:\.\d+){1,2}(?:-[\w.]+)?)\b/, // @19.0 or @19.0.0 (require at least major.minor)
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
  private parseCache: Map<string, ParsedQuery> = new Map();
  private readonly MAX_PARSE_CACHE_SIZE = 200;

  /**
   * Parse a natural language query into structured components
   */
  parse(query: string): ParsedQuery {
    // Check parse cache (deterministic for same input)
    const cached = this.parseCache.get(query);
    if (cached) {
      return cached;
    }
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

    // Cache the result (evict oldest if at capacity)
    if (this.parseCache.size >= this.MAX_PARSE_CACHE_SIZE) {
      const firstKey = this.parseCache.keys().next().value;
      if (firstKey !== undefined) {
        this.parseCache.delete(firstKey);
      }
    }
    this.parseCache.set(query, result);

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

    // Pre-check: match tokens directly against package names (handles scoped packages)
    for (const [framework, info] of Object.entries(FRAMEWORK_ALIASES)) {
      const pkgLower = info.package.toLowerCase();
      // Use token-level matching to prevent "react" matching inside "reactive"
      if (tokens.includes(pkgLower)) {
        const confidence = 1.0;
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { framework, packageName: info.package, confidence };
        }
      }
    }

    // Check for direct framework mentions
    if (!bestMatch) {
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
          // For single-word aliases, check tokens to prevent substring false positives
          // For multi-word aliases, use query includes (safe since multi-word is specific)
          if (aliasLower.includes(' ')) {
            if (normalizedQuery.includes(aliasLower)) {
              const confidence = 0.9;
              if (!bestMatch || confidence > bestMatch.confidence) {
                bestMatch = { framework, packageName: info.package, confidence };
              }
            }
          } else {
            if (tokens.includes(aliasLower)) {
              const confidence = 0.9;
              if (!bestMatch || confidence > bestMatch.confidence) {
                bestMatch = { framework, packageName: info.package, confidence };
              }
            }
          }
        }
      }
    }

    // If no direct framework match, try to infer from API patterns
    if (!bestMatch) {
      for (const token of tokens) {
        const normalizedToken = token.toLowerCase().replace(/[^a-z]/g, '');
        // Only use API pattern fallback for tokens that are specific enough:
        // either 6+ chars long, or match the use* hook pattern
        if (normalizedToken.length < 6 && !normalizedToken.startsWith('use')) {
          continue;
        }
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

    // If still no match, try fuzzy matching (30% tolerance)
    if (!bestMatch) {
      for (const token of tokens) {
        if (token.length < 3) continue;
        for (const [framework, info] of Object.entries(FRAMEWORK_ALIASES)) {
          const distance = levenshteinDistance(token, framework);
          const tolerance = Math.ceil(framework.length * 0.3);
          if (distance > 0 && distance <= tolerance) {
            bestMatch = {
              framework,
              packageName: info.package,
              confidence: 0.6,
            };
            break;
          }
        }
        if (bestMatch) break;
      }
    }

    // Dynamic npm package resolution: treat first npm-like token as potential package
    if (!bestMatch) {
      for (const token of tokens) {
        // Match scoped (@scope/name) or unscoped (name) package patterns
        if (/^(@[\w-]+\/)?[\w-]+$/.test(token) && token.length >= 2) {
          bestMatch = {
            framework: token,
            packageName: token,
            confidence: 0.4,
          };
          break;
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

    // Remove common prepositions, articles, question words, and conversational fillers
    const stopWords = new Set([
      // Articles & prepositions
      'in', 'for', 'with', 'the', 'a', 'an', 'to', 'of', 'on', 'at', 'by', 'from',
      // Question words
      'how', 'what', 'why', 'when', 'where', 'which',
      // Verbs & fillers
      'using', 'use', 'does', 'do', 'is', 'are', 'was', 'were', 'be', 'been',
      'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might',
      'work', 'works', 'working', 'get', 'gets', 'getting',
      'show', 'tell', 'explain', 'describe',
      // Pronouns & misc
      'about', 'me', 'you', 'i', 'my', 'it', 'its', 'this', 'that',
      'used', 'please', 'help', 'need', 'want',
    ]);
    conceptTokens = conceptTokens.filter((t) => !stopWords.has(t));

    // Remove version strings
    conceptTokens = conceptTokens.filter((t) => !t.match(/^v?\d+(\.\d+)*$/));

    // Scan all tokens for API name patterns (hooks, camelCase, PascalCase, known API_PATTERNS)
    // Return the first matching token as the primary concept
    for (const token of conceptTokens) {
      if (
        /^use[a-z]+$/i.test(token) ||        // Hook pattern (useXxx)
        /^[a-z]+[A-Z]/.test(token) ||         // camelCase
        /^[A-Z][a-z]+[A-Z]/.test(token) ||    // PascalCase
        API_PATTERNS[token]                     // Known API pattern
      ) {
        return token;
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

/**
 * Lightweight Levenshtein distance for fuzzy matching
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Use single row for space efficiency
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

// Singleton instance
let instance: QueryParser | null = null;

export function getQueryParser(): QueryParser {
  if (!instance) {
    instance = new QueryParser();
  }
  return instance;
}
