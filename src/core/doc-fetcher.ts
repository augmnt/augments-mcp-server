/**
 * Documentation Fetcher
 *
 * Fetches actual documentation content from GitHub repositories.
 * Uses GitHub Contents API to list and fetch .md/.mdx files from doc directories.
 * Replaces fragile path-guessing with directory-level indexing.
 *
 * Features:
 * - Directory listing via GitHub Contents API (single API call per dir)
 * - In-memory file-name-to-path index per framework
 * - Normalized query-to-filename matching
 * - Content caching (1hr TTL for both listings and file content)
 * - Reuses DOC_SOURCES config from example-extractor for repo resolution
 */

import { getLogger } from '@/utils/logger';
import { getExampleExtractor, type DocSourceConfig } from './example-extractor';
import { expandWithSynonyms } from './type-parser';

const logger = getLogger('doc-fetcher');

const GITHUB_API_TIMEOUT = 8_000;
const GITHUB_RAW_TIMEOUT = 8_000;
const CACHE_TTL = 3600 * 1000; // 1 hour

/** Rate limit tracking for GitHub API */
let githubRateLimitRemaining = 60;
let githubRateLimitReset = 0;

/**
 * A doc file entry from the GitHub Contents API
 */
interface DocFileEntry {
  name: string;
  path: string;
  size: number;
  type: 'file' | 'dir';
}

/**
 * Cached directory listing
 */
interface CachedDirListing {
  files: DocFileEntry[];
  fetchedAt: number;
}

/**
 * Cached file content
 */
interface CachedFileContent {
  content: string;
  path: string;
  fetchedAt: number;
}

/**
 * Doc search result from fetcher
 */
export interface DocSearchResult {
  /** Prose content from the doc file */
  prose: string;
  /** Code blocks extracted from the doc */
  codeBlocks: { code: string; language: string; context?: string }[];
  /** Source URL */
  source: string;
  /** File path within repo */
  filePath: string;
  /** Relevance score */
  score: number;
}

/**
 * Documentation fetcher that retrieves actual doc content from GitHub
 */
export class DocFetcher {
  private dirCache: Map<string, CachedDirListing> = new Map();
  private fileCache: Map<string, CachedFileContent> = new Map();
  private fileIndexCache: Map<string, Map<string, string>> = new Map();

  // Cache stats
  cacheHits = 0;
  cacheMisses = 0;

  /**
   * Search documentation for a framework+concept query.
   * Returns prose + code blocks from matched doc files.
   */
  async searchDocs(
    framework: string,
    concept: string,
    maxFiles: number = 3
  ): Promise<DocSearchResult[]> {
    const config = this.getDocSource(framework);
    if (!config) {
      logger.debug('No doc source for framework', { framework });
      return [];
    }

    // Build file index for this framework
    const fileIndex = await this.getFileIndex(framework, config);
    if (!fileIndex || fileIndex.size === 0) {
      logger.debug('Empty file index', { framework });
      return [];
    }

    // Match concept against file names
    const matchedPaths = this.matchConceptToFiles(concept, fileIndex, maxFiles);
    if (matchedPaths.length === 0) {
      logger.debug('No doc files matched concept', { framework, concept });
      return [];
    }

    // Fetch matched files in parallel
    const results: DocSearchResult[] = [];
    const fetchPromises = matchedPaths.map(async ({ path, score }) => {
      const content = await this.fetchFileContent(config, path);
      if (!content) return null;

      const { prose, codeBlocks } = this.extractContent(content, concept);
      if (!prose && codeBlocks.length === 0) return null;

      return {
        prose,
        codeBlocks,
        source: this.buildSourceUrl(config, path),
        filePath: path,
        score,
      };
    });

    const settled = await Promise.allSettled(fetchPromises);
    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value);
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    logger.debug('Doc search completed', {
      framework,
      concept,
      matchedFiles: matchedPaths.length,
      resultsWithContent: results.length,
    });

