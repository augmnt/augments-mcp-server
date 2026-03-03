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

// Fetch timeouts (ms) — prevents hung upstreams from blocking the server
const NPM_TIMEOUT = 10_000; // 10s for npm registry
const CDN_TIMEOUT = 8_000;  // 8s for CDN (unpkg, jsdelivr)

/**
 * Alternative type file paths for packages with non-standard structures
 */
const ALTERNATIVE_TYPE_PATHS: Record<string, string[]> = {
  '@tanstack/react-query': ['build/modern/index.d.ts', 'dist/index.d.ts', 'build/legacy/index.d.ts'],
  '@trpc/client': ['dist/index.d.ts', 'dist/client.d.ts'],
  '@trpc/server': ['dist/index.d.ts'],
  '@supabase/supabase-js': ['dist/module/index.d.ts', 'dist/main/index.d.ts', 'dist/index.d.ts'],
  'lodash': ['index.d.ts', 'lodash.d.ts'],
  'lodash-es': ['index.d.ts'],
  'framer-motion': ['dist/types/index.d.ts', 'dist/index.d.ts'],
  'react-hook-form': ['dist/index.d.ts', 'dist/types.d.ts'],
  'styled-components': ['dist/index.d.ts'],
  '@emotion/react': ['dist/emotion-react.cjs.d.ts', 'types/index.d.ts'],
  'zod': ['index.d.ts', 'lib/index.d.ts'],
  'axios': ['index.d.ts', 'index.d.cts'],
  'zustand': ['esm/index.d.mts', 'index.d.ts'],
  'jotai': ['esm/index.d.ts', 'index.d.ts'],
  'drizzle-orm': ['index.d.ts', 'pg-core/index.d.ts', 'mysql-core/index.d.ts'],
  'svelte': ['types/index.d.ts', 'index.d.ts'],
  'hono': ['dist/types/index.d.ts', 'dist/index.d.ts'],
  'fastify': ['types/index.d.ts', 'fastify.d.ts'],
  'vitest': ['dist/index.d.ts', 'index.d.ts'],
  'next-auth': ['index.d.ts', 'src/index.ts'],
};

/**
 * Packages that use barrel exports - need to fetch specific sub-modules
 * Maps package name to an array of sub-module paths to fetch for specific concepts
 */
const BARREL_EXPORT_MODULES: Record<string, Record<string, string[]>> = {
  'react-hook-form': {
    useform: ['dist/useForm.d.ts'],
    usecontroller: ['dist/useController.d.ts'],
    usefieldarray: ['dist/useFieldArray.d.ts'],
    useformcontext: ['dist/useFormContext.d.ts'],
    usewatch: ['dist/useWatch.d.ts'],
    useformstate: ['dist/useFormState.d.ts'],
  },
  '@tanstack/react-query': {
    usequery: ['build/modern/useQuery.d.ts', 'src/useQuery.ts'],
    usemutation: ['build/modern/useMutation.d.ts'],
    useinfinitequery: ['build/modern/useInfiniteQuery.d.ts'],
    usesuspensequery: ['build/modern/useSuspenseQuery.d.ts'],
  },
  zustand: {
    create: ['esm/react.d.mts', 'esm/index.d.mts'],
    createstore: ['esm/vanilla.d.mts', 'esm/vanilla/store.d.mts'],
  },
  jotai: {
    atom: ['esm/vanilla.d.ts', 'esm/index.d.ts'],
    useatomvalue: ['esm/react.d.ts'],
    usesetatom: ['esm/react.d.ts'],
  },
  '@trpc/server': {
    inittrpc: ['dist/index.d.ts', 'dist/unstable-core-do-not-import/initTRPC.d.ts'],
    router: ['dist/index.d.ts'],
    procedure: ['dist/index.d.ts'],
  },
  '@trpc/client': {
    createtrpcclient: ['dist/index.d.ts', 'dist/createTRPCClient.d.ts'],
  },
  'drizzle-orm': {
    pgtable: ['pg-core/index.d.ts', 'pg-core/table.d.ts'],
    mysqltable: ['mysql-core/index.d.ts', 'mysql-core/table.d.ts'],
    sqlitetable: ['sqlite-core/index.d.ts', 'sqlite-core/table.d.ts'],
  },
  next: {
    userouter: ['dist/client/components/navigation.d.ts', 'navigation.d.ts'],
    usepathname: ['dist/client/components/navigation.d.ts', 'navigation.d.ts'],
    usesearchparams: ['dist/client/components/navigation.d.ts', 'navigation.d.ts'],
  },
};

