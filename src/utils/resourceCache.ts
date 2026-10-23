const MEMORY_CACHE_LIMIT = 300;
// 延续原 Data URL 的 UTF-16 预算，转换为 Blob 后保持相同淘汰范围，避免扩大缓存。
const MEMORY_CACHE_BYTE_LIMIT = 24 * 1024 * 1024;
const MEMORY_CACHE_ENTRY_BYTE_LIMIT = 4 * 1024 * 1024;

type ResourceFetcher = (url: string) => Promise<string>;
type ResourceEntry = { src: string; bytes: number; binaryBytes: number; cached: boolean; readers: number; timer?: ReturnType<typeof setTimeout> };

const memoryCache = new Map<string, ResourceEntry>();
const pendingRequests = new Map<string, Promise<string>>();
const objectUrls = new Map<string, ResourceEntry>();
let memoryCacheBytes = 0;
let cacheGeneration = 0;

/**
 * 统一图片地址，避免同一资源因为协议写法不同产生多份缓存。
 */
export function normalizeResourceUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('http://')) return `https://${trimmed.slice('http://'.length)}`;
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('data:') && !trimmed.startsWith('blob:') && !trimmed.startsWith('/')) {
    if (trimmed.includes('/') || trimmed.includes('.jpg') || trimmed.includes('.png') || trimmed.includes('.webp') || trimmed.includes('.gif')) {
      return `https://image.coolapk.com/${trimmed}`;
    }
  }
  return trimmed;
}

/**
 * 所有 HTTP/HTTPS 图片都允许进入原生文件缓存，包括需要登录态的私信图片。
 */
