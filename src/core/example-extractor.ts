/**
 * Code Example Extractor
 *
 * Finds examples in official repos (e.g., `reactjs/react.dev`).
 * Parses markdown to extract code blocks.
 * Tags examples with concepts they demonstrate.
 */

import { getLogger } from '@/utils/logger';
import { getTypeFetcher } from './type-fetcher';

const logger = getLogger('example-extractor');

// Fetch timeout for GitHub raw content
const GITHUB_TIMEOUT = 8_000; // 8s

/**
 * A code example with metadata
 */
export interface CodeExample {
  /** The code content */
  code: string;
  /** Programming language (typescript, javascript, jsx, tsx) */
  language: string;
  /** Source URL or file path */
  source: string;
  /** Concepts/APIs demonstrated */
  concepts: string[];
  /** Title or description if available */
  title?: string;
  /** Context around the example */
  context?: string;
  /** Line numbers in source file */
  lines?: { start: number; end: number };
}

/**
 * Documentation source configuration
 */
export interface DocSourceConfig {
  /** GitHub repository (owner/repo) */
  repo: string;
  /** Documentation directory path */
  docsPath: string;
  /** Branch name */
  branch: string;
  /** Base URL for documentation website */
  websiteBaseUrl?: string;
}

/**
 * Known documentation sources for popular frameworks
 */
const DOC_SOURCES: Record<string, DocSourceConfig> = {
  react: {
    repo: 'reactjs/react.dev',
    docsPath: 'src/content/reference/react',
    branch: 'main',
    websiteBaseUrl: 'https://react.dev',
  },
  'react-dom': {
    repo: 'reactjs/react.dev',
    docsPath: 'src/content/reference/react-dom',
    branch: 'main',
    websiteBaseUrl: 'https://react.dev',
  },
  next: {
    repo: 'vercel/next.js',
    docsPath: 'docs',
    branch: 'canary',
    websiteBaseUrl: 'https://nextjs.org',
  },
  vue: {
    repo: 'vuejs/docs',
    docsPath: 'src/guide',
    branch: 'main',
    websiteBaseUrl: 'https://vuejs.org',
  },
  prisma: {
    repo: 'prisma/docs',
    docsPath: 'content',
    branch: 'main',
    websiteBaseUrl: 'https://www.prisma.io/docs',
  },
  zod: {
    repo: 'colinhacks/zod',
    docsPath: '',
    branch: 'main',
    websiteBaseUrl: 'https://zod.dev',
  },
  supabase: {
    repo: 'supabase/supabase',
    docsPath: 'apps/docs/content/guides',
    branch: 'master',
    websiteBaseUrl: 'https://supabase.com/docs',
  },
  'tanstack-query': {
    repo: 'TanStack/query',
    docsPath: 'docs/framework/react',
    branch: 'main',
    websiteBaseUrl: 'https://tanstack.com/query',
  },
  trpc: {
    repo: 'trpc/trpc',
    docsPath: 'www/docs',
    branch: 'main',
    websiteBaseUrl: 'https://trpc.io/docs',
  },
  'react-hook-form': {
    repo: 'react-hook-form/documentation',
    docsPath: 'src/content/docs',
    branch: 'master',
    websiteBaseUrl: 'https://react-hook-form.com',
  },
  'framer-motion': {
    repo: 'framer/motion',
    docsPath: 'packages/framer-motion',
    branch: 'main',
    websiteBaseUrl: 'https://www.framer.com/motion',
  },
  express: {
    repo: 'expressjs/expressjs.com',
    docsPath: 'en/guide',
    branch: 'gh-pages',
    websiteBaseUrl: 'https://expressjs.com',
  },

  // Phase 3.3: Expanded doc sources (+12 frameworks)
  zustand: {
    repo: 'pmndrs/zustand',
    docsPath: 'docs',
    branch: 'main',
    websiteBaseUrl: 'https://zustand-demo.pmnd.rs',
  },
  jotai: {
    repo: 'pmndrs/jotai',
    docsPath: 'docs',
    branch: 'main',
    websiteBaseUrl: 'https://jotai.org',
  },
  drizzle: {
    repo: 'drizzle-team/drizzle-orm',
    docsPath: 'docs',
    branch: 'main',
    websiteBaseUrl: 'https://orm.drizzle.team',
  },
  swr: {
    repo: 'vercel/swr',
    docsPath: 'pages',
    branch: 'main',
    websiteBaseUrl: 'https://swr.vercel.app',
  },
  vitest: {
    repo: 'vitest-dev/vitest',
    docsPath: 'docs',
    branch: 'main',
    websiteBaseUrl: 'https://vitest.dev',
  },
  playwright: {
    repo: 'microsoft/playwright',
    docsPath: 'docs/src',
    branch: 'main',
    websiteBaseUrl: 'https://playwright.dev',
  },
  fastify: {
    repo: 'fastify/fastify',
    docsPath: 'docs',
    branch: 'main',
    websiteBaseUrl: 'https://fastify.dev',
  },
  hono: {
    repo: 'honojs/hono',
    docsPath: 'docs',
    branch: 'main',
    websiteBaseUrl: 'https://hono.dev',
  },
  solid: {
    repo: 'solidjs/solid-docs-next',
    docsPath: 'src/routes',
    branch: 'main',
    websiteBaseUrl: 'https://docs.solidjs.com',
  },
  svelte: {
    repo: 'sveltejs/svelte',
    docsPath: 'documentation/docs',
    branch: 'main',
    websiteBaseUrl: 'https://svelte.dev',
  },
  angular: {
    repo: 'angular/angular',
    docsPath: 'adev/src/content',
    branch: 'main',
    websiteBaseUrl: 'https://angular.dev',
  },
  redux: {
    repo: 'reduxjs/redux',
    docsPath: 'docs',
    branch: 'master',
    websiteBaseUrl: 'https://redux.js.org',
  },
};

