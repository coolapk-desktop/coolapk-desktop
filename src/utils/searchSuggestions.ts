import { CoolapkTauriAPI } from '../api/coolapk';
import type { SearchEntity } from '../types/search';
import { extractSearchEntities, getSearchEntityTitle, isSponsorSearchEntity } from './searchEntities';

const DEFAULT_SUGGESTION_LIMIT = 8;

/**
 * 搜索页与 Ctrl+K 面板共用的联想来源：
 * 优先官方 App 变体（type=app），为空或失败时回退通用联想，保证两处看到同一批建议。
 */
export async function fetchSearchSuggestions(keyword: string, limit = DEFAULT_SUGGESTION_LIMIT): Promise<SearchEntity[]> {
  const trimmed = keyword.trim();
  if (!trimmed) return [];
  const normalize = (response: unknown): SearchEntity[] => extractSearchEntities(response)
    .filter((item) => !isSponsorSearchEntity(item))
    .filter((item) => getSearchEntityTitle(item));

  try {
    const appRows = normalize(await CoolapkTauriAPI.getSearchSuggestionsApp(trimmed));
    if (appRows.length) return appRows.slice(0, limit);
  } catch (error) {
    console.warn('加载搜索联想失败，回退通用联想', error);
  }

  try {
    return normalize(await CoolapkTauriAPI.getSearchSuggestions(trimmed)).slice(0, limit);
  } catch (error) {
    console.warn('加载搜索联想失败', error);
    return [];
  }
}
