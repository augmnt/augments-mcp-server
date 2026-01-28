/**
 * Augments MCP Server
 *
 * Main entry point for the TypeScript MCP server.
 * Provides real-time framework documentation access for AI assistants.
 *
 * v4: Query-focused context extraction with TypeScript definition parsing.
 */

export { getServer, SERVER_VERSION } from './server';
export { getRegistry, FrameworkRegistryManager } from './registry/manager';
export { getCache, KVCache } from './cache';
export { getGitHubProvider, GitHubProvider } from './providers/github';
export { getWebsiteProvider, WebsiteProvider } from './providers/website';

// v4 Core modules
export * from './core';

// v4 Tools
export * from './tools/v4';

// Re-export types
export * from './types';
