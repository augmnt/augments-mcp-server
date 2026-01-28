/**
 * search_apis Tool
 *
 * Discovery tool for searching APIs across frameworks.
 */

import { getLogger } from '@/utils/logger';
import {
  getQueryParser,
  getTypeFetcher,
  getTypeParser,
  type TypeDefinition,
} from '@/core';

const logger = getLogger('search-apis');

/**
 * Input parameters for search_apis tool
 */
export interface SearchApisInput {
  /** Search query (e.g., "state management hook") */
  query: string;
  /** Optional: Limit search to specific frameworks */
  frameworks?: string[];
  /** Optional: Maximum results per framework (default: 5) */
  limit?: number;
}

/**
 * A single API search result
 */
export interface ApiSearchResult {
  /** Framework name */
  framework: string;
  /** API name */
  name: string;
  /** API kind (function, interface, type, class, etc.) */
  kind: string;
  /** Full signature */
  signature: string;
  /** Description if available */
  description?: string;
  /** Relevance score (0-1) */
  relevance: number;
}

/**
 * Output of search_apis tool
 */
export interface SearchApisOutput {
  /** Search results */
  results: ApiSearchResult[];
  /** Total results found */
  totalFound: number;
  /** Frameworks searched */
  frameworksSearched: string[];
  /** Original query */
  query: string;
}

/**
 * Default frameworks to search when none specified
 */
const DEFAULT_SEARCH_FRAMEWORKS = [
  'react',
  'react-dom',
  'next',
  'vue',
  '@tanstack/react-query',
  'zod',
  '@prisma/client',
  'express',
];

/**
 * Search for APIs across frameworks
 */
export async function searchApis(
  input: SearchApisInput
): Promise<SearchApisOutput> {
  const startTime = Date.now();
  logger.info('Searching APIs', { query: input.query, frameworks: input.frameworks });

  const queryParser = getQueryParser();
  const typeFetcher = getTypeFetcher();
  const typeParser = getTypeParser();

  // Determine which frameworks to search
  const frameworks = input.frameworks?.length
    ? input.frameworks
    : DEFAULT_SEARCH_FRAMEWORKS;

  const limit = input.limit || 5;
  const allResults: ApiSearchResult[] = [];
  const frameworksSearched: string[] = [];

  // Search each framework
  for (const framework of frameworks) {
    const packageName = queryParser.getPackageName(framework) || framework;

    try {
      // Fetch types for the framework
      const types = await typeFetcher.fetchTypes(packageName);
      if (!types) {
        logger.debug('No types found for framework', { framework, packageName });
        continue;
      }

      frameworksSearched.push(framework);

      // Search the types
      const searchResults = typeParser.searchApis(types.content, input.query);

      // Convert to API search results
      for (const result of searchResults.slice(0, limit)) {
        const relevance = calculateRelevance(result, input.query);
        allResults.push({
          framework,
          name: result.name,
          kind: result.kind,
          signature: truncateSignature(result.signature, 200),
          description: result.description,
          relevance,
        });
      }
    } catch (error) {
      logger.error('Error searching framework', {
        framework,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Sort by relevance
  allResults.sort((a, b) => b.relevance - a.relevance);

  const duration = Date.now() - startTime;
  logger.info('Search completed', {
    query: input.query,
    totalFound: allResults.length,
    frameworksSearched: frameworksSearched.length,
    duration,
  });

  return {
    results: allResults,
    totalFound: allResults.length,
    frameworksSearched,
    query: input.query,
  };
}

/**
 * Calculate relevance score for a search result
 */
function calculateRelevance(result: TypeDefinition, query: string): number {
  const queryLower = query.toLowerCase();
  const nameLower = result.name.toLowerCase();

  let score = 0;

  // Exact match
  if (nameLower === queryLower) {
    score += 1.0;
  }
  // Starts with query
  else if (nameLower.startsWith(queryLower)) {
    score += 0.8;
  }
  // Contains query
  else if (nameLower.includes(queryLower)) {
    score += 0.6;
  }
  // Query words found in name
  else {
    const queryWords = queryLower.split(/\s+/);
    const matchedWords = queryWords.filter((w) => nameLower.includes(w));
    score += (matchedWords.length / queryWords.length) * 0.4;
  }

  // Boost for functions (usually more useful)
  if (result.kind === 'function') {
    score *= 1.1;
  }

  // Boost for having description
  if (result.description) {
    score *= 1.05;
  }

  return Math.min(score, 1.0);
}

/**
 * Truncate a signature for display
 */
function truncateSignature(signature: string, maxLength: number): string {
  if (signature.length <= maxLength) {
    return signature;
  }

  // Try to cut at a reasonable boundary
  const cutPoint = signature.lastIndexOf(' ', maxLength - 3);
  if (cutPoint > maxLength / 2) {
    return signature.substring(0, cutPoint) + '...';
  }

  return signature.substring(0, maxLength - 3) + '...';
}

/**
 * Format the output for MCP response
 */
export function formatSearchApisResponse(output: SearchApisOutput): string {
  const lines: string[] = [];

  lines.push(`# API Search Results`);
  lines.push(`Query: "${output.query}"`);
  lines.push(`Found: ${output.totalFound} results in ${output.frameworksSearched.length} frameworks`);
  lines.push('');

  if (output.results.length === 0) {
    lines.push('No APIs found matching your query.');
    lines.push('');
    lines.push('Try:');
    lines.push('- Using different keywords');
    lines.push('- Specifying a framework');
    lines.push('- Checking the spelling');
    return lines.join('\n');
  }

  // Group by framework
  const byFramework = new Map<string, ApiSearchResult[]>();
  for (const result of output.results) {
    const existing = byFramework.get(result.framework) || [];
    existing.push(result);
    byFramework.set(result.framework, existing);
  }

  for (const [framework, results] of byFramework) {
    lines.push(`## ${framework}`);
    lines.push('');

    for (const result of results) {
      lines.push(`### ${result.name} (${result.kind})`);
      if (result.description) {
        lines.push(result.description);
      }
      lines.push('```typescript');
      lines.push(result.signature);
      lines.push('```');
      lines.push(`Relevance: ${Math.round(result.relevance * 100)}%`);
      lines.push('');
    }
  }

  return lines.join('\n');
}
