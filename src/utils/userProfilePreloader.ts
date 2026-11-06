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
const GUEST_VIEWER_UID = 'guest';

/**
 * 读取当前登录账号 uid（缓存维度）。
 * 这里不 import pinia store：auth store 已经 import 本模块（清缓存），
 * 反向依赖会形成循环；auth store 登录/切号/登出都会同步写 localStorage 的 coolapk_user，
 * 因此直接读这份快照既无循环依赖，也与界面登录态一致。
 */
export function getProfileViewerUid(): string {
  try {
    const raw = localStorage.getItem('coolapk_user');
    if (!raw) return GUEST_VIEWER_UID;
    const parsed = JSON.parse(raw);
    const uid = String(parsed?.uid ?? '').trim();
    return uid && uid !== '0' && uid !== 'undefined' && uid !== 'null' ? uid : GUEST_VIEWER_UID;
  } catch {
    return GUEST_VIEWER_UID;
  }
}

// 缓存键带上账号维度，避免切号后把上一个账号视角下的资料当成当前账号的资料。
function profileCacheKey(uid: string, viewerUid: string = getProfileViewerUid()): string {
  return `${uid}@${viewerUid}`;
}

function uidFromCacheKey(cacheKey: string): string {
  const index = cacheKey.indexOf('@');
  return index < 0 ? cacheKey : cacheKey.slice(0, index);
}

// 全局单例缓存
const globalUserCache: Map<string, UserCacheEntry> =
  (window as any).__COOLAPK_USER_PROFILE_CACHE__ || new Map<string, UserCacheEntry>();
(window as any).__COOLAPK_USER_PROFILE_CACHE__ = globalUserCache;

// 全局 Vue 响应式缓存映射（供模板和计算属性即时响应数据更新）
export const reactiveUserProfileMap = reactive<Record<string, any>>({});

function pruneProfiles() {
  const now = Date.now();
  for (const [cacheKey, entry] of globalUserCache) {
    if (entry.expireAt <= now) {
      globalUserCache.delete(cacheKey);
      delete reactiveUserProfileMap[uidFromCacheKey(cacheKey)];
    }
  }
  while (globalUserCache.size > MAX_CACHED_PROFILES) {
    const cacheKey = globalUserCache.keys().next().value!;
    globalUserCache.delete(cacheKey);
    delete reactiveUserProfileMap[uidFromCacheKey(cacheKey)];
  }
}

// reactiveUserProfileMap 继续按 uid 索引：多处组件直接以 uid 读取，
// 切号时由 clearUserProfileCache() 整体清空，不会串账号。
function rememberProfile(cacheKey: string, data: any) {
  const uid = uidFromCacheKey(cacheKey);
  globalUserCache.delete(cacheKey);
  globalUserCache.set(cacheKey, { data, expireAt: Date.now() + CACHE_TTL });
  reactiveUserProfileMap[uid] = data;
  pruneProfiles();
}

function readProfile(cacheKey: string): UserCacheEntry | undefined {
  pruneProfiles();
  const cached = globalUserCache.get(cacheKey);
  if (cached) {
    globalUserCache.delete(cacheKey);
    globalUserCache.set(cacheKey, cached);
  }
  return cached;
}

/**
 * 清空用户资料缓存：登出、切换账号或凭据失效时调用，
 * 否则上一个账号视角下的资料（含粉丝/关注等私域字段）会被继续复用。
 */
export function clearUserProfileCache() {
  globalUserCache.clear();
  inFlightRequests.clear();
  preloadQueue.splice(0, preloadQueue.length);
  recentlyFailedProfiles.clear();
  for (const uid of Object.keys(reactiveUserProfileMap)) {
    delete reactiveUserProfileMap[uid];
  }
}

// 键统一为 uid@viewerUid，避免切号后把上一个账号的在途请求/结果复用给当前账号。
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
    const cacheKey = preloadQueue.shift();
    if (!cacheKey) continue;
    const uid = uidFromCacheKey(cacheKey);

    const now = Date.now();
    const cached = globalUserCache.get(cacheKey);
    if (cached && cached.expireAt > now) {
      reactiveUserProfileMap[uid] = cached.data;
      continue;
    }

    if (inFlightRequests.has(cacheKey)) {
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
        rememberProfile(cacheKey, data);
        return data;
      })
      .catch((error) => {
        reportProfileFailure(uid, 'background', error);
        return null;
      })
      .finally(() => {
        inFlightRequests.delete(cacheKey);
        activePreloadCount--;
        // 调度下一个
        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
          (window as any).requestIdleCallback(() => pumpPreloadQueue(), { timeout: 1000 });
        } else {
          setTimeout(pumpPreloadQueue, 50);
        }
      });

    inFlightRequests.set(cacheKey, fetchPromise);
  }
}

/**
 * 在后台静默预加载指定用户的个人资料与空间数据
 */
export function preloadUserProfile(rawUid: string | number | undefined | null) {
  if (!rawUid) return;
  const uid = String(rawUid).trim();
  if (!uid || uid === '0' || uid === 'undefined' || uid === 'null') return;

  const cacheKey = profileCacheKey(uid);
  const now = Date.now();
  const cached = readProfile(cacheKey);
  if (cached && cached.expireAt > now) {
    reactiveUserProfileMap[uid] = cached.data;
    return;
  }

  if (inFlightRequests.has(cacheKey) || preloadQueue.includes(cacheKey)) {
    return;
  }

  preloadQueue.push(cacheKey);

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

  const cacheKey = profileCacheKey(uid);
  const now = Date.now();
  const cached = readProfile(cacheKey);
  if (cached && cached.expireAt > now) {
    reactiveUserProfileMap[uid] = cached.data;
    return cached.data;
  }

  if (inFlightRequests.has(cacheKey)) {
    try {
      const data = await inFlightRequests.get(cacheKey);
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
    rememberProfile(cacheKey, data);
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
  const cached = readProfile(profileCacheKey(uid));
  if (cached && cached.expireAt > now) {
    reactiveUserProfileMap[uid] = cached.data;
    return cached.data;
  }
  return null;
}
