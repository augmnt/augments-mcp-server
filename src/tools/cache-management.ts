/**
 * Cache Management Tools
 *
 * Tools for checking updates, refreshing cache, and viewing cache statistics
 */

import { z } from 'zod';
import { FrameworkRegistryManager } from '@/registry/manager';
import { KVCache } from '@/cache';
import { GitHubProvider } from '@/providers/github';
import { WebsiteProvider } from '@/providers/website';
import { GitHubClient, getGitHubClient, RateLimitError } from '@/utils/github-client';
import { type CacheStats } from '@/types';
import { getLogger } from '@/utils/logger';

const logger = getLogger('tools:cache-management');

/**
 * Result of checking for updates from a source
 */
interface UpdateCheckResult {
  has_updates: boolean;
  last_modified: string | null;
  changes: string[];
  commit_count?: number;
  etag?: string | null;
  error?: string;
}

// Input schemas
export const CheckFrameworkUpdatesInputSchema = z.object({
  framework: z.string().min(1).describe('Framework name to check for updates'),
});

export const RefreshFrameworkCacheInputSchema = z.object({
  framework: z.string().optional().describe('Specific framework to refresh, or omit for all frameworks'),
  force: z.boolean().default(false).describe('Force refresh even if cache is still valid'),
});

export type CheckFrameworkUpdatesInput = z.infer<typeof CheckFrameworkUpdatesInputSchema>;
export type RefreshFrameworkCacheInput = z.infer<typeof RefreshFrameworkCacheInputSchema>;

/**
 * Check if framework documentation has been updated since last cache
 */
