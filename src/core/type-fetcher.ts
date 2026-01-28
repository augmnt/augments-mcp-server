/**
 * TypeScript Definition Fetcher
 *
 * Fetches .d.ts files from npm packages directly.
 * Supports version-specific fetching for accurate API signatures.
 */

import { getLogger } from '@/utils/logger';

const logger = getLogger('type-fetcher');

// npm registry endpoints
const NPM_REGISTRY = 'https://registry.npmjs.org';
const UNPKG_CDN = 'https://unpkg.com';
const JSDELIVR_CDN = 'https://cdn.jsdelivr.net/npm';

/**
 * Package metadata from npm registry
 */
export interface NpmPackageInfo {
  name: string;
  version: string;
  description?: string;
  types?: string;
  typings?: string;
  main?: string;
  module?: string;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  'dist-tags': {
    latest: string;
    next?: string;
    beta?: string;
    [tag: string]: string | undefined;
  };
  versions: Record<string, NpmVersionInfo>;
}

export interface NpmVersionInfo {
  name: string;
  version: string;
  description?: string;
  types?: string;
  typings?: string;
  main?: string;
  module?: string;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  dist: {
    tarball: string;
    shasum: string;
  };
}

/**
 * Fetched type definition result
 */
export interface TypeDefinitionResult {
  packageName: string;
  version: string;
  content: string;
  filePath: string;
  source: 'bundled' | 'definitely-typed';
  fetchedAt: number;
}

/**
 * Type fetcher for retrieving TypeScript definitions from npm
 */
export class TypeFetcher {
  private cache: Map<string, TypeDefinitionResult> = new Map();
  private packageInfoCache: Map<string, NpmPackageInfo> = new Map();
  private readonly CACHE_TTL = 3600 * 1000; // 1 hour

  /**
   * Fetch package metadata from npm registry
   */
  async getPackageInfo(packageName: string): Promise<NpmPackageInfo | null> {
    // Check cache
    const cached = this.packageInfoCache.get(packageName);
    if (cached) {
      return cached;
    }

    try {
      const url = `${NPM_REGISTRY}/${encodeURIComponent(packageName)}`;
      logger.debug('Fetching package info', { packageName, url });

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          logger.debug('Package not found', { packageName });
          return null;
        }
        throw new Error(`npm registry returned ${response.status}`);
      }