/**
 * Abbreviated package metadata from npm registry (install-v1 format)
 * Uses the Accept: application/vnd.npm.install-v1+json header
 * to fetch only essential metadata (~5-50KB instead of 2-10MB)
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

/**
 * Cached package info with timestamp for TTL
 */
interface CachedPackageInfo {
  data: NpmPackageInfo;
  fetchedAt: number;
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
  private packageInfoCache: Map<string, CachedPackageInfo> = new Map();
  private inFlightRequests: Map<string, Promise<NpmPackageInfo | null>> = new Map();
  private inFlightTypeRequests: Map<string, Promise<TypeDefinitionResult | null>> = new Map();
  private readonly CACHE_TTL = 3600 * 1000; // 1 hour
  private readonly PACKAGE_INFO_TTL = 1800 * 1000; // 30 minutes

  /**
   * Fetch with retry and backoff — only for npm registry calls
   * (CDN calls already have redundancy via fetchFromCdn racing)
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    retries: number = 1,
    backoffMs: number = 1500
  ): Promise<Response> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, options);
        // Retry on 5xx server errors
        if (response.status >= 500 && attempt < retries) {
          logger.debug('Registry 5xx, retrying', { url, status: response.status, attempt });
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < retries) {
          logger.debug('Registry fetch failed, retrying', { url, attempt, error: lastError.message });
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }
    throw lastError || new Error(`Failed to fetch ${url} after ${retries + 1} attempts`);
  }

  /**
   * Fetch package metadata from npm registry using abbreviated metadata endpoint
   */
  async getPackageInfo(packageName: string): Promise<NpmPackageInfo | null> {
    // Check cache with TTL
    const cached = this.packageInfoCache.get(packageName);
    if (cached && Date.now() - cached.fetchedAt < this.PACKAGE_INFO_TTL) {
      return cached.data;
    }

    // Check for in-flight request (deduplication)
    const inFlight = this.inFlightRequests.get(packageName);
    if (inFlight) {
      logger.debug('Awaiting in-flight request', { packageName });
      return inFlight;
    }

    // Create the request and store it for deduplication
    const request = this.fetchPackageInfo(packageName);
    this.inFlightRequests.set(packageName, request);

    try {
      const result = await request;
      return result;
    } finally {
      this.inFlightRequests.delete(packageName);
    }
  }

