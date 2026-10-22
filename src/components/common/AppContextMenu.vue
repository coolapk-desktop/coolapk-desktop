<template>
  <Teleport to="body">
    <div
      v-if="menu"
      v-show="!selectionAdjusting"
      class="app-context-menu"
      :class="{ 'is-mobile-selection': menu.mobileSelection }"
      :style="menuStyle"
      role="menu"
      @contextmenu.prevent
      @mousedown.stop
    >
      <template v-for="(item, index) in menu.items" :key="item.id">
        <div v-if="item.separator" class="context-menu-separator"></div>
        <button
          v-else
          type="button"
          class="context-menu-item"
          :class="{ 'is-danger': item.danger, 'is-disabled': item.disabled }"
          :disabled="item.disabled"
          role="menuitem"
          @click.stop="run(item)"
        >
          <i :class="item.icon"></i>
          <span>{{ item.label }}</span>
          <kbd v-if="showShortcutHints && item.shortcut">{{ item.shortcut }}</kbd>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from '../../stores/app';
import { usePageTabsStore } from '../../stores/pageTabs';
import { useSettingsStore } from '../../stores/settings';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { openFeedDetail } from '../../utils/feedNavigation';
import { showToast } from '../../utils/toast';
import { getOriginalImageUrl } from '../../utils/image';
import { usePlatformShortcuts } from '../../utils/shortcuts';
import { useShortcutHints } from '../../composables/useShortcutHints';
import { refreshPageTabGeneration } from '../../utils/pageTabs';
import { useAndroidBackButton } from '../../utils/androidBackButton';
import { copyImageToClipboard } from '../../utils/imageClipboard';
import { isTouchMobilePlatform } from '../../utils/platform';

type ContextKind = 'page' | 'selection' | 'link' | 'image' | 'comment' | 'feed' | 'message' | 'chat-message';

type ContextState = {
  x: number;
  y: number;
  kind: ContextKind;
  selectedText: string;
  linkUrl: string;
  linkText: string;
  imageUrl: string;
  imageDataUrl?: string;
  fromDetail?: boolean;
  imageUrls: string[];
  feedId: string;
  feedText: string;
  feedUrl: string;
  commentId: string;
  commentUsername: string;
  commentText: string;
  messageUkey?: string;
  messageId?: string;
  messageIsNew?: boolean;
  chatMessageText?: string;
  chatMessageId?: string;
};

type MenuItem = {
  id: string;
  label?: string;
  icon?: string;
  shortcut?: string;
  separator?: boolean;
  danger?: boolean;
  disabled?: boolean;
  action?: () => void | Promise<unknown>;
};

type MenuData = ContextState & { items: MenuItem[]; mobileSelection: boolean; width: number };

const router = useRouter();
const route = useRoute();
const appStore = useAppStore();
const pageTabsStore = usePageTabsStore();
const settingsStore = useSettingsStore();
const { formatShortcut } = usePlatformShortcuts();
const showShortcutHints = useShortcutHints();
const menu = ref<MenuData | null>(null);
const selectionAdjusting = ref(false);
let selectionTouchActive = false;
let selectionRefreshTimer: ReturnType<typeof setTimeout> | undefined;

const menuStyle = computed(() => ({
  left: `${menu.value?.x || 0}px`,
  top: `${menu.value?.y || 0}px`,
  width: `${menu.value?.width || 258}px`,
}));

function selectedText(): string {
  return window.getSelection?.()?.toString().trim() || '';
}