      const data = (await response.json()) as NpmPackageInfo;
      this.packageInfoCache.set(packageName, data);
      return data;
    } catch (error) {
      logger.error('Failed to fetch package info', {
        packageName,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get available versions for a package
   */
  async getVersions(packageName: string): Promise<{
    latest: string;
    versions: string[];
    tags: Record<string, string>;
  } | null> {
    const info = await this.getPackageInfo(packageName);
    if (!info) return null;

    const versions = Object.keys(info.versions).sort((a, b) => {
      // Sort by semver descending
      return this.compareSemver(b, a);
    });

    return {
      latest: info['dist-tags'].latest,
      versions,
      tags: info['dist-tags'] as Record<string, string>,
    };
  }

  /**
   * Fetch TypeScript definitions for a package
   */
  async fetchTypes(
    packageName: string,
    version?: string
  ): Promise<TypeDefinitionResult | null> {
    // Resolve version
    const resolvedVersion = await this.resolveVersion(packageName, version);
    if (!resolvedVersion) {
      logger.debug('Could not resolve version', { packageName, version });
      return null;
    }

    // Check cache
    const cacheKey = `${packageName}@${resolvedVersion}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < this.CACHE_TTL) {
      logger.debug('Cache hit', { cacheKey });
      return cached;
    }

    // Check if package has bundled types
    const packageInfo = await this.getPackageInfo(packageName);
    const versionInfo = packageInfo?.versions[resolvedVersion];

    if (versionInfo?.types || versionInfo?.typings) {
      const result = await this.fetchBundledTypes(packageName, resolvedVersion, versionInfo);
      if (result) {
        this.cache.set(cacheKey, result);
        return result;
      }
    }

    // Try @types package
    const typesPackageName = `@types/${this.normalizePackageName(packageName)}`;
    const typesResult = await this.fetchDefinitelyTypedTypes(typesPackageName, resolvedVersion);
    if (typesResult) {
      this.cache.set(cacheKey, typesResult);
      return typesResult;
    }

    logger.debug('No types found', { packageName, version: resolvedVersion });
    return null;
  }

  /**
   * Fetch bundled TypeScript definitions from a package
   */
  private async fetchBundledTypes(
    packageName: string,
    version: string,
    versionInfo: NpmVersionInfo
  ): Promise<TypeDefinitionResult | null> {
    const typesPath = versionInfo.types || versionInfo.typings;
    if (!typesPath) return null;

    try {
      // Try unpkg first (faster)
      const url = `${UNPKG_CDN}/${packageName}@${version}/${typesPath}`;
      logger.debug('Fetching bundled types', { url });

      const response = await fetch(url);
      if (!response.ok) {
        // Try jsdelivr as fallback
        const jsdelivrUrl = `${JSDELIVR_CDN}/${packageName}@${version}/${typesPath}`;
        const jsdelivrResponse = await fetch(jsdelivrUrl);
        if (!jsdelivrResponse.ok) {
          return null;
        }
        const content = await jsdelivrResponse.text();
        return {
          packageName,
          version,
          content,
          filePath: typesPath,
          source: 'bundled',
          fetchedAt: Date.now(),
        };
      }

      const content = await response.text();
      return {
        packageName,
        version,
        content,
        filePath: typesPath,
        source: 'bundled',
        fetchedAt: Date.now(),
      };
    } catch (error) {
      logger.error('Failed to fetch bundled types', {
        packageName,
        version,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Fetch types from DefinitelyTyped (@types packages)
   */
  private async fetchDefinitelyTypedTypes(
    typesPackageName: string,
    originalVersion: string
  ): Promise<TypeDefinitionResult | null> {
    try {
      // Get @types package info
      const info = await this.getPackageInfo(typesPackageName);
      if (!info) return null;

      // Find the best matching version for @types
      const typesVersion = this.findBestTypesVersion(info, originalVersion);
      if (!typesVersion) return null;

      const versionInfo = info.versions[typesVersion];
      const typesPath = versionInfo.types || versionInfo.typings || 'index.d.ts';

      // Fetch the types file
      const url = `${UNPKG_CDN}/${typesPackageName}@${typesVersion}/${typesPath}`;
      logger.debug('Fetching DefinitelyTyped types', { url });

      const response = await fetch(url);
      if (!response.ok) {
        // Try jsdelivr as fallback
        const jsdelivrUrl = `${JSDELIVR_CDN}/${typesPackageName}@${typesVersion}/${typesPath}`;
        const jsdelivrResponse = await fetch(jsdelivrUrl);
        if (!jsdelivrResponse.ok) {
          return null;
        }
        const content = await jsdelivrResponse.text();
        return {
          packageName: typesPackageName,
          version: typesVersion,
          content,
          filePath: typesPath,
          source: 'definitely-typed',
          fetchedAt: Date.now(),
        };
      }

      const content = await response.text();
      return {
        packageName: typesPackageName,
        version: typesVersion,
        content,
        filePath: typesPath,
        source: 'definitely-typed',
        fetchedAt: Date.now(),
      };
    } catch (error) {
      logger.error('Failed to fetch DefinitelyTyped types', {
        typesPackageName,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Resolve version string to actual version
   */
  private async resolveVersion(
    packageName: string,
    version?: string
  ): Promise<string | null> {
    const info = await this.getPackageInfo(packageName);
    if (!info) return null;

    if (!version || version === 'latest') {
      return info['dist-tags'].latest;
    }

    // Check if it's a dist-tag
    if (info['dist-tags'][version]) {
      return info['dist-tags'][version];
    }

    // Check if it's an exact version
    if (info.versions[version]) {
      return version;
    }

    // Try to find best matching version
    return this.findBestMatchingVersion(Object.keys(info.versions), version);
  }

  /**
   * Find best matching version for a version range/prefix
   */
  private findBestMatchingVersion(
    versions: string[],
    requested: string
  ): string | null {
    // Extract major version if format is like "19" or "19.0"
    const majorMatch = requested.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
    if (majorMatch) {
      const [, major, minor] = majorMatch;
      const prefix = minor ? `${major}.${minor}` : major;

      // Find latest version matching this prefix
      const matching = versions
        .filter((v) => v.startsWith(`${prefix}.`) || v === requested)
        .sort((a, b) => this.compareSemver(b, a));

      if (matching.length > 0) {
        return matching[0];
      }
    }

    // Try caret range (^version)
    if (requested.startsWith('^')) {
      const base = requested.slice(1);
      const baseParts = base.split('.').map(Number);
      const matching = versions
        .filter((v) => this.satisfiesCaret(v, baseParts))
        .sort((a, b) => this.compareSemver(b, a));

      if (matching.length > 0) {
        return matching[0];
      }
    }

    return null;
  }

  /**
   * Find the best @types version for a given package version
   */
  private findBestTypesVersion(
    typesInfo: NpmPackageInfo,
    originalVersion: string
  ): string | null {
    const versions = Object.keys(typesInfo.versions);

    // Extract major.minor from original version
    const match = originalVersion.match(/^(\d+)\.(\d+)/);
    if (!match) {
      return typesInfo['dist-tags'].latest;
    }

    const [, major, minor] = match;

    // Look for exact major.minor match
    const exactMatch = versions.find(
      (v) => v.startsWith(`${major}.${minor}.`)
    );
    if (exactMatch) return exactMatch;

    // Look for same major version
    const majorMatch = versions
      .filter((v) => v.startsWith(`${major}.`))
      .sort((a, b) => this.compareSemver(b, a));
    if (majorMatch.length > 0) return majorMatch[0];

    // Fall back to latest
    return typesInfo['dist-tags'].latest;
  }

  /**
   * Normalize package name for @types lookup
   */
  private normalizePackageName(name: string): string {
    // @scope/package -> scope__package
    if (name.startsWith('@')) {
      return name.slice(1).replace('/', '__');
    }
    return name;
  }

  /**
   * Compare two semver versions (returns positive if a > b)
   */
  private compareSemver(a: string, b: string): number {
    const parseVersion = (v: string) => {
      const match = v.match(/^(\d+)\.(\d+)\.(\d+)/);
      if (!match) return [0, 0, 0];
      return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
    };

    const [aMajor, aMinor, aPatch] = parseVersion(a);
    const [bMajor, bMinor, bPatch] = parseVersion(b);

    if (aMajor !== bMajor) return aMajor - bMajor;
    if (aMinor !== bMinor) return aMinor - bMinor;
    return aPatch - bPatch;
  }

  /**
   * Check if version satisfies caret range
   */
  private satisfiesCaret(version: string, baseParts: number[]): boolean {
    const vParts = version.split('.').map(Number);
    const [baseMajor, baseMinor = 0, basePatch = 0] = baseParts;
    const [vMajor, vMinor = 0, vPatch = 0] = vParts;

    if (baseMajor === 0) {
      // ^0.x.y is more restrictive
      if (baseMinor === 0) {
        return vMajor === 0 && vMinor === 0 && vPatch >= basePatch;
      }
      return vMajor === 0 && vMinor === baseMinor && vPatch >= basePatch;
    }

    return (
      vMajor === baseMajor &&
      (vMinor > baseMinor || (vMinor === baseMinor && vPatch >= basePatch))
    );
  }

  /**
   * Fetch multiple type definition files for a package
   */
  async fetchAllTypes(
    packageName: string,
    version?: string
  ): Promise<TypeDefinitionResult[]> {
    const results: TypeDefinitionResult[] = [];

    // Get main types
    const mainTypes = await this.fetchTypes(packageName, version);
    if (mainTypes) {
      results.push(mainTypes);
    }

    // For some packages, fetch additional type files
    const additionalFiles = await this.getAdditionalTypeFiles(packageName, version);
    for (const filePath of additionalFiles) {
      const result = await this.fetchSpecificTypeFile(packageName, version, filePath);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Get list of additional type files to fetch
   */
  private async getAdditionalTypeFiles(
    packageName: string,
    version?: string
  ): Promise<string[]> {
    // Common patterns for React-like libraries
    const commonFiles: Record<string, string[]> = {
      react: [
        'index.d.ts',
        'experimental.d.ts',
        'jsx-runtime.d.ts',
        'jsx-dev-runtime.d.ts',
      ],
      'react-dom': ['index.d.ts', 'client.d.ts', 'server.d.ts'],
      next: ['index.d.ts', 'app.d.ts', 'navigation.d.ts', 'server.d.ts'],
    };

    // Normalize package name for lookup
    const normalizedName = packageName.replace('@types/', '');
    return commonFiles[normalizedName] || [];
  }

  /**
   * Fetch a specific type file from a package
   */
  private async fetchSpecificTypeFile(
    packageName: string,
    version: string | undefined,
    filePath: string
  ): Promise<TypeDefinitionResult | null> {
    const resolvedVersion = await this.resolveVersion(packageName, version);
    if (!resolvedVersion) return null;

    try {
      const url = `${UNPKG_CDN}/${packageName}@${resolvedVersion}/${filePath}`;
      const response = await fetch(url);

      if (!response.ok) return null;

      const content = await response.text();
      return {
        packageName,
        version: resolvedVersion,
        content,
        filePath,
        source: 'bundled',
        fetchedAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
    this.packageInfoCache.clear();
    logger.debug('Cache cleared');
  }
}

// Singleton instance
let instance: TypeFetcher | null = null;

export function getTypeFetcher(): TypeFetcher {
  if (!instance) {
    instance = new TypeFetcher();
  }
  return instance;
}
