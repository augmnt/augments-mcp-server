/**
 * get_api_context Tool
 *
 * The primary v4 tool for query-focused context extraction.
 * Returns minimal, accurate API context to LLMs.
 */

import { getLogger } from '@/utils/logger';
import {
  getQueryParser,
  getTypeFetcher,
  getTypeParser,
  getVersionRegistry,
  getExampleExtractor,
  type ApiSignature,
  type CodeExample,
  type ParsedQuery,
} from '@/core';

const logger = getLogger('get-api-context');

/**
 * Input parameters for get_api_context tool
 */
export interface GetApiContextInput {
  /** Natural language query (e.g., "useEffect cleanup" or "prisma findMany") */
  query: string;
  /** Optional: Specific framework to search in (e.g., "react", "prisma") */
  framework?: string;
  /** Optional: Specific version (e.g., "19.0.0" or "latest") */
  version?: string;
  /** Optional: Include code examples (default: true) */
  includeExamples?: boolean;
  /** Optional: Maximum number of examples (default: 2) */
  maxExamples?: number;
}

/**
 * Output of get_api_context tool
 */
export interface GetApiContextOutput {
  /** Identified framework */
  framework: string;
  /** Package name used for type lookup */
  packageName: string;
  /** Resolved version */
  version: string;
  /** Primary API signature */
  api: ApiSignature | null;
  /** Related APIs found */
  relatedApis: string[];
  /** Code examples */
  examples: CodeExample[];
  /** Parsing confidence (0-1) */
  confidence: number;
  /** Original parsed query */
  query: ParsedQuery;
  /** Any warnings or notes */
  notes: string[];
}

/**
 * Get API context for a natural language query
 */
