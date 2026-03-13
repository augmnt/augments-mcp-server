/**
 * Documentation Search Engine (BM25)
 *
 * BM25 inverted index search for documentation content.
 * Splits doc files into chunks by heading, builds an inverted index,
 * and ranks results using BM25 scoring with synonym expansion.
 *
 * Performance targets:
 * - Indexing 100 files: <100ms
 * - Search: <5ms
 * - Memory: ~2-5MB
 */

import { getLogger } from '@/utils/logger';

const logger = getLogger('doc-search');

// BM25 parameters
const BM25_K1 = 1.5;
const BM25_B = 0.75;
const API_NAME_BOOST = 3.0;
const HEADING_BOOST = 2.0;

/**
 * A chunk of documentation content
 */
export interface DocChunk {
  /** Unique chunk ID */
  id: string;
  /** Framework this chunk belongs to */
  framework: string;
  /** Section heading (h2/h3) */
  heading: string;
  /** Prose text content */
  prose: string;
  /** Code blocks within this chunk */
  codeBlocks: string[];
  /** API names mentioned in this chunk */
  apiNames: string[];
  /** Source file path */
  sourcePath: string;
  /** Source URL */
  sourceUrl: string;
}

/**
 * Search result from BM25 search
 */
export interface DocSearchResult {
  chunk: DocChunk;
  score: number;
}

/**
 * Posting list entry
 */
interface Posting {
  chunkId: string;
  termFrequency: number;
}

/**
 * BM25 Documentation Search Engine
 */
export class DocSearchEngine {
  private chunks: Map<string, DocChunk> = new Map();
  private invertedIndex: Map<string, Posting[]> = new Map();
  private documentLengths: Map<string, number> = new Map();
  private avgDocLength = 0;
  private totalDocuments = 0;

  // Cache stats
  indexedChunks = 0;
  searchCount = 0;

  /**
   * Index a set of documentation chunks
   */
  indexChunks(chunks: DocChunk[]): void {
    for (const chunk of chunks) {
      this.addChunk(chunk);
    }
    this.recalculateAvgLength();

    logger.debug('Indexed chunks', {
      count: chunks.length,
      totalChunks: this.totalDocuments,
      uniqueTerms: this.invertedIndex.size,
    });
  }

  /**
   * Add a single chunk to the index
   */
  private addChunk(chunk: DocChunk): void {
    // Skip if already indexed
    if (this.chunks.has(chunk.id)) return;

    this.chunks.set(chunk.id, chunk);
    this.totalDocuments++;
    this.indexedChunks++;

    // Tokenize heading and body separately for heading boost
    const headingTokens = this.tokenize(chunk.heading);
    const bodyTokens = this.tokenize(
      `${chunk.prose} ${chunk.apiNames.join(' ')}`
    );
    const allTokens = [...headingTokens, ...bodyTokens];

    // Store document length
    this.documentLengths.set(chunk.id, allTokens.length);

    // Build term frequencies with heading boost
    const termFreqs = new Map<string, number>();
    for (const token of headingTokens) {
      termFreqs.set(token, (termFreqs.get(token) || 0) + HEADING_BOOST);
    }
    for (const token of bodyTokens) {
      termFreqs.set(token, (termFreqs.get(token) || 0) + 1);
    }

    // Update inverted index
    for (const [term, freq] of termFreqs) {
      const postings = this.invertedIndex.get(term) || [];
      postings.push({ chunkId: chunk.id, termFrequency: freq });
      this.invertedIndex.set(term, postings);
    }
  }

