/**
 * get_api_context Tool
 *
 * The primary v5 tool for query-focused context extraction.
 * Returns types + prose + examples with context-aware formatting to LLMs.
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
 * Query intent type — determines response format
 */
export type QueryIntent = 'howto' | 'reference' | 'migration' | 'balanced';

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
  /** Prose documentation extracted from README/docs */
  prose: string | null;
  /** Detected query intent */
  intent: QueryIntent;
  /** Parsing confidence (0-1) */
  confidence: number;
  /** Original parsed query */
  query: ParsedQuery;
  /** Any warnings or notes */
  notes: string[];
}

/**
 * Detect query intent from natural language
 */
function detectIntent(query: string): QueryIntent {
  const q = query.toLowerCase();
  if (/\b(how\s+to|how\s+do\s+i|example\s+of|tutorial|guide|usage|getting\s+started)\b/.test(q)) {
    return 'howto';
  }
  if (/\b(signature|types?|parameters?|return\s+type|overloads?|interface|typedef)\b/.test(q)) {
    return 'reference';
  }
  if (/\b(migrat|upgrade|breaking\s+changes?|v\d+\s+to\s+v\d+|deprecat)\b/.test(q)) {
    return 'migration';
  }
  return 'balanced';
}

/**
 * Extract code blocks from README that mention a concept
 */
function extractReadmeExamples(readmeContent: string, concept: string): CodeExample[] {
  const examples: CodeExample[] = [];
  const codeBlockRegex = /```(\w+)?\s*\n([\s\S]*?)```/g;
  const conceptLower = concept.toLowerCase();

  let match;
  while ((match = codeBlockRegex.exec(readmeContent)) !== null) {
    const language = match[1] || 'javascript';
    const code = match[2].trim();

    // Skip very short, config, or install blocks
    if (code.length < 20) continue;
    if (/\b(npm|yarn|pnpm|bun)\s+(install|add|i)\b/.test(code)) continue;
    if (/^(bash|shell|sh)$/i.test(language)) continue;

    // Check if concept is mentioned in the code or nearby text
    const beforeBlock = readmeContent.substring(Math.max(0, match.index - 300), match.index);
    if (
      code.toLowerCase().includes(conceptLower) ||
      beforeBlock.toLowerCase().includes(conceptLower)
    ) {
      // Extract context heading
      const headingMatch = beforeBlock.match(/#+\s+([^\n]+)\s*$/);
      examples.push({
        code,
        language: language.toLowerCase(),
        source: 'README.md',
        concepts: [conceptLower],
        context: headingMatch ? headingMatch[1].trim() : undefined,
      });
    }
  }

  return examples.slice(0, 3); // Limit to 3 README examples
}

/**
 * Extract prose documentation from README/doc content for a concept.
 * Finds the most relevant section and returns its prose paragraphs.
 */
function extractProseForConcept(content: string, concept: string, maxChars: number = 2000): string | null {
  const sections = splitIntoSections(content);
  if (sections.length === 0) return null;

  // Score each section by concept relevance
  const scored = sections
    .map((section) => ({
      section,
      score: scoreSectionRelevance(section, concept),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  // Extract prose paragraphs from the top-scoring section
  const prose = extractProseParagraphs(scored[0].section.body);
  if (!prose || prose.length < 20) return null;

  return prose.length > maxChars ? prose.substring(0, maxChars - 3) + '...' : prose;
}

interface Section {
  heading: string;
  body: string;
}

function splitIntoSections(content: string): Section[] {
  const sections: Section[] = [];
  const parts = content.split(/^(#{1,3}\s+.+)$/m);

  // Handle content before first heading
  if (parts[0]?.trim()) {
    sections.push({ heading: '', body: parts[0].trim() });
  }

  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i]?.replace(/^#+\s*/, '').trim() || '';
    const body = parts[i + 1]?.trim() || '';
    if (body) {
      sections.push({ heading, body });
    }
  }

  return sections;
}

function scoreSectionRelevance(section: Section, concept: string): number {
  let score = 0;
  const conceptLower = concept.toLowerCase();
  const headingLower = section.heading.toLowerCase();
  const bodyLower = section.body.toLowerCase();

  // Heading contains concept
  if (headingLower.includes(conceptLower)) score += 50;
  // Heading is exactly the concept
  if (headingLower === conceptLower) score += 30;

  // Count keyword density in body (occurrences per 1000 chars)
  const escapedConcept = conceptLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const conceptCount = (bodyLower.match(new RegExp(escapedConcept, 'g')) || []).length;
  score += Math.min(conceptCount * 5, 25);

  // Bonus for sections with prose (not just code)
  const proseLines = section.body.split('\n').filter((line) => !isNonProseLine(line));
  if (proseLines.length > 2) score += 10;

  return score;
}

function extractProseParagraphs(body: string): string {
  const lines = body.split('\n');
  const proseLines: string[] = [];

  let inCodeBlock = false;
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    if (isNonProseLine(line)) continue;
    if (line.trim()) {
      proseLines.push(line.trim());
    }
  }

  return proseLines.join('\n');
}

function isNonProseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('```')) return true;
  if (trimmed.startsWith('|') && trimmed.endsWith('|')) return true; // table
  if (trimmed.startsWith('![')) return true; // image
  if (/^[-*]\s*$/.test(trimmed)) return true; // empty list item
  if (/^#{1,6}\s/.test(trimmed)) return true; // heading (handled separately)
  return false;
}

/**
 * Synthesize a one-line plain-English summary from an API signature
 */
function synthesizeUsageSummary(api: ApiSignature): string {
  const parts: string[] = [];
  parts.push(`\`${api.name}\``);
  if (api.parameters && api.parameters.length > 0) {
    const paramNames = api.parameters.map((p) => p.name).join(', ');
    parts.push(`takes ${paramNames}`);
  }
  if (api.returnType) {
    parts.push(`and returns \`${api.returnType}\``);
  }
  return parts.join(' ') + '.';
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

  // Detect query intent
  const intent = detectIntent(input.query);

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
      prose: null,
      intent,
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
      prose: null,
      intent,
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

  // README fallback: if no examples and no curated doc source, try package README
  let readmeContent: string | null = null;
  if (examples.length === 0 && !exampleExtractor.getDocSource(framework)) {
    logger.debug('No examples and no doc source — trying README fallback', { packageName });
    readmeContent = await Promise.race([
      typeFetcher.fetchReadme(packageName, resolvedVersion),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), EXAMPLE_SOFT_TIMEOUT)),
    ]);

    if (readmeContent) {
      const readmeExamples = extractReadmeExamples(readmeContent, parsedQuery.concept);
      examples = readmeExamples.slice(0, maxExamples);
      logger.debug('README fallback examples', { count: examples.length });
    }
  }

  // Extract prose documentation from README or doc content
  let prose: string | null = null;
  if (readmeContent) {
    prose = extractProseForConcept(readmeContent, parsedQuery.concept);
  }
  // If no README was fetched but we have a doc source, we could still try README for prose
  if (!prose && !readmeContent) {
    const readmeForProse = await Promise.race([
      typeFetcher.fetchReadme(packageName, resolvedVersion),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), EXAMPLE_SOFT_TIMEOUT)),
    ]);
    if (readmeForProse) {
      prose = extractProseForConcept(readmeForProse, parsedQuery.concept);
    }
  }

  logger.debug('Fetched examples', { count: examples.length, hasProse: !!prose });

  const duration = Date.now() - startTime;
  logger.info('Query processed', {
    query: input.query,
    framework,
    version: resolvedVersion,
    hasApi: !!api,
    exampleCount: examples.length,
    hasProse: !!prose,
    intent,
    duration,
  });

  return {
    framework,
    packageName,
    version: resolvedVersion,
    api,
    relatedApis,
    examples,
    prose,
    intent,
    confidence: parsedQuery.confidence,
    query: parsedQuery,
    notes,
  };
}

