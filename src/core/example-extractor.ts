/**
 * Code Example Extractor
 *
 * Finds examples in official repos (e.g., `reactjs/react.dev`).
 * Parses markdown to extract code blocks.
 * Tags examples with concepts they demonstrate.
 */

import { getLogger } from '@/utils/logger';

const logger = getLogger('example-extractor');

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
  },
  next: {
    userouter: ['routing/navigation.md', 'api-reference/next/navigation.md'],
    getserversideprops: ['data-fetching/getServerSideProps.md'],
    getstaticprops: ['data-fetching/getStaticProps.md'],
    app: ['app-router/building-your-application/routing.md'],
    metadata: ['app-router/api-reference/functions/generate-metadata.md'],
  },
};

/**
 * Code example extractor for finding and parsing examples
 */
export class ExampleExtractor {
  private cache: Map<string, CodeExample[]> = new Map();
  private readonly CACHE_TTL = 3600 * 1000; // 1 hour

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

      const response = await fetch(url);
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
   * Get examples for a specific concept and framework
   */
  async getExamplesForConcept(
    framework: string,
    concept: string
  ): Promise<CodeExample[]> {
    const config = this.getDocSource(framework);
    if (!config) {
      logger.debug('No doc source for framework', { framework });
      return [];
    }

    const docPaths = this.getDocPathsForConcept(framework, concept);
    const allExamples: CodeExample[] = [];

    for (const path of docPaths) {
      const fullPath = config.docsPath
        ? `${config.docsPath}/${path}`
        : path;

      const examples = await this.fetchExamplesFromGitHub(config, fullPath);

      // Filter the fetched examples for relevance
      const filtered = examples.filter((ex) =>
        ex.concepts.includes(concept.toLowerCase()) ||
        ex.code.toLowerCase().includes(concept.toLowerCase())
      );

      allExamples.push(...filtered);
    }

    // Deduplicate by code content
    const seen = new Set<string>();
    const unique = allExamples.filter((ex) => {
      const key = ex.code.trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    logger.debug('Found examples for concept', {
      framework,
      concept,
      count: unique.length,
    });

    return unique;
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
