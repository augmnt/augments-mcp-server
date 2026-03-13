/**
 * diagnose_error Tool
 *
 * Troubleshoots errors using:
 * 1. Curated error pattern database
 * 2. GitHub Issues search API
 * 3. Docs troubleshooting sections
 * 4. Type information for missing-export errors
 */

import { getLogger } from '@/utils/logger';
import { getQueryParser, getDocFetcher, getTypeFetcher, getTypeParser } from '@/core';
import { matchErrorPatterns, type ErrorPattern } from '@/core/error-patterns';

const logger = getLogger('diagnose-error');

const GITHUB_TIMEOUT = 8_000;

export interface DiagnoseErrorInput {
  /** The error message or stack trace */
  error: string;
  /** Optional: specific package/framework */
  package?: string;
  /** Optional: package version */
  version?: string;
}

export interface DiagnoseErrorOutput {
  /** Matched error patterns with solutions */
  patterns: Array<{
    title: string;
    cause: string;
    solutions: string[];
    relatedDocs?: string[];
  }>;
  /** Relevant GitHub issues */
  githubIssues: Array<{
    title: string;
    url: string;
    state: string;
  }>;
  /** Relevant documentation */
  docs: string | null;
  /** Detected framework */
  framework: string | null;
  /** Notes */
  notes: string[];
}

export async function diagnoseError(input: DiagnoseErrorInput): Promise<DiagnoseErrorOutput> {
  const startTime = Date.now();
  logger.info('Diagnosing error', { errorLen: input.error.length, package: input.package });

  const queryParser = getQueryParser();
  const notes: string[] = [];

  // Resolve framework
  let framework = input.package || null;
  if (framework) {
    const packageName = queryParser.getPackageName(framework);
    if (packageName) framework = input.package!;
  }

  // 1. Match against curated error patterns
  const matchedPatterns = matchErrorPatterns(input.error, framework || undefined);

  // If no framework specified but patterns matched, infer framework
  if (!framework && matchedPatterns.length > 0) {
    framework = matchedPatterns[0].frameworks[0] || null;
    notes.push(`Inferred framework: ${framework}`);
  }

  // 2. Search GitHub Issues (in parallel with docs)
  const githubIssuesPromise = framework
    ? searchGitHubIssues(input.error, framework).catch(() => [])
    : Promise.resolve([]);

  // 3. Search documentation for troubleshooting
  const docFetcher = getDocFetcher();
  const docsPromise = framework
    ? docFetcher.searchDocs(framework, 'troubleshooting error').catch(() => [])
    : Promise.resolve([]);

  // 4. Check for missing export errors
  let missingExportCheck: string | null = null;
  const missingExportMatch = input.error.match(
    /(?:cannot find|is not exported|does not exist).*['"](\w+)['"]/i
  );
  if (missingExportMatch && framework) {
    const apiName = missingExportMatch[1];
    const packageName = queryParser.getPackageName(framework) || framework;
    try {
      const typeFetcher = getTypeFetcher();
      const typeParser = getTypeParser();
      const types = await typeFetcher.fetchTypes(packageName, input.version);
      if (types) {
        const searchResults = typeParser.searchApis(types.content, apiName);
        if (searchResults.length > 0) {
          const suggestions = searchResults.slice(0, 5).map((r) => r.name);
          missingExportCheck = `"${apiName}" not found. Did you mean: ${suggestions.join(', ')}?`;
          notes.push(missingExportCheck);
        }
      }
    } catch {
      // ignore type lookup failures
    }
  }

  const [githubIssues, docResults] = await Promise.all([githubIssuesPromise, docsPromise]);

  // Build docs prose
  let docs: string | null = null;
  if (docResults.length > 0) {
    docs = docResults
      .map((r) => r.prose)
      .filter(Boolean)
      .join('\n\n')
      .substring(0, 2000) || null;
  }

  const duration = Date.now() - startTime;
  logger.info('Error diagnosis completed', { patternsFound: matchedPatterns.length, issuesFound: githubIssues.length, duration });

  return {
    patterns: matchedPatterns.slice(0, 5).map((p) => ({
      title: p.title,
      cause: p.cause,
      solutions: p.solutions,
      relatedDocs: p.relatedDocs,
    })),
    githubIssues: githubIssues.slice(0, 5),
    docs,
    framework,
    notes,
  };
}

/**
 * Search GitHub Issues for similar errors
 */
async function searchGitHubIssues(
  error: string,
  framework: string
): Promise<Array<{ title: string; url: string; state: string }>> {
  // Extract a meaningful search query from the error
  const searchTerms = error
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5)
    .join(' ');

  if (!searchTerms) return [];

  const repoMap: Record<string, string> = {
    react: 'facebook/react',
    next: 'vercel/next.js',
    vue: 'vuejs/core',
    prisma: 'prisma/prisma',
    zod: 'colinhacks/zod',
    zustand: 'pmndrs/zustand',
    'tanstack-query': 'TanStack/query',
    express: 'expressjs/express',
    vitest: 'vitest-dev/vitest',
  };

  const repo = repoMap[framework];
  const query = repo
    ? `${searchTerms} repo:${repo} is:issue`
    : `${searchTerms} is:issue`;

  try {
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=5&sort=relevance`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'augments-mcp-server',
      },
      signal: AbortSignal.timeout(GITHUB_TIMEOUT),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as {
      items: Array<{ title: string; html_url: string; state: string }>;
    };

    return data.items.map((item) => ({
      title: item.title,
      url: item.html_url,
      state: item.state,
    }));
  } catch {
    return [];
  }
}

export function formatDiagnoseErrorResponse(output: DiagnoseErrorOutput): string {
  const lines: string[] = [];

  lines.push('# Error Diagnosis');
  if (output.framework) {
    lines.push(`Framework: ${output.framework}`);
  }
  lines.push('');

  if (output.patterns.length === 0 && output.githubIssues.length === 0 && !output.docs) {
    lines.push('No matching error patterns found.');
    lines.push('');
    lines.push('Suggestions:');
    lines.push('- Search the package\'s GitHub issues directly');
    lines.push('- Check the official documentation');
    lines.push('- Try specifying the package name for more targeted results');
    return lines.join('\n');
  }

  // Known patterns
  if (output.patterns.length > 0) {
    lines.push('## Known Error Patterns');
    lines.push('');
    for (const pattern of output.patterns) {
      lines.push(`### ${pattern.title}`);
      lines.push(`**Cause:** ${pattern.cause}`);
      lines.push('');
      lines.push('**Solutions:**');
      for (const solution of pattern.solutions) {
        lines.push(`- ${solution}`);
      }
      if (pattern.relatedDocs && pattern.relatedDocs.length > 0) {
        lines.push(`**Related docs:** ${pattern.relatedDocs.join(', ')}`);
      }
      lines.push('');
    }
  }

  // GitHub issues
  if (output.githubIssues.length > 0) {
    lines.push('## Related GitHub Issues');
    for (const issue of output.githubIssues) {
      lines.push(`- [${issue.state}] ${issue.title}`);
      lines.push(`  ${issue.url}`);
    }
    lines.push('');
  }

  // Documentation
  if (output.docs) {
    lines.push('## Related Documentation');
    lines.push(output.docs);
    lines.push('');
  }

  // Notes
  if (output.notes.length > 0) {
    lines.push('## Notes');
    for (const note of output.notes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join('\n');
}