/**
 * Maximum response size in characters to keep output LLM-friendly
 */
const MAX_RESPONSE_SIZE = 10000;

// ==================== Composable Render Helpers ====================

function renderSignature(api: ApiSignature, brief: boolean = false): string[] {
  const lines: string[] = [];

  // Deprecation warning
  if (api.deprecated) {
    lines.push(`**DEPRECATED**${api.deprecatedMessage ? `: ${api.deprecatedMessage}` : ''}`);
    lines.push('');
  }

  lines.push('## API Signature');
  lines.push('```typescript');
  lines.push(api.signature);
  lines.push('```');
  if (api.description) {
    lines.push(api.description);
  }
  lines.push('');

  if (brief) return lines;

  // Parameters with descriptions
  if (api.parameters && api.parameters.length > 0) {
    lines.push('### Parameters');
    for (const param of api.parameters) {
      const optional = param.optional ? '?' : '';
      const desc = param.description ? ` — ${param.description}` : '';
      lines.push(`- \`${param.name}${optional}\`: ${param.type}${desc}`);
    }
    lines.push('');
  }

  // Return type
  if (api.returnType) {
    lines.push('### Returns');
    lines.push(`\`${api.returnType}\``);
    lines.push('');
  }

  // JSDoc examples (from type definitions)
  if (api.examples && api.examples.length > 0) {
    lines.push('### JSDoc Examples');
    for (const example of api.examples) {
      const hasTypeScriptSignals = /\b(import|const|let|function|interface|type)\b/.test(example);
      const lang = hasTypeScriptSignals ? 'typescript' : '';
      lines.push(`\`\`\`${lang}`);
      lines.push(example);
      lines.push('```');
    }
    lines.push('');
  }

  return lines;
}

