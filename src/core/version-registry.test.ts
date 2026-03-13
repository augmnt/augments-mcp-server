import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VersionRegistry } from './version-registry';

vi.mock('@/utils/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockGetVersions = vi.fn();
const mockGetBreakingChanges = vi.fn();
const mockGetNewFeatures = vi.fn();

vi.mock('./type-fetcher', () => ({
  getTypeFetcher: () => ({
    getVersions: mockGetVersions,
  }),
}));

vi.mock('./changelog-fetcher', () => ({
  getChangelogFetcher: () => ({
    getBreakingChanges: mockGetBreakingChanges,
    getNewFeatures: mockGetNewFeatures,
  }),
}));

describe('VersionRegistry', () => {
  let registry: VersionRegistry;

  beforeEach(() => {
    registry = new VersionRegistry();
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // parseVersion
  // ---------------------------------------------------------------------------
  describe('parseVersion()', () => {
    it('parses a full semver string', () => {
      const result = registry.parseVersion('19.0.0');
      expect(result).not.toBeNull();
      expect(result!.major).toBe(19);
      expect(result!.minor).toBe(0);
      expect(result!.patch).toBe(0);
      expect(result!.version).toBe('19.0.0');
      expect(result!.prerelease).toBeUndefined();
    });

    it('parses a semver string with prerelease tag', () => {
      const result = registry.parseVersion('19.0.0-beta.1');
      expect(result).not.toBeNull();
      expect(result!.major).toBe(19);
      expect(result!.minor).toBe(0);
      expect(result!.patch).toBe(0);
      expect(result!.prerelease).toBe('beta.1');
    });

    it('parses a semver string with build metadata (strips it)', () => {
      const result = registry.parseVersion('1.2.3+build.42');
      expect(result).not.toBeNull();
      expect(result!.version).toBe('1.2.3');
      expect(result!.major).toBe(1);
      expect(result!.minor).toBe(2);
      expect(result!.patch).toBe(3);
    });

    it('parses major.minor partial version (no patch)', () => {
      const result = registry.parseVersion('19.1');
      expect(result).not.toBeNull();
      expect(result!.major).toBe(19);
      expect(result!.minor).toBe(1);
      expect(result!.patch).toBe(0);
      expect(result!.version).toBe('19.1.0');
    });

    it('parses major-only partial version', () => {
      const result = registry.parseVersion('18');
      expect(result).not.toBeNull();
      expect(result!.major).toBe(18);
      expect(result!.minor).toBe(0);
      expect(result!.patch).toBe(0);
      expect(result!.version).toBe('18.0.0');
    });

    it('returns null for an invalid version string', () => {
      expect(registry.parseVersion('not-a-version')).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(registry.parseVersion('')).toBeNull();
    });

    it('returns null for a plain float like "1.2.3.4"', () => {
      expect(registry.parseVersion('1.2.3.4')).toBeNull();
    });

    it('returns null for a string with leading "v"', () => {
      // The regex requires a digit first; "v1.2.3" does not match
      expect(registry.parseVersion('v1.2.3')).toBeNull();
    });

    it('parses 0.x.x correctly', () => {
      const result = registry.parseVersion('0.14.0');
      expect(result).not.toBeNull();
      expect(result!.major).toBe(0);
      expect(result!.minor).toBe(14);
      expect(result!.patch).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // groupByMajor (tested indirectly via getVersions)
  // ---------------------------------------------------------------------------
  describe('groupByMajor() — via getVersions()', () => {
    beforeEach(() => {
      mockGetVersions.mockResolvedValue({
        versions: ['19.0.0', '19.0.1', '18.3.0', '18.2.0', '17.0.0'],
        latest: '19.0.1',
        tags: { latest: '19.0.1' },
      });
    });

    it('groups versions into major version buckets', async () => {
      const info = await registry.getVersions('react');
      expect(info).not.toBeNull();
      const majors = info!.majorVersions.map((g) => g.major);
      expect(majors).toContain(19);
      expect(majors).toContain(18);
      expect(majors).toContain(17);
    });

    it('each group contains only versions with that major number', async () => {
      const info = await registry.getVersions('react');
      const group18 = info!.majorVersions.find((g) => g.major === 18);
      expect(group18).toBeDefined();
      expect(group18!.versions).toContain('18.3.0');
      expect(group18!.versions).toContain('18.2.0');
      expect(group18!.versions).not.toContain('19.0.0');
    });

    it('latestVersion in each group is the highest stable version', async () => {
      const info = await registry.getVersions('react');
      const group19 = info!.majorVersions.find((g) => g.major === 19);
      expect(group19!.latestVersion).toBe('19.0.1');
    });

    it('marks the current major (matching latestStable) as isCurrent', async () => {
      const info = await registry.getVersions('react');
      const group19 = info!.majorVersions.find((g) => g.major === 19);
      expect(group19!.isCurrent).toBe(true);
    });

    it('marks old majors (more than 1 behind current) as deprecated', async () => {
      const info = await registry.getVersions('react');
      // current is 19; 17 is 2 behind → deprecated
      const group17 = info!.majorVersions.find((g) => g.major === 17);
      expect(group17!.isDeprecated).toBe(true);
      // 18 is only 1 behind → not deprecated
      const group18 = info!.majorVersions.find((g) => g.major === 18);
      expect(group18!.isDeprecated).toBe(false);
    });

    it('returns an empty majorVersions array when version list is empty', async () => {
      mockGetVersions.mockResolvedValue({
        versions: [],
        latest: '',
        tags: {},
      });
      const info = await registry.getVersions('empty-pkg');
      expect(info).not.toBeNull();
      expect(info!.majorVersions).toHaveLength(0);
    });

    it('sorts major version groups in descending order', async () => {
      const info = await registry.getVersions('react');
      const majors = info!.majorVersions.map((g) => g.major);
      expect(majors[0]).toBeGreaterThan(majors[majors.length - 1]);
    });

    it('prerelease version is ranked lower than stable in same major group', async () => {
      mockGetVersions.mockResolvedValue({
        versions: ['20.0.0-alpha.1', '20.0.0'],
        latest: '20.0.0',
        tags: { latest: '20.0.0' },
      });
      const info = await registry.getVersions('future-pkg');
      const group20 = info!.majorVersions.find((g) => g.major === 20);
      // latestVersion should be the stable release, not the alpha
      expect(group20!.latestVersion).toBe('20.0.0');
    });
  });

  // ---------------------------------------------------------------------------
  // resolveVersion
  // ---------------------------------------------------------------------------
  describe('resolveVersion()', () => {
    beforeEach(() => {
      mockGetVersions.mockResolvedValue({
        versions: ['19.1.0', '19.0.1', '19.0.0', '18.3.0', '18.2.0'],
        latest: '19.1.0',
        tags: { latest: '19.1.0', next: '19.1.0' },
      });
    });

    it('resolves "latest" to the latest stable version', async () => {
      const version = await registry.resolveVersion('react', 'latest');
      expect(version).toBe('19.1.0');
    });

    it('resolves undefined constraint to the latest stable version', async () => {
      const version = await registry.resolveVersion('react');
      expect(version).toBe('19.1.0');
    });

    it('resolves a dist-tag like "next" to its mapped version', async () => {
      const version = await registry.resolveVersion('react', 'next');
      expect(version).toBe('19.1.0');
    });

    it('resolves an exact semver constraint that exists in the list', async () => {
      const version = await registry.resolveVersion('react', '18.3.0');
      expect(version).toBe('18.3.0');
    });

    it('resolves a partial major-only string ("18") to the latest in that major', async () => {
      const version = await registry.resolveVersion('react', '18');
      expect(version).toBe('18.3.0');
    });

    it('resolves a major.minor partial string to the best patch in that minor', async () => {
      // "19.0" should match 19.0.1 (highest patch)
      const version = await registry.resolveVersion('react', '19.0');
      expect(version).toBe('19.0.1');
    });

    it('falls back to major group latest when minor has no exact match', async () => {
      // "18.9" doesn't exist; fall back to 18 major latest
      const version = await registry.resolveVersion('react', '18.9');
      expect(version).toBe('18.3.0');
    });

    it('returns null when the package does not exist', async () => {
      mockGetVersions.mockResolvedValue(null);
      const version = await registry.resolveVersion('nonexistent-pkg', 'latest');
      expect(version).toBeNull();
    });

    it('returns null for a completely unrecognised constraint', async () => {
      const version = await registry.resolveVersion('react', 'nonsense-constraint');
      expect(version).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getVersionDiff
  // ---------------------------------------------------------------------------
  describe('getVersionDiff()', () => {
    beforeEach(() => {
      mockGetBreakingChanges.mockResolvedValue([]);
      mockGetNewFeatures.mockResolvedValue([]);
    });

    it('returns null when fromVersion is invalid', async () => {
      const diff = await registry.getVersionDiff('react', 'not-valid', '19.0.0');
      expect(diff).toBeNull();
    });

    it('returns null when toVersion is invalid', async () => {
      const diff = await registry.getVersionDiff('react', '18.0.0', 'not-valid');
      expect(diff).toBeNull();
    });

    it('detects a major version change', async () => {
      const diff = await registry.getVersionDiff('react', '18.2.0', '19.0.0');
      expect(diff).not.toBeNull();
      expect(diff!.isMajorChange).toBe(true);
      expect(diff!.from).toBe('18.2.0');
      expect(diff!.to).toBe('19.0.0');
    });

    it('does not flag a minor change as major', async () => {
      const diff = await registry.getVersionDiff('react', '18.2.0', '18.3.0');
      expect(diff).not.toBeNull();
      expect(diff!.isMajorChange).toBe(false);
    });

    it('does not flag a patch change as major', async () => {
      const diff = await registry.getVersionDiff('react', '18.2.0', '18.2.1');
      expect(diff!.isMajorChange).toBe(false);
    });

    it('includes breaking changes returned by the changelog fetcher', async () => {
      mockGetBreakingChanges.mockResolvedValue(['Remove legacy context API', 'Drop IE11 support']);
      const diff = await registry.getVersionDiff('react', '17.0.0', '18.0.0');
      expect(diff!.breakingChanges).toEqual(['Remove legacy context API', 'Drop IE11 support']);
    });

    it('includes new features returned by the changelog fetcher', async () => {
      mockGetNewFeatures.mockResolvedValue(['Concurrent rendering', 'Automatic batching']);
      const diff = await registry.getVersionDiff('react', '17.0.0', '18.0.0');
      expect(diff!.newFeatures).toEqual(['Concurrent rendering', 'Automatic batching']);
    });

    it('leaves breakingChanges undefined when changelog returns an empty array', async () => {
      mockGetBreakingChanges.mockResolvedValue([]);
      mockGetNewFeatures.mockResolvedValue([]);
      const diff = await registry.getVersionDiff('react', '18.2.0', '18.3.0');
      expect(diff!.breakingChanges).toBeUndefined();
    });

    it('leaves newFeatures undefined when changelog returns an empty array', async () => {
      mockGetBreakingChanges.mockResolvedValue([]);
      mockGetNewFeatures.mockResolvedValue([]);
      const diff = await registry.getVersionDiff('react', '18.2.0', '18.2.1');
      expect(diff!.newFeatures).toBeUndefined();
    });

    it('summary mentions major version numbers on a major change', async () => {
      const diff = await registry.getVersionDiff('react', '17.0.0', '18.0.0');
      expect(diff!.summary.some((s) => s.includes('17') || s.includes('18'))).toBe(true);
    });

    it('summary mentions new features on a minor change', async () => {
      const diff = await registry.getVersionDiff('react', '18.2.0', '18.3.0');
      expect(diff!.summary.some((s) => /new features/i.test(s))).toBe(true);
    });

    it('summary mentions bug fixes on a patch change', async () => {
      const diff = await registry.getVersionDiff('react', '18.2.0', '18.2.1');
      expect(diff!.summary.some((s) => /bug fix|patch/i.test(s))).toBe(true);
    });

    it('still returns a diff when the changelog fetcher throws', async () => {
      mockGetBreakingChanges.mockRejectedValue(new Error('network error'));
      mockGetNewFeatures.mockRejectedValue(new Error('network error'));
      const diff = await registry.getVersionDiff('react', '17.0.0', '18.0.0');
      expect(diff).not.toBeNull();
      expect(diff!.isMajorChange).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  describe('edge cases', () => {
    it('returns null from getVersions when the fetcher returns null', async () => {
      mockGetVersions.mockResolvedValue(null);
      const result = await registry.getVersions('nonexistent-pkg');
      expect(result).toBeNull();
    });

    it('returns null from getVersions when the fetcher throws', async () => {
      mockGetVersions.mockRejectedValue(new Error('registry unavailable'));
      const result = await registry.getVersions('broken-pkg');
      expect(result).toBeNull();
    });

    it('getVersionDiff with same from and to version sets isMajorChange to false', async () => {
      mockGetBreakingChanges.mockResolvedValue([]);
      mockGetNewFeatures.mockResolvedValue([]);
      const diff = await registry.getVersionDiff('react', '18.0.0', '18.0.0');
      expect(diff).not.toBeNull();
      expect(diff!.isMajorChange).toBe(false);
    });

    it('getVersionDiff with same from and to returns patch-level summary', async () => {
      mockGetBreakingChanges.mockResolvedValue([]);
      mockGetNewFeatures.mockResolvedValue([]);
      const diff = await registry.getVersionDiff('react', '18.0.0', '18.0.0');
      expect(diff!.summary.some((s) => /patch/i.test(s))).toBe(true);
    });

    it('resolveVersion returns null when version list is empty', async () => {
      mockGetVersions.mockResolvedValue({
        versions: [],
        latest: '',
        tags: {},
      });
      // latestStable will fall back to versionData.latest which is ""
      // parseVersion("") returns null, so majorVersions will be []
      const version = await registry.resolveVersion('empty-pkg', '18');
      expect(version).toBeNull();
    });

    it('cache is used on the second call — fetcher is only called once', async () => {
      mockGetVersions.mockResolvedValue({
        versions: ['1.0.0'],
        latest: '1.0.0',
        tags: {},
      });
      await registry.getVersions('cached-pkg');
      await registry.getVersions('cached-pkg');
      expect(mockGetVersions).toHaveBeenCalledTimes(1);
    });

    it('clearCache() forces a fresh fetch on the next call', async () => {
      mockGetVersions.mockResolvedValue({
        versions: ['1.0.0'],
        latest: '1.0.0',
        tags: {},
      });
      await registry.getVersions('cached-pkg');
      registry.clearCache();
      await registry.getVersions('cached-pkg');
      expect(mockGetVersions).toHaveBeenCalledTimes(2);
    });

    it('clearPackageCache() evicts only the specified package', async () => {
      mockGetVersions.mockResolvedValue({
        versions: ['1.0.0'],
        latest: '1.0.0',
        tags: {},
      });
      await registry.getVersions('pkg-a');
      await registry.getVersions('pkg-b');
      registry.clearPackageCache('pkg-a');
      await registry.getVersions('pkg-a'); // should re-fetch
      await registry.getVersions('pkg-b'); // should use cache
      // pkg-a fetched twice, pkg-b fetched once → total 3
      expect(mockGetVersions).toHaveBeenCalledTimes(3);
    });
  });
});