    return results;
  }

  /**
   * Get or build the file-name-to-path index for a framework
   */
  private async getFileIndex(
    framework: string,
    config: DocSourceConfig
  ): Promise<Map<string, string> | null> {
    // Check index cache
    const cached = this.fileIndexCache.get(framework);
    if (cached) {
      this.cacheHits++;
      return cached;
    }
    this.cacheMisses++;

    // Fetch directory listing
    const files = await this.listDocFiles(config);
    if (!files || files.length === 0) return null;

    // Build name-to-path index
    const index = new Map<string, string>();
    for (const file of files) {
      if (file.type === 'file' && /\.(md|mdx)$/i.test(file.name)) {
        // Normalize the name: remove extension, lowercase
        const normalizedName = file.name
          .replace(/\.(md|mdx)$/i, '')
          .toLowerCase()
          .replace(/[-_]/g, '');
        index.set(normalizedName, file.path);

        // Also index by the last path segment for nested paths
        const segments = file.path.split('/');
        if (segments.length > 1) {
          const lastSegment = segments[segments.length - 1]
            .replace(/\.(md|mdx)$/i, '')
            .toLowerCase()
            .replace(/[-_]/g, '');
          if (!index.has(lastSegment)) {
            index.set(lastSegment, file.path);
          }
        }
      }
    }

    this.fileIndexCache.set(framework, index);
    return index;
  }

  /**
   * List all doc files in a repo's docs directory via GitHub Contents API.
   * Uses recursive tree API for complete listing.
   */
  private async listDocFiles(config: DocSourceConfig): Promise<DocFileEntry[]> {
    const cacheKey = `${config.repo}:${config.docsPath}:${config.branch}`;
    const cached = this.dirCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      this.cacheHits++;
      return cached.files;
    }
    this.cacheMisses++;

    // Check rate limit
    if (githubRateLimitRemaining <= 2 && Date.now() / 1000 < githubRateLimitReset) {
      logger.warn('GitHub API rate limited, skipping directory listing', {
        repo: config.repo,
        resetAt: new Date(githubRateLimitReset * 1000).toISOString(),
      });
      return [];
    }

    try {
      // Use Git Trees API for recursive listing (single API call)
      const treeUrl = `https://api.github.com/repos/${config.repo}/git/trees/${config.branch}?recursive=1`;
      logger.debug('Fetching repo tree', { url: treeUrl });

      const response = await fetch(treeUrl, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'augments-mcp-server',
        },
        signal: AbortSignal.timeout(GITHUB_API_TIMEOUT),
      });

      // Track rate limits
      const remaining = response.headers.get('X-RateLimit-Remaining');
      const reset = response.headers.get('X-RateLimit-Reset');
      if (remaining) githubRateLimitRemaining = parseInt(remaining);
      if (reset) githubRateLimitReset = parseInt(reset);

      if (!response.ok) {
        logger.debug('GitHub tree API failed', { status: response.status, repo: config.repo });
        return [];
      }

      const data = (await response.json()) as { tree: Array<{ path: string; type: string; size?: number }> };

      // Filter to doc files within the docs path
      const docsPrefix = config.docsPath ? `${config.docsPath}/` : '';
      const files: DocFileEntry[] = data.tree
        .filter((item) => {
          if (item.type !== 'blob') return false;
          const path = item.path;
          if (docsPrefix && !path.startsWith(docsPrefix)) return false;
          return /\.(md|mdx)$/i.test(path);
        })
        .map((item) => ({
          name: item.path.split('/').pop() || item.path,
          path: item.path,
          size: item.size || 0,
          type: 'file' as const,
        }));

      this.dirCache.set(cacheKey, { files, fetchedAt: Date.now() });

      logger.debug('Listed doc files', {
        repo: config.repo,
        docsPath: config.docsPath,
        fileCount: files.length,
      });

      return files;
    } catch (error) {
      logger.debug('Failed to list doc files', {
        repo: config.repo,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Fetch raw file content from GitHub
   */
  private async fetchFileContent(
    config: DocSourceConfig,
    filePath: string
  ): Promise<string | null> {
    const cacheKey = `${config.repo}:${filePath}`;
    const cached = this.fileCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      this.cacheHits++;
      return cached.content;
    }
    this.cacheMisses++;

    try {
      const url = `https://raw.githubusercontent.com/${config.repo}/${config.branch}/${filePath}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(GITHUB_RAW_TIMEOUT),
      });

      if (!response.ok) {
        logger.debug('Failed to fetch file', { url, status: response.status });
        return null;
      }

      const content = await response.text();

      // Don't cache very large files (>200KB)
      if (content.length <= 200_000) {
        this.fileCache.set(cacheKey, { content, path: filePath, fetchedAt: Date.now() });
      }

      return content;
    } catch (error) {
      logger.debug('Failed to fetch file content', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Match a concept against the file index.
   * Returns matched paths sorted by relevance.
   *
   * Scoring strategy:
   * 1. Full concept exact/prefix/contains match (highest priority: 100/80/70)
   * 2. Each concept part scored independently and summed, with a bonus when ALL
   *    parts match the same file (addresses multi-word concepts like "persist middleware")
   *    - Part exact match in filename:    60 pts each
   *    - Part contained in filename:      40 pts each
   *    - Part contained in path:          20 pts each
   *    - All-parts-match bonus:          +20 (multi-part concepts only)
   * 3. Path-depth bonus for specificity: +2 per path segment, capped at +10
   *
   */
  private matchConceptToFiles(
    concept: string,
    fileIndex: Map<string, string>,
    maxFiles: number
  ): Array<{ path: string; score: number }> {
    const normalized = concept.toLowerCase().replace(/[-_\s]/g, '');
    const conceptParts = concept.toLowerCase().split(/[-_\s]+/).filter((p) => p.length >= 2);

    // Expand concept parts with synonyms for broader file matching
    const expandedParts = expandWithSynonyms(conceptParts);
    const synonymOnly = expandedParts.filter((p) => !conceptParts.includes(p));

    const matches: Array<{ path: string; score: number }> = [];

    for (const [fileName, filePath] of fileIndex) {
      let score = 0;
      const pathLower = filePath.toLowerCase().replace(/[-_]/g, '');

      // 1. Full concept exact match (highest priority)
      if (fileName === normalized) {
        score = 100;
      } else if (fileName.startsWith(normalized)) {
        score = 80;
      } else if (fileName.includes(normalized)) {
        score = 70;
      } else if (conceptParts.length > 0) {
        // 2. Score each part independently and sum
        let partScore = 0;
        let partsMatched = 0;

        for (const part of conceptParts) {
          if (part.length < 2) continue;
          if (fileName === part) {
            partScore += 60;
            partsMatched++;
          } else if (fileName.includes(part)) {
            partScore += 40;
            partsMatched++;
          } else if (pathLower.includes(part)) {
            partScore += 20;
            partsMatched++;
          }
        }

        // Bonus when ALL parts match the same file (multi-word concepts)
        if (partsMatched === conceptParts.length && conceptParts.length > 1) {
          partScore += 20;
        }

        score = partScore;

        // 3. Synonym expansion: check synonym terms at 50% weight
        if (score === 0 && synonymOnly.length > 0) {
          for (const syn of synonymOnly) {
            if (syn.length < 3) continue;
            if (fileName.includes(syn)) {
              score += 20;
            } else if (pathLower.includes(syn)) {
              score += 10;
            }
          }
        }
      }

      // 4. Path-depth bonus for specificity
      if (score > 0) {
        const depth = filePath.split('/').length;
        score += Math.min(depth * 2, 10);
      }

      if (score > 0) {
        matches.push({ path: filePath, score });
      }
    }

    return matches
      .sort((a, b) => b.score - a.score)
      .slice(0, maxFiles);
  }

  /**
   * Extract prose text and code blocks from markdown content.
   * Focuses content around sections relevant to the concept.
   */
  private extractContent(
    content: string,
    concept: string
  ): { prose: string; codeBlocks: Array<{ code: string; language: string; context?: string }> } {
    const conceptLower = concept.toLowerCase();
    const sections = this.splitIntoSections(content);
    const codeBlocks: Array<{ code: string; language: string; context?: string }> = [];

    // Score and select relevant sections
    const scoredSections = sections
      .map((section) => ({
        section,
        score: this.scoreSectionForConcept(section, conceptLower),
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    // If no sections match, take the top 2 sections by size (general docs)
    const selectedSections =
      scoredSections.length > 0
        ? scoredSections.slice(0, 3).map((s) => s.section)
        : sections.slice(0, 2);

    // Extract prose and code blocks from selected sections
    const proseLines: string[] = [];

    for (const section of selectedSections) {
      if (section.heading) {
        proseLines.push(`## ${section.heading}`);
      }

      let inCodeBlock = false;
      let currentLang = '';
      let currentCode: string[] = [];

      for (const line of section.body.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('```')) {
          if (inCodeBlock) {
            // End code block
            const code = currentCode.join('\n').trim();
            if (code.length >= 20 && !this.isInstallCommand(code)) {
              codeBlocks.push({
                code,
                language: currentLang || 'javascript',
                context: section.heading,
              });
            }
            currentCode = [];
            inCodeBlock = false;
          } else {
            // Start code block
            currentLang = trimmed.replace('```', '').trim();
            inCodeBlock = true;
          }
          continue;
        }

        if (inCodeBlock) {
          currentCode.push(line);
        } else if (trimmed && !this.isNonProseLine(trimmed)) {
          proseLines.push(trimmed);
        }
      }
    }

    // Limit prose to ~3000 chars
    let prose = proseLines.join('\n');
    if (prose.length > 3000) {
      prose = prose.substring(0, 2997) + '...';
    }

    // Limit to 5 best code blocks
    return {
      prose,
      codeBlocks: codeBlocks.slice(0, 5),
    };
  }

  private splitIntoSections(content: string): Array<{ heading: string; body: string }> {
    const sections: Array<{ heading: string; body: string }> = [];
    const parts = content.split(/^(#{1,3}\s+.+)$/m);

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

  private scoreSectionForConcept(
    section: { heading: string; body: string },
    conceptLower: string
  ): number {
    let score = 0;
    const headingLower = section.heading.toLowerCase();
    const bodyLower = section.body.toLowerCase();
    const conceptParts = conceptLower.split(/[-_\s]+/).filter((p) => p.length >= 2);

    // Full concept match in heading
    if (headingLower.includes(conceptLower)) score += 50;
    if (headingLower === conceptLower) score += 30;

    // Per-part heading matches (helps multi-word concepts like "persist middleware")
    if (conceptParts.length > 1) {
      const headingMatches = conceptParts.filter((p) => headingLower.includes(p)).length;
      score += headingMatches * 15;
      if (headingMatches === conceptParts.length) score += 20;
    }

    // Count mentions in body — try full concept first, then individual parts
    const escapedConcept = conceptLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fullMentions = (bodyLower.match(new RegExp(escapedConcept, 'g')) || []).length;
    score += Math.min(fullMentions * 5, 25);

    if (fullMentions === 0 && conceptParts.length > 1) {
      let partMentions = 0;
      for (const part of conceptParts) {
        const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        partMentions += (bodyLower.match(new RegExp(escaped, 'g')) || []).length;
      }
      score += Math.min(partMentions * 3, 20);
    }

    // Has code blocks
    if (/```\w*\n/.test(section.body)) score += 10;

    return score;
  }

  private isNonProseLine(line: string): boolean {
    if (line.startsWith('|') && line.endsWith('|')) return true;
    if (line.startsWith('![')) return true;
    if (/^[-*]\s*$/.test(line)) return true;
    if (/^#{1,6}\s/.test(line)) return true;
    if (/^---+$/.test(line)) return true;
    return false;
  }

  private isInstallCommand(code: string): boolean {
    return /\b(npm|yarn|pnpm|bun)\s+(install|add|i|create)\b/.test(code);
  }

  private buildSourceUrl(config: DocSourceConfig, filePath: string): string {
    if (config.websiteBaseUrl) {
      // Try to build a website URL from the file path
      const cleanPath = filePath
        .replace(config.docsPath ? `${config.docsPath}/` : '', '')
        .replace(/\.(md|mdx)$/i, '')
        .replace(/\/index$/, '');
      return `${config.websiteBaseUrl}/${cleanPath}`;
    }
    return `https://github.com/${config.repo}/blob/${config.branch}/${filePath}`;
  }

  /**
   * Get doc source config for a framework
   */
  private getDocSource(framework: string): DocSourceConfig | null {
    const extractor = getExampleExtractor();
    return extractor.getDocSource(framework);
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.dirCache.clear();
    this.fileCache.clear();
    this.fileIndexCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    logger.debug('DocFetcher cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { dirEntries: number; fileEntries: number; indexEntries: number; hits: number; misses: number } {
    return {
      dirEntries: this.dirCache.size,
      fileEntries: this.fileCache.size,
      indexEntries: this.fileIndexCache.size,
      hits: this.cacheHits,
      misses: this.cacheMisses,
    };
  }
}

// Singleton
let instance: DocFetcher | null = null;

export function getDocFetcher(): DocFetcher {
  if (!instance) {
    instance = new DocFetcher();
  }
  return instance;
}
