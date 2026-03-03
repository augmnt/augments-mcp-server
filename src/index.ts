/**
 * Augments MCP Server
 *
 * Main entry point for the TypeScript MCP server.
 * Provides real-time framework documentation access for AI assistants.
 *
 * v5: Types + prose + examples with context-aware formatting for any npm package.
 */

export { getServer, SERVER_VERSION } from './server';

// v4 Core modules
export * from './core';

// v4 Tools
export * from './tools/v4';
