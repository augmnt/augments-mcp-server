import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getVersionInfo,
  formatVersionInfoResponse,
  type GetVersionInfoOutput,
} from './get-version-info';
import type { PackageVersions, VersionDiff } from '@/core';

const mockGetVersions = vi.fn();
const mockGetVersionDiff = vi.fn();
const mockGetPackageName = vi.fn();

vi.mock('@/core', () => ({
  getQueryParser: () => ({
    getPackageName: mockGetPackageName,
  }),
  getVersionRegistry: () => ({
    getVersions: mockGetVersions,
    getVersionDiff: mockGetVersionDiff,
  }),
}));

vi.mock('@/utils/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const makePackageVersions = (overrides: Partial<PackageVersions> = {}): PackageVersions => ({
  packageName: 'react',
  latestStable: '18.2.0',
  latest: '18.2.0',
  tags: { latest: '18.2.0' },
  majorVersions: [
    { major: 18, latestVersion: '18.2.0', versions: ['18.2.0', '18.1.0'], isCurrent: true, isDeprecated: false },
  ],
  totalVersions: 50,
  lastChecked: Date.now(),
  ...overrides,
});

describe('get-version-info', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPackageName.mockReturnValue('react');
    mockGetVersionDiff.mockResolvedValue(null);
  });

  describe('getVersionInfo()', () => {
    it('returns version info for a known framework', async () => {
      const versions = makePackageVersions();
      mockGetVersions.mockResolvedValue(versions);

      const result = await getVersionInfo({ framework: 'react' });

      expect(result.packageName).toBe('react');
      expect(result.latestStable).toBe('18.2.0');
      expect(result.latest).toBe('18.2.0');
      expect(result.totalVersions).toBe(50);
      expect(result.majorVersions).toHaveLength(1);
      expect(result.majorVersions[0]).toMatchObject({ major: 18, isCurrent: true, isDeprecated: false });
      expect(result.diff).toBeUndefined();
    });

    it('returns empty result for an unknown framework', async () => {
      mockGetPackageName.mockReturnValue(null);
      mockGetVersions.mockResolvedValue(null);

      const result = await getVersionInfo({ framework: 'nonexistent-pkg-xyz' });

      expect(result.totalVersions).toBe(0);
      expect(result.latestStable).toBe('');
      expect(result.latest).toBe('');
      expect(result.notes).toContain('Package "nonexistent-pkg-xyz" not found on npm.');
    });

    it('handles fromVersion and toVersion comparison', async () => {
      const versions = makePackageVersions();
      mockGetVersions.mockResolvedValue(versions);

      const diff: VersionDiff = {
        from: '17.0.0',
        to: '18.2.0',
        isMajorChange: true,
        summary: ['Major version bump from 17 to 18'],
        breakingChanges: ['Removed legacy mode'],
        newFeatures: ['Concurrent rendering'],
      };
      mockGetVersionDiff.mockResolvedValue(diff);

      const result = await getVersionInfo({ framework: 'react', fromVersion: '17.0.0', toVersion: '18.2.0' });

      expect(mockGetVersionDiff).toHaveBeenCalledWith('react', '17.0.0', '18.2.0');
      expect(result.diff).toBeDefined();
      expect(result.diff?.isMajorChange).toBe(true);
      expect(result.diff?.breakingChanges).toContain('Removed legacy mode');
      expect(result.diff?.newFeatures).toContain('Concurrent rendering');
    });

    it('compares fromVersion to latestStable when toVersion is omitted', async () => {
      const versions = makePackageVersions();
      mockGetVersions.mockResolvedValue(versions);
      mockGetVersionDiff.mockResolvedValue({
        from: '17.0.0',
        to: '18.2.0',
        isMajorChange: true,
        summary: ['Upgraded to v18'],
      } as VersionDiff);

      const result = await getVersionInfo({ framework: 'react', fromVersion: '17.0.0' });

      expect(mockGetVersionDiff).toHaveBeenCalledWith('react', '17.0.0', '18.2.0');
      expect(result.diff?.from).toBe('17.0.0');
      expect(result.diff?.to).toBe('18.2.0');
    });

    it('adds notes for deprecated major versions', async () => {
      const versions = makePackageVersions({
        majorVersions: [
          { major: 18, latestVersion: '18.2.0', versions: ['18.2.0'], isCurrent: true, isDeprecated: false },
          { major: 16, latestVersion: '16.14.0', versions: ['16.14.0'], isCurrent: false, isDeprecated: true },
        ],
      });
      mockGetVersions.mockResolvedValue(versions);

      const result = await getVersionInfo({ framework: 'react' });

      expect(result.notes.some((n) => n.includes('16') && n.includes('deprecated'))).toBe(true);
    });

    it('adds notes for pre-release dist-tags', async () => {
      const versions = makePackageVersions({
        tags: { latest: '18.2.0', beta: '19.0.0-beta.1', canary: '19.0.0-canary.42' },
      });
      mockGetVersions.mockResolvedValue(versions);

      const result = await getVersionInfo({ framework: 'react' });

      expect(result.notes.some((n) => n.includes('Pre-release'))).toBe(true);
      expect(result.notes.some((n) => n.includes('beta: 19.0.0-beta.1'))).toBe(true);
    });

    it('propagates network errors from versionRegistry', async () => {
      mockGetVersions.mockRejectedValue(new Error('Network timeout'));

      await expect(getVersionInfo({ framework: 'react' })).rejects.toThrow('Network timeout');
    });
  });

  describe('formatVersionInfoResponse()', () => {
    function makeOutput(overrides: Partial<GetVersionInfoOutput> = {}): GetVersionInfoOutput {
      return {
        packageName: 'react',
        latestStable: '18.2.0',
        latest: '18.2.0',
        tags: { latest: '18.2.0' },
        majorVersions: [
          { major: 18, latestVersion: '18.2.0', isCurrent: true, isDeprecated: false },
        ],
        totalVersions: 50,
        notes: [],
        ...overrides,
      };
    }

    it('formats header with package name', () => {
      const response = formatVersionInfoResponse(makeOutput());
      expect(response).toContain('# react Version Info');
    });

    it('shows "Package not found" when totalVersions is 0', () => {
      const response = formatVersionInfoResponse(
        makeOutput({ totalVersions: 0, latestStable: '', latest: '' })
      );
      expect(response).toContain('Package not found on npm.');
      expect(response).not.toContain('## Latest Versions');
    });

    it('includes stable version in Latest Versions section', () => {
      const response = formatVersionInfoResponse(makeOutput());
      expect(response).toContain('## Latest Versions');
      expect(response).toContain('**Stable**: 18.2.0');
    });

    it('shows separate Latest line when latest differs from stable', () => {
      const response = formatVersionInfoResponse(makeOutput({ latest: '19.0.0-beta.1' }));
      expect(response).toContain('**Latest**: 19.0.0-beta.1');
    });

    it('omits separate Latest line when latest equals stable', () => {
      const response = formatVersionInfoResponse(makeOutput());
      const latestLineCount = (response.match(/\*\*Latest\*\*/g) || []).length;
      expect(latestLineCount).toBe(0);
    });

    it('renders Distribution Tags section when more than one tag exists', () => {
      const output = makeOutput({ tags: { latest: '18.2.0', next: '19.0.0-rc.1' } });
      const response = formatVersionInfoResponse(output);
      expect(response).toContain('## Distribution Tags');
      expect(response).toContain('`next`: 19.0.0-rc.1');
    });

    it('omits Distribution Tags section when only one tag exists', () => {
      const response = formatVersionInfoResponse(makeOutput());
      expect(response).not.toContain('## Distribution Tags');
    });

    it('renders Major Versions section with status labels', () => {
      const output = makeOutput({
        majorVersions: [
          { major: 18, latestVersion: '18.2.0', isCurrent: true, isDeprecated: false },
          { major: 16, latestVersion: '16.14.0', isCurrent: false, isDeprecated: true },
        ],
      });
      const response = formatVersionInfoResponse(output);
      expect(response).toContain('## Major Versions');
      expect(response).toContain('**v18**: 18.2.0 (current)');
      expect(response).toContain('**v16**: 16.14.0 (deprecated)');
    });

    it('includes breaking changes and new features when diff is present', () => {
      const diff: VersionDiff = {
        from: '17.0.0',
        to: '18.2.0',
        isMajorChange: true,
        summary: ['Major version bump'],
        breakingChanges: ['Removed unstable_ConcurrentMode', 'ReactDOM.render is deprecated'],
        newFeatures: ['useId hook', 'useDeferredValue hook'],
      };
      const response = formatVersionInfoResponse(makeOutput({ diff }));

      expect(response).toContain('## Version Comparison');
      expect(response).toContain('From: 17.0.0');
      expect(response).toContain('To: 18.2.0');
      expect(response).toContain('**Major version change - may contain breaking changes**');
      expect(response).toContain('### Breaking Changes');
      expect(response).toContain('Removed unstable_ConcurrentMode');
      expect(response).toContain('ReactDOM.render is deprecated');
      expect(response).toContain('### New Features');
      expect(response).toContain('useId hook');
      expect(response).toContain('useDeferredValue hook');
    });

    it('truncates breaking changes beyond 20 entries with overflow note', () => {
      const diff: VersionDiff = {
        from: '1.0.0',
        to: '2.0.0',
        isMajorChange: true,
        summary: [],
        breakingChanges: Array.from({ length: 25 }, (_, i) => `Breaking change ${i + 1}`),
      };
      const response = formatVersionInfoResponse(makeOutput({ diff }));
      expect(response).toContain('*...and 5 more*');
    });

    it('truncates new features beyond 15 entries with overflow note', () => {
      const diff: VersionDiff = {
        from: '1.0.0',
        to: '2.0.0',
        isMajorChange: false,
        summary: [],
        newFeatures: Array.from({ length: 18 }, (_, i) => `New feature ${i + 1}`),
      };
      const response = formatVersionInfoResponse(makeOutput({ diff }));
      expect(response).toContain('*...and 3 more*');
    });

    it('renders Notes section when notes are present', () => {
      const output = makeOutput({ notes: ['Version 16 is deprecated.'] });
      const response = formatVersionInfoResponse(output);
      expect(response).toContain('## Notes');
      expect(response).toContain('Version 16 is deprecated.');
    });

    it('includes total version count footer', () => {
      const response = formatVersionInfoResponse(makeOutput({ totalVersions: 123 }));
      expect(response).toContain('*Total versions on npm: 123*');
    });
  });
});
