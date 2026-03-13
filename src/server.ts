/**
 * Augments MCP Server
 *
 * A comprehensive MCP server that provides real-time access to framework documentation
 * and context to enhance Claude Code's ability to generate accurate, up-to-date code.
 *
 * v7: Documentation-first search, 7 tools, BM25 indexing, migration guides, error diagnosis.
 *
 * Uses the official MCP SDK for Claude Code compatibility.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  getApiContext,
  formatApiContextResponse,
  searchApis,
  formatSearchApisResponse,
  getVersionInfo,
  formatVersionInfoResponse,
  getMigrationGuide,
  formatMigrationGuideResponse,
  diagnoseError,
  formatDiagnoseErrorResponse,
  comparePackages,
  formatComparePackagesResponse,
  scanProjectDeps,
  formatScanProjectDepsResponse,
} from '@/tools/v4';
import { getLogger } from '@/utils/logger';

const logger = getLogger('mcp-server');

// Server version
export const SERVER_VERSION = '7.0.0';

// Server start time for diagnostics
const serverStartTime = Date.now();

// Registered tool count — set during initialization, used by health check
export let registeredToolCount = 0;

// Track whether cache warming has been kicked off
let cacheWarmingStarted = false;

/**
 * Format tool result for MCP response
 */
function formatResult(result: unknown): { content: Array<{ type: 'text'; text: string }> } {
  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  return {
    content: [{ type: 'text', text }],
  };
}

/**
 * Format error result for MCP response with tool context and recovery hints
 */
function formatError(error: unknown, toolName?: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const message = error instanceof Error ? error.message : String(error);
  const prefix = toolName ? `Error in ${toolName}: ` : 'Error: ';

  let hint = '';
  const msgLower = message.toLowerCase();
  if (msgLower.includes('timeout') || msgLower.includes('timed out') || msgLower.includes('aborted')) {
    hint = '\nHint: The upstream service timed out. Try again or specify a different package version.';
  } else if (msgLower.includes('fetch') || msgLower.includes('network') || msgLower.includes('econnrefused')) {
    hint = '\nHint: Network error reaching upstream. Check connectivity or try again shortly.';
  } else if (msgLower.includes('404') || msgLower.includes('not found')) {
    hint = '\nHint: Package or resource not found. Verify the package name and version.';
  }

  return {
    content: [{ type: 'text', text: `${prefix}${message}${hint}` }],
    isError: true,
  };
}

/**
 * Create and configure the MCP server instance.
 */
