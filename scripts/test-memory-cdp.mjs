// 在真实 Tauri WebView 中验证页面淘汰后可回收，并检查缓存返回仍恢复滚动位置。
import { writeFileSync } from 'node:fs';

const port = Number(process.env.CDP_PORT || 9222);
const pageUrl = process.env.CDP_PAGE_URL || 'http://127.0.0.1:17520/';
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(item => item.type === 'page' && item.url.startsWith(pageUrl));
if (!target?.webSocketDebuggerUrl) throw new Error('请先以 WebView2 CDP 调试端口启动开发版酷安');
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 0;
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时：${method}`)); }, 60_000);
  pending.set(id, { resolve, reject, timer });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const measure = async () => {
  await send('HeapProfiler.collectGarbage');
  return { heap: await send('Runtime.getHeapUsage'), dom: await send('Memory.getDOMCounters') };
};
let originalRoute;
const viewportWidth = Number(process.env.CDP_VIEWPORT_WIDTH || 0);
try {
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  originalRoute = await evaluate('location.hash.slice(1) || "/"');
  if (viewportWidth) await send('Emulation.setDeviceMetricsOverride', { width: viewportWidth, height: Number(process.env.CDP_VIEWPORT_HEIGHT || 844), deviceScaleFactor: 1, mobile: true });
  if (process.env.CDP_FORCE_RELOAD === '1') {
    await send('Page.reload');
    // 等待 Vue 挂载，避免把开发服务器重载中的空白文档作为基线。
    for (let i = 0; i < 100; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if (await evaluate('Boolean(document.querySelector("#app")?.__vue_app__?._instance)')) break;
    }
  }
  const before = await measure();
  const navigation = await evaluate(`(async () => {
    const router = document.querySelector('#app').__vue_app__.config.globalProperties.$router;
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const prefix = '/settings/appearance?memoryAudit=' + Date.now() + '-';
    window.__coolapkMemoryAudit = { nodes: [] };
    const audit = window.__coolapkMemoryAudit;
    for (let i = 0; i < 40; i++) {
      await router.push(prefix + i);
      await wait(180);
      const element = document.querySelector('.settings-page-container');
      if (!element) throw new Error('设置页未挂载');
      audit.nodes.push({ node: new WeakRef(element), component: new WeakRef(element.__vueParentComponent) });
    }
    // 只弱持有被测页面，测试工具本身不能造成页面存活。
    const page = document.querySelector('.settings-page-container');
    const scroll = page.querySelector('.settings-content');
    scroll.scrollTop = 320;
    const expectedScroll = scroll.scrollTop;
    await router.push('/downloads');
    await wait(250);
    await router.push(prefix + 39);
    await wait(250);
    const current = document.querySelector('.settings-page-container');
    return { cachedPageReused: current === page, expectedScroll, restoredScroll: current.querySelector('.settings-content').scrollTop,
      viewportWidth: innerWidth, viewportHeight: innerHeight, mobileSettings: Boolean(current.querySelector('.settings-layout-card.is-mobile')) };
  })()`);
  const after = await measure();
  const retained = await evaluate(`(() => {
    const nodes = window.__coolapkMemoryAudit.nodes;
    return { visited: nodes.length, alive: nodes.filter(item => item.node.deref()).length,
      unmountedAlive: nodes.filter(item => item.node.deref() && item.component.deref()?.isUnmounted).length };
  })()`);
  const result = { before, after, navigation, retained };
  console.log(JSON.stringify(result, null, 2));
  if (process.env.CDP_SCREENSHOT_PATH) {
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(process.env.CDP_SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
  }
  if (viewportWidth && navigation.viewportWidth !== viewportWidth) throw new Error('实际视口与测试宽度不一致');
  if (retained.unmountedAlive || retained.alive > 15) throw new Error('已淘汰页面仍被引用');
  if (!navigation.cachedPageReused || navigation.expectedScroll <= 0 || Math.abs(navigation.restoredScroll - navigation.expectedScroll) > 1) throw new Error('缓存返回或滚动位置恢复异常');
} finally {
  if (socket.readyState === WebSocket.OPEN) {
    try {
      await evaluate(`(async () => {
        delete window.__coolapkMemoryAudit;
        const router = document.querySelector('#app')?.__vue_app__?.config.globalProperties.$router;
        if (router) await router.push(${JSON.stringify(originalRoute || '/')});
      })()`);
    } finally {
      if (viewportWidth) await send('Emulation.clearDeviceMetricsOverride');
      socket.close();
    }
  }
  for (const request of pending.values()) clearTimeout(request.timer);
}
