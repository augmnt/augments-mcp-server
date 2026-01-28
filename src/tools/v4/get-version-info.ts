/**
 * get_version_info Tool
 *
 * Version information tool for npm packages.
 * Tracks versions and breaking changes.
 */

import { getLogger } from '@/utils/logger';
import {
  getQueryParser,
  getVersionRegistry,
  type PackageVersions,
  type VersionDiff,
} from '@/core';

const logger = getLogger('get-version-info');

/**
 * Input parameters for get_version_info tool
 */
export interface GetVersionInfoInput {
  /** Framework or package name */
  framework: string;
  /** Optional: Compare from this version */
  fromVersion?: string;
  /** Optional: Compare to this version */
  toVersion?: string;
}

/**
 * Output of get_version_info tool
 */
export interface GetVersionInfoOutput {
  /** Package name */
  packageName: string;
  /** Latest stable version */
  latestStable: string;
  /** Latest version (including pre-releases) */
  latest: string;
  /** Available dist-tags */
  tags: Record<string, string>;
  /** Major version summary */
  majorVersions: {
    major: number;
    latestVersion: string;
    isCurrent: boolean;
    isDeprecated: boolean;
  }[];
  /** Total versions available */
  totalVersions: number;
  /** Version diff if requested */
  diff?: VersionDiff;
  /** Notes */
  notes: string[];
}

/**
 * Get version information for a framework/package
 */
export async function getVersionInfo(
  input: GetVersionInfoInput
): Promise<GetVersionInfoOutput> {
  const startTime = Date.now();
  logger.info('Getting version info', { framework: input.framework });

  const queryParser = getQueryParser();
  const versionRegistry = getVersionRegistry();

  // Resolve package name
  const packageName = queryParser.getPackageName(input.framework) || input.framework;
  const notes: string[] = [];

  // Get version information
  const versions = await versionRegistry.getVersions(packageName);

  if (!versions) {
    logger.debug('Package not found', { packageName });
    return {
      packageName,
      latestStable: '',
      latest: '',
      tags: {},
      majorVersions: [],
      totalVersions: 0,
      notes: [`Package "${packageName}" not found on npm.`],
    };
  }

  // Get version diff if requested
  let diff: VersionDiff | undefined;
  if (input.fromVersion && input.toVersion) {
    diff = await versionRegistry.getVersionDiff(
      packageName,
      input.fromVersion,
      input.toVersion
    ) || undefined;
  } else if (input.fromVersion) {
    // Compare from version to latest
    diff = await versionRegistry.getVersionDiff(
      packageName,
      input.fromVersion,
      versions.latestStable
    ) || undefined;
  }

  // Add helpful notes
  if (versions.majorVersions.length > 1) {
    const deprecatedMajors = versions.majorVersions
      .filter((m) => m.isDeprecated)
      .map((m) => m.major);
    if (deprecatedMajors.length > 0) {
      notes.push(
        `Major versions ${deprecatedMajors.join(', ')} are considered deprecated.`
      );
    }
  }

  // Check for pre-release versions
  const preReleaseTags = Object.entries(versions.tags)
    .filter(([tag]) => ['next', 'beta', 'alpha', 'canary', 'rc'].includes(tag))
    .map(([tag, version]) => `${tag}: ${version}`);
  if (preReleaseTags.length > 0) {
    notes.push(`Pre-release versions available: ${preReleaseTags.join(', ')}`);
  }

  const duration = Date.now() - startTime;
  logger.info('Version info retrieved', {
    packageName,
    latestStable: versions.latestStable,
    totalVersions: versions.totalVersions,
    duration,
  });

  return {
    packageName,
    latestStable: versions.latestStable,
    latest: versions.latest,
    tags: versions.tags,
    majorVersions: versions.majorVersions.map((m) => ({
      major: m.major,
      latestVersion: m.latestVersion,
      isCurrent: m.isCurrent,
      isDeprecated: m.isDeprecated,
    })),
    totalVersions: versions.totalVersions,
    diff,
    notes,
  };
}

/**
 * Format the output for MCP response
 */
export function formatVersionInfoResponse(output: GetVersionInfoOutput): string {
  const lines: string[] = [];

  lines.push(`# ${output.packageName} Version Info`);
  lines.push('');

  if (output.totalVersions === 0) {
    lines.push('Package not found on npm.');
    return lines.join('\n');
  }

  // Latest versions
  lines.push('## Latest Versions');
  lines.push(`- **Stable**: ${output.latestStable}`);
  if (output.latest !== output.latestStable) {
    lines.push(`- **Latest**: ${output.latest}`);
  }
  lines.push('');

  // Dist tags
  if (Object.keys(output.tags).length > 1) {
    lines.push('## Distribution Tags');
    for (const [tag, version] of Object.entries(output.tags)) {
      lines.push(`- \`${tag}\`: ${version}`);
    }
    lines.push('');
  }

  // Major versions
  if (output.majorVersions.length > 0) {
    lines.push('## Major Versions');
    for (const major of output.majorVersions) {
      const status = [];
      if (major.isCurrent) status.push('current');
      if (major.isDeprecated) status.push('deprecated');
      const statusStr = status.length > 0 ? ` (${status.join(', ')})` : '';
      lines.push(`- **v${major.major}**: ${major.latestVersion}${statusStr}`);
    }
    lines.push('');
  }

  // Version diff
  if (output.diff) {
    lines.push('## Version Comparison');
    lines.push(`From: ${output.diff.from}`);
    lines.push(`To: ${output.diff.to}`);
    lines.push('');
    if (output.diff.isMajorChange) {
      lines.push('**Major version change - may contain breaking changes**');
      lines.push('');
    }
    lines.push('### Summary');
    for (const note of output.diff.summary) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

  // Notes
  if (output.notes.length > 0) {
    lines.push('## Notes');
    for (const note of output.notes) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

  // Total versions
  lines.push(`*Total versions on npm: ${output.totalVersions}*`);

  return lines.join('\n');
}
