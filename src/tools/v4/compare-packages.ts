/**
 * compare_packages Tool
 *
 * Data-driven package comparison using:
 * 1. npm registry — weekly downloads, last publish, dependency count
 * 2. Bundlephobia API — gzip + minified sizes
 * 3. Type analysis — count exported APIs
 * 4. GitHub — stars, open issues
 */

import { getLogger } from '@/utils/logger';
import { getTypeFetcher, getTypeParser, getQueryParser } from '@/core';

const logger = getLogger('compare-packages');

const FETCH_TIMEOUT = 8_000;

export interface ComparePackagesInput {
  /** Packages to compare (2-5) */
  packages: string[];
  /** Optional: focus area for comparison */
  criteria?: string;
}

interface PackageComparison {
  name: string;
  version: string;
  description: string;
  weeklyDownloads: number | null;
  lastPublish: string | null;
  dependencies: number;
  bundleSize: { gzip: number; minified: number } | null;
  exportCount: number | null;
  github: { stars: number; openIssues: number; repo: string } | null;
  license: string | null;
}

export interface ComparePackagesOutput {
  packages: PackageComparison[];
  notes: string[];
}

export async function comparePackages(input: ComparePackagesInput): Promise<ComparePackagesOutput> {
  const startTime = Date.now();
  logger.info('Comparing packages', { packages: input.packages });

  const queryParser = getQueryParser();
  const typeFetcher = getTypeFetcher();
  const typeParser = getTypeParser();
  const notes: string[] = [];

  if (input.packages.length < 2 || input.packages.length > 5) {
    return {
      packages: [],
      notes: ['Please provide 2-5 packages to compare.'],
    };
  }

  // Resolve package names
  const packageNames = input.packages.map(
    (p) => queryParser.getPackageName(p) || p
  );

  // Fetch all package data in parallel
  const comparisons = await Promise.all(
    packageNames.map(async (pkgName, i) => {
      const displayName = input.packages[i];
      try {
        return await fetchPackageData(pkgName, displayName, typeFetcher, typeParser);
      } catch (error) {
        logger.debug('Failed to fetch package data', { pkgName, error: error instanceof Error ? error.message : String(error) });
        notes.push(`Failed to fetch data for ${displayName}`);
        return null;
      }
    })
  );

  const validComparisons = comparisons.filter((c): c is PackageComparison => c !== null);

  const duration = Date.now() - startTime;
  logger.info('Package comparison completed', { count: validComparisons.length, duration });

  return { packages: validComparisons, notes };
}

async function fetchPackageData(
  packageName: string,
  displayName: string,
  typeFetcher: ReturnType<typeof getTypeFetcher>,
  typeParser: ReturnType<typeof getTypeParser>
): Promise<PackageComparison> {
  // Fetch npm info, downloads, bundle size, and types in parallel
  const [npmInfo, downloads, bundleSize, types] = await Promise.all([
    typeFetcher.getVersionSpecificInfo(packageName, 'latest').catch(() => null),
    fetchWeeklyDownloads(packageName).catch(() => null),
    fetchBundleSize(packageName).catch(() => null),
    typeFetcher.fetchTypes(packageName).catch(() => null),
  ]);

  // Count exports from types
  let exportCount: number | null = null;
  if (types) {
    const parsed = typeParser.parse(types.content);
    exportCount = parsed.definitions.length;
  }

  // Extract GitHub info from npm metadata
  let github: PackageComparison['github'] = null;
  if (npmInfo?.repository) {
    const repoUrl = typeof npmInfo.repository === 'string' ? npmInfo.repository : npmInfo.repository.url;
    const match = repoUrl?.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (match) {
      const repo = `${match[1]}/${match[2]}`;
      github = await fetchGitHubInfo(repo).catch(() => null);
    }
  }

  return {
    name: displayName,
    version: npmInfo?.version || 'unknown',
    description: npmInfo?.description || '',
    weeklyDownloads: downloads,
    lastPublish: npmInfo?.version ? 'latest' : null,
    dependencies: npmInfo?.dependencies ? Object.keys(npmInfo.dependencies).length : 0,
    bundleSize,
    exportCount,
    github,
    license: null, // Would need full npm metadata
  };
}

async function fetchWeeklyDownloads(packageName: string): Promise<number | null> {
  try {
    const url = `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(packageName)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (!response.ok) return null;
    const data = (await response.json()) as { downloads: number };
    return data.downloads;
  } catch {
    return null;
  }
}

async function fetchBundleSize(packageName: string): Promise<{ gzip: number; minified: number } | null> {
  try {
    const url = `https://bundlephobia.com/api/size?package=${encodeURIComponent(packageName)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (!response.ok) return null;
    const data = (await response.json()) as { gzip: number; size: number };
    return { gzip: data.gzip, minified: data.size };
  } catch {
    return null;
  }
}

async function fetchGitHubInfo(repo: string): Promise<{ stars: number; openIssues: number; repo: string } | null> {
  try {
    const url = `https://api.github.com/repos/${repo}`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'augments-mcp-server',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { stargazers_count: number; open_issues_count: number };
    return { stars: data.stargazers_count, openIssues: data.open_issues_count, repo };
  } catch {
    return null;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatComparePackagesResponse(output: ComparePackagesOutput): string {
  const lines: string[] = [];

  lines.push('# Package Comparison');
  lines.push('');

  if (output.packages.length === 0) {
    lines.push('No package data available.');
    if (output.notes.length > 0) {
      for (const note of output.notes) {
        lines.push(`- ${note}`);
      }
    }
    return lines.join('\n');
  }

  // Summary table
  lines.push('| Feature | ' + output.packages.map((p) => p.name).join(' | ') + ' |');
  lines.push('| --- | ' + output.packages.map(() => '---').join(' | ') + ' |');

  // Version
  lines.push('| Version | ' + output.packages.map((p) => p.version).join(' | ') + ' |');

  // Downloads
  lines.push('| Weekly Downloads | ' + output.packages.map(
    (p) => p.weeklyDownloads ? formatDownloads(p.weeklyDownloads) : 'N/A'
  ).join(' | ') + ' |');

  // Bundle size
  lines.push('| Bundle (gzip) | ' + output.packages.map(
    (p) => p.bundleSize ? formatSize(p.bundleSize.gzip) : 'N/A'
  ).join(' | ') + ' |');
  lines.push('| Bundle (min) | ' + output.packages.map(
    (p) => p.bundleSize ? formatSize(p.bundleSize.minified) : 'N/A'
  ).join(' | ') + ' |');

  // Dependencies
  lines.push('| Dependencies | ' + output.packages.map(
    (p) => String(p.dependencies)
  ).join(' | ') + ' |');

  // Exports
  lines.push('| Exported APIs | ' + output.packages.map(
    (p) => p.exportCount !== null ? String(p.exportCount) : 'N/A'
  ).join(' | ') + ' |');

  // GitHub stars
  lines.push('| GitHub Stars | ' + output.packages.map(
    (p) => p.github ? formatDownloads(p.github.stars) : 'N/A'
  ).join(' | ') + ' |');

  // Open issues
  lines.push('| Open Issues | ' + output.packages.map(
    (p) => p.github ? formatDownloads(p.github.openIssues) : 'N/A'
  ).join(' | ') + ' |');

  lines.push('');

  // Descriptions
  lines.push('## Descriptions');
  for (const pkg of output.packages) {
    if (pkg.description) {
      lines.push(`- **${pkg.name}**: ${pkg.description}`);
    }
  }
  lines.push('');

  if (output.notes.length > 0) {
    lines.push('## Notes');
    for (const note of output.notes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join('\n');
}
