/**
 * Environment configuration for Augments MCP Server
 */

export interface Config {
  env: 'development' | 'production' | 'test';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export function getConfig(): Config {
  const env = (process.env.NODE_ENV || 'development') as Config['env'];

  return {
    env,
    logLevel: (process.env.LOG_LEVEL || (env === 'production' ? 'info' : 'debug')) as Config['logLevel'],
  };
}

export const config = getConfig();
