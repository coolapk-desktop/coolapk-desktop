import { reactive } from 'vue';
import { CoolapkTauriAPI } from '../api/coolapk';
import { logDiagnosticLimited, classifyDiagnosticRequestError } from './diagnosticLogger';

interface UserCacheEntry {
  data: any;
  expireAt: number;
}

const CACHE_TTL = 10 * 60 * 1000; // 10 分钟缓存
const MAX_CACHED_PROFILES = 128;
const MAX_CONCURRENT_PRELOAD = 3; // 后台静默并发数限制，避免拥堵主请求

// 全局单例缓存
const globalUserCache: Map<string, UserCacheEntry> =
  (window as any).__COOLAPK_USER_PROFILE_CACHE__ || new Map<string, UserCacheEntry>();
(window as any).__COOLAPK_USER_PROFILE_CACHE__ = globalUserCache;

// 全局 Vue 响应式缓存映射（供模板和计算属性即时响应数据更新）
export const reactiveUserProfileMap = reactive<Record<string, any>>({});

function pruneProfiles() {
  const now = Date.now();
  for (const [uid, entry] of globalUserCache) {
    if (entry.expireAt <= now) {
      globalUserCache.delete(uid);
      delete reactiveUserProfileMap[uid];
    }
  }
  while (globalUserCache.size > MAX_CACHED_PROFILES) {
    const uid = globalUserCache.keys().next().value!;
    globalUserCache.delete(uid);
    delete reactiveUserProfileMap[uid];
  }
}

function rememberProfile(uid: string, data: any) {
  globalUserCache.delete(uid);
  globalUserCache.set(uid, { data, expireAt: Date.now() + CACHE_TTL });
  reactiveUserProfileMap[uid] = data;
  pruneProfiles();
}

function readProfile(uid: string): UserCacheEntry | undefined {
  pruneProfiles();
  const cached = globalUserCache.get(uid);
  if (cached) {
    globalUserCache.delete(uid);
    globalUserCache.set(uid, cached);
  }
  return cached;
}

const inFlightRequests = new Map<string, Promise<any>>();
const preloadQueue: string[] = [];
let activePreloadCount = 0;
let failedLoads = 0;
let repeatedFailures = 0;
const recentlyFailedProfiles = new Set<string>();

function reportProfileFailure(uid: string, source: 'background' | 'hover', error: unknown) {
  failedLoads++;
  if (recentlyFailedProfiles.has(uid)) repeatedFailures++;
  recentlyFailedProfiles.add(uid);
  if (recentlyFailedProfiles.size > MAX_CACHED_PROFILES) recentlyFailedProfiles.delete(recentlyFailedProfiles.values().next().value!);
  logDiagnosticLimited('warn', 'user_profile', 'load_failed_summary',
    `source=${source} category=${classifyDiagnosticRequestError(error)} failed_loads=${failedLoads} repeated_failures=${repeatedFailures} tracked_failed_profiles=${recentlyFailedProfiles.size} queued=${preloadQueue.length} active=${activePreloadCount} in_flight=${inFlightRequests.size} cached=${globalUserCache.size}`,
    60_000, 'user_profile:load_failed_summary');
}

/**
 * 调度后台预加载队列
 */
function pumpPreloadQueue() {
  while (activePreloadCount < MAX_CONCURRENT_PRELOAD && preloadQueue.length > 0) {
    const uid = preloadQueue.shift();
    if (!uid) continue;

    const now = Date.now();
    const cached = globalUserCache.get(uid);
    if (cached && cached.expireAt > now) {
      reactiveUserProfileMap[uid] = cached.data;
      continue;
    }

    if (inFlightRequests.has(uid)) {
      continue;
    }

    activePreloadCount++;
    const fetchPromise = Promise.resolve()
      .then(() => {
        if (typeof CoolapkTauriAPI?.getPublicUserSpace !== 'function') {
          return null;
        }
        return CoolapkTauriAPI.getPublicUserSpace(uid);
      })
      .then((res: any) => {
        if (!res) return null;
        const data = res?.data || res || {};
        recentlyFailedProfiles.delete(uid);
        rememberProfile(uid, data);
        return data;
      })
      .catch((error) => {
        reportProfileFailure(uid, 'background', error);
        return null;
      })
      .finally(() => {
        inFlightRequests.delete(uid);
        activePreloadCount--;
        // 调度下一个
        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
          (window as any).requestIdleCallback(() => pumpPreloadQueue(), { timeout: 1000 });
        } else {
          setTimeout(pumpPreloadQueue, 50);
        }
      });

    inFlightRequests.set(uid, fetchPromise);
  }
}

/**
 * 在后台静默预加载指定用户的个人资料与空间数据
 */
export function preloadUserProfile(rawUid: string | number | undefined | null) {
  if (!rawUid) return;
  const uid = String(rawUid).trim();
  if (!uid || uid === '0' || uid === 'undefined' || uid === 'null') return;

  const now = Date.now();
  const cached = readProfile(uid);
  if (cached && cached.expireAt > now) {
    reactiveUserProfileMap[uid] = cached.data;
    return;
  }

  if (inFlightRequests.has(uid) || preloadQueue.includes(uid)) {
    return;
  }

  preloadQueue.push(uid);

  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    (window as any).requestIdleCallback(() => pumpPreloadQueue(), { timeout: 1000 });
  } else {
    setTimeout(pumpPreloadQueue, 20);
  }
}

/**
 * 批量后台静默预加载一组用户的资料
 */
export function batchPreloadUserProfiles(uids: (string | number | undefined | null)[]) {
  for (const uid of uids) {
    preloadUserProfile(uid);
  }
}

/**
 * 获取用户资料（优先读取本地预加载缓存，无缓存时即时拉取）
 */
export async function getUserProfileCached(rawUid: string | number | undefined | null, fallback?: any): Promise<any> {
  if (!rawUid) return fallback || null;
  const uid = String(rawUid).trim();
  if (!uid) return fallback || null;

  const now = Date.now();
  const cached = readProfile(uid);
  if (cached && cached.expireAt > now) {
    reactiveUserProfileMap[uid] = cached.data;
    return cached.data;
  }

  if (inFlightRequests.has(uid)) {
    try {
      const data = await inFlightRequests.get(uid);
      if (data) {
        reactiveUserProfileMap[uid] = data;
        return data;
      }
    } catch {
      // ignore
    }
  }

  try {
    if (typeof CoolapkTauriAPI?.getPublicUserSpace !== 'function') {
      return fallback || null;
    }
    const res: any = await CoolapkTauriAPI.getPublicUserSpace(uid);
    const data = res?.data || res || {};
    recentlyFailedProfiles.delete(uid);
    rememberProfile(uid, data);
    return data;
  } catch (err) {
    reportProfileFailure(uid, 'hover', err);
    return fallback || null;
  }
}

/**
 * 直接读取内存缓存（同步，用于挂载时立即初始化）
 */
export function getCachedUserProfileSync(rawUid: string | number | undefined | null): any | null {
  if (!rawUid) return null;
  const uid = String(rawUid).trim();
  if (!uid) return null;

  const now = Date.now();
  const cached = readProfile(uid);
  if (cached && cached.expireAt > now) {
    reactiveUserProfileMap[uid] = cached.data;
    return cached.data;
  }
  return null;
}