function parseImageUrls(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((url): url is string => typeof url === 'string' && url.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function getImageUrl(element: HTMLElement): string {
  const carrier = element.closest<HTMLElement>('[data-context-image-url]');
  if (carrier?.dataset.contextImageUrl) return carrier.dataset.contextImageUrl;
  const image = element.closest('img') as HTMLImageElement | null;
  return image?.dataset.originalUrl || image?.currentSrc || image?.src || '';
}

/** 构建菜单只需要命中元素与坐标，因此鼠标右键和触摸长按可以共用同一份逻辑。 */
type ContextPoint = {
  target: EventTarget | null;
  clientX: number;
  clientY: number;
};

function buildContext(event: ContextPoint): ContextState | null {
  const element = event.target instanceof HTMLElement ? event.target : null;
  if (!element) return null;
  if (element.closest('.app-context-menu')) return null;

  const text = selectedText();
  const interactive = element.closest('input, textarea, select, [contenteditable="true"]');
  if (interactive && !text) return null;

  const message = element.closest<HTMLElement>('[data-context-kind="message"]');
  if (message) {
    return {
      x: event.clientX,
      y: event.clientY,
      kind: 'message',
      selectedText: '',
      linkUrl: '',
      linkText: '',
      imageUrl: '',
      imageUrls: [],
      feedId: '',
      feedText: '',
      feedUrl: '',
      commentId: '',
      commentUsername: '',
      commentText: '',
      messageUkey: message.dataset.contextMessageUkey || '',
      messageId: message.dataset.contextMessageId || '',
      messageIsNew: message.dataset.contextMessageNew === 'true',
    };
  }

  const comment = element.closest<HTMLElement>('[data-context-kind="comment"]');
  if (comment && !element.closest('img, [data-context-image-url]')) {
    return {
      x: event.clientX,
      y: event.clientY,
      kind: 'comment',
      selectedText: text,
      linkUrl: '',
      linkText: '',
      imageUrl: '',
      imageUrls: [],
      feedId: comment.dataset.contextFeedId || '',
      feedText: '',
      feedUrl: '',
      commentId: comment.dataset.contextCommentId || '',
      commentUsername: comment.dataset.commentUsername || '',
      commentText: comment.dataset.commentText || element.textContent?.trim() || '',
    };
  }

  const imageUrl = getImageUrl(element);
  if (imageUrl && (element.closest('img') || element.closest('[data-context-image-url]'))) {
    return {
      x: event.clientX,
      y: event.clientY,
      kind: 'image',
      selectedText: text,
      linkUrl: '',
      linkText: '',
      imageUrl,
      // 大图可能超过内存缓存上限；直接复用当前元素持有的完整原图数据。
      imageDataUrl: getLoadedOriginalImage(element, imageUrl),
      fromDetail: Boolean(element.closest('.no-image-detail-enabled')),
      imageUrls: [],
      feedId: '',
      feedText: '',
      feedUrl: '',
      commentId: '',
      commentUsername: '',
      commentText: '',
    };
  }

  const link = element.closest<HTMLAnchorElement>('a[href]');
  // 视频和音频也复用链接菜单，以媒体资源地址执行通用下载。
  const media = element.closest<HTMLMediaElement>('video, audio');
  const linkUrl = media?.currentSrc || media?.src || media?.querySelector('source')?.src || link?.href || '';
  if (linkUrl) {
    return {
      x: event.clientX,
      y: event.clientY,
      kind: 'link',
      selectedText: text,
      linkUrl,
      linkText: link?.textContent?.trim() || linkUrl,
      imageUrl: '',
      imageUrls: [],
      feedId: '',
      feedText: '',
      feedUrl: '',
      commentId: '',
      commentUsername: '',
      commentText: '',
    };
  }

  const chatMessage = element.closest<HTMLElement>('[data-context-kind="chat-message"]');
  if (chatMessage && !element.closest('img, [data-context-image-url]')) {
    const chatMessageText = chatMessage.dataset.contextMessageText || chatMessage.querySelector('.msg-text')?.textContent?.trim() || '';
    return {
      x: event.clientX,
      y: event.clientY,
      kind: 'chat-message',
      selectedText: text,
      linkUrl: '',
      linkText: '',
      imageUrl: '',
      imageUrls: [],
      feedId: '',
      feedText: '',
      feedUrl: '',
      commentId: '',
      commentUsername: '',
      commentText: '',
      chatMessageText,
      chatMessageId: chatMessage.dataset.contextMessageId || '',
    };
  }

  if (text) {
    return {
      x: event.clientX,
      y: event.clientY,
      kind: 'selection',
      selectedText: text,
      linkUrl: '',
      linkText: '',
      imageUrl: '',
      imageUrls: [],
      feedId: '',
      feedText: '',
      feedUrl: '',
      commentId: '',
      commentUsername: '',
      commentText: '',
    };
  }

  const feed = element.closest<HTMLElement>('[data-feed-id]');
  if (feed?.dataset.feedId) {
    const feedId = feed.dataset.feedId;
    return {
      x: event.clientX,
      y: event.clientY,
      kind: 'feed',
      selectedText: '',
      linkUrl: '',
      linkText: '',
      imageUrl: '',
      imageUrls: parseImageUrls(feed.dataset.feedImages || ''),
      feedId,
      feedText: feed.dataset.feedText || feed.querySelector('.feed-body')?.textContent?.trim() || '',
      feedUrl: `https://www.coolapk.com/feed/${encodeURIComponent(feedId)}`,
      commentId: '',
      commentUsername: '',
      commentText: '',
    };
  }

  return {
    x: event.clientX,
    y: event.clientY,
    kind: 'page',
    selectedText: '',
    linkUrl: '',
    linkText: '',
    imageUrl: '',
    imageUrls: [],
    feedId: '',
    feedText: '',
    feedUrl: '',
    commentId: '',
    commentUsername: '',
    commentText: '',
  };
}

function item(id: string, label: string, icon: string, action: () => void | Promise<unknown>, extra: Partial<MenuItem> = {}): MenuItem {
  return { id, label, icon, action, ...extra };
}

function separator(id: string): MenuItem {
  return { id, separator: true };
}

function createItems(state: ContextState): MenuItem[] {
  if (state.kind === 'message') {
    return [
      item('delete-message-chat', '删除聊天', 'far fa-trash-alt', () => deleteMessageChat(state), {
        danger: true,
        disabled: !state.messageUkey && !state.messageIsNew,
      }),
    ];
  }

  if (state.kind === 'chat-message') {
    const items: MenuItem[] = [];
    if (state.selectedText) {
      items.push(
        item('copy-selection', '复制', 'far fa-copy', () => copyText(state.selectedText), {
          shortcut: formatShortcut('Ctrl+C'),
        })
      );
      if (state.chatMessageText && state.chatMessageText !== state.selectedText) {
        items.push(
          item('copy-chat-message-all', '复制全文', 'far fa-copy', () => copyText(state.chatMessageText || ''))
        );
      }
      items.push(separator('chat-message-sep'));
      items.push(
        item('search-selection-app', '在酷安内搜索', 'fas fa-search', () => searchInApp(state.selectedText))
      );
      items.push(
        item('search-selection-system', '在浏览器中搜索', 'fas fa-globe', () => searchInSystem(state.selectedText))
      );
    } else {
      items.push(
        item('copy-chat-message', '复制', 'far fa-copy', () => copyText(state.chatMessageText || ''), {
          shortcut: formatShortcut('Ctrl+C'),
          disabled: !state.chatMessageText,
        })
      );
    }
    return items;
  }

  if (state.kind === 'comment') {
    return [
      item('reply-comment', '回复评论', 'fas fa-reply', () => replyComment(state)),
      item('copy-comment', '复制评论', 'far fa-copy', () => copyText(state.commentText)),
    ];
  }

  if (state.kind === 'image') {
    return [
      item('view-image', '查看大图', 'fas fa-expand', () => appStore.openImageViewer([state.imageUrl], 0, { fromDetail: state.fromDetail })),
      item('view-original', '查看原图', 'fas fa-file-image', () => appStore.openImageViewer([state.imageUrl], 0, { fromDetail: state.fromDetail })),
      separator('image-separator'),
      item('save-image', '保存图片', 'fas fa-download', () => saveImage(state.imageUrl, state.imageDataUrl)),
      item('copy-image', '复制图片', 'far fa-copy', () => copyImage(state.imageUrl, state.imageDataUrl)),
      item('copy-image-url', '复制图片地址', 'fas fa-link', () => copyText(state.imageUrl)),
      item('open-image-system', '使用系统程序打开', 'fas fa-external-link-alt', () => CoolapkTauriAPI.openImageInSystemViewer(state.imageUrl)),
    ];
  }

  if (state.kind === 'link') {
    return [
      item('open-link-app', '在应用内打开', 'fas fa-window-maximize', () => openLink(state.linkUrl)),
      item('open-link-system', '使用系统浏览器打开', 'fas fa-external-link-alt', () => CoolapkTauriAPI.openUrl(state.linkUrl, 'system')),
      item('copy-link', '复制链接地址', 'fas fa-link', () => copyText(state.linkUrl)),
      item('save-file', '下载链接文件', 'fas fa-download', () => saveFile(state.linkUrl), { disabled: !/^(https?:\/\/|blob:|data:)/i.test(state.linkUrl) }),
      separator('link-separator'),
      item('search-link-text', '搜索链接文字', 'fas fa-search', () => searchInApp(state.linkText), { disabled: !state.linkText }),
    ];
  }

  if (state.kind === 'selection') {
    return [
      item('copy-selection', '复制选中文字', 'far fa-copy', () => copyText(state.selectedText), { shortcut: formatShortcut('Ctrl+C') }),
      item('search-selection-app', '在酷安内搜索', 'fas fa-search', () => searchInApp(state.selectedText)),
      item('search-selection-system', '在浏览器中搜索', 'fas fa-globe', () => searchInSystem(state.selectedText)),
      item('copy-selection-markdown', '复制为 Markdown', 'fab fa-markdown', () => copyText(state.selectedText)),
    ];
  }

  if (state.kind === 'feed') {
    return [
      item('open-feed', '打开动态详情', 'far fa-file-alt', () => openFeedDetail(router, state.feedId)),
      item('copy-feed-text', '复制动态正文', 'far fa-copy', () => copyText(state.feedText)),
      item('copy-feed-link', '复制动态链接', 'fas fa-link', () => copyText(state.feedUrl)),
      item('share-feed', '分享动态', 'fas fa-share-alt', () => shareText(state.feedUrl)),
      separator('feed-image-separator'),
      item('save-feed-images', `一键保存全部原图（${state.imageUrls.length}张）`, 'fas fa-images', () => saveAllImages(state.imageUrls), { disabled: state.imageUrls.length === 0 }),
    ];
  }

  const density = settingsStore.settings.density;
  const nextDensity = density === 'compact' ? 'comfortable' : density === 'comfortable' ? 'standard' : 'compact';
  const fontSize = settingsStore.settings.fontSize || 15;
  return [
    item('back', '返回', 'fas fa-arrow-left', () => router.back(), { shortcut: formatShortcut('Alt+←') }),
    item('forward', '前进', 'fas fa-arrow-right', () => router.go(1), { shortcut: formatShortcut('Alt+→') }),
    item('refresh', '刷新页面', 'fas fa-sync-alt', () => refreshPageTabGeneration(pageTabsStore.tabs, route), { shortcut: formatShortcut('Ctrl+R') }),
    separator('page-separator-1'),
    item('scroll-top', '返回顶部', 'fas fa-arrow-up', () => scrollToTop()),
    item('toggle-sidebar', settingsStore.settings.sidebarCollapsed ? '显示侧边栏' : '隐藏侧边栏', 'fas fa-columns', () => settingsStore.toggleSidebar()),
    item('toggle-theme', document.documentElement.getAttribute('data-theme') === 'dark' ? '切换日间模式' : '切换夜间模式', 'fas fa-moon', () => toggleTheme()),
    item('toggle-density', `切换布局密度（${nextDensity === 'compact' ? '紧凑' : nextDensity === 'comfortable' ? '舒适' : '标准'}）`, 'fas fa-compress-arrows-alt', () => setDensity(nextDensity)),
    item('font-smaller', '减小字体', 'fas fa-font', () => adjustFontSize(-1)),
    item('font-larger', '增大字体', 'fas fa-text-height', () => adjustFontSize(1)),
    separator('page-separator-2'),
    item('copy-page-url', '复制当前页面地址', 'fas fa-link', () => copyText(window.location.href)),
    item('open-page-system', '使用系统浏览器打开当前页', 'fas fa-external-link-alt', () => CoolapkTauriAPI.openUrl(window.location.href, 'system')),
    item('open-settings', '打开设置', 'fas fa-cog', () => router.push('/settings')),
  ];
}

async function copyText(text: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制');
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    showToast('已复制');
  }
}

async function copyImage(url: string, loadedDataUrl?: string) {
  try {
    await copyImageToClipboard(url, loadedDataUrl);
    showToast('图片已复制');
  } catch (error) {
    // 复制图片失败不能偷偷改写为文本链接，避免用户得到与菜单含义不符的剪贴板内容。
    showToast(`复制图片失败：${error instanceof Error ? error.message : String(error)}`, 'error', 3000);
  }
}

/** 仅在已加载地址与原图地址一致时复用，静态动图封面必须重新获取原文件。 */
function getLoadedOriginalImage(element: HTMLElement, url: string): string | undefined {
  const image = element.closest('img') as HTMLImageElement | null;
  const resourceUrl = image?.dataset.resourceUrl || image?.dataset.originalUrl;
  const dataUrl = image?.currentSrc || image?.src || '';
  return resourceUrl === getOriginalImageUrl(url) && /^(?:data:image\/|blob:)/.test(dataUrl) ? dataUrl : undefined;
}

async function saveImage(url: string, loadedDataUrl?: string) {
  try {
    const savedPath = await CoolapkTauriAPI.saveImage(url, settingsStore.settings.downloadPath, loadedDataUrl);
    showToast(savedPath ? `图片已保存：${savedPath}` : '图片保存成功');
  } catch (error) {
    showToast(`图片保存失败：${String(error)}`, 'error', 2400);
  }
}

// 同一资源下载期间忽略重复点击，桌面右键和移动端长按共用入口。
const downloadingUrls = new Set<string>();
async function saveFile(url: string) {
  if (downloadingUrls.has(url)) return;
  downloadingUrls.add(url);
  showToast('正在下载文件…', 'success', 3000);
  try {
    const savedPath = await CoolapkTauriAPI.saveFile(url, settingsStore.settings.downloadPath);
    showToast(`文件已保存：${savedPath}`, 'success', 3000);
  } catch (error) {
    showToast(`文件下载失败：${String(error)}`, 'error', 3000);
  } finally {
    downloadingUrls.delete(url);
  }
}

async function saveAllImages(urls: string[]) {
  const originalUrls = [...new Set(urls.map((url) => getOriginalImageUrl(url)).filter(Boolean))];
  if (!originalUrls.length) {
    showToast('当前动态没有可保存的图片', 'error');
    return;
  }

  showToast(`正在保存 ${originalUrls.length} 张原图...`, 'success', 3000);
  let saved = 0;
  let failed = 0;
  const savedPaths: string[] = [];
  for (const url of originalUrls) {
    try {
      const savedPath = await CoolapkTauriAPI.saveImage(
        url,
        settingsStore.settings.downloadPath
      );
      if (savedPath) savedPaths.push(savedPath);
      saved += 1;
    } catch (error) {
      failed += 1;
      console.warn('保存动态原图失败:', url, error);
    }
  }

  const directories = [...new Set(savedPaths.map((path) => path.replace(/[\\/][^\\/]*$/, '')).filter(Boolean))];
  const savedLocation = directories.length === 1 ? `，路径：${directories[0]}` : '';

  showToast(
    failed ? `原图保存完成：成功 ${saved} 张，失败 ${failed} 张${savedLocation}` : `原图保存完成：共 ${saved} 张${savedLocation}`,
    failed ? 'error' : 'success',
    6000,
  );
}

function replyComment(state: ContextState) {
  window.dispatchEvent(new CustomEvent('coolapk-context-reply-comment', {
    detail: {
      feedId: state.feedId,
      commentId: state.commentId,
      username: state.commentUsername,
    },
  }));
}

function deleteMessageChat(state: ContextState) {
  window.dispatchEvent(new CustomEvent('coolapk-context-delete-message', {
    detail: {
      ukey: state.messageUkey || '',
      id: state.messageId || '',
      isNew: Boolean(state.messageIsNew),
    },
  }));
}

function openLink(url: string) {
  const feedMatch = url.match(/\/feed\/(\d+)/);
  if (feedMatch?.[1]) {
    openFeedDetail(router, feedMatch[1]);
    return;
  }
  const path = new URL(url, window.location.origin).pathname;
  if (path.startsWith('/u/')) {
    void CoolapkTauriAPI.openUrl(new URL(url, 'https://www.coolapk.com').href, 'internal');
    return;
  }
  if (path.startsWith('/t/')) {
    router.push(`/topic/${path.slice(3)}`);
    return;
  }
  void CoolapkTauriAPI.openUrl(url, 'internal');
}

function searchInApp(value: string) {
  const query = value.trim();
  if (query) void router.push({ path: '/search', query: { q: query } });
}

function searchInSystem(value: string) {
  const query = value.trim();
  if (query) void CoolapkTauriAPI.openUrl(`https://www.baidu.com/s?wd=${encodeURIComponent(query)}`, 'system');
}

async function shareText(url: string) {
  try {
    if (navigator.share) {
      await navigator.share({ title: '酷安动态', url });
      return;
    }
  } catch {
    // 用户取消分享时不提示错误。
  }
  await copyText(url);
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  const scrollables = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((element) => (
    element.scrollTop > 0 && element.scrollHeight > element.clientHeight
  ));
  scrollables.forEach((element) => element.scrollTo({ top: 0, behavior: 'smooth' }));
}

function toggleTheme() {
  settingsStore.setTheme(settingsStore.settings.theme === 'dark' ? 'light' : 'dark');
}

function setDensity(density: typeof settingsStore.settings.density) {
  settingsStore.settings.density = density;
  const label = density === 'compact' ? '紧凑' : density === 'comfortable' ? '舒适' : '标准';
  showToast(`已切换为${label}布局`);
}

function adjustFontSize(delta: number) {
  const next = Math.min(20, Math.max(12, (settingsStore.settings.fontSize || 15) + delta));
  settingsStore.settings.fontSize = next;
  showToast(`字体大小：${next}px`);
}

function closeMenu() {
  clearTimeout(selectionRefreshTimer);
  selectionAdjusting.value = false;
  selectionTouchActive = false;
  menu.value = null;
}

useAndroidBackButton(() => Boolean(menu.value), closeMenu);

/**
 * 触摸端长按等价于桌面右键。
 *
 * 刻意不接管图片、图片载体、链接和输入框：
 * - iOS 在长按图片/链接时会弹出系统菜单（存储到照片 / 拷贝链接等），那目前是
 *   本应用在 iOS 上唯一真正可用的存图路径；
 * - 输入框和可编辑区域本身需要系统选择手柄。
 * 应用菜单和系统菜单同时弹出只会互相打架，所以这些区域让给系统；
 * 其余区域（评论、私信、页面空白与普通控件）在 iOS 上没有系统菜单可竞争。
 */
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 10;
// Android WebView 自身会在长按时派发 contextmenu，避免同一次手势跑两遍。
const NATIVE_CONTEXT_MENU_GRACE_MS = 700;
// 长按抬手后 WebKit 仍可能补发一次 click，避免菜单刚打开就被 window click 关掉。
const LONG_PRESS_CLICK_GUARD_MS = 400;

let lastNativeContextMenuAt = 0;
let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let longPressOrigin: { x: number; y: number } | null = null;
let longPressOpened = false;
let suppressMenuCloseUntil = 0;

function cancelLongPress() {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  longPressOrigin = null;
}

function resolveMenuState(point: ContextPoint): ContextState | null {
  // 标签栏提供收藏、固定和关闭等专用菜单，不能被全局捕获阶段的页面菜单抢先接管。
  if (point.target instanceof Element && point.target.closest('.page-tab-bar')) return null;
  return buildContext(point);
}

function applyMenu(state: ContextState) {
  const items = createItems(state);
  const mobileSelection = isTouchMobilePlatform() && Boolean(state.selectedText);
  const width = mobileSelection ? Math.min(460, window.visualViewport?.width || window.innerWidth) - 16 : 258;
  const estimatedHeight = Math.min(520, items.length * 38 + 16);
  menu.value = {
    ...state,
    items,
    mobileSelection,
    width,
    x: Math.max(8, Math.min(state.x, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(state.y, window.innerHeight - estimatedHeight - 8)),
  };
  if (mobileSelection) positionSelectionMenu();
}

/** 选择操作栏避开选区和手柄；选区占满可视区域时压缩在底部，调整期间隐藏。 */
function positionSelectionMenu() {
  const current = menu.value;
  const selection = window.getSelection();
  if (!current?.mobileSelection || !selection?.rangeCount) return;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  const viewport = window.visualViewport;
  const left = (viewport?.offsetLeft || 0) + 8;
  const top = (viewport?.offsetTop || 0) + 8;
  const bottom = (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight) - 8;
  const height = 50;
  const gap = 24;
  current.x = Math.max(left, Math.min(rect.left, left + (viewport?.width || window.innerWidth) - current.width - 16));
  current.y = rect.top - gap - height >= top ? rect.top - gap - height : rect.bottom + gap + height <= bottom ? rect.bottom + gap : Math.max(top, bottom - height);
}

/** 等系统更新选择范围后再刷新菜单，复制动作始终使用最新选中文字。 */
function refreshSelectionMenu() {
  clearTimeout(selectionRefreshTimer);
  if (!menu.value?.mobileSelection || selectionTouchActive) return;
  selectionRefreshTimer = setTimeout(() => {
    const current = menu.value;
    if (!current?.mobileSelection || selectionTouchActive) return;
    const text = selectedText();
    if (!text) { closeMenu(); return; }
    applyMenu({ ...current, selectedText: text });
    selectionAdjusting.value = false;
  }, 150);
}

function openMenu(event: MouseEvent) {
  lastNativeContextMenuAt = Date.now();
  const state = resolveMenuState(event);
  if (!state) return;
  event.preventDefault();
  event.stopPropagation();
  applyMenu(state);
}

function openMenuForLongPress(target: EventTarget | null, x: number, y: number): boolean {
  if (Date.now() - lastNativeContextMenuAt < NATIVE_CONTEXT_MENU_GRACE_MS) return false;
  if (target instanceof Element && target.closest('img, [data-context-image-url], a[href], input, textarea, select, [contenteditable="true"]')) return false;
  const state = resolveMenuState({ target, clientX: x, clientY: y });
  if (!state) return false;
  applyMenu(state);
  return true;
}

function handleWindowClick() {
  if (Date.now() < suppressMenuCloseUntil) return;
  closeMenu();
}

function handleTouchStart(event: TouchEvent) {
  cancelLongPress();
  longPressOpened = false;
  // 触摸正文或选择手柄时让出整个选区，不阻止系统拖动，也不重新触发长按菜单。
  if (menu.value?.mobileSelection) {
    if (!(event.target instanceof Element) || !event.target.closest('.app-context-menu')) {
      clearTimeout(selectionRefreshTimer);
      selectionTouchActive = true;
      selectionAdjusting.value = true;
    }
    return;
  }
  if (event.touches.length !== 1) return;
  const touch = event.touches[0];
  longPressOrigin = { x: touch.clientX, y: touch.clientY };
  const target = event.target;
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    if (!longPressOrigin) return;
    if (openMenuForLongPress(target, longPressOrigin.x, longPressOrigin.y)) {
      longPressOpened = true;
      suppressMenuCloseUntil = Date.now() + LONG_PRESS_CLICK_GUARD_MS;
    }
  }, LONG_PRESS_MS);
}