export async function getServer(): Promise<McpServer> {
  const server = new McpServer({
    name: 'augments-mcp-server',
    version: SERVER_VERSION,
  });

  let toolCount = 0;

  // ==================== Primary Tools (3) ====================

  server.tool(
    'get_api_context',
    'RECOMMENDED: Get precise API signatures, parameters, return types, prose documentation, and code examples for any npm package. Handles natural language like "react useEffect cleanup" or "how to use zustand". Always try this first.',
    {
      query: z.string().min(1).describe('Natural language query (e.g., "useEffect cleanup" or "how to use prisma findMany")'),
      framework: z.string().optional().describe('Specific framework to search in (e.g., "react", "prisma")'),
      version: z.string().optional().describe('Specific version (e.g., "19.0.0" or "latest")'),
      includeExamples: z.boolean().default(true).describe('Whether to include code examples'),
      maxExamples: z.number().min(0).max(5).default(2).describe('Maximum number of examples to include'),
    },
    async ({ query, framework, version, includeExamples, maxExamples }) => {
      try {
        const result = await getApiContext({
          query,
          framework,
          version,
          includeExamples: includeExamples ?? true,
          maxExamples: maxExamples ?? 2,
        });
        return formatResult(formatApiContextResponse(result));
      } catch (error) {
        logger.error('Tool execution failed', { tool: 'get_api_context', error });
        return formatError(error, 'get_api_context');
      }
    }
  );
  toolCount++;

  server.tool(
    'search_apis',
    "Search for APIs across multiple frameworks when you don't know the exact name. Supports concept search like 'state management' which matches useState, createStore, atom, etc.",
    {
      query: z.string().min(1).describe('Search query (e.g., "state management hook" or "form validation")'),
      frameworks: z.array(z.string()).optional().describe('Limit search to specific frameworks'),
      limit: z.number().min(1).max(20).default(5).describe('Maximum results per framework'),
    },
    async ({ query, frameworks, limit }) => {
      try {
        const result = await searchApis({
          query,
          frameworks,
          limit: limit ?? 5,
        });
        return formatResult(formatSearchApisResponse(result));
      } catch (error) {
        logger.error('Tool execution failed', { tool: 'search_apis', error });
        return formatError(error, 'search_apis');
      }
    }
  );
  toolCount++;

  server.tool(
    'get_version_info',
    'Get version info, available versions, and breaking change detection for any npm package. Now includes actual breaking changes and new features from changelogs.',
    {
      framework: z.string().min(1).describe('Framework or package name'),
      fromVersion: z.string().optional().describe('Compare from this version'),
      toVersion: z.string().optional().describe('Compare to this version'),
    },
    async ({ framework, fromVersion, toVersion }) => {
      try {
        const result = await getVersionInfo({
          framework,
          fromVersion,
          toVersion,
        });
        return formatResult(formatVersionInfoResponse(result));
      } catch (error) {
        logger.error('Tool execution failed', { tool: 'get_version_info', error });
        return formatError(error, 'get_version_info');
      }
    }
  );
  toolCount++;

  // ==================== New Tools (4) ====================

  server.tool(
    'get_migration_guide',
    'Get a detailed migration guide between package versions. Returns breaking changes, new features, deprecations, type diffs, and official migration docs.',
    {
      package: z.string().min(1).describe('Package or framework name (e.g., "react", "next", "prisma")'),
      fromVersion: z.string().min(1).describe('Version to migrate from (e.g., "18", "14.0.0")'),
      toVersion: z.string().optional().describe('Version to migrate to (defaults to latest)'),
    },
    async ({ package: pkg, fromVersion, toVersion }) => {
      try {
        const result = await getMigrationGuide({
          package: pkg,
          fromVersion,
          toVersion,
        });
        return formatResult(formatMigrationGuideResponse(result));
      } catch (error) {
        logger.error('Tool execution failed', { tool: 'get_migration_guide', error });
        return formatError(error, 'get_migration_guide');
      }
    }
  );
  toolCount++;

  server.tool(
    'diagnose_error',
    'Diagnose an error message or stack trace. Matches against known error patterns, searches GitHub issues, and finds relevant documentation.',
    {
      error: z.string().min(1).describe('The error message or stack trace to diagnose'),
      package: z.string().optional().describe('Package or framework the error is from'),
      version: z.string().optional().describe('Package version'),
    },
    async ({ error, package: pkg, version }) => {
      try {
        const result = await diagnoseError({
          error,
          package: pkg,
          version,
        });
        return formatResult(formatDiagnoseErrorResponse(result));
      } catch (err) {
        logger.error('Tool execution failed', { tool: 'diagnose_error', error: err });
        return formatError(err, 'diagnose_error');
      }
    }
  );
  toolCount++;

  server.tool(
    'compare_packages',
    'Compare npm packages side-by-side: downloads, bundle size, dependencies, GitHub stars, exported APIs. Great for choosing between alternatives.',
    {
      packages: z.array(z.string()).min(2).max(5).describe('Package names to compare (2-5)'),
      criteria: z.string().optional().describe('Focus area (e.g., "bundle size", "popularity")'),
    },
    async ({ packages, criteria }) => {
      try {
        const result = await comparePackages({ packages, criteria });
        return formatResult(formatComparePackagesResponse(result));
      } catch (error) {
        logger.error('Tool execution failed', { tool: 'compare_packages', error });
        return formatError(error, 'compare_packages');
      }
    }
  );
  toolCount++;

  server.tool(
    'scan_project_deps',
    'Scan project dependencies for outdated packages, major updates, deprecated packages, and security advisories. Reads package.json.',
    {
      packageJsonPath: z.string().optional().describe('Path to package.json (defaults to ./package.json)'),
      checkTypes: z.array(z.enum(['updates', 'deprecated', 'security'])).optional().describe('Types of checks to run'),
    },
    async ({ packageJsonPath, checkTypes }) => {
      try {
        const result = await scanProjectDeps({ packageJsonPath, checkTypes });
        return formatResult(formatScanProjectDepsResponse(result));
      } catch (error) {
        logger.error('Tool execution failed', { tool: 'scan_project_deps', error });
        return formatError(error, 'scan_project_deps');
      }
    }
  );
  toolCount++;

  // ==================== Diagnostics Tool ====================

  server.tool(
    'diagnostics',
    'Get server health information: version, uptime, memory usage, cache statistics, and Node.js version.',
    {},
    async () => {
      try {
        const { getDocFetcher, getDocSearchEngine } = await import('@/core');
        const docFetcher = getDocFetcher();
        const searchEngine = getDocSearchEngine();

        const memUsage = process.memoryUsage();
        const uptimeMs = Date.now() - serverStartTime;
        const uptimeMin = Math.floor(uptimeMs / 60_000);

        const info = {
          version: SERVER_VERSION,
          nodeVersion: process.version,
          platform: process.platform,
          uptime: `${uptimeMin}m ${Math.floor((uptimeMs % 60_000) / 1000)}s`,
          memory: {
            heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB`,
            heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(1)}MB`,
            rss: `${(memUsage.rss / 1024 / 1024).toFixed(1)}MB`,
          },
          tools: toolCount,
          caches: {
            docFetcher: docFetcher.getCacheStats(),
            searchEngine: searchEngine.getStats(),
          },
        };

        return formatResult(JSON.stringify(info, null, 2));
      } catch (error) {
        return formatError(error, 'diagnostics');
      }
    }
  );
  toolCount++;

  registeredToolCount = toolCount;

  // ==================== MCP Resources ====================

  server.resource(
    'frameworks',
    'augments://frameworks',
    async () => {
      const { getQueryParser } = await import('@/core');
      const parser = getQueryParser();
      const frameworks = parser.getKnownFrameworks();

      const content = [
        '# Supported Frameworks',
        '',
        'The following frameworks and packages are supported with curated documentation sources, type definitions, and optimized search:',
        '',
        ...frameworks.map((f) => {
          const pkg = parser.getPackageName(f);
          return `- **${f}**${pkg && pkg !== f ? ` (${pkg})` : ''}`;
        }),
        '',
        `Total: ${frameworks.length} frameworks`,
      ].join('\n');

      return {
        contents: [{
          uri: 'augments://frameworks',
          mimeType: 'text/markdown',
          text: content,
        }],
      };
    }
  );

  // Cache warming: kick off once on first request (non-blocking)
  if (!cacheWarmingStarted) {
    cacheWarmingStarted = true;
    logger.info('MCP Server initialized', {
      tools: toolCount,
      version: SERVER_VERSION,
    });
    warmPopularFrameworks().catch((error) => {
      logger.warn('Cache warming failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return server;
}

/**
 * Pre-fetch types for the most commonly queried frameworks.
 */
async function warmPopularFrameworks(): Promise<void> {
  const { getTypeFetcher } = await import('@/core');
  const typeFetcher = getTypeFetcher();

  const tier1Packages = [
    'react',
    'next',
    'vue',
    'zod',
    'express',
    '@prisma/client',
    '@tanstack/react-query',
    'react-dom',
  ];

  const tier2Packages = [
    'lodash',
    'axios',
    'zustand',
    'jotai',
    'drizzle-orm',
    'react-hook-form',
    'svelte',
    'fastify',
    'hono',
    'vitest',
    '@trpc/client',
    '@trpc/server',
  ];

  // Warm tier 1 in batches of 6 (I/O bound)
  const batchSize = 6;
  const totalTimeout = setTimeout(() => {
    logger.warn('Cache warming timed out after 30s');
  }, 30_000);

  try {
    for (let i = 0; i < tier1Packages.length; i += batchSize) {
      const batch = tier1Packages.slice(i, i + batchSize);
      await Promise.allSettled(
        batch.map((pkg) => typeFetcher.fetchTypes(pkg))
      );
    }

    for (let i = 0; i < tier2Packages.length; i += batchSize) {
      const batch = tier2Packages.slice(i, i + batchSize);
      await Promise.allSettled(
        batch.map((pkg) => typeFetcher.getPackageInfo(pkg))
      );
    }

    logger.info('Cache warming completed', {
      tier1: tier1Packages.length,
      tier2: tier2Packages.length,
    });
  } finally {
    clearTimeout(totalTimeout);
  }
}
