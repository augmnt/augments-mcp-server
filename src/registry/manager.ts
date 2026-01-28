/**
 * Framework Registry Manager
 *
 * Manages framework configurations loaded from JSON files.
 * Optimized for serverless environments - loads on first request and caches in memory.
 */

import { promises as fs } from 'fs';
import path from 'path';
import {
  type FrameworkConfig,
  type FrameworkInfo,
  type SearchResult,
  FrameworkConfigSchema,
} from '@/types';
import { validateFrameworkConfig, configToInfo, calculateSearchScore } from './models';
import { getLogger } from '@/utils/logger';

const logger = getLogger('registry-manager');

export class FrameworkRegistryManager {
  private frameworks: Map<string, FrameworkConfig> = new Map();
  private frameworksDir: string;
  private loaded: boolean = false;
  private loadPromise: Promise<void> | null = null;

  constructor(frameworksDir?: string) {
    // Default to frameworks directory relative to project root
    this.frameworksDir = frameworksDir || path.join(process.cwd(), 'frameworks');
  }

  /**
   * Initialize the registry by loading all framework configurations
   */
  async initialize(): Promise<void> {
    // Prevent multiple concurrent initialization attempts
    if (this.loadPromise) {
      return this.loadPromise;
    }

    if (this.loaded) {
      return;
    }

    this.loadPromise = this.loadAllFrameworks();
    await this.loadPromise;
    this.loaded = true;
    this.loadPromise = null;
  }

  /**
   * Load all framework configurations from the frameworks directory
   */
  private async loadAllFrameworks(): Promise<void> {
    this.frameworks.clear();

    try {
      await this.loadFrameworksRecursive(this.frameworksDir);
      logger.info('Framework registry initialized', {
        framework_count: this.frameworks.size,
      });
    } catch (error) {
      logger.error('Failed to load frameworks', {
        error: error instanceof Error ? error.message : String(error),
        dir: this.frameworksDir,
      });
      throw error;
    }
  }

  /**
   * Recursively load framework configs from directory
   */
  private async loadFrameworksRecursive(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await this.loadFrameworksRecursive(fullPath);
        } else if (entry.name.endsWith('.json')) {
          await this.loadFrameworkConfig(fullPath);
        }
      }
    } catch (error) {
      logger.warn('Failed to read directory', {
        dir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Load a single framework configuration from a JSON file
   */
  private async loadFrameworkConfig(configPath: string): Promise<FrameworkConfig | null> {
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const data = JSON.parse(content);

      const config = validateFrameworkConfig(data);
      if (!config) {
        logger.error('Invalid framework configuration', { file: configPath });
        return null;
      }

      this.frameworks.set(config.name, config);
      logger.debug('Loaded framework configuration', {
        framework: config.name,
        category: config.category,
        file: configPath,
      });

      return config;
    } catch (error) {
      logger.error('Failed to load framework config', {
        file: configPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get a framework configuration by name
   */
  getFramework(name: string): FrameworkConfig | undefined {
    return this.frameworks.get(name);
  }

  /**
   * List all frameworks, optionally filtered by category
   */
  listFrameworks(category?: string): FrameworkInfo[] {
    const frameworks: FrameworkInfo[] = [];

    for (const config of this.frameworks.values()) {
      if (category && config.category !== category) {
        continue;
      }

      frameworks.push(configToInfo(config));
    }

    // Sort by priority (higher first) then by name
    frameworks.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.name.localeCompare(b.name);
    });

    return frameworks;
  }

  /**
   * Search frameworks by query
   */
  searchFrameworks(query: string): SearchResult[] {
    // Sanitize and limit query length to prevent performance issues
    const sanitizedQuery = query.trim().slice(0, 200);
    if (sanitizedQuery.length === 0) {
      return [];
    }

    const results: SearchResult[] = [];

    for (const config of this.frameworks.values()) {
      const { score, matched_fields } = calculateSearchScore(config, sanitizedQuery);

      if (score > 0) {
        results.push({
          framework: configToInfo(config),
          relevance_score: score,
          matched_fields,
        });
      }
    }

    // Sort by relevance score (highest first)
    results.sort((a, b) => b.relevance_score - a.relevance_score);

    return results;
  }

  /**
   * Get all available framework categories
   */
  getCategories(): string[] {
    const categories = new Set<string>();

    for (const config of this.frameworks.values()) {
      categories.add(config.category);
    }

    return Array.from(categories).sort();
  }

  /**
   * Get total number of loaded frameworks
   */
  getFrameworkCount(): number {
    return this.frameworks.size;
  }

  /**
   * Check if the registry has been loaded
   */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Get all framework names
   */
  getFrameworkNames(): string[] {
    return Array.from(this.frameworks.keys());
  }
}

// Singleton instance for serverless environments
let registryInstance: FrameworkRegistryManager | null = null;

export async function getRegistry(): Promise<FrameworkRegistryManager> {
  if (!registryInstance) {
    registryInstance = new FrameworkRegistryManager();
    await registryInstance.initialize();
  }
  return registryInstance;
}