  /**
   * Internal method to fetch package info from npm
   */
  private async fetchPackageInfo(packageName: string): Promise<NpmPackageInfo | null> {
    try {
      const url = `${NPM_REGISTRY}/${encodeURIComponent(packageName)}`;
      logger.debug('Fetching package info (abbreviated)', { packageName, url });

      const response = await this.fetchWithRetry(url, {
        headers: {
          // Use abbreviated metadata to reduce payload from 2-10MB to 5-50KB
          Accept: 'application/vnd.npm.install-v1+json',
        },
        signal: AbortSignal.timeout(NPM_TIMEOUT),
      });

      if (!response.ok) {
        if (response.status === 404) {
          logger.debug('Package not found', { packageName });
          return null;
        }
        throw new Error(`npm registry returned ${response.status}`);
      }

      let data: NpmPackageInfo;
      try {
        data = (await response.json()) as NpmPackageInfo;
      } catch {
        logger.error('Failed to parse npm registry JSON', { packageName });
        return null;
      }
      this.packageInfoCache.set(packageName, { data, fetchedAt: Date.now() });
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
   * Fetch version-specific package info for types/typings fields
   */
  async getVersionSpecificInfo(packageName: string, version: string): Promise<NpmVersionInfo | null> {
    try {
      const url = `${NPM_REGISTRY}/${encodeURIComponent(packageName)}/${version}`;
      logger.debug('Fetching version-specific info', { packageName, version, url });

      const response = await this.fetchWithRetry(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(NPM_TIMEOUT),
      });

      if (!response.ok) return null;
      try {
        return (await response.json()) as NpmVersionInfo;
      } catch {
        logger.error('Failed to parse version-specific JSON', { packageName, version });
        return null;
      }
    } catch {
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
   * Fetch TypeScript definitions for a package (with request deduplication)
   */
  async fetchTypes(
    packageName: string,
    version?: string
  ): Promise<TypeDefinitionResult | null> {
    // Build a dedup key from the inputs (version may be undefined → 'latest')
    const dedupKey = `${packageName}@${version ?? 'latest'}`;

    // Check for in-flight request (deduplication)
    const inFlight = this.inFlightTypeRequests.get(dedupKey);
    if (inFlight) {
      logger.debug('Awaiting in-flight type request', { packageName, version });
      return inFlight;
    }

    const request = this.fetchTypesInternal(packageName, version);
    this.inFlightTypeRequests.set(dedupKey, request);

    try {
      return await request;
    } finally {
      this.inFlightTypeRequests.delete(dedupKey);
    }
  }

  /**
   * Internal method: Fetch TypeScript definitions for a package
   */
  private async fetchTypesInternal(
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
    // First try abbreviated metadata, then fall back to version-specific endpoint
    const packageInfo = await this.getPackageInfo(packageName);
    let versionInfo = packageInfo?.versions[resolvedVersion];

    // Abbreviated metadata may not include types/typings fields - fetch version-specific if needed
    if (versionInfo && !versionInfo.types && !versionInfo.typings) {
      const specificInfo = await this.getVersionSpecificInfo(packageName, resolvedVersion);
      if (specificInfo) {
        versionInfo = specificInfo;
      }
    }

    if (versionInfo?.types || versionInfo?.typings) {
      const result = await this.fetchBundledTypes(packageName, resolvedVersion, versionInfo);
      if (result) {
        this.cache.set(cacheKey, result);
        return result;
      }
    }

    // Try alternative type paths for packages with non-standard structures
    const altPaths = ALTERNATIVE_TYPE_PATHS[packageName];
    if (altPaths) {
      for (const altPath of altPaths) {
        const result = await this.fetchSpecificTypeFile(packageName, resolvedVersion, altPath);
        if (result) {
          this.cache.set(cacheKey, result);
          return result;
        }
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
   * Race both CDN endpoints in parallel, returning the first successful response.
   * Eliminates sequential fallback latency (up to 8s saved when one CDN is slow).
   */
  private async fetchFromCdn(
    packageName: string,
    version: string,
    filePath: string
  ): Promise<string | null> {
    const unpkgUrl = `${UNPKG_CDN}/${packageName}@${version}/${filePath}`;
    const jsdelivrUrl = `${JSDELIVR_CDN}/${packageName}@${version}/${filePath}`;

    const fetchCdn = async (url: string): Promise<string> => {
      const response = await fetch(url, { signal: AbortSignal.timeout(CDN_TIMEOUT) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    };

    try {
      // Race both CDNs — first success wins
      return await Promise.any([fetchCdn(unpkgUrl), fetchCdn(jsdelivrUrl)]);
    } catch {
      // All CDN attempts failed
      logger.debug('All CDN fetches failed', { packageName, version, filePath });
      return null;
    }
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

    logger.debug('Fetching bundled types', { packageName, version, typesPath });
    const content = await this.fetchFromCdn(packageName, version, typesPath);
    if (!content) return null;

    return {
      packageName,
      version,
      content,
      filePath: typesPath,
      source: 'bundled',
      fetchedAt: Date.now(),
    };
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

      logger.debug('Fetching DefinitelyTyped types', { typesPackageName, typesVersion, typesPath });
      const content = await this.fetchFromCdn(typesPackageName, typesVersion, typesPath);
      if (!content) return null;

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
   * Fetch a specific type file from a package (public for barrel export handling)
   */
  async fetchSpecificTypeFile(
    packageName: string,
    version: string | undefined,
    filePath: string
  ): Promise<TypeDefinitionResult | null> {
    const resolvedVersion = await this.resolveVersion(packageName, version);
    if (!resolvedVersion) return null;

    logger.debug('Fetching specific type file', { packageName, resolvedVersion, filePath });
    const content = await this.fetchFromCdn(packageName, resolvedVersion, filePath);
    if (!content) return null;

    return {
      packageName,
      version: resolvedVersion,
      content,
      filePath,
      source: 'bundled',
      fetchedAt: Date.now(),
    };
  }

  /**
   * Get barrel export module paths for a specific concept
   */
  getBarrelExportPaths(packageName: string, concept: string): string[] {
    const modules = BARREL_EXPORT_MODULES[packageName];
    if (!modules) return [];

    const normalizedConcept = concept.toLowerCase().replace(/[^a-z]/g, '');
    return modules[normalizedConcept] || [];
  }

  /**
   * Check if a package uses barrel exports
   */
  hasBarrelExports(packageName: string): boolean {
    return packageName in BARREL_EXPORT_MODULES;
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
