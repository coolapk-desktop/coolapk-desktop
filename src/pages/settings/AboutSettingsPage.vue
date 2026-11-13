<template>
  <div class="settings-section">
    <h3 class="section-title">关于酷安桌面版</h3>

    <!-- 应用信息 -->
    <div class="setting-group">
      <div class="about-head">
        <img src="../../assets/coolapk-logo-rounded.png" alt="酷安 Logo" class="about-logo" />
        <div class="about-info">
          <div class="about-name-row">
            <span class="about-name">酷安桌面版</span>
            <span class="about-version">v{{ appVersion }}</span>
            <span class="about-channel">{{ versionChannelLabel }}</span>
          </div>
          <p class="about-desc">
            基于 Tauri 2、Vue 3 与 Rust 构建的非官方酷安桌面客户端，数据来自酷安公开接口。
          </p>
          <p v-if="buildCommit" class="about-desc">构建提交：{{ buildCommit }}</p>
        </div>
        <AppButton v-if="!isWebBuild" variant="secondary" size="sm" icon="fas fa-sync-alt" @click="checkUpdate">
          检查更新
        </AppButton>
      </div>

      <!-- 更新渠道只在启动与行为设置中编辑，这里只读展示当前值并提供跳转。 -->
      <div v-if="!isWebBuild" class="setting-row">
        <div class="row-info">
          <span class="row-label">更新渠道</span>
          <span class="row-sub">仅显示当前值，更新渠道在“启动与行为 → 更新渠道”中修改</span>
        </div>
        <div class="row-actions">
          <span class="channel-value">{{ updateChannelLabel }}</span>
          <router-link class="settings-link" to="/settings/startup">前往修改</router-link>
        </div>
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">技术栈</span>
          <span class="row-sub">Tauri 2 · Vue 3 · TypeScript · Rust · Pinia</span>
        </div>
        <div class="tech-badges">
          <span v-for="t in techStack" :key="t" class="tech-badge">{{ t }}</span>
        </div>
      </div>

      <div v-if="repoStats" class="setting-row">
        <div class="row-info">
          <span class="row-label">社区数据</span>
          <span class="row-sub">数据来自 GitHub API</span>
        </div>
        <div class="repo-stats">
          <span class="repo-stat"><i class="fas fa-star"></i> {{ formatCount(repoStats.stars) }}</span>
          <span class="repo-stat"><i class="fas fa-code-branch"></i> {{ formatCount(repoStats.forks) }}</span>
          <span class="repo-stat"><i class="fas fa-exclamation-circle"></i> {{ formatCount(repoStats.issues) }}</span>
        </div>
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">开源协议</span>
          <span class="row-sub">MIT License · 第三方非官方客户端</span>
        </div>
        <span class="license-badge">MIT</span>
      </div>
    </div>

    <!-- 联系与支持 -->
    <div class="setting-group">
      <h4 class="group-title">联系与支持</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">反馈与建议</span>
          <span class="row-sub">在 GitHub Issues 提交问题或建议，自动预填客户端版本与系统</span>
        </div>
        <AppButton variant="primary" size="sm" icon="fas fa-bug" title="提交 GitHub Issue" @click="open(createFeedbackIssueUrl())">
          提交反馈
        </AppButton>
      </div>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">项目主页</span>
          <span class="row-sub">GitHub 仓库 · 源码与 Release</span>
        </div>
        <AppIconButton icon="fas fa-arrow-up-right-from-square" size="sm" title="打开项目主页" @click="open('https://github.com/coolapk-desktop/coolapk-desktop')" />
      </div>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">项目组织</span>
          <span class="row-sub">coolapk-desktop · GitHub</span>
        </div>
        <AppIconButton icon="fas fa-users" size="sm" title="打开项目组织主页" @click="open('https://github.com/coolapk-desktop')" />
      </div>
    </div>

    <!-- 反馈说明指引 -->
    <div class="setting-group feedback-guide-group">
      <h4 class="group-title"><i class="fas fa-info-circle"></i> 反馈说明与建议</h4>
      <div class="guide-content">
        <p class="guide-item"><strong>📌 支持反馈内容：</strong>功能异常/报错（Bug）、界面样式显示问题、交互体验优化建议、希望新增的专区或功能。</p>
        <p class="guide-item"><strong>💡 高效反馈技巧：</strong>建议附带<strong>具体操作步骤</strong>、<strong>复现条件</strong>或<strong>截图/报错信息</strong>，以便开发者快速定位并排查问题。</p>
        <p class="guide-item"><strong>⚡ 自动附加信息：</strong>点击提交反馈后会打开 GitHub Issues，并预填当前客户端版本号与系统类型。</p>
        <p class="guide-item"><strong>📄 诊断日志：</strong>日志默认保存在本机。需要提供时，请先在“诊断日志”页面检查并导出，再自行决定是否附加到 Issue；提交前请移除账号凭据和个人信息。</p>
      </div>
    </div>

    <p class="copyright">© 2026 coolapk-desktop · MIT License</p>
  </div>
</template>

<script setup lang="ts">
import { isWebBuild } from '../../api/runtime';
import { computed, onMounted, ref } from 'vue';
import { APP_VERSION } from '../../constants/version';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { useSettingsStore } from '../../stores/settings';
import AppButton from '../../components/common/AppButton.vue';
import AppIconButton from '../../components/common/AppIconButton.vue';
import { createFeedbackIssueUrl } from '../../utils/feedback';

