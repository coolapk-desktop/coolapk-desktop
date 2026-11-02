<template>
  <div v-pull-refresh="{ refresh: refreshMobilePage, disabled: !auth.isLoggedIn || mobileProfileRefreshing }" class="my-profile-page custom-scrollbar" @scroll="compact = ($event.target as HTMLElement).scrollTop > 100">
    <div class="profile-toolbar" :class="{ 'is-compact': compact }">
      <button v-if="compact" class="compact-avatar" type="button" aria-label="个人主页" @click="openProfile"><AppImage v-if="auth.user?.userAvatar" :src="auth.user.userAvatar" alt="头像" /></button>
      <button type="button" aria-label="扫一扫（暂未支持）" disabled><span class="official-icon" :style="iconStyle(scanIcon)"></span></button>
      <button type="button" aria-label="设置" @click="go('/settings')"><span class="official-icon" :style="iconStyle(settingsIcon)"></span></button>
      <button type="button" aria-label="应用管理" @click="go('/downloads')"><span class="official-icon" :style="iconStyle(appIcon)"></span></button>
      <button type="button" :aria-label="notifications.messageCount > 0 ? `消息，${notifications.messageCount} 条未读私信` : '消息'" @click="go('/messages')"><span class="official-icon" :style="iconStyle(mailIcon)"></span><span v-if="notifications.messageCount" class="message-badge">{{ notifications.messageCount > 99 ? '99+' : notifications.messageCount }}</span></button>
    </div>
    <section class="profile-identity">
      <button type="button" class="identity-link" @click="openProfile">
        <AppAvatar v-if="auth.user?.userAvatar" :src="auth.user.userAvatar" :plugin-url="auth.user.avatarPluginUrl" :size="60" alt="头像" />
        <span v-else class="profile-avatar placeholder-avatar"><i class="fas fa-user"></i></span>
        <span class="identity-info">
          <strong>{{ auth.user?.username || '登录 / 注册' }}</strong>
          <template v-if="auth.user">
            <span class="level-info"><em>Lv.{{ auth.user.level ?? 0 }}</em><span v-if="auth.user.maxExp">{{ auth.user.exp ?? 0 }}/{{ auth.user.maxExp }}</span></span>
            <span v-if="auth.user.maxExp" class="experience-track"><span :style="{ width: `${experiencePercent}%` }"></span></span>
          </template>
          <span v-else class="login-caption">登录酷安，发现更多精彩</span>
        </span>
      </button>
      <button type="button" class="profile-qr" aria-label="我的二维码名片" @click="showQr"><i class="fas fa-qrcode"></i></button>
      <button type="button" class="profile-arrow" aria-label="个人主页" @click="openProfile"><i class="fas fa-chevron-right"></i></button>
    </section>
    <div class="profile-statistics profile-card">
      <button v-for="stat in statistics" :key="stat.label" type="button" @click="goPrivate(stat.path)"><strong>{{ stat.value ?? '—' }}</strong><span>{{ stat.label }}</span></button>
    </div>
    <div v-if="accountTips && !tipsDismissed" class="account-tips profile-card"><AppImage v-if="accountTips.logo" :src="accountTips.logo" /><span>{{ accountTips.title }}</span><button v-if="accountTips.buttonName && accountTips.url" type="button" @click="openTip">{{ accountTips.buttonName }}</button><button v-if="Number(accountTips.closable) === 1" type="button" aria-label="关闭账号提示" @click="tipsDismissed = true">×</button></div>
    <section class="profile-menu profile-card" aria-label="我的功能">
      <button v-for="item in menu" :key="item.label" type="button" :title="item.disabled ? `${item.label}暂未支持` : undefined" :aria-pressed="item.action === 'theme' ? isDark : undefined" :disabled="item.disabled" @click="activate(item)">
        <span v-if="item.asset" class="official-icon" :style="{ ...iconStyle(item.asset), color: item.color }"></span>
        <i v-else :class="item.icon" :style="{ color: item.color }"></i>
        <span>{{ item.action === 'theme' && isDark ? '日间模式' : item.label }}</span>
      </button>
    </section>
    <button type="button" class="profile-help profile-card" @click="openHelp"><i class="fas fa-volume-high"></i><span>有疑惑请参考「酷安常见问题」 &gt;&gt;&gt;</span><i class="fas fa-chevron-right"></i></button>
    <MyProfileCards ref="mobileProfileCards" />
    <AppDialog :is-open="qrOpen" title="我的二维码名片" @close="qrOpen = false"><img v-if="qrImage" class="qr-image" :src="qrImage" alt="我的二维码名片" /><p v-else>{{ qrStatus }}</p></AppDialog>
  </div>
