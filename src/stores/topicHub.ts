import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface CategoryItem {
  key: string;
  title: string;
  url: string;
}

export interface CardRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface TransitionMetadata {
  tag: string;
  title: string;
  logo: string;
  rect: CardRect;
}

export const useTopicHubStore = defineStore('topicHub', () => {
  const categories = ref<CategoryItem[]>([]);
  const activeCategoryUrl = ref<string>('');
  const rawTopicItems = ref<any[]>([]);
  
  // 视图模式：'grid'（大网格） 或 'split'（分屏模式）
  const viewMode = ref<'grid' | 'split'>('grid');
  // 当前激活的话题 tag
  const activeTopicTag = ref<string>('');
  // 当前激活的话题实体
  const activeTopic = ref<any>(null);
  // 当前选中的 Feed（用于三栏宽屏下的右侧评论区展示）
  const activeFeed = ref<any>(null);

  // FLIP 过渡动画元数据
  const transitionMeta = ref<TransitionMetadata | null>(null);
  const isTransitioning = ref<boolean>(false);

  function setCategories(items: CategoryItem[], selectedUrl = '') {
    categories.value = items;
    if (selectedUrl) {
      activeCategoryUrl.value = selectedUrl;
    } else if (!activeCategoryUrl.value && items.length > 0) {
      activeCategoryUrl.value = items[0].url;
    }
  }

  function setTopicItems(items: any[]) {
    rawTopicItems.value = items;
  }

  function appendTopicItems(items: any[]) {
    rawTopicItems.value = [...rawTopicItems.value, ...items];
  }

  function openTopicSplit(topic: any, cardRect?: CardRect) {
    const rawTag = topic?.tag || topic?.title || topic?.title_format || '';
    const tag = String(rawTag).replace(/^#|#$/g, '').trim();
    activeTopicTag.value = tag;
    activeTopic.value = topic;
    activeFeed.value = null;

    if (cardRect) {
      const logo = topic?.logo || topic?.pic || topic?.cover || topic?.icon || '';
      transitionMeta.value = {
        tag,
        title: tag,
        logo,
        rect: cardRect,
      };
      isTransitioning.value = true;
    } else {
      transitionMeta.value = null;
      isTransitioning.value = false;
    }

    viewMode.value = 'split';
  }

  function closeTopicSplit() {
    viewMode.value = 'grid';
    activeTopicTag.value = '';
    activeTopic.value = null;
    activeFeed.value = null;
    transitionMeta.value = null;
    isTransitioning.value = false;
  }

  function selectFeed(feed: any) {
    activeFeed.value = feed;
  }

  function clearTransition() {
    transitionMeta.value = null;
    isTransitioning.value = false;
  }

  /**
   * 清空与账号相关的话题数据：话题流缓存（feed 实体带 userAction/收藏计数，
   * 是按当前账号视角返回的）与选中的 feed。切号/登出时由 auth 的
   * clearFrontendAuthState() 调用，避免残留上一个账号视角的实体态。
   * 不清账号无关的状态：categories/activeCategoryUrl（全局分类）、
   * activeTopicTag/activeTopic（话题本身与账号无关）、viewMode（用户偏好）、
   * transitionMeta/isTransitioning（瞬时过渡态）。
   */
  function clearAccountData() {
    rawTopicItems.value = [];
    activeFeed.value = null;
  }

  return {
    categories,
    activeCategoryUrl,
    rawTopicItems,
    viewMode,
    activeTopicTag,
    activeTopic,
    activeFeed,
    transitionMeta,
    isTransitioning,
    setCategories,
    setTopicItems,
    appendTopicItems,
    openTopicSplit,
    closeTopicSplit,
    selectFeed,
    clearTransition,
    clearAccountData,
  };
});
