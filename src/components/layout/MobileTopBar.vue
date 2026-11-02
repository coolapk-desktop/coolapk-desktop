<template>
  <header v-if="!isReportPage && !(officialMobileDetail && /^\/feed\//.test(route.path))" class="mobile-top-bar" :class="{ 'is-macos': macOverlay, 'is-profile-page': route.path === '/me', 'is-digital-page': route.path === '/digital' || route.path === '/discover' }">
    <template v-if="route.path === '/digital' || route.path === '/discover'">
      <button type="button" class="mobile-icon-button digital-avatar" aria-label="个人主页" @click="router.push('/me')"><AppAvatar :src="authStore.user?.userAvatar" :size="24" /></button>
      <button type="button" class="digital-search-entry" :aria-label="route.path === '/discover' ? '搜索' : '搜索数码'" @click="appStore.openSearch"><span>{{ route.path === '/discover' ? '搜索你感兴趣的内容' : '搜索数码产品' }}</span><i class="fas fa-magnifying-glass"></i></button>
      <button type="button" class="mobile-icon-button has-badge digital-official-icon" aria-label="应用游戏" @click="router.push('/apps')"><span :style="iconStyle(appIcon)"></span></button>
      <button type="button" class="mobile-icon-button has-badge digital-official-icon" :aria-label="getMessageAriaLabel()" @click="router.push('/messages')"><span :style="iconStyle(mailIcon)"></span><span v-if="notificationStore.messageCount" class="mobile-badge">{{ notificationStore.messageCount > 99 ? '99+' : notificationStore.messageCount }}</span></button>
    </template>
    <template v-else>
    <button
      v-if="route.path !== '/'"
      type="button"
      class="mobile-icon-button"
      aria-label="返回"
      @click="goBack"
    >
      <i class="fas fa-arrow-left"></i>
    </button>
    <div v-else class="mobile-brand" aria-label="酷安首页">
      <img src="../../assets/coolapk-logo-rounded.png" alt="" />
    </div>

    <button v-if="route.path === '/'" type="button" class="mobile-search-entry" aria-label="搜索" @click="appStore.openSearch">
      <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
      <span>搜索你感兴趣的内容</span>
    </button>
    <strong v-else class="mobile-page-title">{{ pageTitle }}</strong>

    <div class="mobile-top-actions">
      <button v-if="route.path !== '/'" type="button" class="mobile-icon-button" aria-label="搜索" @click="appStore.openSearch">
        <i class="fas fa-magnifying-glass"></i>
      </button>
      <!-- 首页顶部提供直达私信入口，角标只显示私信分类未读数。 -->
      <button v-if="route.path === '/'" type="button" class="mobile-icon-button has-badge" :aria-label="getMessageAriaLabel()" @click="router.push('/messages')">
        <i class="fas fa-envelope" aria-hidden="true"></i>
        <span v-if="notificationStore.messageCount" class="mobile-badge">{{ notificationStore.messageCount > 99 ? '99+' : notificationStore.messageCount }}</span>
      </button>
      <button type="button" class="mobile-icon-button has-badge" aria-label="通知" @click="router.push('/notifications')">
        <i class="fas fa-bell"></i>
        <span v-if="notificationStore.notificationCount" class="mobile-badge">
          {{ notificationStore.notificationCount > 99 ? '99+' : notificationStore.notificationCount }}
        </span>
      </button>
      <button
        type="button"
        class="mobile-icon-button"
        :aria-label="navigationOpen ? '关闭快捷入口' : '打开快捷入口'"
        :aria-expanded="navigationOpen"
        @click="emit('toggleNavigation')"
      >
        <i :class="navigationOpen ? 'fas fa-xmark' : 'fas fa-grip'"></i>
      </button>
    </div>
    </template>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { isFeedReportUrl } from '../../utils/feedReport';
import { useOfficialMobileFeedDetail } from '../../composables/useOfficialMobileFeedDetail';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from '../../stores/app';
import { useNotificationStore } from '../../stores/notifications';
import { navigateBack } from '../../utils/navigation';
import { useAuthStore } from '../../stores/auth';
import AppAvatar from '../common/AppAvatar.vue';
import appIcon from '../../assets/official-profile/ic_app_outline.svg';
import mailIcon from '../../assets/official-profile/ic_mail_outline.svg';

defineProps<{ navigationOpen: boolean; macOverlay: boolean }>();
const emit = defineEmits<{ toggleNavigation: [] }>();

const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const notificationStore = useNotificationStore();
const authStore = useAuthStore();
const officialMobileDetail = useOfficialMobileFeedDetail();