/**
 * Mapping from concepts to potential doc file paths
 */
const CONCEPT_TO_DOC_PATHS: Record<string, Record<string, string[]>> = {
  react: {
    usestate: ['hooks/useState.md', 'useState.md'],
    useeffect: ['hooks/useEffect.md', 'useEffect.md'],
    usecontext: ['hooks/useContext.md', 'useContext.md'],
    usereducer: ['hooks/useReducer.md', 'useReducer.md'],
    usecallback: ['hooks/useCallback.md', 'useCallback.md'],
    usememo: ['hooks/useMemo.md', 'useMemo.md'],
    useref: ['hooks/useRef.md', 'useRef.md'],
    uselayouteffect: ['hooks/useLayoutEffect.md', 'useLayoutEffect.md'],
    usetransition: ['hooks/useTransition.md', 'useTransition.md'],
    useid: ['hooks/useId.md', 'useId.md'],
    component: ['components-and-props.md', 'component.md'],
    props: ['components-and-props.md'],
    state: ['state-and-lifecycle.md', 'managing-state.md'],
    forwardref: ['forwardRef.md'],
    createcontext: ['createContext.md'],
    suspense: ['Suspense.md'],
  },
  next: {
    userouter: ['routing/navigation.md', 'api-reference/next/navigation.md'],
    getserversideprops: ['data-fetching/getServerSideProps.md'],
    getstaticprops: ['data-fetching/getStaticProps.md'],
    app: ['app-router/building-your-application/routing.md'],
    metadata: ['app-router/api-reference/functions/generate-metadata.md'],
  },
  'tanstack-query': {
    usequery: ['reference/useQuery.md', 'useQuery.md'],
    usemutation: ['reference/useMutation.md', 'useMutation.md'],
    useinfinitequery: ['reference/useInfiniteQuery.md', 'useInfiniteQuery.md'],
    queryclient: ['reference/QueryClient.md', 'QueryClient.md'],
    usesuspensequery: ['reference/useSuspenseQuery.md'],
  },
  supabase: {
    createclient: ['getting-started.mdx', 'auth/overview.mdx'],
    auth: ['auth/overview.mdx', 'auth/authentication.mdx'],
    storage: ['storage/overview.mdx'],
    realtime: ['realtime/overview.mdx'],
    database: ['database/overview.mdx'],
  },
  trpc: {
    createtrpcproxyclient: ['client/vanilla.md', 'client/setup.md'],
    router: ['server/routers.md'],
    procedure: ['server/procedures.md'],
    middleware: ['server/middlewares.md'],
  },
  'react-hook-form': {
    useform: ['useform.mdx', 'api/useform.mdx'],
    usecontroller: ['usecontroller.mdx', 'api/usecontroller.mdx'],
    useformcontext: ['useformcontext.mdx', 'api/useformcontext.mdx'],
    usefieldarray: ['usefieldarray.mdx', 'api/usefieldarray.mdx'],
  },
  express: {
    router: ['routing.md'],
    middleware: ['using-middleware.md'],
    errorhandling: ['error-handling.md'],
  },
  vue: {
    ref: ['essentials/reactivity-fundamentals.md'],
    computed: ['essentials/computed.md'],
    watch: ['essentials/watchers.md'],
    reactive: ['essentials/reactivity-fundamentals.md'],
    onmounted: ['essentials/lifecycle.md'],
  },
  zustand: {
    create: ['guides/updating-state.md', 'guides/tutorial-tic-tac-toe.md'],
    middleware: ['guides/flux-inspired-practice.md'],
    persist: ['integrations/persisting-store-data.md'],
  },
  jotai: {
    atom: ['basics/primitives.md', 'guides/atoms-in-atom.md'],
    useatomvalue: ['basics/primitives.md'],
    derived: ['guides/atoms-in-atom.md'],
  },
  drizzle: {
    pgtable: ['column-types/pg.md', 'schemas.md'],
    select: ['crud.md', 'select.md'],
    insert: ['crud.md', 'insert.md'],
    migrate: ['migrations.md'],
  },
  redux: {
    createslice: ['tutorials/fundamentals/part-8-modern-redux.md'],
    configurestore: ['tutorials/fundamentals/part-8-modern-redux.md'],
    useselector: ['tutorials/fundamentals/part-5-ui-and-react.md'],
    usedispatch: ['tutorials/fundamentals/part-5-ui-and-react.md'],
  },
  vitest: {
    describe: ['guide/filtering.md', 'api/index.md'],
    expect: ['api/expect.md'],
    mock: ['guide/mocking.md', 'api/mock.md'],
  },
  playwright: {
    test: ['test-components-js.md', 'writing-tests.md'],
    page: ['pages.md', 'api/class-page.md'],
    locator: ['locators.md', 'api/class-locator.md'],
    expect: ['test-assertions.md'],
  },
  angular: {
    component: ['guide/components.md'],
    signal: ['guide/signals.md'],
    inject: ['guide/di/dependency-injection.md'],
  },
  swr: {
    useswr: ['docs/getting-started.mdx', 'docs/api.mdx'],
    mutation: ['docs/mutation.mdx'],
    pagination: ['docs/pagination.mdx'],
  },
};

