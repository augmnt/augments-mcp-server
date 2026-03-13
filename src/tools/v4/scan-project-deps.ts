/**
 * scan_project_deps Tool
 *
 * Project dependency scanner that reads package.json and checks:
 * 1. Available updates from npm registry
 * 2. Deprecated packages
 * 3. Security advisories (npm audit)
 */

import { getLogger } from '@/utils/logger';
import { getTypeFetcher, getVersionRegistry } from '@/core';
import { readFile } from 'fs/promises';

const logger = getLogger('scan-project-deps');

const FETCH_TIMEOUT = 8_000;

export interface ScanProjectDepsInput {
  /** Path to package.json (defaults to ./package.json) */
  packageJsonPath?: string;
  /** Types of checks to run */
  checkTypes?: ('updates' | 'deprecated' | 'security')[];
}

interface DepStatus {
  name: string;
  currentVersion: string;
  latestVersion: string | null;
  isOutdated: boolean;
  isMajorUpdate: boolean;
  isDeprecated: boolean;
  deprecationMessage?: string;
  type: 'dependency' | 'devDependency';
}

interface SecurityAdvisory {
  name: string;
  severity: string;
  title: string;
  url?: string;
}

export interface ScanProjectDepsOutput {
  totalDependencies: number;
  outdated: DepStatus[];
  majorUpdates: DepStatus[];
  deprecated: DepStatus[];
  security: SecurityAdvisory[];
  upToDate: number;
  notes: string[];
}