</template>

<script setup lang="ts">
import { vPullRefresh } from '../directives/pullRefresh';
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { useNotificationStore } from '../stores/notifications';
import { CoolapkTauriAPI } from '../api/coolapk';
import AppDialog from '../components/common/AppDialog.vue';
import MyProfileCards from '../components/profile/MyProfileCards.vue';
const mobileProfileCards = ref<InstanceType<typeof MyProfileCards> | null>(null);
const mobileProfileRefreshing = ref(false);
import AppImage from '../components/common/AppImage.vue';
import AppAvatar from '../components/common/AppAvatar.vue';
import ratingIcon from '../assets/official-profile/ic_my_rating_fill.svg';
import starIcon from '../assets/official-profile/ic_wodeshoucang_white_24dp.png';
import followIcon from '../assets/official-profile/ic_wodeguanzhu_white_24dp.png';
import moreIcon from '../assets/official-profile/ic_more_horiz_white_24dp.png';
import avatarPluginIcon from '../assets/official-profile/ic_avatar_plugin.svg';
import settingsIcon from '../assets/official-profile/ic_setting.svg';
import scanIcon from '../assets/official-profile/ic_scan_24dp.svg';
import textIcon from '../assets/official-profile/ic_wodetuwen_white_24dp.png';
import replyIcon from '../assets/official-profile/ic_wodehuifu_white_24dp.png';
import mailIcon from '../assets/official-profile/ic_mail_outline.svg';
import appIcon from '../assets/official-profile/ic_app_outline.svg';
import nightIcon from '../assets/official-profile/night.png';

