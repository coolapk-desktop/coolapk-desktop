import { vi } from 'vitest';
let serial = 0;

/** jsdom Blob 与 Node URL 的内部类型不兼容；在边界保留真实 Blob，直接校验其原始字节。 */
export function mockObjectUrls() {
  const blobs = new Map<string, Blob>();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    const url = `blob:test-${++serial}`;
    blobs.set(url, blob as Blob);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => { blobs.delete(url); });
  return blobs;
}