export async function getApiContext(
  input: GetApiContextInput
): Promise<GetApiContextOutput> {
  const startTime = Date.now();
  logger.info('Processing query', { query: input.query, framework: input.framework });

  // Initialize modules
  const queryParser = getQueryParser();
  const typeFetcher = getTypeFetcher();
  const typeParser = getTypeParser();
  const versionRegistry = getVersionRegistry();
  const exampleExtractor = getExampleExtractor();

  // Parse the query
  const parsedQuery = queryParser.parse(input.query);

  // Override framework if explicitly provided
  const framework = input.framework || parsedQuery.framework;
  const packageName =
    input.framework
      ? queryParser.getPackageName(input.framework) || input.framework
      : parsedQuery.packageName;

  if (!framework || !packageName) {
    logger.debug('Could not identify framework', { query: input.query });
    // Suggest alternatives using query parser
    const alternatives = queryParser.suggestAlternatives(input.query);
    const suggestions = alternatives
      .filter((alt) => alt.framework)
      .slice(0, 4)
      .map((alt) => alt.framework!);

    const notes: string[] = [
      'Could not identify a framework from the query.',
      'Please specify a framework explicitly.',
    ];
    if (suggestions.length > 0) {
      notes.push(`Did you mean: ${suggestions.join(', ')}?`);
    } else {
      notes.push(`Known frameworks: ${queryParser.getKnownFrameworks().slice(0, 10).join(', ')}...`);
    }

    return {
      framework: '',
      packageName: '',
      version: '',
      api: null,
      relatedApis: [],
      examples: [],
      confidence: parsedQuery.confidence,
      query: parsedQuery,
      notes,
    };
  }

  // Resolve version
  const requestedVersion = input.version || parsedQuery.version;
  const resolvedVersion = await versionRegistry.resolveVersion(
    packageName,
    requestedVersion || undefined
  );

  if (!resolvedVersion) {
    logger.debug('Could not resolve version', { packageName, requestedVersion });
    return {
      framework,
      packageName,
      version: '',
      api: null,
      relatedApis: [],
      examples: [],
      confidence: parsedQuery.confidence,
      query: parsedQuery,
      notes: [
        `Could not resolve version for ${packageName}.`,
        'The package may not exist on npm.',
      ],
    };
  }

  logger.debug('Resolved version', { packageName, resolvedVersion });

  // Fetch type definitions and examples in parallel (both are I/O-bound)
  // Examples have a soft 3s timeout — type signatures (primary value) are never delayed
  const EXAMPLE_SOFT_TIMEOUT = 3000;
  const typesPromise = typeFetcher.fetchTypes(packageName, resolvedVersion);
  const rawExamplesPromise = input.includeExamples !== false
    ? exampleExtractor.getExamplesForConcept(framework, parsedQuery.concept)
    : Promise.resolve([]);
  const examplesPromise = Promise.race([
    rawExamplesPromise,
    new Promise<CodeExample[]>((resolve) => setTimeout(() => resolve([]), EXAMPLE_SOFT_TIMEOUT)),
  ]);

  const [types, rawExamples] = await Promise.all([typesPromise, examplesPromise]);

  let api: ApiSignature | null = null;
  const relatedApis: string[] = [];
  const notes: string[] = [];

  if (types) {
    logger.debug('Fetched type definitions', {
      packageName,
      version: types.version,
      source: types.source,
      contentLength: types.content.length,
    });

    // Extract API signature for the concept
    api = typeParser.extractApiSignature(
      types.content,
      parsedQuery.concept,
      types.filePath
    );

    if (api) {
      logger.debug('Extracted API signature', { name: api.name });

      // Find related APIs
      const searchResults = typeParser.searchApis(
        types.content,
        parsedQuery.concept
      );
      relatedApis.push(
        ...searchResults
          .filter((r) => r.name !== api!.name)
          .slice(0, 5)
          .map((r) => r.name)
      );
    } else {
      // Try barrel export sub-modules for packages with re-exports
      const barrelPaths = typeFetcher.getBarrelExportPaths(packageName, parsedQuery.concept);
      if (barrelPaths.length > 0) {
        logger.debug('Trying barrel export paths', { packageName, paths: barrelPaths });
        for (const path of barrelPaths) {
          const subModuleTypes = await typeFetcher.fetchSpecificTypeFile(
            packageName,
            resolvedVersion,
            path
          );
          if (subModuleTypes) {
            api = typeParser.extractApiSignature(
              subModuleTypes.content,
              parsedQuery.concept,
              subModuleTypes.filePath
            );
            if (api) {
              logger.debug('Found API in barrel export sub-module', { path, name: api.name });
              break;
            }
          }
        }
      }

      if (!api) {
        notes.push(
          `No API named "${parsedQuery.concept}" found in ${packageName}@${resolvedVersion}`
        );

        // Try to find similar APIs with richer info
        const searchResults = typeParser.searchApis(
          types.content,
          parsedQuery.concept
        );
        if (searchResults.length > 0) {
          const similarDescriptions = searchResults.slice(0, 5).map((r) => {
            const desc = r.description ? ` — ${r.description.substring(0, 80)}` : '';
            return `${r.name} (${r.kind})${desc}`;
          });
          notes.push(`Similar APIs:\n${similarDescriptions.map((d) => `  - ${d}`).join('\n')}`);
          relatedApis.push(...searchResults.slice(0, 5).map((r) => r.name));
        }
      }
    }
  } else {
    notes.push(`No type definitions found for ${packageName}@${resolvedVersion}`);

    // Try @types package
    const typesPackage = `@types/${packageName.replace('@', '').replace('/', '__')}`;
    const dtTypes = await typeFetcher.fetchTypes(typesPackage, undefined);
    if (dtTypes) {
      notes.push(`Found types via DefinitelyTyped: ${typesPackage}@${dtTypes.version}`);
      api = typeParser.extractApiSignature(
        dtTypes.content,
        parsedQuery.concept,
        dtTypes.filePath
      );
    }
  }

  // Use pre-fetched examples
  const maxExamples = input.maxExamples || 2;
  let examples: CodeExample[] = rawExamples.slice(0, maxExamples);
  logger.debug('Fetched examples', { count: examples.length });

  const duration = Date.now() - startTime;
  logger.info('Query processed', {
    query: input.query,
    framework,
    version: resolvedVersion,
    hasApi: !!api,
    exampleCount: examples.length,
    duration,
  });

  return {
    framework,
    packageName,
    version: resolvedVersion,
    api,
    relatedApis,
    examples,
    confidence: parsedQuery.confidence,
    query: parsedQuery,
    notes,
  };
}

/**
 * Maximum response size in characters to keep output LLM-friendly
 */
const MAX_RESPONSE_SIZE = 10000;

/**
 * Format the output for MCP response (minimal, LLM-friendly)
 * Progressively truncates when exceeding MAX_RESPONSE_SIZE
 */
