import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { copyImageToClipboard } from '../imageClipboard';
import { clearResourceMemoryCache, loadImageResource, getResourceMemoryCacheStats } from '../resourceCache';
import { mockObjectUrls } from '../../test-utils/objectUrls';

const api = vi.hoisted(() => ({ getImageDataUrl: vi.fn() }));
vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: api }));
const drawImage = vi.fn();
const decode = vi.fn().mockResolvedValue(undefined);
const writeText = vi.fn();
const write = vi.fn();
const png = new Blob(['png-image-bytes'], { type: 'image/png' });

beforeEach(() => {
  api.getImageDataUrl.mockReset().mockResolvedValue('data:image/jpeg;base64,aW1hZ2U=');
  decode.mockReset().mockResolvedValue(undefined);
  writeText.mockReset();
  write.mockReset().mockImplementation(async items => { await items[0].data['image/png']; });
  vi.stubGlobal('Image', class { src = ''; naturalWidth = 640; naturalHeight = 480; decode = decode; });
  vi.stubGlobal('ClipboardItem', class { constructor(public data: Record<string, Promise<Blob>>) {} });
  vi.stubGlobal('navigator', { clipboard: { write, writeText } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => { expect(type).toBe('image/png'); callback(png); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('私信图片走原生登录态通道，JPEG 转 PNG 写入剪贴板而不是文本', async () => {
  const url = 'https://api.coolapk.com/v6/message/showImage?id=233036637&type=n';
  await copyImageToClipboard(url);
  expect(api.getImageDataUrl).toHaveBeenCalledWith(url);
  expect(await write.mock.calls[0][0][0].data['image/png']).toBe(png);
  expect(writeText).not.toHaveBeenCalled();
});

it('立即请求剪贴板写入，不等待原生请求结束才申请权限', async () => {
  let resolve!: (value: string) => void;
  api.getImageDataUrl.mockImplementation(() => new Promise<string>(done => { resolve = done; }));
  const copying = copyImageToClipboard('https://image.coolapk.com/photo.webp');
  expect(write).toHaveBeenCalledOnce();
  resolve('data:image/webp;base64,aW1hZ2U=');
  await copying;
});

it('复用已加载图片，支持页面生成的图片', async () => {
  await copyImageToClipboard('https://image.coolapk.com/photo.jpg', 'data:image/jpeg;base64,aW1hZ2U=');
  await copyImageToClipboard('blob:local-image');
  expect(api.getImageDataUrl).not.toHaveBeenCalled();
});

it('复制尚未解码完成时清缓存仍保留 Blob，转换结束后释放', async () => {
  vi.useFakeTimers();
  clearResourceMemoryCache();
  const blobs = mockObjectUrls();
  let finish!: () => void;
  decode.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const src = await loadImageResource('https://img.example/copy.png', async () => 'data:image/png;base64,YQ==');
  try {
    const copying = copyImageToClipboard('https://img.example/copy.png', src);
    clearResourceMemoryCache();
    await vi.runOnlyPendingTimersAsync();
    expect(blobs.has(src)).toBe(true);
    expect(getResourceMemoryCacheStats().activeReaders).toBe(1);
    finish();
    await copying;
    await vi.runOnlyPendingTimersAsync();
    expect(blobs.has(src)).toBe(false);
  } finally { vi.useRealTimers(); }
});

it('解码失败或权限拒绝时报告失败，不覆盖剪贴板为链接', async () => {
  decode.mockRejectedValueOnce(new Error('图片损坏'));
  await expect(copyImageToClipboard('https://image.coolapk.com/bad.jpg')).rejects.toThrow('图片损坏');
  write.mockRejectedValueOnce(new Error('权限被拒绝'));
  await expect(copyImageToClipboard('https://image.coolapk.com/photo.jpg')).rejects.toThrow('权限被拒绝');
  expect(writeText).not.toHaveBeenCalled();
});

it('不支持图片剪贴板时不下载图片或复制文本', async () => {
  vi.stubGlobal('ClipboardItem', undefined);
  await expect(copyImageToClipboard('https://image.coolapk.com/photo.jpg')).rejects.toThrow('当前系统不支持复制图片');
  expect(api.getImageDataUrl).not.toHaveBeenCalled();
  expect(writeText).not.toHaveBeenCalled();
});
