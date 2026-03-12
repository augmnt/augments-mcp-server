/**
 * Structured logging utility for Augments MCP Server
 */

import { config } from '@/config';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private minLevel: number;
  private name: string;

  constructor(name: string) {
    this.name = name;
    this.minLevel = LOG_LEVELS[config.logLevel];
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= this.minLevel;
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';

    if (config.env === 'production') {
      // JSON format for production (log aggregators)
      return JSON.stringify({
        timestamp,
        level,
        logger: this.name,
        message,
        ...context,
      });
    }

    // Human-readable format for development
    return `[${timestamp}] ${level.toUpperCase().padEnd(5)} [${this.name}] ${message}${contextStr}`;
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      process.stderr.write(this.formatMessage('debug', message, context) + '\n');
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      process.stderr.write(this.formatMessage('info', message, context) + '\n');
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog('warn')) {
      process.stderr.write(this.formatMessage('warn', message, context) + '\n');
    }
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog('error')) {
      process.stderr.write(this.formatMessage('error', message, context) + '\n');
    }
  }
}

// Logger factory
const loggers: Map<string, Logger> = new Map();

export function getLogger(name: string): Logger {
  if (!loggers.has(name)) {
    loggers.set(name, new Logger(name));
  }
  return loggers.get(name)!;
}

// Default logger
export const logger = getLogger('augments-mcp');
