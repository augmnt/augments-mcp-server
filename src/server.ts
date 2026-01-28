/**
 * Augments MCP Server
 *
 * A comprehensive MCP server that provides real-time access to framework documentation
 * and context to enhance Claude Code's ability to generate accurate, up-to-date code.
 *
 * v4: Query-focused context extraction with TypeScript definition parsing.
 *
 * Uses the official MCP SDK for Claude Code compatibility.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getRegistry, FrameworkRegistryManager } from '@/registry/manager';
import { getCache, KVCache } from '@/cache';
import { getGitHubProvider, GitHubProvider } from '@/providers/github';
import { getWebsiteProvider, WebsiteProvider } from '@/providers/website';
import {
  // Discovery tools
  listAvailableFrameworks,
  searchFrameworks,
  getFrameworkInfo,
  getRegistryStats,
  // Documentation tools
  getFrameworkDocs,
  getFrameworkExamples,
  searchDocumentation,
  // Context tools
  getFrameworkContext,
  analyzeCodeCompatibility,
  // Cache management tools
  checkFrameworkUpdates,
  refreshFrameworkCache,
  getCacheStats,
} from '@/tools';
// v4 Tools: Query-focused context extraction
import {
  getApiContext,
  formatApiContextResponse,
  searchApis,
  formatSearchApisResponse,
  getVersionInfo,
  formatVersionInfoResponse,
} from '@/tools/v4';
import { FrameworkCategories } from '@/types';
import { getLogger } from '@/utils/logger';

const logger = getLogger('mcp-server');

// Server version
export const SERVER_VERSION = '4.0.0';

// Singleton instance for serverless environments
let serverInstance: McpServer | null = null;

// Dependencies (cached)
let registry: FrameworkRegistryManager | null = null;
let cache: KVCache | null = null;
let githubProvider: GitHubProvider | null = null;
let websiteProvider: WebsiteProvider | null = null;

/**
 * Initialize dependencies
 */
async function initializeDependencies(): Promise<{
  registry: FrameworkRegistryManager;
  cache: KVCache;
  githubProvider: GitHubProvider;
  websiteProvider: WebsiteProvider;
}> {
  if (!registry) {
    registry = await getRegistry();
  }
  if (!cache) {
    cache = getCache();
  }
  if (!githubProvider) {
    githubProvider = getGitHubProvider();
  }
  if (!websiteProvider) {
    websiteProvider = getWebsiteProvider();
  }

  return { registry, cache, githubProvider, websiteProvider };
}

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
 * Format error result for MCP response
 */
function formatError(error: unknown): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Get the MCP server instance, creating it if necessary
 */
