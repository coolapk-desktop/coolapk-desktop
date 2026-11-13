<template>
  <div v-if="!requestCenterState.isOnline" class="network-status-banner" role="status">
    <i class="fas fa-wifi-slash"></i>
    <span>网络连接已断开，网络恢复后可重试失败的动态和评论请求。</span>
  </div>
</template>

<script setup lang="ts">
import { watch } from 'vue';
import { isWebBuild } from '../../api/runtime';
import { markNetworkReachable } from '../../utils/networkState';
import { requestCenterState } from '../../utils/requestCenter';

if (isWebBuild) {
  watch(() => requestCenterState.isOnline, (online, _, onCleanup) => {
    if (online) return;
    // 浏览器可能漏发 online 事件。离线提示可见期间用无副作用的请求确认连接。
    let activeProbe: AbortController | undefined;
    const timer = window.setInterval(async () => {
      if (activeProbe || document.visibilityState === 'hidden') return;
      const probe = new AbortController();
      activeProbe = probe;
      const timeout = window.setTimeout(() => probe.abort(), 8000);
      try {
        const response = await fetch('/', { method: 'HEAD', cache: 'no-store', signal: probe.signal });
        if (response.ok && !probe.signal.aborted) markNetworkReachable();
      } catch {
        // 连接仍不可用，等下一轮检查或浏览器的 online 事件。
      } finally {
        window.clearTimeout(timeout);
        activeProbe = undefined;
      }
    }, 5000);
    onCleanup(() => {
      window.clearInterval(timer);
      activeProbe?.abort();
    });
  }, { immediate: true });
}
</script>

<style scoped>
.network-status-banner { position: fixed; top: var(--app-titlebar-height); left: 50%; z-index: 2200; display: flex; align-items: center; gap: 8px; transform: translateX(-50%); padding: 8px 14px; color: var(--warning); background: var(--surface-elevated); border: 1px solid var(--warning); border-radius: var(--radius-pill); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12); font-size: var(--font-size-caption); }
@media (max-width: 700px) { .network-status-banner { width: calc(100% - 32px); justify-content: center; text-align: center; } }
</style>