/**
 * Code example extractor for finding and parsing examples
 */
/**
 * Discovered doc source info from npm metadata
 */
interface DiscoveredDocSource {
  owner: string;
  repo: string;
  docPaths: string[];
}

export class ExampleExtractor {
  private cache: Map<string, CodeExample[]> = new Map();
  private conceptCache: Map<string, { examples: CodeExample[]; fetchedAt: number }> = new Map();
  private discoveryCache: Map<string, DiscoveredDocSource | null> = new Map();
  private readonly CACHE_TTL = 3600 * 1000; // 1 hour
  private readonly MAX_CONCEPT_CACHE_SIZE = 100;

  /**
   * Extract code examples from markdown content
   */
  extractFromMarkdown(content: string, source: string): CodeExample[] {
    const examples: CodeExample[] = [];
    const codeBlockRegex = /```(\w+)?\s*\n([\s\S]*?)```/g;

    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      const language = match[1] || 'javascript';
      const code = match[2].trim();

      // Skip very short examples or configuration files
      if (code.length < 20 || this.isConfigCode(code)) {
        continue;
      }

      // Calculate line numbers
      const beforeMatch = content.substring(0, match.index);
      const startLine = beforeMatch.split('\n').length;
      const endLine = startLine + code.split('\n').length - 1;

      // Extract concepts from the code
      const concepts = this.extractConceptsFromCode(code, language);

      // Extract context (heading or paragraph before code block)
      const context = this.extractContext(content, match.index);

      examples.push({
        code,
        language: this.normalizeLanguage(language),
        source,
        concepts,
        context,
        lines: { start: startLine, end: endLine },
      });
    }

