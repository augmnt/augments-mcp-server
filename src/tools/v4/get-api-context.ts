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
    return {
      framework: '',
      packageName: '',
      version: '',
      api: null,
      relatedApis: [],
      examples: [],
      confidence: parsedQuery.confidence,
      query: parsedQuery,
      notes: [
        'Could not identify a framework from the query.',
        'Please specify a framework explicitly.',
        `Known frameworks: ${queryParser.getKnownFrameworks().slice(0, 10).join(', ')}...`,
      ],
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

  // Fetch type definitions
  const types = await typeFetcher.fetchTypes(packageName, resolvedVersion);

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

        // Try to find similar APIs
        const searchResults = typeParser.searchApis(
          types.content,
          parsedQuery.concept
        );
        if (searchResults.length > 0) {
          notes.push(`Similar APIs found: ${searchResults.slice(0, 5).map((r) => r.name).join(', ')}`);
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

  // Fetch code examples
  let examples: CodeExample[] = [];
  if (input.includeExamples !== false) {
    const maxExamples = input.maxExamples || 2;
    examples = await exampleExtractor.getExamplesForConcept(
      framework,
      parsedQuery.concept
    );
    examples = examples.slice(0, maxExamples);
    logger.debug('Fetched examples', { count: examples.length });
  }

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
 * Format the output for MCP response (minimal, LLM-friendly)
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
    lines.push('## API Signature');
    lines.push('```typescript');
    lines.push(output.api.signature);
    lines.push('```');
    lines.push('');

    // Parameters
    if (output.api.parameters && output.api.parameters.length > 0) {
      lines.push('### Parameters');
      for (const param of output.api.parameters) {
        const optional = param.optional ? '?' : '';
        lines.push(`- \`${param.name}${optional}\`: ${param.type}`);
      }
      lines.push('');
    }

    // Return type
    if (output.api.returnType) {
      lines.push(`### Returns`);
      lines.push(`\`${output.api.returnType}\``);
      lines.push('');
    }

    // Related types
    if (Object.keys(output.api.relatedTypes).length > 0) {
      lines.push('### Related Types');
      for (const [name, signature] of Object.entries(output.api.relatedTypes)) {
        lines.push(`**${name}**`);
        lines.push('```typescript');
        lines.push(signature);
        lines.push('```');
      }
      lines.push('');
    }

    // Overloads
    if (output.api.overloads && output.api.overloads.length > 1) {
      lines.push('### Overloads');
      for (const overload of output.api.overloads) {
        lines.push('```typescript');
        lines.push(overload);
        lines.push('```');
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

  // Examples
  if (output.examples.length > 0) {
    lines.push('## Code Examples');
    for (const example of output.examples) {
      if (example.context) {
        lines.push(`### ${example.context}`);
      }
      lines.push(`\`\`\`${example.language}`);
      lines.push(example.code);
      lines.push('```');
      lines.push(`*Source: ${example.source}*`);
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
