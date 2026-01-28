/**
 * Website documentation provider
 */

import { createHash } from 'crypto';
import { htmlToMarkdown, extractCodeExamples, cleanMarkdown } from '@/utils/html-parser';
import { getLogger } from '@/utils/logger';

const logger = getLogger('website-provider');

const DEFAULT_FETCH_TIMEOUT = 10000; // 10 seconds
const HEAD_REQUEST_TIMEOUT = 5000; // 5 seconds for HEAD requests

/**
 * Fetch with timeout using AbortController
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export class WebsiteProvider {
  private userAgent = 'Augments-MCP-Server/3.0 (Documentation Fetcher)';

  /**
   * Fetch documentation content from a website
   */
  async fetchDocumentation(url: string): Promise<string | null> {
    try {
      logger.debug('Fetching documentation from website', { url });

      const response = await fetchWithTimeout(
        url,
        {
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          redirect: 'follow',
        },
        DEFAULT_FETCH_TIMEOUT
      );

      if (!response.ok) {
        logger.error('Website HTTP error', {
          url,
          status: response.status,
        });
        return null;
      }

      const html = await response.text();
      const markdown = htmlToMarkdown(html, url);

      if (!markdown) {
        logger.warn('No meaningful content extracted', { url });
        return null;
      }

      // Add header
      const formattedContent = `# Documentation from ${url}\n\n${markdown}`;

      logger.info('Website documentation fetched successfully', {
        url,
        length: formattedContent.length,
      });

      return formattedContent;
    } catch (error) {
      logger.error('Website documentation fetch failed', {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Fetch examples from a website
   */
  async fetchExamples(url: string, pattern?: string): Promise<string | null> {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          redirect: 'follow',
        },
        DEFAULT_FETCH_TIMEOUT
      );

      if (!response.ok) {
        return null;
      }

      const html = await response.text();
      const examples = extractCodeExamples(html, pattern);

      if (!examples.length) {
        logger.warn('No code examples found', { url, pattern });
        return null;
      }

      // Format examples
      const parts: string[] = [
        `# Examples from ${url}`,
        pattern ? `**Pattern:** ${pattern}` : '',
        '',
      ].filter(Boolean);

      for (const example of examples) {
        parts.push(`## ${example.title}`);
        parts.push(`\`\`\`${example.language}`);
        parts.push(example.code);
        parts.push('```\n');
      }

      const formattedExamples = parts.join('\n');

      logger.info('Website examples fetched successfully', {
        url,
        pattern,
        count: examples.length,
      });

      return formattedExamples;
    } catch (error) {
      logger.error('Website examples fetch failed', {
        url,
        pattern,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Check if website has been updated (via HEAD request with content hash fallback)
   */
  async checkForUpdates(
    url: string,
    previousContentHash?: string
  ): Promise<{
    lastModified: string | null;
    etag: string | null;
    contentHash: string | null;
    hasChanges: boolean | null;
  }> {
    try {
      // Try HEAD request first for headers
      const headResponse = await fetchWithTimeout(
        url,
        {
          method: 'HEAD',
          headers: {
            'User-Agent': this.userAgent,
          },
        },
        HEAD_REQUEST_TIMEOUT
      );

      const lastModified = headResponse.headers.get('last-modified');
      const etag = headResponse.headers.get('etag');

      // If we have HTTP headers, return them
      if (lastModified || etag) {
        return { lastModified, etag, contentHash: null, hasChanges: null };
      }

      // Fallback: fetch content and compute hash if we have a previous hash to compare
      if (previousContentHash) {
        const response = await fetchWithTimeout(
          url,
          {
            headers: {
              'User-Agent': this.userAgent,
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            redirect: 'follow',
          },
          DEFAULT_FETCH_TIMEOUT
        );

        if (response.ok) {
          const content = await response.text();
          const currentHash = createHash('sha256').update(content).digest('hex');
          return {
            lastModified: null,
            etag: null,
            contentHash: currentHash,
            hasChanges: currentHash !== previousContentHash,
          };
        }
      }

      return { lastModified: null, etag: null, contentHash: null, hasChanges: null };
    } catch (error) {
      logger.warn('Website update check failed', {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        lastModified: null,
        etag: null,
        contentHash: null,
        hasChanges: null,
      };
    }
  }

  /**
   * Compute content hash for a given content string
   */
  computeContentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}

// Singleton instance
let providerInstance: WebsiteProvider | null = null;

export function getWebsiteProvider(): WebsiteProvider {
  if (!providerInstance) {
    providerInstance = new WebsiteProvider();
  }
  return providerInstance;
}