const appVersion = APP_VERSION;
const buildCommit = (import.meta.env.VITE_BUILD_COMMIT || '').slice(0, 8);
const settingsStore = useSettingsStore();

// 安装版本与更新渠道独立，测试版用户也可以选择只接收稳定版更新。
const versionChannelLabel = computed(() => (appVersion.includes('-') ? '测试版' : '稳定版'));
const updateChannelLabel = computed(() =>
  settingsStore.settings.updateChannel === 'beta' ? '测试版更新渠道' : '稳定版更新渠道'
);

const techStack = ['Tauri 2', 'Vue 3', 'TypeScript', 'Rust', 'Pinia'];

type RepoStats = { stars: number; forks: number; issues: number };
const repoStats = ref<RepoStats | null>(null);

function formatCount(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function open(url: string) {
  void CoolapkTauriAPI.openUrl(url, 'system');
}

function checkUpdate() {
  window.dispatchEvent(new Event('check-for-update'));
}

onMounted(() => {
  fetch('https://api.github.com/repos/coolapk-desktop/coolapk-desktop', {
    headers: { Accept: 'application/vnd.github.v3+json' },
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((data: any) => {
      if (data && typeof data.stargazers_count === 'number') {
        repoStats.value = {
          stars: data.stargazers_count,
          forks: data.forks_count ?? 0,
          issues: data.open_issues_count ?? 0,
        };
      }
    })
    .catch(() => {
      // 网络不可用时隐藏社区数据行
    });
});
</script>

<style scoped>
.settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  width: 100%;
  max-width: 760px;
  min-width: 0;
  box-sizing: border-box;
  container-type: inline-size;
  container-name: about-settings;
}

.section-title {
  font-size: var(--font-size-title-md);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  border-bottom: 1px solid var(--border);
  padding-bottom: var(--space-3);
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.group-title {
  margin: 0 0 var(--space-1);
  font-size: var(--font-size-title-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.setting-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3) var(--space-4);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border-light);
}

.row-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 200px;
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.row-label {
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}

.row-sub {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

/* 应用信息头 */
.about-head {
  display: flex;
  /* 更新按钮空间不足时另起一行，保留应用名称和说明的正常阅读宽度。 */
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) 0 var(--space-5);
  border-bottom: 1px solid var(--border-light);
}

.about-logo {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  flex-shrink: 0;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
}

.about-info {
  flex: 1 1 180px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-wrap: anywhere;
}

.about-name-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.about-name {
  font-size: var(--font-size-title-md);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}

.about-version {
  font-size: 12px;
  font-weight: 600;
  color: var(--brand-primary);
  background-color: var(--brand-soft);
  border: 1px solid rgba(16, 185, 129, 0.25);
  padding: 1px 8px;
  border-radius: var(--radius-pill);
}

.about-channel {
  font-size: 11px;
  color: var(--text-tertiary);
  background-color: var(--background);
  border: 1px solid var(--border);
  padding: 1px 8px;
  border-radius: var(--radius-pill);
}

.about-desc {
  margin: 0;
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  line-height: 1.6;
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
  flex: 0 0 auto;
  max-width: 100%;
}

.channel-value {
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  white-space: nowrap;
}

.settings-link {
  color: var(--brand-primary);
  font-size: var(--font-size-sub);
  text-decoration: none;
  white-space: nowrap;
}

.settings-link:hover {
  text-decoration: underline;
}

/* 技术栈与社区数据 */
.tech-badges {
  display: flex;
  gap: var(--space-1);
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 100%;
}

.tech-badge {
  font-size: 11px;
  background-color: var(--brand-soft);
  color: var(--brand-primary);
  border: 1px solid rgba(16, 185, 129, 0.25);
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  font-weight: var(--font-weight-medium);
}

.repo-stats {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-3);
  max-width: 100%;
}

.repo-stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.repo-stat i {
  font-size: 12px;
  color: var(--brand-primary);
}

.license-badge {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
  background-color: var(--background);
  border: 1px solid var(--border);
  padding: 2px 12px;
  border-radius: var(--radius-pill);
}

.feedback-guide-group {
  padding: var(--space-4);
  border-radius: var(--radius-card);
  background: rgba(16, 185, 129, 0.05);
  border: 1px solid rgba(16, 185, 129, 0.25);
}

.feedback-guide-group .group-title {
  color: var(--brand-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.guide-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0 0;
}

.guide-item {
  margin: 0;
  font-size: var(--font-size-caption);
  line-height: 1.6;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.guide-item strong {
  color: var(--text-primary);
}

/* 链接行（与其他 setting-row 观感一致） */
.copyright {
  margin: 0;
  text-align: center;
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  padding: var(--space-2) 0 var(--space-4);
}

@media (max-width: 600px) {
  .row-actions,
  .tech-badges,
  .repo-stats {
    flex-basis: 100%;
    justify-content: flex-start;
  }
}

@container about-settings (max-width: 560px) {
  .row-actions,
  .tech-badges,
  .repo-stats {
    flex-basis: 100%;
    justify-content: flex-start;
  }
}
</style>