    logger.debug('Extracted examples from markdown', {
      source,
      count: examples.length,
    });

    return examples;
  }

  /**
   * Extract concepts/APIs from code content
   */
  extractConceptsFromCode(code: string, language: string): string[] {
    const concepts = new Set<string>();

    // React hooks
    const hookMatches = code.match(/\buse[A-Z][a-zA-Z]*/g);
    if (hookMatches) {
      hookMatches.forEach((hook) => concepts.add(hook.toLowerCase()));
    }

    // React components (PascalCase)
    const componentMatches = code.match(/\b[A-Z][a-zA-Z]+(?=[\s(.<])/g);
    if (componentMatches) {
      componentMatches.forEach((comp) => {
        if (!this.isBuiltInType(comp)) {
          concepts.add(comp.toLowerCase());
        }
      });
    }

    // Import statements
    const importMatches = code.match(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g);
    if (importMatches) {
      importMatches.forEach((imp) => {
        const fromMatch = imp.match(/from\s+['"]([^'"]+)['"]/);
        if (fromMatch) {
          const pkg = fromMatch[1].split('/')[0].replace('@', '');
          concepts.add(pkg);
        }
      });
    }

    // Function declarations
    const functionMatches = code.match(/(?:function|const|let|var)\s+(\w+)\s*(?:=|<|\()/g);
    if (functionMatches) {
      functionMatches.forEach((fn) => {
        const nameMatch = fn.match(/(?:function|const|let|var)\s+(\w+)/);
        if (nameMatch && this.isSignificantName(nameMatch[1])) {
          concepts.add(nameMatch[1].toLowerCase());
        }
      });
    }

    // Prisma methods
    const prismaMatches = code.match(/\.(findMany|findUnique|findFirst|create|update|delete|upsert)\(/g);
    if (prismaMatches) {
      prismaMatches.forEach((method) => {
        const name = method.slice(1, -1);
        concepts.add(name.toLowerCase());
      });
    }

    // Zod methods
    const zodMatches = code.match(/z\.(\w+)/g);
    if (zodMatches) {
      zodMatches.forEach((method) => {
        concepts.add(method.slice(2).toLowerCase());
      });
    }

    return Array.from(concepts);
  }

  /**
   * Search examples by concept
   */
  searchByConceptFromContent(
    content: string,
    concept: string,
    source: string
  ): CodeExample[] {
    const allExamples = this.extractFromMarkdown(content, source);
    const normalizedConcept = concept.toLowerCase();

    return allExamples.filter((example) => {
      // Check if concept is in extracted concepts
      if (example.concepts.includes(normalizedConcept)) {
        return true;
      }

      // Check if concept appears in code
      if (example.code.toLowerCase().includes(normalizedConcept)) {
        return true;
      }

      // Check if context mentions concept
      if (example.context?.toLowerCase().includes(normalizedConcept)) {
        return true;
      }

      return false;
    });
  }

  /**
   * Get documentation source for a framework
   */
  getDocSource(framework: string): DocSourceConfig | null {
    return DOC_SOURCES[framework.toLowerCase()] || null;
  }

  /**
   * Get potential doc paths for a concept
   */
  getDocPathsForConcept(
    framework: string,
    concept: string
  ): string[] {
    const frameworkPaths = CONCEPT_TO_DOC_PATHS[framework.toLowerCase()];
    if (!frameworkPaths) return [];

    const normalizedConcept = concept.toLowerCase().replace(/\s+/g, '');
    return frameworkPaths[normalizedConcept] || [];
  }

  /**
   * Build GitHub raw content URL
   */
  buildGitHubRawUrl(
    repo: string,
    branch: string,
    path: string
  ): string {
    return `https://raw.githubusercontent.com/${repo}/${branch}/${path}`;
  }

  /**
   * Fetch examples from GitHub documentation
   */
  async fetchExamplesFromGitHub(
    config: DocSourceConfig,
    filePath: string
  ): Promise<CodeExample[]> {
    const cacheKey = `${config.repo}:${filePath}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    try {
      const url = this.buildGitHubRawUrl(config.repo, config.branch, filePath);
      logger.debug('Fetching examples from GitHub', { url });

      const response = await fetch(url, { signal: AbortSignal.timeout(GITHUB_TIMEOUT) });
      if (!response.ok) {
        logger.debug('Failed to fetch GitHub content', {
          url,
          status: response.status,
        });
        return [];
      }

      const content = await response.text();
      const source = `https://github.com/${config.repo}/blob/${config.branch}/${filePath}`;
      const examples = this.extractFromMarkdown(content, source);

      this.cache.set(cacheKey, examples);
      return examples;
    } catch (error) {
      logger.error('Failed to fetch examples from GitHub', {
        config,
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Auto-discover doc source from npm package metadata.
   * Parses repository URL to find GitHub owner/repo, then probes common doc paths.
   */
  async discoverDocSource(packageName: string): Promise<DiscoveredDocSource | null> {
    // Check discovery cache (indefinite TTL)
    if (this.discoveryCache.has(packageName)) {
      return this.discoveryCache.get(packageName)!;
    }

    try {
      const typeFetcher = getTypeFetcher();
      const info = await typeFetcher.getVersionSpecificInfo(packageName, 'latest');
      if (!info) {
        this.discoveryCache.set(packageName, null);
        return null;
      }

      // Parse repository URL
      let repoUrl: string | null = null;
      if (typeof info.repository === 'string') {
        repoUrl = info.repository;
      } else if (info.repository?.url) {
        repoUrl = info.repository.url;
      }

      if (!repoUrl) {
        this.discoveryCache.set(packageName, null);
        return null;
      }

      // Extract owner/repo from GitHub URL patterns
      const ghMatch = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
      if (!ghMatch) {
        this.discoveryCache.set(packageName, null);
        return null;
      }

      const owner = ghMatch[1];
      const repo = ghMatch[2];

      // Probe common doc paths via GitHub raw content
      const probePaths = ['docs/', 'documentation/', 'doc/', 'README.md'];
      const discoveredPaths: string[] = [];

      // Probe in parallel with a 5s overall timeout
      const probePromises = probePaths.map(async (path) => {
        try {
          const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/${path}`;
          const response = await fetch(url, {
            method: 'HEAD',
            signal: AbortSignal.timeout(5000),
          });
          if (response.ok) return path;
        } catch {
          // Ignore probe failures
        }
        return null;
      });

      const probeResults = await Promise.allSettled(probePromises);
      for (const result of probeResults) {
        if (result.status === 'fulfilled' && result.value) {
          discoveredPaths.push(result.value);
        }
      }

      if (discoveredPaths.length === 0) {
        // Always have README.md as fallback
        discoveredPaths.push('README.md');
      }

      const discovered: DiscoveredDocSource = { owner, repo, docPaths: discoveredPaths };
      this.discoveryCache.set(packageName, discovered);

      logger.debug('Discovered doc source', { packageName, owner, repo, docPaths: discoveredPaths });
      return discovered;
    } catch (error) {
      logger.debug('Doc source discovery failed', {
        packageName,
        error: error instanceof Error ? error.message : String(error),
      });
      this.discoveryCache.set(packageName, null);
      return null;
    }
  }

  /**
   * Get examples for a specific concept and framework
   */
  async getExamplesForConcept(
    framework: string,
    concept: string
  ): Promise<CodeExample[]> {
    // Check concept-level cache
    const conceptKey = `${framework}:${concept.toLowerCase()}`;
    const cachedConcept = this.conceptCache.get(conceptKey);
    if (cachedConcept && Date.now() - cachedConcept.fetchedAt < this.CACHE_TTL) {
      logger.debug('Concept cache hit', { framework, concept });
      return cachedConcept.examples;
    }

    const config = this.getDocSource(framework);
    const allExamples: CodeExample[] = [];

    if (config) {
      const docPaths = this.getDocPathsForConcept(framework, concept);

      // Fetch all doc paths in parallel
      const fetchPromises = docPaths.map(async (path) => {
        const fullPath = config.docsPath
          ? `${config.docsPath}/${path}`
          : path;

        const examples = await this.fetchExamplesFromGitHub(config, fullPath);

        // Filter the fetched examples for relevance
        return examples.filter((ex) =>
          ex.concepts.includes(concept.toLowerCase()) ||
          ex.code.toLowerCase().includes(concept.toLowerCase())
        );
      });

      const results = await Promise.allSettled(fetchPromises);
      for (const result of results) {
        if (result.status === 'fulfilled') {
          allExamples.push(...result.value);
        }
      }
    } else {
      // No curated doc source — try auto-discovery from npm metadata
      logger.debug('No curated doc source, trying auto-discovery', { framework });
      const discovered = await this.discoverDocSource(framework);
      if (discovered) {
        // Try fetching README.md from the discovered repo
        const discoveredConfig: DocSourceConfig = {
          repo: `${discovered.owner}/${discovered.repo}`,
          docsPath: '',
          branch: 'main',
        };

        for (const docPath of discovered.docPaths) {
          const examples = await this.fetchExamplesFromGitHub(discoveredConfig, docPath);
          const relevant = examples.filter((ex) =>
            ex.concepts.includes(concept.toLowerCase()) ||
            ex.code.toLowerCase().includes(concept.toLowerCase())
          );
          allExamples.push(...relevant);
        }
      }
    }

    // Deduplicate by code content
    const seen = new Set<string>();
    const unique = allExamples.filter((ex) => {
      const key = ex.code.trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Score and sort examples by quality
    const scored = unique
      .map((ex) => ({ example: ex, score: this.scoreExample(ex) }))
      .sort((a, b) => b.score - a.score)
      .map((s) => s.example);

    logger.debug('Found examples for concept', {
      framework,
      concept,
      count: scored.length,
    });

    // Cache the scored results (evict oldest if at capacity)
    if (this.conceptCache.size >= this.MAX_CONCEPT_CACHE_SIZE) {
      const firstKey = this.conceptCache.keys().next().value;
      if (firstKey !== undefined) {
        this.conceptCache.delete(firstKey);
      }
    }
    this.conceptCache.set(conceptKey, { examples: scored, fetchedAt: Date.now() });

    return scored;
  }

  /**
   * Score an example by quality (higher = better)
   */
  private scoreExample(example: CodeExample): number {
    let score = 0;
    const code = example.code;

    // Boost: has import + usage pattern (real code example)
    if (/\bimport\s/.test(code)) score += 20;

    // Boost: TypeScript or TSX
    if (example.language === 'typescript' || example.language === 'tsx') score += 15;

    // Boost: JSX components
    if (example.language === 'jsx' || example.language === 'tsx') score += 10;

    // Boost: has context heading
    if (example.context) score += 10;

    // Boost: has multiple concepts (demonstrates more)
    score += Math.min(example.concepts.length * 3, 15);

    // Boost: moderate code length (50-500 chars is ideal)
    if (code.length >= 50 && code.length <= 500) score += 10;
    else if (code.length > 500 && code.length <= 1000) score += 5;

    // Penalize: install commands
    if (/\b(npm|yarn|pnpm|bun)\s+(install|add|i)\b/.test(code)) score -= 30;

    // Penalize: bash/shell snippets
    if (example.language === 'bash' || example.language === 'shell') score -= 25;

    // Penalize: very short code (likely incomplete)
    if (code.length < 30) score -= 15;

    // Penalize: just configuration
    if (this.isConfigCode(code)) score -= 20;

    return score;
  }

  /**
   * Extract context (heading or description) before a code block
   */
  private extractContext(content: string, codeBlockIndex: number): string | undefined {
    // Look for the nearest heading or paragraph before the code block
    const before = content.substring(0, codeBlockIndex);
    const lines = before.split('\n').reverse();

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines
      if (!trimmed) continue;

      // Found a heading
      if (trimmed.startsWith('#')) {
        return trimmed.replace(/^#+\s*/, '').trim();
      }

      // Found a paragraph (not a code block marker)
      if (!trimmed.startsWith('```') && trimmed.length > 20) {
        return trimmed.substring(0, 200); // Limit context length
      }
    }

    return undefined;
  }

  /**
   * Normalize language identifier
   */
  private normalizeLanguage(lang: string): string {
    const normalized = lang.toLowerCase();
    const aliases: Record<string, string> = {
      js: 'javascript',
      ts: 'typescript',
      jsx: 'jsx',
      tsx: 'tsx',
      json: 'json',
      bash: 'bash',
      sh: 'bash',
      shell: 'bash',
      css: 'css',
      html: 'html',
      md: 'markdown',
      markdown: 'markdown',
      sql: 'sql',
      prisma: 'prisma',
      graphql: 'graphql',
      gql: 'graphql',
    };
    return aliases[normalized] || normalized;
  }

  /**
   * Check if code is configuration rather than example
   */
  private isConfigCode(code: string): boolean {
    const configPatterns = [
      /^{[\s\S]*}$/m, // JSON-like object only
      /^module\.exports\s*=/m,
      /^export\s+default\s+{/m,
      /next\.config/i,
      /tsconfig/i,
      /package\.json/i,
      /\.config\./i,
      /^npm\s+/m,
      /^yarn\s+/m,
      /^pnpm\s+/m,
    ];

    return configPatterns.some((pattern) => pattern.test(code));
  }

  /**
   * Check if a type name is a built-in
   */
  private isBuiltInType(name: string): boolean {
    const builtIns = new Set([
      'Array',
      'String',
      'Number',
      'Boolean',
      'Object',
      'Function',
      'Promise',
      'Error',
      'Date',
      'Map',
      'Set',
      'Symbol',
      'RegExp',
      'JSON',
      'Math',
      'Intl',
      'React',
      'Component',
      'Fragment',
      'Suspense',
      'HTMLElement',
      'Element',
      'Node',
      'Document',
      'Window',
    ]);
    return builtIns.has(name);
  }

  /**
   * Check if a function/variable name is significant
   */
  private isSignificantName(name: string): boolean {
    // Skip short names and common variable names
    const insignificant = new Set([
      'i',
      'j',
      'k',
      'x',
      'y',
      'z',
      'n',
      'a',
      'b',
      'c',
      'el',
      'fn',
      'cb',
      'err',
      'res',
      'req',
      'ctx',
      'val',
      'key',
      'tmp',
      'temp',
      'data',
      'item',
      'value',
      'result',
      'response',
      'error',
      'index',
      'count',
    ]);
    return name.length >= 3 && !insignificant.has(name.toLowerCase());
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
    this.conceptCache.clear();
    logger.debug('Cache cleared');
  }
}

// Singleton instance
let instance: ExampleExtractor | null = null;

export function getExampleExtractor(): ExampleExtractor {
  if (!instance) {
    instance = new ExampleExtractor();
  }
  return instance;
}
