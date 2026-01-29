/**
 * GitHub API client with rate limiting
 */

import { Octokit } from '@octokit/rest';
import { config } from '@/config';
import { getLogger } from '@/utils/logger';

const logger = getLogger('github-client');

/**
 * Parsed repository information
 */
interface ParsedRepo {
  owner: string;
  repoName: string;
}

/**
 * Parse and validate repository string format
 */
function parseRepoString(repo: string): ParsedRepo {
  if (!repo || typeof repo !== 'string') {
    throw new Error('Repository string is required');
  }
  const parts = repo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repository format: "${repo}". Expected format: "owner/repo"`);
  }
  return { owner: parts[0], repoName: parts[1] };
}

/**
 * Type guard for Octokit errors with status code
 */
function isOctokitError(error: unknown): error is { status: number; message?: string } {
  return typeof error === 'object' && error !== null && 'status' in error;
}

/**
 * Extract error message from unknown error type
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export class RateLimitError extends Error {
  public readonly resetTime: Date;
  public readonly waitSeconds: number;

  constructor(message: string, resetTime?: Date) {
    super(message);
    this.name = 'RateLimitError';
    this.resetTime = resetTime || new Date();
    this.waitSeconds = Math.max(0, Math.ceil((this.resetTime.getTime() - Date.now()) / 1000));
  }
}

export class GitHubClient {
  private octokit: Octokit;
  private rateLimitRemaining: number = 5000;
  private rateLimitReset: Date = new Date();
  private lastRequestTime: Date = new Date();

  constructor(token?: string) {
    this.octokit = new Octokit({
      auth: token || config.githubToken,
      userAgent: 'Augments-MCP-Server/3.0',
      timeZone: 'UTC',
    });

    logger.info('GitHub client initialized', {
      hasToken: Boolean(token || config.githubToken),
    });
  }

  /**
   * Get file content from a repository
   */
  async getFileContent(
    repo: string,
    path: string,
    branch: string = 'main'
  ): Promise<string | null> {
    const { owner, repoName } = parseRepoString(repo);

    try {
      await this.checkRateLimit();

      const response = await this.octokit.repos.getContent({
        owner,
        repo: repoName,
        path: path.replace(/^\//, ''),
        ref: branch,
      });

      this.updateRateLimitFromHeaders(response.headers);

      if ('content' in response.data && response.data.type === 'file') {
        const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
        logger.debug('Retrieved file content', {
          repo,
          path,
          size: content.length,
        });
        return content;
      }

      return null;
    } catch (error: unknown) {
      if (isOctokitError(error)) {
        if (error.status === 404) {
          logger.debug('File not found', { repo, path });
          return null;
        }
        if (error.status === 403 && error.message?.includes('rate limit')) {
          throw new RateLimitError('GitHub API rate limit exceeded');
        }
      }
      logger.error('GitHub getFileContent error', {
        repo,
        path,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Get directory contents from a repository
   */
  async getDirectoryContents(
    repo: string,
    path: string = '',
    branch: string = 'main'
  ): Promise<Array<{ name: string; type: string; path: string }>> {
    const { owner, repoName } = parseRepoString(repo);

    try {
      await this.checkRateLimit();

      const response = await this.octokit.repos.getContent({
        owner,
        repo: repoName,
        path: path.replace(/^\//, ''),
        ref: branch,
      });

      this.updateRateLimitFromHeaders(response.headers);

      if (Array.isArray(response.data)) {
        const contents = response.data.map((item) => ({
          name: item.name,
          type: item.type,
          path: item.path,
        }));
        logger.debug('Retrieved directory contents', {
          repo,
          path,
          count: contents.length,
        });
        return contents;
      }

      return [];
    } catch (error: unknown) {
      if (isOctokitError(error) && error.status === 404) {
        logger.debug('Directory not found', { repo, path });
        return [];
      }
      logger.error('GitHub getDirectoryContents error', {
        repo,
        path,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Get recent commits for a repository or path
   */
  async getCommits(
    repo: string,
    options: {
      path?: string;
      since?: Date;
      limit?: number;
    } = {}
  ): Promise<Array<{ sha: string; message: string; date: string }>> {
    const { owner, repoName } = parseRepoString(repo);

    try {
      await this.checkRateLimit();

      const response = await this.octokit.repos.listCommits({
        owner,
        repo: repoName,
        path: options.path,
        since: options.since?.toISOString(),
        per_page: Math.min(options.limit || 10, 100),
      });

      this.updateRateLimitFromHeaders(response.headers);

      const commits = response.data.map((commit) => ({
        sha: commit.sha,
        message: commit.commit.message,
        date: commit.commit.committer?.date || '',
      }));

      logger.debug('Retrieved commits', {
        repo,
        path: options.path,
        count: commits.length,
      });

      return commits;
    } catch (error: unknown) {
      if (isOctokitError(error) && error.status === 404) {
        return [];
      }
      logger.error('GitHub getCommits error', {
        repo,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Search code in a repository
   */
  async searchCode(
    repo: string,
    query: string,
    extension?: string
  ): Promise<Array<{ path: string; url: string }>> {
    try {
      await this.checkRateLimit();

      let searchQuery = `${query} repo:${repo}`;
      if (extension) {
        searchQuery += ` extension:${extension}`;
      }

      const response = await this.octokit.search.code({
        q: searchQuery,
        sort: 'indexed',
        order: 'desc',
        per_page: 30,
      });

      this.updateRateLimitFromHeaders(response.headers);

      const results = response.data.items.map((item) => ({
        path: item.path,
        url: item.html_url,
      }));

      logger.debug('Code search completed', {
        repo,
        query,
        results: results.length,
      });

      return results;
    } catch (error: unknown) {
      if (isOctokitError(error) && error.status === 403) {
        logger.warn('Code search not available (rate limited or requires auth)');
        return [];
      }
      logger.error('GitHub searchCode error', {
        repo,
        query,
        error: getErrorMessage(error),
      });
      return [];
    }
  }

  /**
   * Get rate limit info
   */
  getRateLimitInfo(): {
    remaining: number;
    reset_time: string;
    seconds_until_reset: number;
  } {
    const secondsUntilReset = Math.max(
      0,
      Math.floor((this.rateLimitReset.getTime() - Date.now()) / 1000)
    );

    return {
      remaining: this.rateLimitRemaining,
      reset_time: this.rateLimitReset.toISOString(),
      seconds_until_reset: secondsUntilReset,
    };
  }

  private async checkRateLimit(): Promise<void> {
    if (this.rateLimitRemaining <= 1 && Date.now() < this.rateLimitReset.getTime()) {
      // Throw immediately instead of blocking - let caller handle the rate limit
      throw new RateLimitError(
        `GitHub API rate limit exceeded. Resets at ${this.rateLimitReset.toISOString()}`,
        this.rateLimitReset
      );
    }

    // Respect minimum delay between requests (100ms)
    const timeSinceLast = Date.now() - this.lastRequestTime.getTime();
    if (timeSinceLast < 100) {
      await new Promise((resolve) => setTimeout(resolve, 100 - timeSinceLast));
    }

    this.lastRequestTime = new Date();
  }

  private updateRateLimitFromHeaders(headers: Record<string, any>): void {
    if (headers['x-ratelimit-remaining']) {
      this.rateLimitRemaining = parseInt(headers['x-ratelimit-remaining'], 10);
    }
    if (headers['x-ratelimit-reset']) {
      this.rateLimitReset = new Date(parseInt(headers['x-ratelimit-reset'], 10) * 1000);
    }
  }
}

// Singleton instance
let clientInstance: GitHubClient | null = null;

export function getGitHubClient(): GitHubClient {
  if (!clientInstance) {
    clientInstance = new GitHubClient();
  }
  return clientInstance;
}