export async function scanProjectDeps(input: ScanProjectDepsInput): Promise<ScanProjectDepsOutput> {
  const startTime = Date.now();
  const packageJsonPath = input.packageJsonPath || './package.json';
  logger.info('Scanning project dependencies', { path: packageJsonPath });

  const notes: string[] = [];

  // Read package.json
  let packageJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  try {
    const content = await readFile(packageJsonPath, 'utf-8');
    packageJson = JSON.parse(content);
  } catch (error) {
    return {
      totalDependencies: 0,
      outdated: [],
      majorUpdates: [],
      deprecated: [],
      security: [],
      upToDate: 0,
      notes: [`Failed to read ${packageJsonPath}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  // Collect all dependencies
  const deps: Array<{ name: string; version: string; type: 'dependency' | 'devDependency' }> = [];

  if (packageJson.dependencies) {
    for (const [name, version] of Object.entries(packageJson.dependencies)) {
      deps.push({ name, version, type: 'dependency' });
    }
  }
  if (packageJson.devDependencies) {
    for (const [name, version] of Object.entries(packageJson.devDependencies)) {
      deps.push({ name, version, type: 'devDependency' });
    }
  }

  if (deps.length === 0) {
    return {
      totalDependencies: 0,
      outdated: [],
      majorUpdates: [],
      deprecated: [],
      security: [],
      upToDate: 0,
      notes: ['No dependencies found in package.json.'],
    };
  }

  const checkTypes = input.checkTypes || ['updates', 'deprecated'];

  // Check packages in parallel (batch of 10)
  const versionRegistry = getVersionRegistry();
  const statuses: DepStatus[] = [];
  const batchSize = 10;

  for (let i = 0; i < deps.length; i += batchSize) {
    const batch = deps.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(async (dep) => {
        const versions = await versionRegistry.getVersions(dep.name);
        if (!versions) {
          return {
            name: dep.name,
            currentVersion: dep.version,
            latestVersion: null,
            isOutdated: false,
            isMajorUpdate: false,
            isDeprecated: false,
            type: dep.type,
          } satisfies DepStatus;
        }

        const currentClean = dep.version.replace(/^[\^~>=<]+/, '');
        const currentParts = currentClean.match(/^(\d+)/);
        const latestParts = versions.latestStable.match(/^(\d+)/);

        const isMajorUpdate =
          currentParts && latestParts
            ? parseInt(currentParts[1]) < parseInt(latestParts[1])
            : false;

        const isOutdated = currentClean !== versions.latestStable && !dep.version.includes('*');

        // Check deprecation by looking at the latest version in the current major
        const isDeprecated = versions.majorVersions.some(
          (m) => m.isDeprecated && currentParts && m.major === parseInt(currentParts[1])
        );

        return {
          name: dep.name,
          currentVersion: dep.version,
          latestVersion: versions.latestStable,
          isOutdated,
          isMajorUpdate,
          isDeprecated,
          type: dep.type,
        } satisfies DepStatus;
      })
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        statuses.push(result.value);
      }
    }
  }

  // Check security advisories if requested
  let security: SecurityAdvisory[] = [];
  if (checkTypes.includes('security')) {
    security = await fetchSecurityAdvisories(
      statuses.map((s) => ({ name: s.name, version: s.currentVersion.replace(/^[\^~>=<]+/, '') }))
    ).catch(() => {
      notes.push('Failed to fetch security advisories');
      return [];
    });
  }

  const outdated = statuses.filter((s) => s.isOutdated && !s.isMajorUpdate);
  const majorUpdates = statuses.filter((s) => s.isMajorUpdate);
  const deprecated = statuses.filter((s) => s.isDeprecated);
  const upToDate = statuses.filter((s) => !s.isOutdated && !s.isDeprecated).length;

  const duration = Date.now() - startTime;
  logger.info('Dependency scan completed', {
    total: deps.length,
    outdated: outdated.length,
    majorUpdates: majorUpdates.length,
    deprecated: deprecated.length,
    duration,
  });

  return {
    totalDependencies: deps.length,
    outdated,
    majorUpdates,
    deprecated,
    security,
    upToDate,
    notes,
  };
}

async function fetchSecurityAdvisories(
  packages: Array<{ name: string; version: string }>
): Promise<SecurityAdvisory[]> {
  try {
    // Use npm audit bulk advisory endpoint
    const body: Record<string, string[]> = {};
    for (const pkg of packages) {
      body[pkg.name] = [pkg.version];
    }

    const response = await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as Record<
      string,
      Array<{ title: string; severity: string; url: string }>
    >;

    const advisories: SecurityAdvisory[] = [];
    for (const [name, issues] of Object.entries(data)) {
      for (const issue of issues) {
        advisories.push({
          name,
          severity: issue.severity,
          title: issue.title,
          url: issue.url,
        });
      }
    }

    return advisories;
  } catch {
    return [];
  }
}

export function formatScanProjectDepsResponse(output: ScanProjectDepsOutput): string {
  const lines: string[] = [];

  lines.push('# Dependency Scan Results');
  lines.push('');
  lines.push(`**Total dependencies:** ${output.totalDependencies}`);
  lines.push(`**Up to date:** ${output.upToDate}`);
  lines.push(`**Minor/patch updates:** ${output.outdated.length}`);
  lines.push(`**Major updates:** ${output.majorUpdates.length}`);
  lines.push(`**Deprecated:** ${output.deprecated.length}`);
  if (output.security.length > 0) {
    lines.push(`**Security advisories:** ${output.security.length}`);
  }
  lines.push('');

  // Security (highest priority)
  if (output.security.length > 0) {
    lines.push('## Security Advisories');
    for (const advisory of output.security) {
      lines.push(`- **[${advisory.severity.toUpperCase()}]** ${advisory.name}: ${advisory.title}`);
      if (advisory.url) lines.push(`  ${advisory.url}`);
    }
    lines.push('');
  }

  // Deprecated
  if (output.deprecated.length > 0) {
    lines.push('## Deprecated Packages');
    for (const dep of output.deprecated) {
      lines.push(`- **${dep.name}** ${dep.currentVersion} → ${dep.latestVersion || 'N/A'}${dep.deprecationMessage ? ` (${dep.deprecationMessage})` : ''}`);
    }
    lines.push('');
  }

  // Major updates
  if (output.majorUpdates.length > 0) {
    lines.push('## Major Updates Available');
    for (const dep of output.majorUpdates) {
      lines.push(`- **${dep.name}** ${dep.currentVersion} → ${dep.latestVersion} *(major)*`);
    }
    lines.push('');
  }

  // Minor/patch updates (limit to top 20)
  if (output.outdated.length > 0) {
    lines.push('## Minor/Patch Updates');
    for (const dep of output.outdated.slice(0, 20)) {
      lines.push(`- ${dep.name} ${dep.currentVersion} → ${dep.latestVersion}`);
    }
    if (output.outdated.length > 20) {
      lines.push(`*...and ${output.outdated.length - 20} more*`);
    }
    lines.push('');
  }

  if (output.notes.length > 0) {
    lines.push('## Notes');
    for (const note of output.notes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join('\n');
}