export async function checkFrameworkUpdates(
  registry: FrameworkRegistryManager,
  cache: KVCache,
  githubProvider: GitHubProvider,
  input: CheckFrameworkUpdatesInput
): Promise<{
  framework: string;
  display_name: string;
  last_checked: string;
  last_modified: string | null;
  has_updates: boolean;
  change_summary: string[];
  sources: Record<string, unknown>;
  cache_info: unknown;
}> {
  try {
    const { framework } = input;

    // Get framework configuration
    const config = registry.getFramework(framework);
    if (!config) {
      throw new Error(`Framework '${framework}' not found in registry`);
    }

    // Get current cache info
    const cacheInfo = await cache.getFrameworkCacheInfo(framework);

    // Check each source for updates
    const updateResults: Record<string, unknown> = {};

    // Check GitHub source
    if (config.sources.documentation.github) {
      const githubUpdate = await checkGitHubUpdates(
        config.sources.documentation.github.repo,
        config.sources.documentation.github.docs_path,
        config.sources.documentation.github.branch,
        cacheInfo
      );
      updateResults.github = githubUpdate;
    }

    // Check website source (basic check)
    if (config.sources.documentation.website) {
      const websiteProvider = new WebsiteProvider();
      const websiteUpdate = await checkWebsiteUpdates(
        config.sources.documentation.website,
        cacheInfo,
        websiteProvider
      );
      updateResults.website = websiteUpdate;
    }

    // Determine overall update status
    const hasUpdates = Object.values(updateResults).some(
      (result) => (result as UpdateCheckResult)?.has_updates === true
    );

    // Find the most recent update
    let lastModified: string | null = null;
    const changeSummary: string[] = [];

    for (const [_source, result] of Object.entries(updateResults)) {
      const r = result as UpdateCheckResult;
      if (r?.last_modified) {
        if (!lastModified || new Date(r.last_modified) > new Date(lastModified)) {
          lastModified = r.last_modified;
        }
      }
      if (r?.changes) {
        changeSummary.push(...r.changes);
      }
    }

    const result = {
      framework,
      display_name: config.display_name,
      last_checked: new Date().toISOString(),
      last_modified: lastModified,
      has_updates: hasUpdates,
      change_summary: changeSummary,
      sources: updateResults,
      cache_info: cacheInfo,
    };

    logger.info('Framework update check completed', {
      framework,
      has_updates: hasUpdates,
      sources: Object.keys(updateResults).length,
    });

    return result;
  } catch (error) {
    logger.error('Update check failed', {
      framework: input.framework,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Refresh cached documentation for frameworks
 */
export async function refreshFrameworkCache(
  registry: FrameworkRegistryManager,
  cache: KVCache,
  githubProvider: GitHubProvider,
  websiteProvider: WebsiteProvider,
  input: RefreshFrameworkCacheInput
): Promise<string> {
  try {
    const { framework, force } = input;

    const frameworksToRefresh = framework
      ? [framework]
      : registry.getFrameworkNames();

    const refreshResults: Array<{
      framework: string;
      refreshed: boolean;
      reason?: string;
      items_refreshed?: number;
      timestamp?: string;
    }> = [];
    const failedRefreshes: string[] = [];

    for (const fwName of frameworksToRefresh) {
      try {
        const result = await refreshSingleFramework(
          registry,
          cache,
          githubProvider,
          websiteProvider,
          fwName,
          force
        );
        refreshResults.push(result);
      } catch (error) {
        logger.error('Failed to refresh framework cache', {
          framework: fwName,
          error: error instanceof Error ? error.message : String(error),
        });
        failedRefreshes.push(fwName);
      }
    }

    // Generate summary
    const totalRefreshed = refreshResults.filter((r) => r.refreshed).length;
    const totalSkipped = refreshResults.filter((r) => !r.refreshed).length;

    const summaryParts: string[] = [];
    summaryParts.push('Cache refresh completed:');
    summaryParts.push(`- Refreshed: ${totalRefreshed} frameworks`);

    if (totalSkipped > 0) {
      summaryParts.push(`- Skipped (up-to-date): ${totalSkipped} frameworks`);
    }

    if (failedRefreshes.length > 0) {
      summaryParts.push(`- Failed: ${failedRefreshes.length} frameworks (${failedRefreshes.join(', ')})`);
    }

    const summary = summaryParts.join('\n');

    logger.info('Framework cache refresh completed', {
      total_frameworks: frameworksToRefresh.length,
      refreshed: totalRefreshed,
      skipped: totalSkipped,
      failed: failedRefreshes.length,
    });

    return summary;
  } catch (error) {
    const errorMsg = `Cache refresh failed: ${error instanceof Error ? error.message : String(error)}`;
    logger.error('Cache refresh failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return `Error: ${errorMsg}`;
  }
}

/**
 * Get comprehensive cache statistics
 */
export async function getCacheStats(
  registry: FrameworkRegistryManager,
  cache: KVCache
): Promise<{
  overall: CacheStats;
  frameworks: Array<{ framework: string; memory_entries: number; total_size_bytes: number }>;
  summary: {
    total_frameworks: number;
    total_memory_size_bytes: number;
    average_cache_age_hours: number;
    oldest_cache_hours: number;
    newest_cache_hours: number;
  };
}> {
  try {
    // Get overall cache stats
    const overallStats = cache.getStats();

    // Get per-framework stats
    const frameworkStats: Array<{
      framework: string;
      memory_entries: number;
      total_size_bytes: number;
    }> = [];

    for (const frameworkName of registry.getFrameworkNames()) {
      const fwStats = await cache.getFrameworkCacheInfo(frameworkName);
      frameworkStats.push(fwStats);
    }

    // Calculate totals
    const totalMemorySize = frameworkStats.reduce((sum, fw) => sum + fw.total_size_bytes, 0);

    // Calculate cache age statistics
    const timestamps = cache.getCacheTimestamps();
    const now = Date.now();
    let averageAgeHours = 0;
    let oldestAgeHours = 0;
    let newestAgeHours = 0;

    if (timestamps.all.length > 0) {
      const ageSum = timestamps.all.reduce((sum, ts) => sum + (now - ts), 0);
      averageAgeHours = Math.round((ageSum / timestamps.all.length / 3600000) * 100) / 100;
      if (timestamps.oldest !== null) {
        oldestAgeHours = Math.round(((now - timestamps.oldest) / 3600000) * 100) / 100;
      }
      if (timestamps.newest !== null) {
        newestAgeHours = Math.round(((now - timestamps.newest) / 3600000) * 100) / 100;
      }
    }

    const result = {
      overall: overallStats,
      frameworks: frameworkStats,
      summary: {
        total_frameworks: frameworkStats.length,
        total_memory_size_bytes: totalMemorySize,
        average_cache_age_hours: averageAgeHours,
        oldest_cache_hours: oldestAgeHours,
        newest_cache_hours: newestAgeHours,
      },
    };

    logger.debug('Cache statistics retrieved', {
      frameworks: frameworkStats.length,
      memory_entries: overallStats.memory_entries,
    });

    return result;
  } catch (error) {
    logger.error('Failed to get cache statistics', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// Helper functions

async function checkGitHubUpdates(
  repo: string,
  docsPath: string,
  branch: string,
  cacheInfo: { framework: string; memory_entries: number; total_size_bytes: number; last_cached_at: number | null }
): Promise<{
  has_updates: boolean;
  last_modified: string | null;
  changes: string[];
  commit_count?: number;
  error?: string;
}> {
  try {
    const client = getGitHubClient();

    // Check commits in the last week
    const since = new Date();
    since.setDate(since.getDate() - 7);

    const commits = await client.getCommits(repo, {
      path: docsPath,
      since,
      limit: 10,
    });

    if (!commits.length) {
      return {
        has_updates: false,
        last_modified: null,
        changes: [],
      };
    }

    // Get the most recent commit
    const latestCommit = commits[0];
    const commitDate = latestCommit.date;

    // Compare commit timestamp against cache timestamp
    const hasUpdates =
      cacheInfo.last_cached_at === null ||
      (commits.length > 0 && new Date(commits[0].date).getTime() > cacheInfo.last_cached_at);

    // Extract change summaries
    const changes = commits.slice(0, 5).map((commit) => {
      const firstLine = commit.message.split('\n')[0];
      return firstLine;
    });

    return {
      has_updates: hasUpdates,
      last_modified: commitDate,
      changes,
      commit_count: commits.length,
    };
  } catch (error) {
    // Handle rate limit errors gracefully
    if (error instanceof RateLimitError) {
      return {
        has_updates: false,
        last_modified: null,
        changes: [],
        error: `Rate limited until ${error.resetTime?.toISOString() || 'unknown'}`,
      };
    }
    logger.warn('GitHub update check failed', {
      repo,
      path: docsPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      has_updates: false,
      last_modified: null,
      changes: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkWebsiteUpdates(
  websiteUrl: string,
  cacheInfo: { framework: string; memory_entries: number; total_size_bytes: number; last_cached_at: number | null },
  websiteProvider: WebsiteProvider
): Promise<{
  has_updates: boolean;
  last_modified: string | null;
  changes: string[];
  etag?: string | null;
  error?: string;
}> {
  try {
    const updateInfo = await websiteProvider.checkForUpdates(websiteUrl);

    // Determine if there are updates based on available information
    let hasUpdates = cacheInfo.last_cached_at === null; // No cache means we need to fetch

    if (!hasUpdates && updateInfo.lastModified && cacheInfo.last_cached_at !== null) {
      // Compare Last-Modified header against cache timestamp
      hasUpdates = new Date(updateInfo.lastModified).getTime() > cacheInfo.last_cached_at;
    } else if (!hasUpdates && updateInfo.hasChanges !== null) {
      // Use content hash comparison result if available
      hasUpdates = updateInfo.hasChanges;
    }

    return {
      has_updates: hasUpdates,
      last_modified: updateInfo.lastModified,
      changes: hasUpdates ? ['Website content may have been updated'] : [],
      etag: updateInfo.etag,
    };
  } catch (error) {
    logger.warn('Website update check failed', {
      url: websiteUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      has_updates: false,
      last_modified: null,
      changes: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function refreshSingleFramework(
  registry: FrameworkRegistryManager,
  cache: KVCache,
  githubProvider: GitHubProvider,
  websiteProvider: WebsiteProvider,
  framework: string,
  force: boolean
): Promise<{
  framework: string;
  refreshed: boolean;
  reason?: string;
  items_refreshed?: number;
  timestamp?: string;
}> {
  const config = registry.getFramework(framework);
  if (!config) {
    throw new Error(`Framework '${framework}' not found`);
  }

  // Check if refresh is needed
  if (!force) {
    const cacheInfo = await cache.getFrameworkCacheInfo(framework);

    // Skip if recently cached (simple heuristic)
    if (cacheInfo.memory_entries > 0) {
      return {
        framework,
        refreshed: false,
        reason: 'Recently cached content found',
      };
    }
  }

  let refreshCount = 0;

  // Refresh documentation
  const docSource = config.sources.documentation;

  if (docSource.github) {
    try {
      // Invalidate existing cache
      await cache.invalidate(framework, '', 'docs');

      // Fetch fresh content
      const freshContent = await githubProvider.fetchDocumentation(
        docSource.github.repo,
        docSource.github.docs_path,
        docSource.github.branch
      );

      if (freshContent) {
        await cache.set(
          framework,
          freshContent,
          '',
          'docs',
          config.version,
          docSource.github.branch
        );
        refreshCount++;
      }
    } catch (error) {
      logger.warn('GitHub cache refresh failed', {
        framework,
        repo: docSource.github.repo,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (docSource.website) {
    try {
      // Invalidate existing cache
      await cache.invalidate(framework, 'website', 'docs');

      // Fetch fresh content
      const freshContent = await websiteProvider.fetchDocumentation(docSource.website);

      if (freshContent) {
        await cache.set(framework, freshContent, 'website', 'docs', config.version);
        refreshCount++;
      }
    } catch (error) {
      logger.warn('Website cache refresh failed', {
        framework,
        url: docSource.website,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Refresh examples if available
  if (config.sources.examples?.github) {
    try {
      await cache.invalidate(framework, '', 'examples');

      const freshExamples = await githubProvider.fetchExamples(
        config.sources.examples.github.repo,
        config.sources.examples.github.docs_path,
        config.sources.examples.github.branch
      );

      if (freshExamples) {
        await cache.set(
          framework,
          freshExamples,
          'examples',
          'examples',
          config.version,
          config.sources.examples.github.branch
        );
        refreshCount++;
      }
    } catch (error) {
      logger.warn('Examples cache refresh failed', {
        framework,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    framework,
    refreshed: refreshCount > 0,
    items_refreshed: refreshCount,
    timestamp: new Date().toISOString(),
  };
}
