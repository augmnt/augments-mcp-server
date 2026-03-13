/**
 * get_migration_guide Tool
 *
 * Cross-version migration guides built from real data:
 * - Official migration/upgrade docs from GitHub
 * - CHANGELOG.md parsed between version headings
 * - GitHub Releases API for release notes
 * - Type diff (added/removed/changed exports)
 */

import { getLogger } from '@/utils/logger';
import {
  getQueryParser,
  getVersionRegistry,
  getTypeFetcher,
  getChangelogFetcher,
  getTypeDiffer,
  getDocFetcher,
} from '@/core';

const logger = getLogger('get-migration-guide');

export interface GetMigrationGuideInput {
  /** Package or framework name */
  package: string;
  /** Version to migrate from */
  fromVersion: string;
  /** Version to migrate to (defaults to latest) */
  toVersion?: string;
}

export interface GetMigrationGuideOutput {
  packageName: string;
  fromVersion: string;
  toVersion: string;
  breakingChanges: string[];
  newFeatures: string[];
  deprecations: string[];
  migrationDocs: string | null;
  typeDiff: {
    added: Array<{ name: string; kind: string }>;
    removed: Array<{ name: string; kind: string }>;
    changed: Array<{ name: string; description: string }>;
  } | null;
  notes: string[];
}

export async function getMigrationGuide(
  input: GetMigrationGuideInput
): Promise<GetMigrationGuideOutput> {
  const startTime = Date.now();
  logger.info('Getting migration guide', { package: input.package, from: input.fromVersion });

  const queryParser = getQueryParser();
  const versionRegistry = getVersionRegistry();
  const typeFetcher = getTypeFetcher();
  const changelogFetcher = getChangelogFetcher();
  const typeDiffer = getTypeDiffer();
  const docFetcher = getDocFetcher();

  const packageName = queryParser.getPackageName(input.package) || input.package;
  const notes: string[] = [];

  // Resolve toVersion
  let toVersion = input.toVersion;
  if (!toVersion) {
    const latest = await versionRegistry.getLatestStable(packageName);
    if (!latest) {
      return {
        packageName,
        fromVersion: input.fromVersion,
        toVersion: '',
        breakingChanges: [],
        newFeatures: [],
        deprecations: [],
        migrationDocs: null,
        typeDiff: null,
        notes: [`Package "${packageName}" not found on npm.`],
      };
    }
    toVersion = latest;
  }

  // Fetch all data in parallel
  const [
    breakingChanges,
    newFeatures,
    changelogEntries,
    migrationDocsResults,
    fromTypes,
    toTypes,
  ] = await Promise.all([
    changelogFetcher.getBreakingChanges(packageName, input.fromVersion, toVersion).catch(() => []),
    changelogFetcher.getNewFeatures(packageName, input.fromVersion, toVersion).catch(() => []),
    changelogFetcher.getChangelogBetween(packageName, input.fromVersion, toVersion).catch(() => []),
    docFetcher.searchDocs(input.package, 'migration upgrade').catch(() => []),
    typeFetcher.fetchTypes(packageName, input.fromVersion).catch(() => null),
    typeFetcher.fetchTypes(packageName, toVersion).catch(() => null),
  ]);

  // Collect deprecations from changelog entries
  const deprecations: string[] = [];
  for (const entry of changelogEntries) {
    deprecations.push(...entry.deprecations);
  }

  // Build migration docs prose
  let migrationDocs: string | null = null;
  if (migrationDocsResults.length > 0) {
    migrationDocs = migrationDocsResults
      .map((r) => r.prose)
      .filter(Boolean)
      .join('\n\n')
      .substring(0, 3000) || null;
  }

  // Type diff
  let typeDiff: GetMigrationGuideOutput['typeDiff'] = null;
  if (fromTypes && toTypes) {
    try {
      const diff = typeDiffer.diff(fromTypes.content, toTypes.content);
      if (diff.summary.added > 0 || diff.summary.removed > 0 || diff.summary.changed > 0) {
        typeDiff = {
          added: diff.added.slice(0, 20).map((d) => ({ name: d.name, kind: d.kind })),
          removed: diff.removed.slice(0, 20).map((d) => ({ name: d.name, kind: d.kind })),
          changed: diff.changed.slice(0, 20).map((d) => ({ name: d.name, description: d.description })),
        };

        if (diff.removed.length > 0) {
          notes.push(`${diff.removed.length} export(s) were removed — check for breaking changes`);
        }
      }
    } catch (error) {
      logger.debug('Type diff failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  const duration = Date.now() - startTime;
  logger.info('Migration guide generated', { packageName, fromVersion: input.fromVersion, toVersion, duration });

  return {
    packageName,
    fromVersion: input.fromVersion,
    toVersion,
    breakingChanges,
    newFeatures,
    deprecations,
    migrationDocs,
    typeDiff,
    notes,
  };
}

export function formatMigrationGuideResponse(output: GetMigrationGuideOutput): string {
  const lines: string[] = [];

  lines.push(`# Migration Guide: ${output.packageName}`);
  lines.push(`**${output.fromVersion}** → **${output.toVersion}**`);
  lines.push('');

  // Breaking changes
  if (output.breakingChanges.length > 0) {
    lines.push('## ⚠ Breaking Changes');
    for (const change of output.breakingChanges) {
      lines.push(`- ${change}`);
    }
    lines.push('');
  }

  // Deprecations
  if (output.deprecations.length > 0) {
    lines.push('## Deprecations');
    for (const dep of output.deprecations) {
      lines.push(`- ${dep}`);
    }
    lines.push('');
  }

  // New features
  if (output.newFeatures.length > 0) {
    lines.push('## New Features');
    for (const feature of output.newFeatures) {
      lines.push(`- ${feature}`);
    }
    lines.push('');
  }

  // Type changes
  if (output.typeDiff) {
    if (output.typeDiff.removed.length > 0) {
      lines.push('## Removed Exports');
      for (const item of output.typeDiff.removed) {
        lines.push(`- \`${item.name}\` (${item.kind})`);
      }
      lines.push('');
    }

    if (output.typeDiff.changed.length > 0) {
      lines.push('## Changed Exports');
      for (const item of output.typeDiff.changed) {
        lines.push(`- \`${item.name}\`: ${item.description}`);
      }
      lines.push('');
    }

    if (output.typeDiff.added.length > 0) {
      lines.push('## New Exports');
      for (const item of output.typeDiff.added) {
        lines.push(`- \`${item.name}\` (${item.kind})`);
      }
      lines.push('');
    }
  }

  // Migration docs
  if (output.migrationDocs) {
    lines.push('## Official Migration Documentation');
    lines.push(output.migrationDocs);
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

  if (output.breakingChanges.length === 0 && !output.typeDiff && !output.migrationDocs) {
    lines.push('No specific migration information found. Check the official documentation for detailed upgrade instructions.');
  }

  return lines.join('\n');
}
