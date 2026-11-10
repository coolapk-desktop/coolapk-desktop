import { CoolapkTauriAPI } from '../api/coolapk';
import type { FeedItem } from '../types/feed';
import { getCommentUserLevel, getExpectedCommentCount, getReplyData, getReplyEntityId, getReplyPageCursor, hasMoreReplyPages, mergeReplies } from './commentList';
import { getCachedReplySort, getCachedReplyStatisticsDetail, hasRecentReplyDetailFailure } from './feedStatisticsCache';

function withReplyDetail(item: any, detail: any) {
  if (!detail) return item;
  return { ...item, deviceTitle: deviceName(item) || deviceName(detail), userLevel: getCommentUserLevel(item) || getCommentUserLevel(detail) };
}

function replyDetailId(item: any) {
  return String(item.id || getReplyEntityId(item));
}

export async function loadStatisticsReplies(feed: FeedItem, signal: AbortSignal, onProgress: (replies: any[], floors: any[]) => void) {
  const feedId = String(feed.id);
  const listType = getCachedReplySort(feedId);
  let firstItem = '';
  let lastItem = '';
  let floors: any[] = [];
  const childrenByFloor = new Map<string, any[]>();
  const pinned = Array.isArray(feed.topReplyRows) ? feed.topReplyRows : [];

  function publish() {
    const top = mergeReplies(floors, pinned);
    const nested = top.map(item => ({ ...item, replyRows: childrenByFloor.get(getReplyEntityId(item)) ?? embeddedReplies(item) }));
    const children = nested.flatMap(item => item.replyRows);
    onProgress(mergeReplies(top, children).map(item => withReplyDetail(item, getCachedReplyStatisticsDetail(replyDetailId(item)))), nested);
  }

  for (let page = 1; ; page++) {
    if (signal.aborted) return;
    const response = await CoolapkTauriAPI.getFeedReplies(feedId, page, { listType, firstItem, lastItem, preferLocal: true });
    if (signal.aborted) return;
    const rows = getReplyData(response);
    const merged = mergeReplies(floors, rows);
    const cursor = getReplyPageCursor(rows);
    const hasMore = hasMoreReplyPages(rows, floors, merged, getExpectedCommentCount(feed.replynum));
    floors = merged;
    publish();
    if (!hasMore) break;
    if (!cursor.lastItem || cursor.lastItem === lastItem) throw new Error('评论分页未继续');
    firstItem ||= cursor.firstItem;
    lastItem = cursor.lastItem;
  }

  // 已随主列表返回的楼中楼直接使用，只对仍有缺口的楼层补分页。
  for (const floor of mergeReplies(floors, pinned)) {
    const floorId = getReplyEntityId(floor);
    const embedded = embeddedReplies(floor);
    const total = getExpectedCommentCount(floor.replynum ?? floor.replyNum);
    const hasMore = Number(floor.replyRowsMore) > 0 || Math.max(total ?? 0, Number(floor.replyRowsCount) || 0) > embedded.length;
    if (!hasMore || !floorId) continue;
    let fetched: any[] = [];
    let lastItem = '';
    for (let page = 1; ; page++) {
      if (signal.aborted) return;
      const response = await CoolapkTauriAPI.getSubReplies(feedId, String(floor.id || floorId), page, { lastItem, preferLocal: true });
      if (signal.aborted) return;
      const rows = getReplyData(response);
      const merged = mergeReplies(fetched, rows);
      const combined = mergeReplies(merged, embedded);
      const next = getReplyPageCursor(rows).lastItem;
      const hasMore = hasMoreReplyPages(rows, fetched, merged) && (total === null || combined.length < total);
      childrenByFloor.set(floorId, combined);
      fetched = merged;
      publish();
      if (!hasMore) break;
      if (!next || next === lastItem) throw new Error('楼中楼分页未继续');
      lastItem = next;
    }
  }
}

// 列表接口可能省略机型。仅给缺字段且没有缓存的评论补详情，限制并发，并在关窗后停止派发。
export async function loadStatisticsDevices(replies: any[], signal: AbortSignal, onProgress: (items: any[], done: number, total: number) => void) {
  const result = replies.map(item => withReplyDetail(item, getCachedReplyStatisticsDetail(replyDetailId(item))));
  const missing = result.map((item, index) => ({ item, index, id: replyDetailId(item) }))
    .filter(({ item, id }) => id && !deviceName(item) && !getCachedReplyStatisticsDetail(id) && !hasRecentReplyDetailFailure(id));
  if (!missing.length) {
    onProgress(result, 0, 0);
    return;
  }
  let next = 0;
  let done = 0;
  onProgress(result, done, missing.length);
  await Promise.all(Array.from({ length: Math.min(4, missing.length) }, async () => {
    while (!signal.aborted && next < missing.length) {
      const { item, index, id } = missing[next++];
      try {
        // 批量补查遇到网络故障时先保留未知，避免每条详情在同一轮反复重试。
        const response = await CoolapkTauriAPI.getReplyDetail(id, { preferLocal: true, retry: false });
        result[index] = withReplyDetail(item, response?.data);
      } catch {
        // 单条详情不可用时，保留该评论并将机型计入未知。
      }
      if (signal.aborted) return;
      done++;
      if (done % 8 === 0 || done === missing.length) onProgress([...result], done, missing.length);
    }
  }));
}

function embeddedReplies(item: any): any[] {
  if (Array.isArray(item.replyRows)) return item.replyRows;
  return Array.isArray(item.rlist) ? item.rlist : [];
}

export function statisticsUid(item: any) {
  return String(item.uid || item.userInfo?.uid || item.userInfo?.id || '').trim();
}

export function statisticsLevel(item: any) {
  const level = getCommentUserLevel(item).replace(/^lv\.?\s*/i, '');
  return /^\d{1,2}$/.test(level) ? `Lv.${Number(level)}` : '未知';
}

export function statisticsDevice(item: any) {
  return deviceName(item) || '未知';
}

function deviceName(item: any): string {
  // 详情可能带空的 deviceTitle 占位，仍需检查其它实际有值的机型字段。
  return [item?.deviceTitle, item?.device_title, item?.deviceName, item?.device_name, item?.device]
    .find(value => typeof value === 'string' && value.trim() && !/^(?:未知|unknown|null|undefined|0)$/i.test(value.trim()))?.trim() || '';
}

export function groupStatistics(items: any[], getLabel: (item: any) => string) {
  const groups = new Map<string, { label: string; users: Set<string>; count: number }>();
  for (const item of items) {
    const label = getLabel(item);
    const group = groups.get(label) ?? { label, users: new Set<string>(), count: 0 };
    const uid = statisticsUid(item);
    if (uid) group.users.add(uid);
    group.count++;
    groups.set(label, group);
  }
  return [...groups.values()].sort((a, b) => Number(a.label === '未知') - Number(b.label === '未知') || b.users.size - a.users.size || b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));
}
