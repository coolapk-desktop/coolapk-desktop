import type { Router } from 'vue-router';
import { useAppStore } from '../stores/app';
import { captureRouteTransitionAnchor } from './containerTransform';

/** 进入完整动态页，并缓存通知、历史等调用方携带的动态摘要。 */
export function openFeedDetail(
  router: Router,
  feedId: string | number,
  context?: any,
  replyId?: string,
  anchorElement?: HTMLElement | null
) {
  const id = String(feedId || '').trim();
  if (!id) return;
  if (context) useAppStore().setFeedDetailContext(id, context);
  if (anchorElement) captureRouteTransitionAnchor(anchorElement, `feed:${id}`);
  return router.push(replyId ? { path: `/feed/${id}`, query: { replyId } } : `/feed/${id}`);
}
