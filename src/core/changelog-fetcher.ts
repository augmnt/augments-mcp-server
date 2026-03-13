/**
 * Changelog Fetcher
 *
 * Fetches and parses CHANGELOG.md + GitHub Releases for a package.
 * Used by get_migration_guide and enhanced get_version_info.
 *
 * Data sources:
 * 1. CHANGELOG.md from package repo (parsed between version headings)
 * 2. GitHub Releases API for release notes
 */

import { getLogger } from '@/utils/logger';
import { getExampleExtractor } from './example-extractor';
import { getTypeFetcher } from './type-fetcher';

const logger = getLogger('changelog-fetcher');

const GITHUB_TIMEOUT = 8_000;

/**
 * A parsed changelog entry for a specific version
 */
export interface ChangelogEntry {
  version: string;
  date?: string;
  content: string;
  breakingChanges: string[];
  newFeatures: string[];
  bugFixes: string[];
  deprecations: string[];
}

/**
 * GitHub release info
 */
export interface ReleaseInfo {
  tagName: string;
  name: string;
  body: string;
  publishedAt: string;
  prerelease: boolean;
}

export class ChangelogFetcher {
  private changelogCache: Map<string, { content: string; fetchedAt: number }> = new Map();
  private releaseCache: Map<string, { releases: ReleaseInfo[]; fetchedAt: number }> = new Map();
  private readonly CACHE_TTL = 3600 * 1000; // 1 hour

  /**
   * Get changelog entries between two versions
   */
  async getChangelogBetween(
    packageName: string,
    fromVersion: string,
    toVersion: string
  ): Promise<ChangelogEntry[]> {
    const changelog = await this.fetchChangelog(packageName);
    if (!changelog) return [];

    return this.parseChangelogBetweenVersions(changelog, fromVersion, toVersion);
  }

  /**
   * Get release notes between two versions
   */
  async getReleaseNotes(
    packageName: string,
    fromVersion: string,
    toVersion: string
  ): Promise<ReleaseInfo[]> {
    const repo = await this.resolveRepo(packageName);
    if (!repo) return [];

    const releases = await this.fetchReleases(repo);
    if (!releases) return [];

    return this.filterReleasesBetween(releases, fromVersion, toVersion);
  }

  /**
   * Get breaking changes between versions (combined from changelog + releases)
   */
  async getBreakingChanges(
    packageName: string,
    fromVersion: string,
    toVersion: string
  ): Promise<string[]> {
    const [entries, releases] = await Promise.all([
      this.getChangelogBetween(packageName, fromVersion, toVersion),
      this.getReleaseNotes(packageName, fromVersion, toVersion),
    ]);

    const breakingChanges = new Set<string>();

    for (const entry of entries) {
      for (const change of entry.breakingChanges) {
        breakingChanges.add(change);
      }
    }

    for (const release of releases) {
      const parsed = this.parseReleaseBody(release.body);
      for (const change of parsed.breakingChanges) {
        breakingChanges.add(change);
      }
    }

    return Array.from(breakingChanges);
  }

  /**
   * Get new features between versions
   */
  async getNewFeatures(
    packageName: string,
    fromVersion: string,
    toVersion: string
  ): Promise<string[]> {
    const [entries, releases] = await Promise.all([
      this.getChangelogBetween(packageName, fromVersion, toVersion),
      this.getReleaseNotes(packageName, fromVersion, toVersion),
    ]);

    const features = new Set<string>();

    for (const entry of entries) {
      for (const feature of entry.newFeatures) {
        features.add(feature);
      }
    }

    for (const release of releases) {
      const parsed = this.parseReleaseBody(release.body);
      for (const feature of parsed.newFeatures) {
        features.add(feature);
      }
    }

    return Array.from(features);
  }

