import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke, isTauri } from '@tauri-apps/api/core';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './styles/index.css';
import App from './App.vue';
import { initializeAndroidSafeArea } from './utils/androidSafeArea';
import { router } from './router';
import { CoolapkTauriAPI } from './api/coolapk';
import { useSettingsStore } from './stores/settings';
import { setupGlobalAlertProxy } from './utils/toast';
import { normalizeCoolapkDeepLink } from './utils/coolapkRoute';
import { installDiagnosticLogging, logDiagnostic, logDiagnosticLimited, summarizeDiagnosticError } from './utils/diagnosticLogger';
import { isResizeObserverWarning } from './utils/windowError';

// 启动全局原生 alert 代理拦截，统一呈现顶部高质感 Toast
// 手机上的图标不依赖系统字体；桌面继续沿用现有字体图标。
// 仅 Android 加载 SVG 规则，并在挂载前等待样式就绪，避免首屏图标闪烁。
const androidIconStylesReady = /android/i.test(navigator.userAgent) ? import('virtual:android-icons.css') : Promise.resolve();
if (/android/i.test(navigator.userAgent)) document.documentElement.dataset.iconRenderer = 'svg';
setupGlobalAlertProxy();
installDiagnosticLogging();

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
const settingsStore = useSettingsStore(pinia);
let unregisterDeepLink: (() => void) | null = null;

// 全局挂载外部链接打开器，供 DOM v-html 中的 <a onclick="..."> 安全调用
(window as any).__openCoolapkUrl = (url: string) => {
  if (!url) return;
  console.log('Open coolapk link:', url);
  void CoolapkTauriAPI.openUrl(url, useSettingsStore().settings.externalLinkMode);
};
app.use(router);

// 全局兜底：拦截 v-html 或未来新增页面中遗漏处理的 <a> 点击，
// 防止主窗口被导航到外部域名（外部页面接管主窗口 = 钓鱼/凭据回跳源被劫持风险）。
// 冒泡阶段执行：页面级 handleAnchorClick / vue-router 已处理（preventDefault）的
// 点击自动让行，只接管"无人处理"的外部链接。
document.addEventListener('click', (e) => {
  if (e.defaultPrevented) return;
  const anchor = (e.target as HTMLElement).closest('a');
  if (!anchor) return;
  const href = anchor.getAttribute('href') || '';
  // 站内相对/锚点链接交给 vue-router 与页面级逻辑
  if (!href || (href.startsWith('/') && !href.startsWith('//')) || href.startsWith('#')) return;
  e.preventDefault();
  if (/^(https?:)?\/\//i.test(href)) {
    void CoolapkTauriAPI.openUrl(href.startsWith('//') ? href : anchor.href, useSettingsStore().settings.externalLinkMode);
  }
  // 其余 scheme（javascript:、file: 等）直接静默阻止，协议白名单由 open_url 兜底
}, false);

// 全局错误捕获：把渲染期/异步崩溃显示出来，避免静默白屏，便于定位问题
function showGlobalError(message: string) {
  try {
    let el = document.getElementById('__global_error_overlay__');
    if (!el) {
      el = document.createElement('div');
      el.id = '__global_error_overlay__';
      el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99999;max-width:80vw;padding:10px 14px;background:#f04444;color:#fff;border-radius:8px;font:12px/1.5 system-ui,sans-serif;white-space:pre-wrap;word-break:break-all;box-shadow:0 4px 16px rgba(0,0,0,.25)';
      document.body.appendChild(el);
    }
    el.textContent = '[全局错误] ' + message;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 15000);
  } catch {
    // 忽略叠加层自身的错误
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return String(error);
}

app.config.errorHandler = (err, _instance, info) => {
  const msg = `${info || 'render'}: ${describeError(err)}`;
  logDiagnostic('error', 'vue', 'render_exception', `${info || 'render'} ${summarizeDiagnosticError(err)}`);
  console.error('[global-error]', msg, err);
  showGlobalError(msg);
};

window.addEventListener('error', (e) => {
  if (isResizeObserverWarning(e)) {
    logDiagnosticLimited('warn', 'window', 'resize_notification_deferred', e.message);
    e.preventDefault();
    return;
  }
  const msg = `${e.message || 'unknown'} @ ${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}`;
  const location = `${e.filename || 'unknown'}:${e.lineno || 0}:${e.colno || 0}`;
  logDiagnostic('error', 'window', 'uncaught_exception', `${summarizeDiagnosticError(e.error || e.message)} location=${location}`);
  console.error('[window-error]', msg, e.error);
  showGlobalError(msg);
});

window.addEventListener('unhandledrejection', (e) => {
  const msg = describeError(e.reason || e);
  logDiagnostic('error', 'window', 'unhandled_rejection', summarizeDiagnosticError(e.reason));
  console.error('[unhandledrejection]', msg, e.reason);
  showGlobalError(msg);
});

async function focusMainWindow() {
  // Android 由深链 Intent 激活 Activity，不调用桌面窗口聚焦接口。
  if (/android/i.test(navigator.userAgent)) return;
  try {
    const mainWindow = getCurrentWindow();
    await mainWindow.show();
    await mainWindow.unminimize();
    await mainWindow.setFocus();
  } catch (error) {
    console.warn('处理酷安深链时聚焦主窗口失败:', error);
  }
}

async function navigateCoolapkDeepLinks(urls: string[]) {
  const route = urls.map(normalizeCoolapkDeepLink).find((item): item is string => Boolean(item));
  if (!route || !router.resolve(route).matched.length) return;
  await router.isReady();
  await router.push(route);
  await focusMainWindow();
}

async function setupDeepLinkHandling() {
  try {
    // 已安装应用首次被深链启动时，从 getCurrent 读取启动参数；已有实例则接收 onOpenUrl 事件。
    unregisterDeepLink = await onOpenUrl((urls) => { void navigateCoolapkDeepLinks(urls); });
    const startupUrls = await getCurrent();
    if (startupUrls?.length) await navigateCoolapkDeepLinks(startupUrls);
  } catch (error) {
    // 浏览器开发模式没有 Tauri 深链运行时，不影响普通页面启动。
    console.warn('初始化酷安深链处理失败:', error);
  }
}

async function bootstrap() {
  await androidIconStylesReady;
  await initializeAndroidSafeArea();
  await settingsStore.initializeSettings();
  // 原生层已恢复登录 Cookie：游客生成并缓存 DUID，已登录时不会自动获取或启用。
  if (isTauri()) {
    try { await invoke('initialize_device_identity'); }
    catch { logDiagnostic('warn', 'device', 'identity_initialization_failed'); }
  }
  logDiagnostic('info', 'app', 'settings-ready');
  app.mount('#app');
  // 设置文件在应用挂载前读取；缩放等依赖 #app 的外观设置需在挂载后再应用一次。
  settingsStore.applyAppearance();
  await setupDeepLinkHandling();
  logDiagnostic('info', 'app', 'ready');
  const readyAt = Date.now();
  window.setInterval(() => {
    if (!document.hidden) {
      logDiagnostic('info', 'app', 'heartbeat', `uptime_s=${Math.floor((Date.now() - readyAt) / 1000)}`);
    }
  }, 30_000);
}

void bootstrap();
