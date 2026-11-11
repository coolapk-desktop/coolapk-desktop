import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APP_VERSION } from '../../constants/version';
import {
  isNewerVersion,
  isUpdateAssetCompatible,
  checkLatestRelease,
  normalizeVersion,
  selectInstallerAsset,
  selectPortableAsset,
  shouldReplaceDownloadedUpdate,
  versionFromAssetName,
} from '../updateChecker';

// 固定正式版测试环境，避免 CI 注入测试版版本号后将稳定版响应误构造成预发布版本。
vi.mock('../../constants/version', () => ({ APP_VERSION: '1.9.1' }));

describe('updateChecker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('isNewerVersion', () => {
    it('returns true when latest is greater than current', () => {
      expect(isNewerVersion('1.4.6', '1.4.5')).toBe(true);
      expect(isNewerVersion('v1.5.0', '1.4.5')).toBe(true);
      expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
    });

    it('returns false when latest is equal or lower than current', () => {
      expect(isNewerVersion('1.4.5', '1.4.5')).toBe(false);
      expect(isNewerVersion('1.4.4', '1.4.5')).toBe(false);
      expect(isNewerVersion('v1.3.9', '1.4.5')).toBe(false);
    });

    it('compares prerelease versions using semver rules', () => {
      expect(isNewerVersion('1.5.0-beta.2', '1.5.0-beta.1')).toBe(true);
      expect(isNewerVersion('1.5.0', '1.5.0-beta.9')).toBe(true);
      expect(isNewerVersion('1.5.0-beta.1', '1.5.0')).toBe(false);
    });

    it('rejects malformed versions instead of treating them as zeroes', () => {
      expect(isNewerVersion('1.x.0', '1.0.0')).toBe(false);
      expect(isNewerVersion('release-latest', '1.0.0')).toBe(false);
      expect(normalizeVersion('v2.3.4+build.7')).toBe('2.3.4');
      expect(normalizeVersion('not-a-version')).toBeNull();
    });
  });

  describe('versionFromAssetName', () => {
    it.each([
      'coolapk-desktop_1.29.0_x64.dmg',
      'coolapk-desktop_1.29.0_aarch64-123-456.dmg',
      'coolapk-desktop_1.29.0_amd64.AppImage',
      'coolapk-desktop_1.29.0_amd64-123-456.appimage',
      'coolapk-desktop_1.29.0_arm64.deb',
      'coolapk-desktop-1.29.0-1.x86_64.rpm',
      'coolapk-desktop-1.29.0-1.x86_64-123-456.rpm',
    ])('extracts macOS/Linux release and cached package versions: %s', (name) => {
      expect(versionFromAssetName(name)).toBe('1.29.0');
    });

    it('preserves prerelease versions in macOS and RPM package names', () => {
      expect(versionFromAssetName('coolapk-desktop_1.29.0-beta.2_aarch64.dmg')).toBe('1.29.0-beta.2');
      expect(versionFromAssetName('coolapk-desktop-1.29.0-beta.2-1.x86_64.rpm')).toBe('1.29.0-beta.2');
    });
    it('extracts versions from downloaded files with updater suffixes', () => {
      expect(versionFromAssetName('coolapk-desktop_1.20.2_x64-portable-123-456.exe'))
        .toBe('1.20.2');
      expect(versionFromAssetName('coolapk-desktop_1.20.2_x64-setup-123-456.exe'))
        .toBe('1.20.2');
    });
  });

  describe('isUpdateAssetCompatible', () => {
    it('rejects mismatched Linux package types and architectures', () => {
      const platform = { os: 'linux', arch: 'x86_64' };
      expect(isUpdateAssetCompatible('coolapk-desktop_1.29.0_amd64.deb', platform, 'deb')).toBe(true);
      expect(isUpdateAssetCompatible('coolapk-desktop_1.29.0_amd64.deb', platform, 'portable')).toBe(false);
      expect(isUpdateAssetCompatible('coolapk-desktop_1.29.0_arm64.deb', platform, 'deb')).toBe(false);
      expect(isUpdateAssetCompatible('coolapk-desktop_1.29.0_amd64.AppImage', platform, 'unsupported')).toBe(false);
      expect(isUpdateAssetCompatible('coolapk-desktop_1.29.0_amd64.AppImage', platform, 'installer')).toBe(false);
    });
    it('validates architecture and package type for cached updater file names', () => {
      const platform = { os: 'windows' as const, arch: 'x86_64' as const };
      expect(isUpdateAssetCompatible(
        'coolapk-desktop_1.20.2_x64-portable-123-456.exe',
        platform,
        'portable'
      )).toBe(true);
      expect(isUpdateAssetCompatible(
        'coolapk-desktop_1.20.2_arm64-portable-123-456.exe',
        platform,
        'portable'
      )).toBe(false);
      expect(isUpdateAssetCompatible(
        'coolapk-desktop_1.20.2_x64-setup-123-456.exe',
        platform,
        'portable'
      )).toBe(false);
    });
  });

  describe('shouldReplaceDownloadedUpdate', () => {
    it('reuses the downloaded package when GitHub is unavailable or not newer', () => {
      expect(shouldReplaceDownloadedUpdate('1.20.2', '', false)).toBe(false);
      expect(shouldReplaceDownloadedUpdate('1.20.2', '1.20.2', true)).toBe(false);
      expect(shouldReplaceDownloadedUpdate('1.20.2', '1.20.1', true)).toBe(false);
      expect(shouldReplaceDownloadedUpdate('1.20.2', 'invalid', true)).toBe(false);
    });

    it('replaces it only when GitHub has a newer compatible package', () => {
      expect(shouldReplaceDownloadedUpdate('1.20.2', '1.20.3', true)).toBe(true);
      expect(shouldReplaceDownloadedUpdate('1.20.2', '1.20.3', false)).toBe(false);
    });
  });

  describe('checkLatestRelease', () => {
    it.each([
      ['macos', 'x86_64', 'installer', 'coolapk-desktop_9.9.9_x64.dmg'],
      ['macos', 'aarch64', 'installer', 'coolapk-desktop_9.9.9_aarch64.dmg'],
      ['linux', 'x86_64', 'portable', 'coolapk-desktop_9.9.9_amd64.AppImage'],
      ['linux', 'x86_64', 'deb', 'coolapk-desktop_9.9.9_amd64.deb'],
      ['linux', 'x86_64', 'rpm', 'coolapk-desktop-9.9.9-1.x86_64.rpm'],
    ] as const)('selects %s %s %s package', async (os, arch, packageType, name) => {
      const names = [
        'coolapk-desktop_9.9.9_x64.dmg', 'coolapk-desktop_9.9.9_aarch64.dmg',
        'coolapk-desktop_9.9.9_amd64.AppImage', 'coolapk-desktop_9.9.9_amd64.deb',
        'coolapk-desktop-9.9.9-1.x86_64.rpm', 'coolapk-desktop_9.9.9_arm64-setup.exe',
      ];
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true, json: async () => ({ tag_name: 'v9.9.9', assets: names.map((name) => ({
          name, browser_download_url: `https://github.com/download/${name}`,
        })) }),
      } as Response);
      const info = await checkLatestRelease('stable', { os, arch }, packageType);
      expect(info.installerName).toBe(name);
      expect(info.packageType).toBe(packageType);
    });

    it.each(['macos', 'linux'])('rejects older version assets on %s', async (os) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true, json: async () => ({ tag_name: 'v9.9.9', assets: [
          { name: 'coolapk-desktop_9.9.8_x64.dmg', browser_download_url: 'old-macos' },
          { name: 'coolapk-desktop_9.9.8_amd64.AppImage', browser_download_url: 'old-linux' },
        ] }),
      } as Response);
      const info = await checkLatestRelease('stable', { os, arch: 'x86_64' }, os === 'linux' ? 'portable' : 'installer');
      expect(info.installerUrl).toBeUndefined();
    });
    it('fetches stable latest release and matches installer URL', async () => {
      const mockRelease = {
        tag_name: 'v9.9.9',
        body: '这是升级日志说明',
        html_url: 'https://github.com/coolapk-desktop/coolapk-desktop/releases/tag/v9.9.9',
        assets: [
          {
            name: 'coolapk-desktop_9.9.9_x64-setup.exe',
            browser_download_url: 'https://github.com/download/coolapk-desktop_9.9.9_x64-setup.exe',
          },
          {
            name: 'coolapk-desktop_9.9.9_arm64-setup.exe',
            browser_download_url: 'https://github.com/download/coolapk-desktop_9.9.9_arm64-setup.exe',
          },
        ],
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockRelease,
      } as Response);

      const info = await checkLatestRelease('stable', { os: 'windows', arch: 'x86_64' });
      expect(info.hasNew).toBe(true);
      expect(info.latestVersion).toBe('v9.9.9');
      expect(info.installerUrl).toBe('https://github.com/download/coolapk-desktop_9.9.9_x64-setup.exe');
      expect(info.releaseNotes).toBe('这是升级日志说明');
    });

    it('does not select an installer from a different release version', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: 'v2.0.0',
          assets: [
            {
              name: 'coolapk-desktop_1.9.0_x64-setup.exe',
              browser_download_url: 'https://github.com/download/old.exe',
            },
          ],
        }),
      } as Response);

      const info = await checkLatestRelease('stable', { os: 'windows', arch: 'x86_64' });
      expect(info.hasNew).toBe(true);
      expect(info.installerUrl).toBeUndefined();
    });

    it('matches the current architecture portable executable', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: 'v9.9.9',
          assets: [
            {
              name: 'coolapk-desktop_9.9.9_x64-portable.exe',
              browser_download_url: 'https://github.com/download/x64-portable.exe',
            },
            {
              name: 'coolapk-desktop_9.9.9_arm64-portable.exe',
              browser_download_url: 'https://github.com/download/arm64-portable.exe',
            },
          ],
        }),
      } as Response);

      const info = await checkLatestRelease(
        'stable',
        { os: 'windows', arch: 'aarch64' },
        'portable'
      );
      expect(info.installerUrl).toBe('https://github.com/download/arm64-portable.exe');
      expect(info.packageType).toBe('portable');
    });

    it('returns remote release body as changelog when current version is latest and remote has body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: `v${APP_VERSION}`,
          body: '1.9.1 远程说明',
          published_at: '2026-08-21T11:51:14Z',
        }),
      } as Response);

      const info = await checkLatestRelease('stable', { os: 'windows', arch: 'x86_64' });
      expect(info.hasNew).toBe(false);
      expect(info.releaseNotes).toBe('1.9.1 远程说明');
      expect(info.publishedAt).toBeDefined();
    });

    it('returns builtin changelog when current version is latest and remote body is empty', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: `v${APP_VERSION}`,
          body: '',
        }),
      } as Response);

      const info = await checkLatestRelease('stable', { os: 'windows', arch: 'x86_64' });
      expect(info.hasNew).toBe(false);
      expect(info.releaseNotes).toBe('暂无当前版本的更新日志。');
      expect(info.publishedAt).toBeUndefined();
    });
  });

  describe('GitHub 更新源', () => {
    const repository = 'coolapk-desktop/coolapk-desktop';
    const releasesUrl = `https://api.github.com/repos/${repository}/releases`;
    const platform = { os: 'windows', arch: 'x86_64' } as const;
    const release = (version: string, arch = 'x64') => ({
      tag_name: `v${version}`, body: repository,
      html_url: `https://github.com/${repository}/releases/tag/v${version}`,
      assets: [{ name: `coolapk-desktop_${version}_${arch}-setup.exe`, browser_download_url: `https://github.com/${repository}/releases/download/v${version}/coolapk-desktop_${version}_${arch}-setup.exe` }],
    });
    const response = (value: any, status = 200) => ({ ok: status === 200, status, json: async () => value }) as Response;

    it('稳定渠道只检查新仓库并选择安装包', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(release('9.0.0')));
      const result = await checkLatestRelease('stable', platform);
      expect(result.latestVersion).toBe('v9.0.0');
      expect(result.releaseNotes).toBe(repository);
      expect(result.downloadUrl).toContain(repository);
      expect(result.installerUrl).toContain(repository);
      expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([`${releasesUrl}/latest`, `${releasesUrl}?per_page=100`]);
    });

    it('正式渠道跨页补齐当前版本到目标版本之间的日志', async () => {
      const target = { ...release('2.1.0'), body: '目标版日志' };
      const firstPage = [
        { ...target, body: '重复的目标日志' },
        { ...release('2.0.0'), body: '中间版日志' },
        { ...release('2.0.1-beta.1'), prerelease: true, body: '测试版日志' },
        { ...release('2.0.1'), draft: true, body: '草稿日志' },
        { ...release('2.2.0'), body: '目标之后的日志' },
        { ...release(APP_VERSION), body: '当前版本日志' },
        ...Array.from({ length: 94 }, () => release('1.8.0')),
      ];
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        if (url === `${releasesUrl}/latest`) return response(target);
        if (url === `${releasesUrl}?per_page=100`) return response(firstPage);
        return response([{ ...release('1.9.2'), body: '较早的中间版日志' }]);
      });
      const result = await checkLatestRelease('stable', platform);
      expect(result.latestVersion).toBe('v2.1.0');
      expect(result.installerUrl).toBe(target.assets[0].browser_download_url);
      expect(result.releaseNotes).toBe('## v2.1.0\n\n目标版日志\n\n---\n\n## v2.0.0\n\n中间版日志\n\n---\n\n## v1.9.2\n\n较早的中间版日志');
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${releasesUrl}/latest`, `${releasesUrl}?per_page=100`, `${releasesUrl}?per_page=100&page=2`]);
    });

    it('历史查询失败时保留目标版本的日志和安装包', async () => {
      const target = { ...release('2.1.0'), body: '目标版日志' };
      vi.spyOn(globalThis, 'fetch').mockImplementation(async url =>
        url === `${releasesUrl}/latest` ? response(target) : response(null, 503));
      const result = await checkLatestRelease('stable', platform);
      expect(result).toMatchObject({ hasNew: true, releaseNotes: target.body, installerUrl: target.assets[0].browser_download_url });
    });

    it('仓库没有可用发布版本时返回明确错误', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(null, 404));
      await expect(checkLatestRelease('stable', platform)).rejects.toThrow('未从 GitHub 获取到可用的发布版本');
    });

    it('测试渠道合并新仓库的测试版列表与正式版，列表失败时仍保留正式版', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const source = String(url);
        if (source.includes('?')) throw new Error('列表不可用');
        return response(release('8.0.0'));
      });
      const result = await checkLatestRelease('beta', platform);
      expect(result).toMatchObject({ latestVersion: 'v8.0.0', releaseNotes: repository });
    });

    it('测试渠道沿用已获取的发布列表，按版本合并正式版和测试版日志', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => String(url).includes('?')
        ? response([
          { ...release('9.0.0-beta.2'), prerelease: true, body: 'beta 2 日志' },
          { ...release('9.0.0-beta.1'), prerelease: true, body: 'beta 1 日志' },
          release('8.0.0'),
        ])
        : response(release('8.0.0')));
      const result = await checkLatestRelease('beta', platform);
      expect(result.latestVersion).toBe('v9.0.0-beta.2');
      expect(result.releaseNotes).toBe(`## v9.0.0-beta.2\n\nbeta 2 日志\n\n---\n\n## v9.0.0-beta.1\n\nbeta 1 日志\n\n---\n\n## v8.0.0\n\n${repository}`);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('当前版本日志只从新仓库读取', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const source = String(url);
        if (source.includes('/tags/')) return response(release(APP_VERSION));
        return response(release('1.0.0'));
      });
      const result = await checkLatestRelease('stable', platform);
      expect(result.hasNew).toBe(false);
      expect(result.releaseNotes).toBe(repository);
      expect(result.downloadUrl).toContain(repository);
    });
  });

  describe('selectInstallerAsset', () => {
    const assets = [
      { name: 'coolapk-desktop_9.9.9_x64-setup.exe', browser_download_url: 'x64-url' },
      { name: 'coolapk-desktop_9.9.9_arm64-setup.exe', browser_download_url: 'arm64-url' },
    ];

    it('selects the x64 installer on Windows x86_64', () => {
      expect(selectInstallerAsset(assets, { os: 'windows', arch: 'x86_64' })?.browser_download_url)
        .toBe('x64-url');
    });

    it('selects the arm64 installer on Windows aarch64', () => {
      expect(selectInstallerAsset(assets, { os: 'windows', arch: 'aarch64' })?.browser_download_url)
        .toBe('arm64-url');
    });
  });

  describe('selectPortableAsset', () => {
    const assets = [
      { name: 'coolapk-desktop_9.9.9_x64-portable.exe', browser_download_url: 'x64-url' },
      { name: 'coolapk-desktop_9.9.9_arm64-portable.exe', browser_download_url: 'arm64-url' },
      { name: 'coolapk-desktop_9.9.9_x64-setup.exe', browser_download_url: 'setup-url' },
    ];

    it('selects only the matching architecture portable executable', () => {
      expect(selectPortableAsset(assets, { os: 'windows', arch: 'x86_64' })?.browser_download_url)
        .toBe('x64-url');
      expect(selectPortableAsset(assets, { os: 'windows', arch: 'aarch64' })?.browser_download_url)
        .toBe('arm64-url');
    });
  });
});