function handleTouchMove(event: TouchEvent) {
  if (!longPressOrigin) return;
  const touch = event.touches[0];
  if (!touch) {
    cancelLongPress();
    return;
  }
  if (
    Math.hypot(touch.clientX - longPressOrigin.x, touch.clientY - longPressOrigin.y)
    > LONG_PRESS_MOVE_TOLERANCE
  ) {
    cancelLongPress();
  }
}

function handleTouchEnd(event: TouchEvent) {
  cancelLongPress();
  if (selectionAdjusting.value) {
    selectionTouchActive = false;
    suppressMenuCloseUntil = Date.now() + LONG_PRESS_CLICK_GUARD_MS;
    refreshSelectionMenu();
    return;
  }
  const opened = longPressOpened;
  longPressOpened = false;
  // 阻止这次抬手派生的 click 与系统选单。
  if (opened && event.cancelable) event.preventDefault();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMenu();
}

function handleWindowScroll(event: Event) {
  // 操作栏横向滚动和拖动手柄产生的正文自动滚动都不能提前关闭选区菜单。
  if (event.target instanceof Element && event.target.closest('.app-context-menu') || selectionTouchActive) return;
  closeMenu();
}

onMounted(() => {
  window.addEventListener('contextmenu', openMenu, true);
  window.addEventListener('click', handleWindowClick);
  window.addEventListener('keydown', handleKeydown, true);
  window.addEventListener('resize', closeMenu);
  window.addEventListener('scroll', handleWindowScroll, true);
  document.addEventListener('selectionchange', refreshSelectionMenu);
  window.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
  window.addEventListener('touchmove', handleTouchMove, { capture: true, passive: true });
  window.addEventListener('touchend', handleTouchEnd, { capture: true, passive: false });
  window.addEventListener('touchcancel', handleTouchEnd, { capture: true, passive: false });
});