export function canPersistResource(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 缓存淘汰与显示结束分别释放所有权；下一任务再撤销地址，等待 Vue 完成 DOM 更新。 */
function disposeUnused(entry: ResourceEntry) {
  if (entry.cached || entry.readers || !objectUrls.has(entry.src) || entry.timer !== undefined) return;
  entry.timer = setTimeout(() => {
    entry.timer = undefined;
    if (entry.cached || entry.readers) return;
    URL.revokeObjectURL(entry.src);
    objectUrls.delete(entry.src);
  }, 0);
}

/** 仅解码 Base64 封装，不重编码图片，保留 GIF、透明度和原图字节。 */
function createEntry(url: string, value: string): ResourceEntry {
  const entry: ResourceEntry = { src: value, bytes: (url.length + value.length) * 2, binaryBytes: 0, cached: false, readers: 0 };
  const header = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(value);
  if (!header || typeof URL.createObjectURL !== 'function') return entry;
  try {
    const payload = value.slice(header[0].length);
    const decoder = Uint8Array as typeof Uint8Array & { fromBase64?: (value: string) => Uint8Array<ArrayBuffer> };
    let bytes: Uint8Array<ArrayBuffer>;
    if (decoder.fromBase64) {
      // 新版 WebView 直接解码为字节，避免在 JS 主线程生成中间字符串并逐字节复制。
      bytes = decoder.fromBase64(payload);
    } else {
      const decoded = atob(payload);
      bytes = new Uint8Array(decoded.length);
      for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
    }
    entry.src = URL.createObjectURL(new Blob([bytes], { type: header[1] }));
    entry.binaryBytes = bytes.byteLength;
    objectUrls.set(entry.src, entry);
  } catch { /* 异常数据或不支持 Blob 的环境保留原地址，沿用图片加载错误处理。 */ }
  return entry;
}

/** 显示组件和切图旧图层分别持有引用，清缓存不能撤销仍在使用的图片地址。 */
export function retainResourceUrl(src: string | undefined): () => void {
  const entry = src ? objectUrls.get(src) : undefined;
  if (!entry) return () => {};
  entry.readers += 1;
  let released = false;
  return () => { if (!released) { released = true; entry.readers -= 1; disposeUnused(entry); } };
}

function remember(url: string, entry: ResourceEntry) {
  const existing = memoryCache.get(url);
  if (existing !== undefined) {
    memoryCacheBytes -= existing.bytes;
    memoryCache.delete(url);
    if (existing !== entry) { existing.cached = false; disposeUnused(existing); }
  }
  // 大图由当前显示组件持有即可，避免在全局缓存中额外延长其生命周期。
  if (entry.bytes > MEMORY_CACHE_ENTRY_BYTE_LIMIT) { disposeUnused(entry); return; }
  entry.cached = true;
  memoryCache.set(url, entry);
  // 继续按原 Base64 的保守预算计费，避免转换后反而多缓存几倍图片。
  memoryCacheBytes += entry.bytes;

  while (memoryCache.size > MEMORY_CACHE_LIMIT || memoryCacheBytes > MEMORY_CACHE_BYTE_LIMIT) {
    const oldestKey = memoryCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = memoryCache.get(oldestKey)!;
    memoryCacheBytes -= oldest.bytes;
    memoryCache.delete(oldestKey);
    oldest.cached = false;
    disposeUnused(oldest);
  }
}

/**
 * 同步检查并获取内存图片缓存（0 延迟，避免重渲染时出现转菊花白屏）
 */
export function getMemoryCachedResourceSync(url: string | undefined): string | null {
  if (!url) return null;
  const normalizedUrl = normalizeResourceUrl(url);
  if (!normalizedUrl) return null;
  if (normalizedUrl.startsWith('data:') || normalizedUrl.startsWith('blob:') || normalizedUrl.startsWith('/')) {
    return normalizedUrl;
  }
  const cached = memoryCache.get(normalizedUrl);
  if (cached) remember(normalizedUrl, cached);
  return cached?.src || null;
}

/** 仅返回缓存规模，供诊断使用，不暴露图片或账号信息。 */
export function getResourceMemoryCacheStats() {
  const resources = [...objectUrls.values()];
  return { entries: memoryCache.size, estimatedBytes: memoryCacheBytes,
    byteLimit: MEMORY_CACHE_BYTE_LIMIT, entryByteLimit: MEMORY_CACHE_ENTRY_BYTE_LIMIT,
    objectUrls: objectUrls.size, retainedBinaryBytes: resources.reduce((sum, entry) => sum + entry.binaryBytes, 0),
    activeReaders: resources.reduce((sum, entry) => sum + entry.readers, 0) };
}

/**
 * 读取全局内存缓存并合并相同资源的并发请求。
 * 持久缓存由原生图片请求层负责，避免 WebView 缓存故障阻塞图片显示。
 */
export async function loadImageResource(url: string, fetcher: ResourceFetcher): Promise<string> {
  const normalizedUrl = normalizeResourceUrl(url);
  const generation = cacheGeneration;
  if (!normalizedUrl) return '';
  if (normalizedUrl.startsWith('data:') || normalizedUrl.startsWith('blob:') || normalizedUrl.startsWith('/')) {
    return normalizedUrl;
  }

  const memoryValue = memoryCache.get(normalizedUrl);
  if (memoryValue) {
    remember(normalizedUrl, memoryValue);
    return memoryValue.src;
  }

  const pending = pendingRequests.get(normalizedUrl);
  if (pending) return pending;

  const request = (async () => {
    const fetchedValue = await fetcher(normalizedUrl);
    const entry = createEntry(normalizedUrl, fetchedValue);
    if (generation === cacheGeneration) {
      remember(normalizedUrl, entry);
    } else disposeUnused(entry);
    return entry.src;
  })();

  pendingRequests.set(normalizedUrl, request);
  try {
    return await request;
  } finally {
    if (pendingRequests.get(normalizedUrl) === request) {
      pendingRequests.delete(normalizedUrl);
    }
  }
}

/**
 * 仅清理当前进程内的资源缓存，主要用于账号切换和测试隔离。
 */
export function clearResourceMemoryCache(): void {
  cacheGeneration += 1;
  for (const entry of memoryCache.values()) { entry.cached = false; disposeUnused(entry); }
  memoryCache.clear();
  memoryCacheBytes = 0;
  pendingRequests.clear();
}

/**
 * 清理当前进程内的图片缓存；原生文件缓存由后端统一清理。
 */
export async function clearResourceCache(): Promise<void> {
  clearResourceMemoryCache();
}