function renderProse(prose: string): string[] {
  return ['## Description', prose, ''];
}

function renderExamples(examples: CodeExample[], maxCount?: number): string[] {
  if (examples.length === 0) return [];
  const lines: string[] = [];
  const limit = maxCount ?? examples.length;

  lines.push('## Code Examples');
  for (const example of examples.slice(0, limit)) {
    if (example.context) {
      lines.push(`### ${example.context}`);
    }
    lines.push(`\`\`\`${example.language}`);
    lines.push(example.code);
    lines.push('```');
    lines.push(`*Source: ${example.source}*`);
    lines.push('');
  }
  if (examples.length > limit) {
    lines.push(`*${examples.length - limit} more examples available*`);
    lines.push('');
  }
  return lines;
}

function renderRelatedTypes(api: ApiSignature, currentSize: number): string[] {
  const relatedTypeEntries = Object.entries(api.relatedTypes);
  if (relatedTypeEntries.length === 0) return [];

  const lines: string[] = [];
  const maxRelatedTypes = currentSize > MAX_RESPONSE_SIZE * 0.5 ? 5 : relatedTypeEntries.length;

  lines.push('### Related Types');
  for (const [name, signature] of relatedTypeEntries.slice(0, maxRelatedTypes)) {
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
  return lines;
}

function renderOverloads(api: ApiSignature, currentSize: number): string[] {
  if (!api.overloads || api.overloads.length <= 1) return [];

  const lines: string[] = [];
  const maxOverloads = currentSize > MAX_RESPONSE_SIZE * 0.6 ? 3 : api.overloads.length;

  lines.push('### Overloads');
  for (const overload of api.overloads.slice(0, maxOverloads)) {
    lines.push('```typescript');
    lines.push(overload);
    lines.push('```');
  }
  if (api.overloads.length > maxOverloads) {
    lines.push(`*...and ${api.overloads.length - maxOverloads} more overloads*`);
  }
  lines.push('');
  return lines;
}

function renderRelatedApis(relatedApis: string[]): string[] {
  if (relatedApis.length === 0) return [];
  return ['## Related APIs', relatedApis.map((a) => `- ${a}`).join('\n'), ''];
}

function renderNotes(notes: string[]): string[] {
  if (notes.length === 0) return [];
  return ['## Notes', ...notes.map((n) => `- ${n}`), ''];
}

// ==================== Intent-Driven Formatter ====================

/**
 * Format the output for MCP response (minimal, LLM-friendly)
 * Uses intent-driven assembly for context-aware formatting.
 */
export function formatApiContextResponse(output: GetApiContextOutput): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${output.framework} API Context`);
  if (output.version) {
    lines.push(`Version: ${output.version}`);
  }
  lines.push('');

  // Usage summary for howto intent
  if (output.intent === 'howto' && output.api) {
    lines.push(synthesizeUsageSummary(output.api));
    lines.push('');
  }

  // Intent-driven content assembly
  switch (output.intent) {
    case 'howto':
      // Examples first, then prose, then signature (brief), skip related types
      lines.push(...renderExamples(output.examples));
      if (output.prose) lines.push(...renderProse(output.prose));
      if (output.api) lines.push(...renderSignature(output.api, true));
      break;

    case 'reference':
      // Signature first (full), then related types, then examples (1 max)
      if (output.api) {
        lines.push(...renderSignature(output.api, false));
        lines.push(...renderRelatedTypes(output.api, lines.join('\n').length));
        lines.push(...renderOverloads(output.api, lines.join('\n').length));
      }
      if (output.prose) lines.push(...renderProse(output.prose));
      lines.push(...renderExamples(output.examples, 1));
      break;

    case 'migration':
      // Prose first (focus on changes), then signature diffs
      if (output.prose) lines.push(...renderProse(output.prose));
      if (output.api) lines.push(...renderSignature(output.api, false));
      lines.push(...renderExamples(output.examples));
      break;

    case 'balanced':
    default:
      // Default order: signature, prose, examples, related types
      if (output.api) {
        lines.push(...renderSignature(output.api, false));
        lines.push(...renderRelatedTypes(output.api, lines.join('\n').length));
        lines.push(...renderOverloads(output.api, lines.join('\n').length));
      }
      if (output.prose) lines.push(...renderProse(output.prose));
      lines.push(...renderExamples(output.examples));
      break;
  }

  // Always include related APIs and notes
  lines.push(...renderRelatedApis(output.relatedApis));
  lines.push(...renderNotes(output.notes));

  return lines.join('\n');
}