export async function getServer(): Promise<McpServer> {
  if (serverInstance) {
    return serverInstance;
  }

  logger.info('Initializing Augments MCP Server', { version: SERVER_VERSION });

  // Initialize dependencies
  const deps = await initializeDependencies();

  logger.info('Dependencies initialized', {
    frameworks: deps.registry.getFrameworkCount(),
    categories: deps.registry.getCategories(),
  });

  // Create SDK McpServer
  const server = new McpServer({
    name: 'augments-mcp-server',
    version: SERVER_VERSION,
  });

  // ==================== Discovery Tools ====================

  server.tool(
    'list_available_frameworks',
    'List all available frameworks, optionally filtered by category. Returns framework information including name, category, and description.',
    {
      category: z.enum(FrameworkCategories).optional().describe('Filter by framework category'),
    },
    async ({ category }) => {
      try {
        const result = await listAvailableFrameworks(deps.registry, { category });
        return formatResult(result);
      } catch (error) {
        logger.error('Tool execution failed', { tool: 'list_available_frameworks', error });
        return formatError(error);
      }
    }
  );

  server.tool(
    'search_frameworks',
    'Search for frameworks by name, keyword, or feature. Returns a ranked list of matching frameworks with relevance scores.',
    {
      query: z.string().min(1).describe('Search query'),
    },
    async ({ query }) => {
      try {
        const result = await searchFrameworks(deps.registry, { query });
        return formatResult(result);
      } catch (error) {
        logger.error('Tool execution failed', { tool: 'search_frameworks', error });
        return formatError(error);
      }
    }
  );

  server.tool(
    'get_framework_info',
    'Get detailed information about a specific framework including sources, features, and patterns.',
    {
      framework: z.string().min(1).describe('Framework name'),
    },
    async ({ framework }) => {
      try {
        const result = await getFrameworkInfo(deps.registry, { framework });
        return formatResult(result);
      } catch (error) {
        logger.error('Tool execution failed', { tool: 'get_framework_info', error });
        return formatError(error);
      }
    }
  );

  server.tool(
    'get_registry_stats',
    'Get statistics about the framework registry including total frameworks and categories.',
    {},
    async () => {
      try {
        const result = await getRegistryStats(deps.registry);
        return formatResult(result);
      } catch (error) {
        logger.error('Tool execution failed', { tool: 'get_registry_stats', error });
        return formatError(error);
      }
    }
  );

  // ==================== Documentation Tools ====================

  server.tool(
    'get_framework_docs',
    'Retrieve comprehensive documentation for a specific framework. Fetches from GitHub or official documentation.',
    {
      framework: z.string().min(1).describe('Framework name'),
      section: z.string().optional().describe('Specific documentation section'),
      use_cache: z.boolean().default(true).describe('Whether to use cached documentation'),
    },
    async ({ framework, section, use_cache }) => {
      try {
        const result = await getFrameworkDocs(deps.registry, deps.cache, deps.githubProvider, deps.websiteProvider, {
          framework,
          section,
          use_cache: use_cache ?? true,
        });
        return formatResult(result);
      } catch (error) {
        logger.error('Tool execution failed', { tool: 'get_framework_docs', error });
        return formatError(error);
      }
    }
  );

  server.tool(
    'get_framework_examples',
    'Get code examples for specific patterns within a framework.',
    {
      framework: z.string().min(1).describe('Framework name'),
      pattern: z.string().optional().describe('Specific pattern to get examples for'),
    },
    async ({ framework, pattern }) => {
      try {
        const result = await getFrameworkExamples(deps.registry, deps.cache, deps.githubProvider, deps.websiteProvider, {
          framework,
          pattern,
        });
        return formatResult(result);
      } catch (error) {
        logger.error('Tool execution failed', { tool: 'get_framework_examples', error });
        return formatError(error);
      }
    }
  );

  server.tool(
    'search_documentation',
    "Search within a framework's documentation for specific topics or keywords.",
    {
      framework: z.string().min(1).describe('Framework name'),
      query: z.string().min(1).describe('Search query'),
      limit: z.number().min(1).max(50).default(10).describe('Maximum number of results'),
    },
    async ({ framework, query, limit }) => {
      try {
        const result = await searchDocumentation(deps.registry, deps.cache, deps.githubProvider, deps.websiteProvider, {
          framework,
          query,
          limit: limit ?? 10,
        });
        return formatResult(result);
      } catch (error) {
        logger.error('Tool execution failed', { tool: 'search_documentation', error });
        return formatError(error);
      }
    }
  );

  // ==================== Context Enhancement Tools ====================

  server.tool(
    'get_framework_context',
    'Get relevant context for multiple frameworks based on the development task. Combines documentation, patterns, and best practices.',
    {
      frameworks: z.array(z.string().min(1)).min(1).describe('List of framework names'),
      task_description: z.string().min(1).describe('Description of the development task'),
    },
    async ({ frameworks, task_description }) => {
      try {
        const result = await getFrameworkContext(deps.registry, deps.cache, { frameworks, task_description });
        return formatResult(result);
      } catch (error) {
        logger.error('Tool execution failed', { tool: 'get_framework_context', error });
        return formatError(error);
      }
    }
  );

  server.tool(
    'analyze_code_compatibility',
    'Analyze code for framework compatibility and suggest improvements.',
    {
      code: z.string().min(1).describe('Code to analyze'),
      frameworks: z.array(z.string().min(1)).min(1).describe('List of frameworks to check compatibility with'),
    },
    async ({ code, frameworks }) => {
      try {
        const result = await analyzeCodeCompatibility(deps.registry, { code, frameworks });
        return formatResult(result);
      } catch (error) {
        logger.error('Tool execution failed', { tool: 'analyze_code_compatibility', error });
        return formatError(error);
      }
    }
  );

  // ==================== Cache Management Tools ====================

  server.tool(
    'check_framework_updates',
    'Check if framework documentation has been updated since last cache.',
    {
      framework: z.string().min(1).describe('Framework name'),
    },
    async ({ framework }) => {
      try {
        const result = await checkFrameworkUpdates(deps.registry, deps.cache, deps.githubProvider, { framework });
        return formatResult(result);
      } catch (error) {
        logger.error('Tool execution failed', { tool: 'check_framework_updates', error });
        return formatError(error);
      }
    }
  );

  server.tool(
    'refresh_framework_cache',
    'Refresh cached documentation for frameworks.',
    {
      framework: z.string().optional().describe('Framework name (optional, refreshes all if not specified)'),
      force: z.boolean().default(false).describe('Force refresh even if cache is valid'),
    },
    async ({ framework, force }) => {
      try {
        const result = await refreshFrameworkCache(deps.registry, deps.cache, deps.githubProvider, deps.websiteProvider, {
          framework,
          force: force ?? false,
        });
        return formatResult(result);
      } catch (error) {
        logger.error('Tool execution failed', { tool: 'refresh_framework_cache', error });
        return formatError(error);
      }
    }
  );

  server.tool(
    'get_cache_stats',
    'Get detailed cache statistics and performance metrics.',
    {},
    async () => {
      try {
        const result = await getCacheStats(deps.registry, deps.cache);
        return formatResult(result);
      } catch (error) {
        logger.error('Tool execution failed', { tool: 'get_cache_stats', error });
        return formatError(error);
      }
    }
  );

  // ==================== v4 API Context Tools ====================

  server.tool(
    'get_api_context',
    'Get minimal, accurate API context for a natural language query. Fetches TypeScript definitions and extracts relevant signatures. Returns focused context optimized for LLMs.',
    {
      query: z.string().min(1).describe('Natural language query (e.g., "useEffect cleanup" or "prisma findMany")'),
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
        return formatError(error);
      }
    }
  );

  server.tool(
    'search_apis',
    'Search for APIs across frameworks by name or keyword. Returns ranked results with signatures and relevance scores.',
    {
      query: z.string().min(1).describe('Search query (e.g., "state management hook")'),
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
        return formatError(error);
      }
    }
  );

  server.tool(
    'get_version_info',
    'Get version information for a framework/package including available versions, dist-tags, and breaking change detection.',
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
        return formatError(error);
      }
    }
  );

  logger.info('MCP Server initialized successfully', {
    tools: 15,
    version: SERVER_VERSION,
  });

  serverInstance = server;
  return server;
}
