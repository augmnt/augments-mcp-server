/**
 * Version Registry
 *
 * Queries npm registry for available versions.
 * Tracks latest stable, latest, and historical versions.
 * Detects major version changes.
 */

import { getLogger } from '@/utils/logger';
import { getTypeFetcher } from './type-fetcher';

const logger = getLogger('version-registry');

/**
 * Version information
 */
export interface VersionInfo {
  /** Full version string (e.g., "19.0.0") */
  version: string;
  /** Major version number */
  major: number;
  /** Minor version number */
  minor: number;
  /** Patch version number */
  patch: number;
  /** Pre-release tag if any (e.g., "beta.1") */
  prerelease?: string;
  /** Publication date */
  publishedAt?: Date;
  /** Whether this is deprecated */
  deprecated?: boolean;
}

/**
 * Package version summary
 */
export interface PackageVersions {
  /** Package name */
  packageName: string;
  /** Latest stable version */
  latestStable: string;
  /** Latest version (including pre-releases) */
  latest: string;
  /** Available dist-tags */
  tags: Record<string, string>;
  /** Major version groups */
  majorVersions: MajorVersionGroup[];
  /** Total version count */
  totalVersions: number;
  /** Last checked timestamp */
  lastChecked: number;
}

/**
 * Grouped versions by major version
 */
export interface MajorVersionGroup {
  /** Major version number */
  major: number;
  /** Latest version in this major */
  latestVersion: string;
  /** All versions in this major */
  versions: string[];
  /** Whether this is the current/recommended major */
  isCurrent: boolean;
  /** Whether this major is deprecated */
  isDeprecated: boolean;
}

/**
 * Breaking changes between versions
 */
export interface VersionDiff {
  /** From version */
  from: string;
  /** To version */
  to: string;
  /** Major version change */
  isMajorChange: boolean;
  /** Summary of changes */
  summary: string[];
}

/**
 * Version registry for tracking npm package versions
 */
export class VersionRegistry {
  private cache: Map<string, PackageVersions> = new Map();
  private readonly CACHE_TTL = 3600 * 1000; // 1 hour

