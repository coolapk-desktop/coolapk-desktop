import { CoolapkTauriAPI } from '../api/coolapk';
import type { SearchEntity } from '../types/search';
import { extractSearchEntities, getSearchEntityTitle, isSponsorSearchEntity } from './searchEntities';

const DEFAULT_SUGGESTION_LIMIT = 8;

/**
 * 联想是随输入逐字触发的交互请求：固定较短超时且不重试，
 * 慢响应让位给用户的下一次输入，而不是在后台反复重试同一批建议。
 */
const SUGGESTION_REQUEST_OPTIONS = { retry: false, timeoutMs: 4000 } as const;

/** 同一关键词的在途请求共用一次网络调用，避免两处输入框同时触发重复请求。 */
const inflightSuggestions = new Map<string, Promise<SearchEntity[]>>();

function normalizeSuggestions(response: unknown): SearchEntity[] {
  return extractSearchEntities(response)
    .filter((item) => !isSponsorSearchEntity(item))
    .filter((item) => getSearchEntityTitle(item));
}

/** 联想接口不可用时的本地兜底：把当前关键词本身作为“搜索词”候选，保证输入框始终有可提交项。 */
function localFallback(keyword: string): SearchEntity[] {
  return [{ entityType: 'searchWord', title: keyword }];
}

async function loadSuggestions(keyword: string, limit: number): Promise<SearchEntity[]> {
  // 只发一个优先请求（官方 App 变体），失败直接本地兜底，不再串行追发第二个接口。
  try {
    const rows = normalizeSuggestions(await CoolapkTauriAPI.getSearchSuggestionsApp(keyword, SUGGESTION_REQUEST_OPTIONS));
    if (rows.length) return rows.slice(0, limit);
  } catch (error) {
    console.warn('加载搜索联想失败，使用本地兜底', error);
  }
  return localFallback(keyword).slice(0, limit);
}

/**
 * 搜索页与 Ctrl+K 面板共用的联想来源：
 * 单请求优先（官方 App 变体），失败或无结果时本地兜底，保证两处看到同一批建议。
 */
export function fetchSearchSuggestions(keyword: string, limit = DEFAULT_SUGGESTION_LIMIT): Promise<SearchEntity[]> {
  const trimmed = keyword.trim();
  if (!trimmed) return Promise.resolve([]);
  const cacheKey = `${trimmed}|${limit}`;
  const pending = inflightSuggestions.get(cacheKey);
  if (pending) return pending;
  const task = loadSuggestions(trimmed, limit).finally(() => {
    if (inflightSuggestions.get(cacheKey) === task) inflightSuggestions.delete(cacheKey);
  });
  inflightSuggestions.set(cacheKey, task);
  return task;
}
