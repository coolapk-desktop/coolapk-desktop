import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { FeedImageInput, LivePhotoContextType } from '../utils/livePhoto';
import type { FeedItem } from '../types/feed';
import type { TopicPublishContext } from '../types/publish';

export interface ImageViewerContext {
  /** 从详情打开的大图沿用该详情的无图模式例外。 */
  fromDetail?: boolean;
  contentId?: string | number;
  contentType?: LivePhotoContextType;
}

export interface ImageViewerState extends ImageViewerContext {
  urls: FeedImageInput[];
  currentIndex: number;
}

export const useAppStore = defineStore('app', () => {
  const isSearchOpen = ref(false);
  const isPublishOpen = ref(false);
  const publishInitialText = ref('');
  const publishTopicContext = ref<TopicPublishContext | null>(null);
  const editFeedTarget = ref<FeedItem | null>(null);
  const feedDetailContexts = ref<Record<string, any>>({});
  const activeImageViewer = ref<ImageViewerState | null>(null);

  function openSearch() {
    isSearchOpen.value = true;
  }

  function closeSearch() {
    isSearchOpen.value = false;
  }

  function openPublish(initialText: unknown = '', topicContext: TopicPublishContext | null = null) {
    publishInitialText.value = typeof initialText === 'string' ? initialText : '';
    publishTopicContext.value = topicContext;
    editFeedTarget.value = null;
    isPublishOpen.value = true;
  }

  function openEditFeed(feed: FeedItem) {
    publishTopicContext.value = null;
    editFeedTarget.value = feed;
    isPublishOpen.value = true;
  }

  function closePublish() {
    publishInitialText.value = '';
    publishTopicContext.value = null;
    isPublishOpen.value = false;
    editFeedTarget.value = null;
  }

  function setFeedDetailContext(feedId: string | number, feed: any) {
    if (!feed) return;
    feedDetailContexts.value = {
      ...feedDetailContexts.value,
      [String(feedId)]: feed,
    };
  }

  function getFeedDetailContext(feedId: string | number) {
    return feedDetailContexts.value[String(feedId)] || null;
  }

  function openImageViewer(
    urls: FeedImageInput[],
    currentIndex: number = 0,
    context: ImageViewerContext = {},
  ) {
    activeImageViewer.value = {
      urls,
      currentIndex,
      ...(context.contentId !== undefined ? { contentId: context.contentId } : {}),
      ...(context.contentType ? { contentType: context.contentType } : {}),
      ...(context.fromDetail ? { fromDetail: true } : {}),
    };
  }

  function closeImageViewer() {
    activeImageViewer.value = null;
  }

  return {
    publishInitialText,
    publishTopicContext,
    isSearchOpen,
    isPublishOpen,
    editFeedTarget,
    feedDetailContexts,
    activeImageViewer,
    openSearch,
    closeSearch,
    openPublish,
    openEditFeed,
    closePublish,
    setFeedDetailContext,
    getFeedDetailContext,
    openImageViewer,
    closeImageViewer
  };
});