  /**
   * Get version information for a package
   */
  async getVersions(packageName: string): Promise<PackageVersions | null> {
    // Check cache
    const cached = this.cache.get(packageName);
    if (cached && Date.now() - cached.lastChecked < this.CACHE_TTL) {
      return cached;
    }

    try {
      const typeFetcher = getTypeFetcher();
      const versionData = await typeFetcher.getVersions(packageName);

      if (!versionData) {
        logger.debug('Package not found', { packageName });
        return null;
      }

      // Parse and group versions
      const parsedVersions = versionData.versions
        .map((v) => this.parseVersion(v))
        .filter((v): v is VersionInfo => v !== null)
        .sort((a, b) => this.compareVersions(b, a)); // Descending

      // Find latest stable (no prerelease)
      const latestStable =
        parsedVersions.find((v) => !v.prerelease)?.version ||
        versionData.latest;

      // Group by major version
      const majorVersions = this.groupByMajor(parsedVersions, latestStable);

      const result: PackageVersions = {
        packageName,
        latestStable,
        latest: versionData.latest,
        tags: versionData.tags,
        majorVersions,
        totalVersions: versionData.versions.length,
        lastChecked: Date.now(),
      };

      this.cache.set(packageName, result);
      logger.debug('Fetched version info', {
        packageName,
        latestStable,
        totalVersions: result.totalVersions,
      });

      return result;
    } catch (error) {
      logger.error('Failed to get versions', {
        packageName,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get the latest stable version for a package
   */
  async getLatestStable(packageName: string): Promise<string | null> {
    const versions = await this.getVersions(packageName);
    return versions?.latestStable || null;
  }

  /**
   * Get versions matching a major version
   */
  async getVersionsForMajor(
    packageName: string,
    major: number
  ): Promise<string[]> {
    const versions = await this.getVersions(packageName);
    if (!versions) return [];

    const majorGroup = versions.majorVersions.find((g) => g.major === major);
    return majorGroup?.versions || [];
  }

  /**
   * Check if a version is the latest in its major
   */
  async isLatestInMajor(
    packageName: string,
    version: string
  ): Promise<boolean> {
    const parsed = this.parseVersion(version);
    if (!parsed) return false;

    const versions = await this.getVersions(packageName);
    if (!versions) return false;

    const majorGroup = versions.majorVersions.find(
      (g) => g.major === parsed.major
    );
    return majorGroup?.latestVersion === version;
  }

  /**
   * Get diff summary between two versions
   */
  async getVersionDiff(
    packageName: string,
    fromVersion: string,
    toVersion: string
  ): Promise<VersionDiff | null> {
    const fromParsed = this.parseVersion(fromVersion);
    const toParsed = this.parseVersion(toVersion);

    if (!fromParsed || !toParsed) return null;

    const isMajorChange = fromParsed.major !== toParsed.major;
    const summary: string[] = [];

    if (isMajorChange) {
      summary.push(
        `Major version change from ${fromParsed.major} to ${toParsed.major}`
      );
      summary.push('This likely includes breaking changes');
      summary.push(
        `Check the ${packageName} migration guide for v${toParsed.major}`
      );
    } else if (fromParsed.minor !== toParsed.minor) {
      summary.push(
        `Minor version change from ${fromVersion} to ${toVersion}`
      );
      summary.push('New features may be available');
    } else {
      summary.push(`Patch version change from ${fromVersion} to ${toVersion}`);
      summary.push('Bug fixes and improvements');
    }

    return {
      from: fromVersion,
      to: toVersion,
      isMajorChange,
      summary,
    };
  }

  /**
   * Find the best matching version for a constraint
   */
  async resolveVersion(
    packageName: string,
    constraint?: string
  ): Promise<string | null> {
    const versions = await this.getVersions(packageName);
    if (!versions) return null;

    if (!constraint || constraint === 'latest') {
      return versions.latestStable;
    }

    // Check if it's a dist-tag
    if (versions.tags[constraint]) {
      return versions.tags[constraint];
    }

    // Parse constraint
    const parsed = this.parseVersion(constraint);
    if (!parsed) {
      // Try as major version only (e.g., "19")
      const majorNum = parseInt(constraint);
      if (!isNaN(majorNum)) {
        const majorGroup = versions.majorVersions.find(
          (g) => g.major === majorNum
        );
        return majorGroup?.latestVersion || null;
      }
      return null;
    }

    // Find exact match or best match in same major
    const allVersions = versions.majorVersions.flatMap((g) => g.versions);

    // Exact match
    if (allVersions.includes(constraint)) {
      return constraint;
    }

    // Best match in same major.minor
    const minorMatch = allVersions
      .filter((v) => {
        const p = this.parseVersion(v);
        return (
          p && p.major === parsed.major && p.minor === parsed.minor
        );
      })
      .sort((a, b) => {
        const pa = this.parseVersion(a);
        const pb = this.parseVersion(b);
        if (!pa || !pb) return 0;
        return this.compareVersions(pb, pa);
      })[0];

    if (minorMatch) return minorMatch;

    // Best match in same major
    const majorGroup = versions.majorVersions.find(
      (g) => g.major === parsed.major
    );
    return majorGroup?.latestVersion || null;
  }

  /**
   * Get all major versions for a package
   */
  async getMajorVersions(packageName: string): Promise<number[]> {
    const versions = await this.getVersions(packageName);
    if (!versions) return [];
    return versions.majorVersions.map((g) => g.major);
  }

  /**
   * Check if a version exists
   */
  async versionExists(
    packageName: string,
    version: string
  ): Promise<boolean> {
    const versions = await this.getVersions(packageName);
    if (!versions) return false;

    const allVersions = versions.majorVersions.flatMap((g) => g.versions);
    return allVersions.includes(version);
  }

  /**
   * Parse a version string into components
   */
  parseVersion(version: string): VersionInfo | null {
    const match = version.match(
      /^(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?(?:\+.*)?$/
    );
    if (!match) {
      // Try simple major.minor format
      const simpleMatch = version.match(/^(\d+)\.(\d+)$/);
      if (simpleMatch) {
        return {
          version: `${simpleMatch[1]}.${simpleMatch[2]}.0`,
          major: parseInt(simpleMatch[1]),
          minor: parseInt(simpleMatch[2]),
          patch: 0,
        };
      }
      // Try major only
      const majorMatch = version.match(/^(\d+)$/);
      if (majorMatch) {
        return {
          version: `${majorMatch[1]}.0.0`,
          major: parseInt(majorMatch[1]),
          minor: 0,
          patch: 0,
        };
      }
      return null;
    }

    return {
      version: match[0].replace(/\+.*$/, ''), // Remove build metadata
      major: parseInt(match[1]),
      minor: parseInt(match[2]),
      patch: parseInt(match[3]),
      prerelease: match[4],
    };
  }

  /**
   * Compare two versions (returns positive if a > b)
   */
  private compareVersions(a: VersionInfo, b: VersionInfo): number {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    if (a.patch !== b.patch) return a.patch - b.patch;

    // Pre-release versions are less than release versions
    if (a.prerelease && !b.prerelease) return -1;
    if (!a.prerelease && b.prerelease) return 1;

    // Compare pre-release identifiers
    if (a.prerelease && b.prerelease) {
      return a.prerelease.localeCompare(b.prerelease);
    }

    return 0;
  }

  /**
   * Group versions by major version
   */
  private groupByMajor(
    versions: VersionInfo[],
    latestStable: string
  ): MajorVersionGroup[] {
    const groups = new Map<number, VersionInfo[]>();

    for (const version of versions) {
      const existing = groups.get(version.major) || [];
      existing.push(version);
      groups.set(version.major, existing);
    }

    const parsedLatest = this.parseVersion(latestStable);
    const currentMajor = parsedLatest?.major;

    return Array.from(groups.entries())
      .map(([major, versionInfos]) => {
        // Sort versions within group (descending)
        versionInfos.sort((a, b) => this.compareVersions(b, a));

        // Find latest stable in this major
        const latestInMajor =
          versionInfos.find((v) => !v.prerelease)?.version ||
          versionInfos[0].version;

        return {
          major,
          latestVersion: latestInMajor,
          versions: versionInfos.map((v) => v.version),
          isCurrent: major === currentMajor,
          isDeprecated: currentMajor !== undefined && major < currentMajor - 1,
        };
      })
      .sort((a, b) => b.major - a.major); // Sort majors descending
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug('Cache cleared');
  }

  /**
   * Clear cache for a specific package
   */
  clearPackageCache(packageName: string): void {
    this.cache.delete(packageName);
    logger.debug('Package cache cleared', { packageName });
  }
}

// Singleton instance
let instance: VersionRegistry | null = null;

export function getVersionRegistry(): VersionRegistry {
  if (!instance) {
    instance = new VersionRegistry();
  }
  return instance;
}