onUnmounted(() => {
  cancelLongPress();
  clearTimeout(selectionRefreshTimer);
  window.removeEventListener('contextmenu', openMenu, true);
  window.removeEventListener('click', handleWindowClick);
  window.removeEventListener('keydown', handleKeydown, true);
  window.removeEventListener('resize', closeMenu);
  window.removeEventListener('scroll', handleWindowScroll, true);
  document.removeEventListener('selectionchange', refreshSelectionMenu);
  window.removeEventListener('touchstart', handleTouchStart, true);
  window.removeEventListener('touchmove', handleTouchMove, true);
  window.removeEventListener('touchend', handleTouchEnd, true);
  window.removeEventListener('touchcancel', handleTouchEnd, true);
});

async function run(itemToRun: MenuItem) {
  if (!itemToRun.action || itemToRun.disabled) return;
  closeMenu();
  try {
    await itemToRun.action();
  } catch (error) {
    console.error('右键菜单操作失败:', error);
    showToast(`操作失败：${String(error)}`, 'error', 2400);
  }
}
</script>

<style scoped>
.app-context-menu {
  position: fixed;
  z-index: 20000;
  width: 258px;
  max-height: min(520px, calc(100vh - 16px));
  overflow-y: auto;
  padding: 7px;
  border: 1px solid var(--border-light);
  border-radius: 12px;
  background: var(--surface-elevated, var(--surface));
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.2), 0 2px 8px rgba(15, 23, 42, 0.12);
  color: var(--text-primary);
  user-select: none;
}