  /**
   * Fetch CHANGELOG.md from package repo
   */
  private async fetchChangelog(packageName: string): Promise<string | null> {
    const cached = this.changelogCache.get(packageName);
    if (cached && Date.now() - cached.fetchedAt < this.CACHE_TTL) {
      return cached.content;
    }

    const repo = await this.resolveRepo(packageName);
    if (!repo) return null;

    const changelogNames = ['CHANGELOG.md', 'CHANGES.md', 'HISTORY.md', 'changelog.md'];
    const branches = ['main', 'master'];

    for (const name of changelogNames) {
      for (const branch of branches) {
        try {
          const url = `https://raw.githubusercontent.com/${repo}/${branch}/${name}`;
          const response = await fetch(url, {
            signal: AbortSignal.timeout(GITHUB_TIMEOUT),
          });

          if (response.ok) {
            const content = await response.text();
            this.changelogCache.set(packageName, { content, fetchedAt: Date.now() });
            return content;
          }
        } catch (error) {
          logger.debug('Failed to fetch changelog', {
            repo, branch, name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return null;
  }

  /**
   * Fetch GitHub releases for a repo
   */
  private async fetchReleases(repo: string): Promise<ReleaseInfo[] | null> {
    const cached = this.releaseCache.get(repo);
    if (cached && Date.now() - cached.fetchedAt < this.CACHE_TTL) {
      return cached.releases;
    }

    try {
      const url = `https://api.github.com/repos/${repo}/releases?per_page=50`;
      const response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'augments-mcp-server',
        },
        signal: AbortSignal.timeout(GITHUB_TIMEOUT),
      });

      if (!response.ok) {
        logger.debug('Failed to fetch releases', { repo, status: response.status });
        return null;
      }

      const data = (await response.json()) as Array<{
        tag_name: string;
        name: string;
        body: string;
        published_at: string;
        prerelease: boolean;
      }>;

      const releases: ReleaseInfo[] = data.map((r) => ({
        tagName: r.tag_name,
        name: r.name || r.tag_name,
        body: r.body || '',
        publishedAt: r.published_at,
        prerelease: r.prerelease,
      }));

      this.releaseCache.set(repo, { releases, fetchedAt: Date.now() });
      return releases;
    } catch (error) {
      logger.debug('Failed to fetch releases', {
        repo,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Resolve package name to GitHub repo
   */
  private async resolveRepo(packageName: string): Promise<string | null> {
    const extractor = getExampleExtractor();
    const docSource = extractor.getDocSource(packageName);
    if (docSource) return docSource.repo;

    const frameworkToRepo: Record<string, string> = {
      react: 'facebook/react',
      next: 'vercel/next.js',
      vue: 'vuejs/core',
      zod: 'colinhacks/zod',
      prisma: 'prisma/prisma',
      '@prisma/client': 'prisma/prisma',
      express: 'expressjs/express',
      zustand: 'pmndrs/zustand',
      jotai: 'pmndrs/jotai',
      '@tanstack/react-query': 'TanStack/query',
      'react-hook-form': 'react-hook-form/react-hook-form',
      svelte: 'sveltejs/svelte',
      vitest: 'vitest-dev/vitest',
      playwright: 'microsoft/playwright',
      '@playwright/test': 'microsoft/playwright',
    };

    const mapped = frameworkToRepo[packageName];
    if (mapped) return mapped;

    try {
      const typeFetcher = getTypeFetcher();
      const info = await typeFetcher.getVersionSpecificInfo(packageName, 'latest');
      if (info?.repository) {
        const repoUrl = typeof info.repository === 'string' ? info.repository : info.repository.url;
        const match = repoUrl?.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
        if (match) return `${match[1]}/${match[2]}`;
      }
    } catch {
      // ignore
    }

    return null;
  }

  private parseChangelogBetweenVersions(
    content: string,
    fromVersion: string,
    toVersion: string
  ): ChangelogEntry[] {
    const entries: ChangelogEntry[] = [];
    const versionRegex = /^#{1,3}\s+\[?v?(\d+\.\d+\.\d+(?:-[\w.]+)?)\]?/gm;
    const sections: Array<{ version: string; startIndex: number }> = [];

    let match;
    while ((match = versionRegex.exec(content)) !== null) {
      sections.push({ version: match[1], startIndex: match.index });
    }

    const fromParts = this.parseVersionParts(fromVersion);
    const toParts = this.parseVersionParts(toVersion);

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const versionParts = this.parseVersionParts(section.version);

      if (
        versionParts && fromParts && toParts &&
        this.isVersionBetween(versionParts, fromParts, toParts)
      ) {
        const endIndex = i + 1 < sections.length ? sections[i + 1].startIndex : content.length;
        const sectionContent = content.substring(section.startIndex, endIndex).trim();
        const parsed = this.parseChangelogSection(sectionContent);
        entries.push({ version: section.version, ...parsed });
      }
    }

    return entries;
  }

  private parseChangelogSection(content: string): Omit<ChangelogEntry, 'version'> {
    const breakingChanges: string[] = [];
    const newFeatures: string[] = [];
    const bugFixes: string[] = [];
    const deprecations: string[] = [];

    const dateMatch = content.match(/\((\d{4}-\d{2}-\d{2})\)/);
    const date = dateMatch ? dateMatch[1] : undefined;

    const lines = content.split('\n');
    let currentCategory = '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (/^#{2,4}\s/.test(trimmed)) {
        if (/breaking|major/i.test(trimmed)) currentCategory = 'breaking';
        else if (/feat|feature|added|new/i.test(trimmed)) currentCategory = 'feature';
        else if (/fix|bug|patch/i.test(trimmed)) currentCategory = 'fix';
        else if (/deprecat/i.test(trimmed)) currentCategory = 'deprecated';
        else currentCategory = '';
        continue;
      }

      if (/^[-*]\s+/.test(trimmed)) {
        const item = trimmed.replace(/^[-*]\s+/, '').trim();
        if (!item) continue;

        if (currentCategory === 'breaking' || /\bBREAKING\b/.test(item)) {
          breakingChanges.push(item);
        } else if (currentCategory === 'feature') {
          newFeatures.push(item);
        } else if (currentCategory === 'fix') {
          bugFixes.push(item);
        } else if (currentCategory === 'deprecated' || /\bdeprecate/i.test(item)) {
          deprecations.push(item);
        } else if (item.toLowerCase().includes('breaking')) {
          breakingChanges.push(item);
        } else if (/^feat/i.test(item)) {
          newFeatures.push(item);
        } else if (/^fix/i.test(item)) {
          bugFixes.push(item);
        }
      }
    }

    return { date, content: content.substring(0, 2000), breakingChanges, newFeatures, bugFixes, deprecations };
  }

  private parseReleaseBody(body: string): { breakingChanges: string[]; newFeatures: string[] } {
    const result = this.parseChangelogSection(body);
    return { breakingChanges: result.breakingChanges, newFeatures: result.newFeatures };
  }

  private filterReleasesBetween(releases: ReleaseInfo[], fromVersion: string, toVersion: string): ReleaseInfo[] {
    const fromParts = this.parseVersionParts(fromVersion);
    const toParts = this.parseVersionParts(toVersion);
    if (!fromParts || !toParts) return [];

    return releases.filter((release) => {
      const version = release.tagName.replace(/^v/, '');
      const parts = this.parseVersionParts(version);
      return parts && this.isVersionBetween(parts, fromParts, toParts);
    });
  }

  private parseVersionParts(version: string): [number, number, number] | null {
    const clean = version.replace(/^v/, '');
    const match = clean.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (match) return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
    const majorMatch = clean.match(/^(\d+)$/);
    if (majorMatch) return [parseInt(majorMatch[1]), 0, 0];
    const majorMinor = clean.match(/^(\d+)\.(\d+)$/);
    if (majorMinor) return [parseInt(majorMinor[1]), parseInt(majorMinor[2]), 0];
    return null;
  }

  private isVersionBetween(
    v: [number, number, number],
    from: [number, number, number],
    to: [number, number, number]
  ): boolean {
    const vNum = v[0] * 10000 + v[1] * 100 + v[2];
    const fromNum = from[0] * 10000 + from[1] * 100 + from[2];
    const toNum = to[0] * 10000 + to[1] * 100 + to[2];
    return vNum > fromNum && vNum <= toNum;
  }

  clearCache(): void {
    this.changelogCache.clear();
    this.releaseCache.clear();
  }
}

// Singleton
let instance: ChangelogFetcher | null = null;

export function getChangelogFetcher(): ChangelogFetcher {
  if (!instance) {
    instance = new ChangelogFetcher();
  }
  return instance;
}