const routeTitles: Record<string, string> = {
  '/': '酷安',
  '/auth_callback': '登录验证',
  '/digital': '数码',
  '/apps': '应用',
  '/discover': '发现',
  '/games': '游戏',
  '/downloads': '下载管理',
  '/topics': '话题',
  '/favorites': '收藏',
  '/my-likes': '我的赞',
  '/followed-nodes': '我关注的论坛',
  '/followed-topics': '我关注的话题',
  '/recent-contacts': '最近联系人',
  '/recycle-bin': '内容回收站',
  '/hidden-replies': '隐藏的回复',
  '/my-devices': '我的设备',
  '/my-albums': '我的专辑',
  '/my-votes': '我的投票',
  '/history': '浏览历史',
  '/following': '关注',
  '/reviews': '评测',
  '/secondhand': '二手市场',
  '/secondhand/brands': '二手品牌',
  '/secondhand/list': '二手列表',
  '/events': '活动',
  '/anylist': '收藏单',
  '/my-dyh': '我的看看号',
  '/center': '酷安中心',
  '/external': '外部页面',
  '/product-selector': '选机中心',
  '/goods': '好物推荐',
  '/my-products': '我的数码',
  '/product-compare': '机型对比',
  '/search': '搜索',
  '/notifications': '通知',
  '/messages': '私信',
  '/blacklist': '黑名单',
  '/albums': '专辑',
  '/pictures': '酷图',
  '/headline': '头条',
  '/page': '内容列表',
  '/more': '更多服务',
  '/my': '我的',
  '/settings': '设置',
  '/user': '个人主页',
  '/feed': '动态详情',
  '/question': '问题详情',
  '/live': '直播详情',
  '/event': '活动详情',
  '/node': '论坛',
  '/topic': '话题详情',
  '/app': '应用详情',
  '/product': '数码详情',
  '/dyh': '看看号',
  '/album': '专辑详情',
};

const pageTitle = computed(() => {
  if (route.path === '/page' && typeof route.query?.title === 'string' && route.query.title.trim()) return route.query.title;
  const exact = routeTitles[route.path];
  if (exact) return exact;
  const prefix = Object.keys(routeTitles)
    .filter((path) => path !== '/' && route.path.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? routeTitles[prefix] : String(route.meta.title || '酷安');
});
const isReportPage = computed(() => route.path === '/external' && isFeedReportUrl(route.query.url));

function iconStyle(url: string) {
  return { maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")` };
}

// 私信入口只播报私信分类未读数，不把普通站内通知混入角标。
function getMessageAriaLabel() {
  const count = notificationStore.messageCount;
  return count > 0 ? `私信，${count} 条未读` : '私信';
}

function goBack() {
  navigateBack(router);
}
</script>

<style scoped>
.mobile-top-bar {
  display: none;
}

@media (max-width: 720px) {
  .mobile-top-bar.is-digital-page { border-bottom: 0; gap: 4px; }
  .digital-search-entry { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: 1; min-width: 0; height: 32px; padding: 0 12px; border: 0; border-radius: 9px; color: var(--text-secondary); background: var(--surface-hover); font: inherit; font-size: 14px; text-align: left; }
  .digital-search-entry span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .digital-official-icon > span:first-child { width: 24px; height: 24px; background: var(--text-secondary); mask-size: contain; mask-position: center; mask-repeat: no-repeat; }
  .mobile-top-bar.is-profile-page { display: none; }
  .mobile-top-bar {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 8px;
    min-height: calc(var(--mobile-topbar-height) + var(--app-safe-area-top, 0px));
    padding: var(--app-safe-area-top, 0px) max(10px, env(safe-area-inset-right)) 0 max(10px, env(safe-area-inset-left));
    border-bottom: 1px solid var(--border-light);
    background: var(--surface);
    z-index: 30;
  }

  .mobile-top-bar.is-macos {
    padding-left: max(86px, env(safe-area-inset-left));
  }

  .mobile-top-bar.is-macos .mobile-brand {
    display: none;
  }

  .mobile-brand,
  .mobile-icon-button {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    flex: 0 0 44px;
  }

  .mobile-brand img {
    width: 28px;
    height: 28px;
    border-radius: 8px;
  }

  .mobile-icon-button {
    position: relative;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: 17px;
  }

  .mobile-icon-button:active {
    background: var(--surface-hover);
  }

  .mobile-search-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    height: 44px;
    padding: 0 12px;
    border: 0;
    border-radius: 22px;
    background: var(--surface-hover);
    color: var(--text-tertiary);
    font: inherit;
    font-size: 13px;
    text-align: left;
  }

  .mobile-search-entry span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mobile-search-entry:active {
    background: var(--background-secondary);
  }

  .mobile-page-title {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    color: var(--text-primary);
    font-size: 17px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mobile-top-actions {
    display: flex;
    align-items: center;
  }

  .mobile-badge {
    position: absolute;
    top: 2px;
    right: 0;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border: 2px solid var(--surface);
    border-radius: 999px;
    background: #ef4444;
    color: #fff;
    font-size: 9px;
    font-weight: 700;
    line-height: 12px;
  }
}
</style>