  /**
   * Search the index using BM25 scoring
   */
  search(query: string, maxResults: number = 10, framework?: string): DocSearchResult[] {
    this.searchCount++;

    if (this.totalDocuments === 0) return [];

    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return [];

    // Also check for API name patterns in the query
    const apiPattern = query.match(/\b(use[A-Z][a-zA-Z]*|[a-z]+[A-Z][a-zA-Z]*)\b/g);
    const queryApiNames = apiPattern ? apiPattern.map((n) => n.toLowerCase()) : [];

    // Score each document
    const scores = new Map<string, number>();

    for (const token of queryTokens) {
      const postings = this.invertedIndex.get(token);
      if (!postings) continue;

      // IDF = log((N - n + 0.5) / (n + 0.5) + 1)
      const n = postings.length;
      const idf = Math.log(
        (this.totalDocuments - n + 0.5) / (n + 0.5) + 1
      );

      for (const posting of postings) {
        // Filter by framework if specified
        if (framework) {
          const chunk = this.chunks.get(posting.chunkId);
          if (chunk && chunk.framework !== framework) continue;
        }

        const dl = this.documentLengths.get(posting.chunkId) || 0;
        const tf = posting.termFrequency;

        // BM25 score component
        const tfNorm = (tf * (BM25_K1 + 1)) /
          (tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / this.avgDocLength)));

        const termScore = idf * tfNorm;
        scores.set(
          posting.chunkId,
          (scores.get(posting.chunkId) || 0) + termScore
        );
      }
    }

    // Apply API name boost
    if (queryApiNames.length > 0) {
      for (const [chunkId, score] of scores) {
        const chunk = this.chunks.get(chunkId);
        if (!chunk) continue;

        const chunkApiNamesLower = chunk.apiNames.map((n) => n.toLowerCase());
        for (const apiName of queryApiNames) {
          if (chunkApiNamesLower.includes(apiName)) {
            scores.set(chunkId, score * API_NAME_BOOST);
            break;
          }
        }
      }
    }

    // Heading match boost: chunks whose heading contains query terms rank higher
    for (const [chunkId, score] of scores) {
      const chunk = this.chunks.get(chunkId);
      if (!chunk || !chunk.heading) continue;
      const headingLower = chunk.heading.toLowerCase();
      const headingMatchCount = queryTokens.filter((t) => headingLower.includes(t)).length;
      if (headingMatchCount > 0) {
        const headingBoost = 1 + (headingMatchCount / queryTokens.length) * 0.5;
        scores.set(chunkId, score * headingBoost);
      }
    }

    // Sort by score and return top results
    const results: DocSearchResult[] = [];
    const sorted = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxResults);

    for (const [chunkId, score] of sorted) {
      const chunk = this.chunks.get(chunkId);
      if (chunk) {
        results.push({ chunk, score });
      }
    }

    return results;
  }

  /**
   * Tokenize text into searchable terms
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      // Split on non-alphanumeric
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2)
      // Also split camelCase
      .flatMap((t) => {
        const camelParts = t.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(' ');
        return camelParts.length > 1 ? [t, ...camelParts] : [t];
      });
  }

  /**
   * Recalculate average document length
   */
  private recalculateAvgLength(): void {
    if (this.totalDocuments === 0) {
      this.avgDocLength = 0;
      return;
    }
    let totalLength = 0;
    for (const length of this.documentLengths.values()) {
      totalLength += length;
    }
    this.avgDocLength = totalLength / this.totalDocuments;
  }

  /**
   * Parse markdown content into DocChunks
   */
  static parseIntoChunks(
    content: string,
    framework: string,
    sourcePath: string,
    sourceUrl: string
  ): DocChunk[] {
    const chunks: DocChunk[] = [];
    const sections = content.split(/^(#{2,3}\s+.+)$/m);

    let currentHeading = '';
    let chunkIndex = 0;

    // Handle content before first heading
    if (sections[0]?.trim()) {
      const chunk = DocSearchEngine.buildChunk(
        `${framework}:${sourcePath}:${chunkIndex}`,
        framework,
        '',
        sections[0].trim(),
        sourcePath,
        sourceUrl
      );
      if (chunk.prose.length > 20 || chunk.codeBlocks.length > 0) {
        chunks.push(chunk);
        chunkIndex++;
      }
    }

    for (let i = 1; i < sections.length; i += 2) {
      currentHeading = sections[i]?.replace(/^#+\s*/, '').trim() || '';
      const body = sections[i + 1]?.trim() || '';
      if (!body) continue;

      const chunk = DocSearchEngine.buildChunk(
        `${framework}:${sourcePath}:${chunkIndex}`,
        framework,
        currentHeading,
        body,
        sourcePath,
        sourceUrl
      );

      if (chunk.prose.length > 10 || chunk.codeBlocks.length > 0) {
        chunks.push(chunk);
        chunkIndex++;
      }
    }

    return chunks;
  }

  /**
   * Build a DocChunk from heading + body content
   */
  private static buildChunk(
    id: string,
    framework: string,
    heading: string,
    body: string,
    sourcePath: string,
    sourceUrl: string
  ): DocChunk {
    const codeBlocks: string[] = [];
    const proseLines: string[] = [];
    const apiNames: string[] = [];

    let inCodeBlock = false;
    let currentCode: string[] = [];

    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('```')) {
        if (inCodeBlock) {
          const code = currentCode.join('\n').trim();
          if (code.length >= 15) {
            codeBlocks.push(code);
            // Extract API names from code
            const hooks = code.match(/\buse[A-Z][a-zA-Z]*/g);
            if (hooks) apiNames.push(...hooks);
            const methods = code.match(/\.(findMany|findUnique|create|update|delete|upsert|select|where)\b/g);
            if (methods) apiNames.push(...methods.map((m) => m.slice(1)));
          }
          currentCode = [];
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        currentCode.push(line);
      } else if (trimmed && !trimmed.startsWith('|') && !trimmed.startsWith('![')) {
        proseLines.push(trimmed);
      }
    }

    // Extract API names from heading and prose
    const headingApis = heading.match(/\b(use[A-Z][a-zA-Z]*|[a-z]+[A-Z][a-zA-Z]*)\b/g);
    if (headingApis) apiNames.push(...headingApis);

    return {
      id,
      framework,
      heading,
      prose: proseLines.join(' '),
      codeBlocks,
      apiNames: [...new Set(apiNames)],
      sourcePath,
      sourceUrl,
    };
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.chunks.clear();
    this.invertedIndex.clear();
    this.documentLengths.clear();
    this.avgDocLength = 0;
    this.totalDocuments = 0;
    this.indexedChunks = 0;
    logger.debug('DocSearchEngine cleared');
  }

  /**
   * Get index statistics
   */
  getStats(): { chunks: number; terms: number; searches: number } {
    return {
      chunks: this.totalDocuments,
      terms: this.invertedIndex.size,
      searches: this.searchCount,
    };
  }
}

// Singleton
let instance: DocSearchEngine | null = null;

export function getDocSearchEngine(): DocSearchEngine {
  if (!instance) {
    instance = new DocSearchEngine();
  }
  return instance;
}