export function formatApiContextResponse(output: GetApiContextOutput): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${output.framework} API Context`);
  if (output.version) {
    lines.push(`Version: ${output.version}`);
  }
  lines.push('');

  // API signature
  if (output.api) {
    // Deprecation warning
    if (output.api.deprecated) {
      lines.push(`**DEPRECATED**${output.api.deprecatedMessage ? `: ${output.api.deprecatedMessage}` : ''}`);
      lines.push('');
    }

    lines.push('## API Signature');
    lines.push('```typescript');
    lines.push(output.api.signature);
    lines.push('```');
    if (output.api.description) {
      lines.push(output.api.description);
    }
    lines.push('');

    // Parameters with descriptions
    if (output.api.parameters && output.api.parameters.length > 0) {
      lines.push('### Parameters');
      for (const param of output.api.parameters) {
        const optional = param.optional ? '?' : '';
        const desc = param.description ? ` — ${param.description}` : '';
        lines.push(`- \`${param.name}${optional}\`: ${param.type}${desc}`);
      }
      lines.push('');
    }

    // Return type
    if (output.api.returnType) {
      lines.push(`### Returns`);
      lines.push(`\`${output.api.returnType}\``);
      lines.push('');
    }

    // JSDoc examples (from type definitions)
    if (output.api.examples && output.api.examples.length > 0) {
      lines.push('### JSDoc Examples');
      for (const example of output.api.examples) {
        // Detect language from content
        const hasTypeScriptSignals = /\b(import|const|let|function|interface|type)\b/.test(example);
        const lang = hasTypeScriptSignals ? 'typescript' : '';
        lines.push(`\`\`\`${lang}`);
        lines.push(example);
        lines.push('```');
      }
      lines.push('');
    }

    // Related types (limit based on size budget)
    const relatedTypeEntries = Object.entries(output.api.relatedTypes);
    if (relatedTypeEntries.length > 0) {
      const currentSize = lines.join('\n').length;
      const maxRelatedTypes = currentSize > MAX_RESPONSE_SIZE * 0.5 ? 5 : relatedTypeEntries.length;

      lines.push('### Related Types');
      for (const [name, signature] of relatedTypeEntries.slice(0, maxRelatedTypes)) {
        // Truncate long signatures
        const truncatedSig = signature.length > 300
          ? signature.substring(0, 297) + '...'
          : signature;
        lines.push(`**${name}**`);
        lines.push('```typescript');
        lines.push(truncatedSig);
        lines.push('```');
      }
      if (relatedTypeEntries.length > maxRelatedTypes) {
        lines.push(`*...and ${relatedTypeEntries.length - maxRelatedTypes} more related types*`);
      }
      lines.push('');
    }

    // Overloads (limit to 2 if response is getting large)
    if (output.api.overloads && output.api.overloads.length > 1) {
      const currentSize = lines.join('\n').length;
      const maxOverloads = currentSize > MAX_RESPONSE_SIZE * 0.6 ? 3 : output.api.overloads.length;

      lines.push('### Overloads');
      for (const overload of output.api.overloads.slice(0, maxOverloads)) {
        lines.push('```typescript');
        lines.push(overload);
        lines.push('```');
      }
      if (output.api.overloads.length > maxOverloads) {
        lines.push(`*...and ${output.api.overloads.length - maxOverloads} more overloads*`);
      }
      lines.push('');
    }
  }

  // Related APIs
  if (output.relatedApis.length > 0) {
    lines.push('## Related APIs');
    lines.push(output.relatedApis.map((a) => `- ${a}`).join('\n'));
    lines.push('');
  }

  // Examples (reduce count if response is getting large)
  if (output.examples.length > 0) {
    const currentSize = lines.join('\n').length;
    const maxExamples = currentSize > MAX_RESPONSE_SIZE * 0.8 ? Math.min(2, output.examples.length) : output.examples.length;

    lines.push('## Code Examples');
    for (const example of output.examples.slice(0, maxExamples)) {
      if (example.context) {
        lines.push(`### ${example.context}`);
      }
      lines.push(`\`\`\`${example.language}`);
      lines.push(example.code);
      lines.push('```');
      lines.push(`*Source: ${example.source}*`);
      lines.push('');
    }
    if (output.examples.length > maxExamples) {
      lines.push(`*${output.examples.length - maxExamples} more examples available*`);
      lines.push('');
    }
  }

  // Notes
  if (output.notes.length > 0) {
    lines.push('## Notes');
    for (const note of output.notes) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
