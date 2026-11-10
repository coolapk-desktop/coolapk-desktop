const MAX_ENTRIES = 1500;

type PageArgs = { feedId: string; page: number; lastItem: string; firstItem?: string; listType?: string; fromFeedAuthor?: number; replyId?: string };
type PageResponse = { data?: unknown };
type SavedPage = { args: PageArgs; response: PageResponse };
const pages = new Map<string, SavedPage>();
const pending = new Map<string, { args: PageArgs; response: Promise<PageResponse> }>();
const replyDetails = new Map<string, PageResponse>();
const pendingDetails = new Map<string, Promise<PageResponse>>();
const detailFailures = new Map<string, number>();
const DETAIL_FAILURE_COOLDOWN_MS = 60_000;
let generation = 0;

function remember<T>(map: Map<string, T>, key: string, value: T) {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_ENTRIES) map.delete(map.keys().next().value!);
}

// 普通评论区仍可主动刷新；统计只复用游标和筛选条件都相同的成功请求。
export async function reuseFeedReplyPage<T extends PageResponse>(args: PageArgs, preferLocal: boolean, request: () => Promise<T>): Promise<T> {
  const key = JSON.stringify([args.feedId, args.replyId, args.listType, args.fromFeedAuthor, args.page, args.firstItem, args.lastItem]);
  const saved = pages.get(key);
  if (preferLocal && saved) return saved.response as T;
  const running = pending.get(key);
  if (running) return running.response as Promise<T>;

  const version = generation;
  const current = request();
  const entry = { args, response: current };
  pending.set(key, entry);
  try {
    const response = await current;
    if (version === generation && Array.isArray(response?.data)) remember(pages, key, { args, response });
    return response;
  } finally {
    if (pending.get(key) === entry) pending.delete(key);
  }
}

export function getCachedReplySort(feedId: string): string {
  const counts = new Map<string, number>();
  const firstPages = new Set<string>();
  for (const { args } of pending.values()) {
    if (args.feedId === feedId && !args.replyId && !args.fromFeedAuthor && args.page === 1 && args.listType !== undefined) firstPages.add(args.listType);
  }
  for (const { args } of pages.values()) {
    if (args.feedId !== feedId || args.replyId || args.fromFeedAuthor || args.listType === undefined) continue;
    if (args.page === 1) firstPages.add(args.listType);
    counts.set(args.listType, (counts.get(args.listType) ?? 0) + 1);
  }
  return [...firstPages].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0] ?? 'lastupdate_desc';
}

export async function reuseReplyStatisticsDetail<T extends PageResponse>(id: string, preferLocal: boolean, request: () => Promise<T>): Promise<T> {
  const cached = replyDetails.get(id);
  if (preferLocal && cached) return cached as T;
  const running = pendingDetails.get(id);
  if (running) return running as Promise<T>;

  const version = generation;
  const current = request();
  pendingDetails.set(id, current);
  try {
    const response = await current;
    if (version === generation && response?.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
      remember(replyDetails, id, response);
      detailFailures.delete(id);
    }
    return response;
  } catch (error) {
    if (version === generation) remember(detailFailures, id, Date.now());
    throw error;
  } finally {
    if (pendingDetails.get(id) === current) pendingDetails.delete(id);
  }
}

export function getCachedReplyStatisticsDetail(id: string) {
  return replyDetails.get(id)?.data;
}

export function hasRecentReplyDetailFailure(id: string) {
  return Date.now() - (detailFailures.get(id) ?? -Infinity) < DETAIL_FAILURE_COOLDOWN_MS;
}

export function invalidateFeedStatisticsReplies(feedId?: string) {
  generation++;
  for (const [key, entry] of pages) {
    if (!feedId || entry.args.feedId === feedId) pages.delete(key);
  }
  pending.clear();
}

export function clearFeedStatisticsCache() {
  invalidateFeedStatisticsReplies();
  replyDetails.clear();
  pendingDetails.clear();
  detailFailures.clear();
}