const router = useRouter();
const auth = useAuthStore();
const settings = useSettingsStore();
const notifications = useNotificationStore();
const uid = computed(() => String(auth.user?.uid || ''));
const isDark = computed(() => settings.resolvedTheme === 'dark');
const experiencePercent = computed(() => Math.max(0, Math.min(100, (auth.user?.exp ?? 0) / (auth.user?.maxExp || 1) * 100)));
const profileData = ref<Record<string, unknown> | null>(null);
const compact = ref(false);
// 同步吸顶背景，避免滚动后状态栏仍保留个人页的浅灰色。
watch(compact, value => { settings.profileToolbarCompact = value; }, { immediate: true });
const tipsDismissed = ref(false);
const accountTips = computed(() => profileData.value?.tips as { title: string; logo?: string; buttonName?: string; url?: string; closable?: number } | undefined);
function openTip() { if (accountTips.value?.url) void CoolapkTauriAPI.openUrl(accountTips.value.url, 'internal'); }
let profileRequest = 0;
async function refreshProfile() {
  const value = uid.value;
  const request = ++profileRequest;
  if (!value) return;
  mobileProfileRefreshing.value = true;
  try {
    const response = await CoolapkTauriAPI.getMyProfile(value);
    if (request !== profileRequest) return;
    const data = response?.data ?? response;
    profileData.value = data;
    auth.updateProfileStats(data);
  } catch (error) { console.warn('加载个人中心资料失败', error); }
  finally { if (request === profileRequest) mobileProfileRefreshing.value = false; }
}
watch(uid, () => { profileData.value = null; tipsDismissed.value = false; void refreshProfile(); }, { immediate: true });
const statistics = computed(() => [
  { label: '动态', value: profileData.value?.feed ?? profileData.value?.feednum ?? profileData.value?.feedNum, path: `/user/${uid.value}` },
  { label: '关注', value: auth.user?.follow, path: `/user/${uid.value}/relations/follow` },
  { label: '粉丝', value: auth.user?.fans, path: `/user/${uid.value}/relations/fans` },
]);
interface MenuItem { label: string; color: string; asset?: string; icon?: string; path?: string; action?: string; disabled?: boolean; public?: boolean }
const menu = computed<MenuItem[]>(() => [
  { label: '我的关注', asset: followIcon, color: '#00b8cf', path: '/following' },
  { label: '我的收藏', asset: starIcon, color: '#2196f3', path: '/favorites' },
  { label: '我的点评', asset: ratingIcon, color: '#ee61d6', path: `/user/${uid.value}?tab=rating` },
  { label: '夜间模式', asset: nightIcon, color: '#a56bff', action: 'theme', public: true },
  { label: '我的图文', asset: textIcon, color: '#ff4039', path: '/my?section=my_feeds' },
  { label: '我的回复', asset: replyIcon, color: '#ff4039', path: '/my?section=my_comments' },
  { label: '我的挂件', asset: avatarPluginIcon, color: '#2196f3', path: '/my-plugins' },
  { label: '更多', asset: moreIcon, color: '#00b8cf', path: '/more', public: true },
]);
function iconStyle(url: string) { return { maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")` }; }
function go(path: string) { void router.push(path); }
function goPrivate(path: string) { if (!uid.value) auth.openLoginModal(); else go(path); }
function openProfile() { goPrivate(`/user/${uid.value}`); }
function openHelp() { void router.push({ path: '/external', query: { url: 'https://m.coolapk.com/mp/do?c=help&m=questionNew' } }); }
function activate(item: MenuItem) {
  if (item.action === 'theme') settings.setTheme(isDark.value ? 'light' : 'dark');
  else if (item.path) (item.public ? go : goPrivate)(item.path);
}
const qrOpen = ref(false), qrImage = ref(''), qrStatus = ref('正在加载…');
async function showQr() {
  if (!uid.value) { auth.openLoginModal(); return; }
  qrImage.value = ''; qrStatus.value = '正在加载…'; qrOpen.value = true;
  try {
    const response = await CoolapkTauriAPI.getUserQrImage(uid.value);
    const data = response?.data ?? response;
    qrImage.value = typeof data === 'string' ? data : data?.image || data?.imageUrl || data?.image_url || data?.url || '';
    if (!qrImage.value) throw new Error('接口未返回二维码图片');
  } catch { qrStatus.value = '二维码加载失败，请稍后重试'; }
}

// 下拉更新当前详情与当前栏目，保留筛选和排序。
async function refreshMobilePage() { await refreshProfile(); await mobileProfileCards.value?.refresh?.(); }
</script>

<style scoped>
.my-profile-page {
  --profile-background: #f2f2f6;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  /* 预留非覆盖式滚动条的位置，避免资料和卡片加载后挤窄内容。 */
  scrollbar-gutter: stable;
  background: var(--profile-background);
  padding: 0 max(8px, env(safe-area-inset-right)) 100px max(8px, env(safe-area-inset-left));
  color: var(--text-primary);
}
:global([data-theme="dark"] .my-profile-page) { --profile-background: var(--background); }
button { font: inherit; color: inherit; border: 0; background: transparent; cursor: pointer; touch-action: manipulation; }
button:active { opacity: .65; }
.profile-toolbar { position: sticky; top: 0; z-index: 2; display: flex; justify-content: flex-end; gap: 0; height: calc(48px + var(--app-safe-area-top, 0px)); align-items: center; padding-top: var(--app-safe-area-top, 0px); color: #757575; background: var(--profile-background); }
.profile-toolbar.is-compact { background: var(--surface); }
.profile-toolbar .compact-avatar { margin-right: auto; }
.compact-avatar .app-image-container { width: 24px; height: 24px; border-radius: 50%; }
.profile-toolbar button { width: 44px; height: 44px; position: relative; display: grid; place-items: center; }
.official-icon { display: inline-block; width: 24px; height: 24px; background: currentColor; mask-size: contain; mask-repeat: no-repeat; mask-position: center; }
/* 隔离头像挂件的内部层级，滚动时随身份区一起被吸顶工具栏遮挡。 */
.profile-identity { isolation: isolate; display: flex; align-items: center; gap: 0; padding: 8px 8px 16px; }
.identity-link { display: flex; align-items: center; flex: 1; min-width: 0; text-align: left; gap: 14px; padding: 0; }
.profile-avatar { width: 60px; height: 60px; border-radius: 50%; object-fit: cover; flex-shrink: 0; background: var(--surface); }
.placeholder-avatar { display: grid; place-items: center; font-size: 28px; color: var(--text-tertiary); }
.identity-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.identity-info strong { font-size: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.level-info { display: flex; justify-content: space-between; font-size: 10px; }
.level-info em { font-size: 12px; color: #b8b8bd; font-weight: 700; }
.experience-track { height: 5px; border-radius: 8px; background: #e2e2e5; overflow: hidden; }
.experience-track span { display: block; height: 100%; border-radius: inherit; background: #cfcfd3; }
.login-caption { font-size: 12px; color: var(--text-tertiary); }
.profile-qr, .profile-arrow { min-width: 44px; height: 44px; font-size: 22px; padding: 0; }
.profile-arrow { min-width: 32px; font-size: 18px; }
.profile-card { background: var(--surface); border-radius: 12px; margin-bottom: 8px; }
.account-tips { display: flex; align-items: center; gap: 8px; padding: 8px 16px; color: #ea4335; background: rgba(234,67,53,.1); font-size: 12px; }
.account-tips .app-image-container { width: 24px; height: 24px; flex-shrink: 0; background: transparent; }
.account-tips span { flex: 1; min-width: 0; }
.account-tips button { flex-shrink: 0; min-height: 44px; }
.profile-statistics { display: grid; grid-template-columns: repeat(3,1fr); padding: 7px 0; }
.profile-statistics button { min-height: 44px; position: relative; display: flex; flex-direction: column; gap: 3px; align-items: center; }
.profile-statistics button + button::before { content: ''; position: absolute; height: 20px; left: 0; top: 12px; width: 1px; background: var(--border-light); }
.profile-statistics strong { font-size: 22px; font-weight: 500; }
.profile-statistics span { font-size: 12px; color: var(--text-secondary); }
.profile-menu { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); padding: 6px 0; }
.profile-menu button { min-width: 0; min-height: 72px; padding: 8px 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; font-size: 14px; }
.profile-menu i, .profile-menu .official-icon { font-size: 24px; width: 24px; height: 24px; }
.profile-help { display: flex; width: 100%; align-items: center; gap: 12px; min-height: 44px; padding: 12px 16px; font-size: 14px; text-align: left; }
.profile-help span { flex: 1; }
.profile-help > i:first-child { color: #2196f3; }
.profile-help > i:last-child { color: var(--text-tertiary); }
.qr-image { display: block; max-width: 100%; margin: auto; }
.message-badge { position: absolute; top: 0; right: 0; background: #ff4039; color: white; border-radius: 16px; min-width: 16px; padding: 1px 4px; font-size: 10px; }
@media (min-width: 721px) { .my-profile-page { padding: 16px max(24px,calc((100% - 720px)/2)); } }
</style>