.context-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 34px;
  gap: 10px;
  padding: 7px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

/* 手机版选区菜单保持单行，横向滑动查看其余操作，减少对正文的遮挡。 */
.app-context-menu.is-mobile-selection { display: flex; max-height: 50px; overflow-x: auto; overflow-y: hidden; padding: 7px; scrollbar-width: none; }
.app-context-menu.is-mobile-selection::-webkit-scrollbar { display: none; }
.is-mobile-selection .context-menu-item { flex: 0 0 auto; width: auto; min-height: 34px; white-space: nowrap; }
.is-mobile-selection .context-menu-item kbd, .is-mobile-selection .context-menu-separator { display: none; }

.context-menu-item i {
  width: 16px;
  color: var(--text-secondary);
  text-align: center;
}

.context-menu-item span {
  flex: 1;
}

.context-menu-item kbd {
  color: var(--text-tertiary);
  font-size: 11px;
}

.context-menu-item:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--brand-primary);
}

.context-menu-item:hover:not(:disabled) i {
  color: var(--brand-primary);
}

.context-menu-item.is-danger {
  color: var(--danger);
}

.context-menu-item.is-disabled,
.context-menu-item:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.context-menu-separator {
  height: 1px;
  margin: 6px 5px;
  background: var(--border-light);
}
</style>
