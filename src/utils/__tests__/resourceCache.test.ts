import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockObjectUrls } from '../../test-utils/objectUrls';
import {
  canPersistResource,
  clearResourceCache,
  clearResourceMemoryCache,
  loadImageResource,
  getMemoryCachedResourceSync,
  getResourceMemoryCacheStats,
  normalizeResourceUrl,
  retainResourceUrl,
} from '../resourceCache';

describe('资源缓存', () => {
  let blobs: Map<string, Blob>;
  beforeEach(() => {
    clearResourceMemoryCache();
    blobs = mockObjectUrls();
  });

  afterEach(() => {
    clearResourceMemoryCache();
    vi.restoreAllMocks();
  });

  it('统一资源地址并允许全部网络图片持久化', () => {
    expect(normalizeResourceUrl('//image.coolapk.com/a.png')).toBe('https://image.coolapk.com/a.png');
    expect(normalizeResourceUrl('http://image.coolapk.com/a.png')).toBe('https://image.coolapk.com/a.png');
    expect(canPersistResource('https://image.coolapk.com/a.png')).toBe(true);
    expect(canPersistResource('https://api.coolapk.com/v6/message/showImage?id=1')).toBe(true);
    expect(canPersistResource('file:///C:/secret.png')).toBe(false);
  });

  it('并发加载相同图片时只发起一次原生请求', async () => {
    let finish!: (value: string) => void;
    const fetcher = vi.fn(() => new Promise<string>((resolve) => {
      finish = resolve;
    }));
    const url = 'https://image.coolapk.com/feed/shared.png';

    const first = loadImageResource(url, fetcher);
    const second = loadImageResource(url, fetcher);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    finish('data:image/png;base64,c2hhcmVk');

    const [firstSrc, secondSrc] = await Promise.all([first, second]);
    expect(firstSrc).toBe(secondSrc);
    expect(await blobs.get(firstSrc)!.text()).toBe('shared');
  });

  it('同一进程内直接命中内存缓存', async () => {
    const fetcher = vi.fn().mockResolvedValue('data:image/png;base64,bWVtb3J5');
    const url = 'https://image.coolapk.com/feed/memory.png';

    const first = await loadImageResource(url, fetcher);
    const cached = await loadImageResource(url, fetcher);

    expect(cached).toBe(first);
    expect(await blobs.get(cached)!.text()).toBe('memory');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('清理内存后重新交给原生层读取持久缓存', async () => {
    const fetcher = vi.fn().mockResolvedValue('data:image/jpeg;base64,cHJpdmF0ZQ==');
    const url = 'https://api.coolapk.com/v6/message/showImage?id=1';

    await loadImageResource(url, fetcher);
    clearResourceMemoryCache();
    await loadImageResource(url, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('清理期间尚未完成的请求不会重新写回内存', async () => {
    let finish!: (value: string) => void;
    const fetcher = vi.fn(() => new Promise<string>((resolve) => {
      finish = resolve;
    }));
    const url = 'https://image.coolapk.com/feed/in-flight.png';

    const loading = loadImageResource(url, fetcher);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await clearResourceCache();
    finish('data:image/png;base64,b2xk');
    await loading;

    const freshFetcher = vi.fn().mockResolvedValue('data:image/png;base64,bmV3');
    const reloaded = await loadImageResource(url, freshFetcher);
    expect(await blobs.get(reloaded)!.text()).toBe('new');
    expect(freshFetcher).toHaveBeenCalledTimes(1);
  });

  it('按总字节限制淘汰，同步命中也刷新最近使用顺序', async () => {
    const value = 'data:image/png;base64,' + 'a'.repeat(1024 * 1024);
    const fetcher = vi.fn().mockResolvedValue(value);
    const first = await loadImageResource('https://img.example/0', fetcher);
    for (let i = 1; i < 10; i++) await loadImageResource(`https://img.example/${i}`, fetcher);
    expect(getMemoryCachedResourceSync('https://img.example/0')).toBe(first);
    for (let i = 10; i < 14; i++) await loadImageResource(`https://img.example/${i}`, fetcher);
    const stats = getResourceMemoryCacheStats();
    expect(stats.estimatedBytes).toBeLessThanOrEqual(stats.byteLimit);
    expect(stats.entries).toBeLessThan(14);
    expect(getMemoryCachedResourceSync('https://img.example/0')).toBe(first);
    expect(getMemoryCachedResourceSync('https://img.example/1')).toBeNull();
    clearResourceMemoryCache();
    expect(getResourceMemoryCacheStats()).toMatchObject({ entries: 0, estimatedBytes: 0 });
  });

  it('超大原图仍返回给显示组件，但不长期放入全局缓存', async () => {
    const value = 'data:image/jpeg;base64,' + 'a'.repeat(getResourceMemoryCacheStats().entryByteLimit);
    const fetcher = vi.fn().mockResolvedValue(value);
    const src = await loadImageResource('https://img.example/original', fetcher);
    const release = retainResourceUrl(src);
    try { expect((await blobs.get(src)!.arrayBuffer()).byteLength).toBe(atob(value.split(',')[1]).length); }
    finally { release(); }
    expect(getMemoryCachedResourceSync('https://img.example/original')).toBeNull();
    expect(getResourceMemoryCacheStats().estimatedBytes).toBe(0);
  });

  it('保持透明图片与动图的 MIME 和原始二进制内容，不经过重编码', async () => {
    const bytes = new Uint8Array([0, 255, 128, 13, 10, 71, 73, 70, 0]);
    for (const mime of ['image/png', 'image/gif', 'image/webp']) {
      const value = `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`;
      const src = await loadImageResource(`https://img.example/${mime}`, async () => value);
      const blob = blobs.get(src)!;
      expect(blob.type).toBe(mime);
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    }
  });

  it('不支持 Object URL 时仍使用原数据地址', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('unavailable'); });
    const value = 'data:image/png;base64,YQ==';
    await expect(loadImageResource('https://img.example/fallback', async () => value)).resolves.toBe(value);
  });
});

describe('图片 Blob 生命周期', () => {
  let serial = 0;
  beforeEach(() => {
    clearResourceMemoryCache();
    vi.useFakeTimers();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:owned-${++serial}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });
  afterEach(async () => {
    clearResourceMemoryCache();
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('缓存淘汰后，主图和切图旧图层都用完才撤销地址，重复释放无副作用', async () => {
    const fetcher = async () => 'data:image/png;base64,YQ==';
    const src = await loadImageResource('https://img.example/active', fetcher);
    const releaseMain = retainResourceUrl(src), releaseGhost = retainResourceUrl(src);
    for (let i = 0; i < 301; i++) await loadImageResource(`https://img.example/other-${i}`, fetcher);
    expect(getMemoryCachedResourceSync('https://img.example/active')).toBeNull();
    await vi.runOnlyPendingTimersAsync();
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(src);
    releaseMain(); releaseMain();
    await vi.runOnlyPendingTimersAsync();
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(src);
    releaseGhost();
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(src);
    await vi.runOnlyPendingTimersAsync();
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.filter(([url]) => url === src)).toHaveLength(1);
  });

  it('清缓存不会破坏显示中的图片，结束显示后回收', async () => {
    const src = await loadImageResource('https://img.example/displayed', async () => 'data:image/jpeg;base64,YQ==');
    const release = retainResourceUrl(src);
    clearResourceMemoryCache();
    await vi.runOnlyPendingTimersAsync();
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(src);
    expect(getResourceMemoryCacheStats()).toMatchObject({ entries: 0, activeReaders: 1 });
    release();
    await vi.runOnlyPendingTimersAsync();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(src);
  });

  it('超大原图不进入全局缓存，当前读者用完后释放；无人使用的预读也会释放', async () => {
    const value = 'data:image/png;base64,' + 'a'.repeat(getResourceMemoryCacheStats().entryByteLimit);
    const src = await loadImageResource('https://img.example/large', async () => value);
    const release = retainResourceUrl(src);
    await vi.runOnlyPendingTimersAsync();
    expect(getResourceMemoryCacheStats().entries).toBe(0);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(src);
    release();
    await vi.runOnlyPendingTimersAsync();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(src);
    const prefetch = await loadImageResource('https://img.example/large-prefetch', async () => value);
    await vi.runOnlyPendingTimersAsync();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(prefetch);
  });

  it('账号切换后迟到的请求不回填缓存，且不会留下无读者的 Blob', async () => {
    let finish!: (value: string) => void;
    const request = loadImageResource('https://img.example/late', () => new Promise(resolve => { finish = resolve; }));
    clearResourceMemoryCache();
    finish('data:image/png;base64,YQ==');
    const src = await request;
    await vi.runOnlyPendingTimersAsync();
    expect(getMemoryCachedResourceSync('https://img.example/late')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(src);
  });
});
