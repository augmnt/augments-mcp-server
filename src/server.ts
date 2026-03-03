/**
 * Augments MCP Server
 *
 * A comprehensive MCP server that provides real-time access to framework documentation
 * and context to enhance Claude Code's ability to generate accurate, up-to-date code.
 *
 * v5: Types + prose + examples with context-aware formatting for any npm package.
 * Consolidated to 3 tools for optimal LLM tool-use decisions.
 *
 * Uses the official MCP SDK for Claude Code compatibility.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
// v4 Tools: Query-focused context extraction
import {
  getApiContext,
  formatApiContextResponse,
  searchApis,
  formatSearchApisResponse,
  getVersionInfo,
  formatVersionInfoResponse,
} from '@/tools/v4';
import { getLogger } from '@/utils/logger';

const logger = getLogger('mcp-server');

// Server version
export const SERVER_VERSION = '5.0.0';

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

  // Add recovery suggestions for common errors
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
 * Create a fresh MCP server instance per request.
 *
 * McpServer.connect() binds the server to a single transport and cannot be
 * called again without closing first. In a stateless serverless environment
 * each request needs its own server+transport pair. Tool registration is
 * just attaching handler functions — very cheap.
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
    'Get version info, available versions, and breaking change detection for any npm package.',
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

  registeredToolCount = toolCount;

  // Cache warming: kick off once on first request (non-blocking)
  if (!cacheWarmingStarted) {
    cacheWarmingStarted = true;
    logger.info('MCP Server initialized, starting cache warming', {
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
 * Runs in the background after server initialization to eliminate cold-start latency.
 */
async function warmPopularFrameworks(): Promise<void> {
  const { getTypeFetcher } = await import('@/core');
  const typeFetcher = getTypeFetcher();

  // Tier 1: Full type warming (types + npm metadata)
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

  // Tier 2: Metadata-only warming (npm metadata for faster first use)
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

  // Warm tier 1 in batches of 4
  const batchSize = 4;
  for (let i = 0; i < tier1Packages.length; i += batchSize) {
    const batch = tier1Packages.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map((pkg) => typeFetcher.fetchTypes(pkg))
    );
  }

  // Warm tier 2 with metadata only (getPackageInfo is much cheaper)
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
}
