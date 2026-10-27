import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, compileStyle } from '@vue/compiler-sfc';
import postcss from 'postcss';

// 使用实际组件样式检查收起后的空间释放、栏目保留和桌面标题栏，避免只测状态开关。
const browser = process.env.LAYOUT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
if (!existsSync(browser)) throw new Error('请通过 LAYOUT_BROWSER 指定 Chromium 浏览器路径');
const artifacts = mkdtempSync(join(tmpdir(), 'coolapk-mobile-reading-'));
const components = ['layout/AppShell', 'layout/MobileTopBar', 'layout/MobileBottomNav', 'feed/MobileHomePager'];
const css = ['tokens.css', 'themes.css', 'reset.css'].map(file => readFileSync('src/styles/' + file, 'utf8')).join('\n') + components.map(name => {
  const descriptor = parse(readFileSync(`src/components/${name}.vue`, 'utf8')).descriptor;
  return descriptor.styles.map(style => compileStyle({ source: style.content, filename: name + '.vue', id: 'data-v-reading', scoped: true }).code).join('\n');
}).join('\n') + parse(readFileSync('src/pages/HomeTabPanel.vue', 'utf8')).descriptor.styles.map(style => compileStyle({ source: style.content, filename: 'HomeTabPanel.vue', id: 'data-v-reading', scoped: true }).code).join('\n');
// 模拟旧内核丢弃 max() 声明；自定义属性仍保留原样，才能发现计算时失效的问题。
const legacyStyles = postcss.parse(css);
legacyStyles.walkAtRules('supports', rule => { if (/\bmax\(/.test(rule.params)) rule.remove(); });
legacyStyles.walkDecls(declaration => { if (!declaration.prop.startsWith('--') && /\bmax\(/.test(declaration.value)) declaration.remove(); });
const cases = [390, 600, 1280].flatMap(width => [{ width, legacy: false }, { width, legacy: true }]);
const frames = cases.map(({ width, legacy }) => {
  const html = `<!doctype html><html><head><style>${legacy ? legacyStyles.toString() : css}
    html,body{height:100%;margin:0;} .home-toolbar{height:48px;background:var(--surface);} .follow-subchannel-bar{height:40px;flex-shrink:0;}
    .top-bar{height:32px;min-height:32px;flex-shrink:0;display:flex;} .content{height:2400px;} .mobile-bottom-nav{height:56px;}
    </style></head><body><div class="app-shell has-mobile-window-controls has-mobile-bottom-nav">
    <div class="top-bar has-window-controls">窗口按钮</div>
    <div class="mobile-reading-topbar"><div class="mobile-reading-topbar-content"><header class="mobile-top-bar"><span>搜索你感兴趣的内容</span></header></div></div>
    <div class="app-body"><div class="app-content-column"><main class="app-main-content"><div class="app-page-content">
    <div class="mobile-home-pager"><div class="home-main-column"><div class="home-toolbar">关注　头条　热榜　快讯　新机　摄影</div>
    <div class="pager-viewport"><div class="pager-track"><section class="pager-page"><div class="home-page-layout"><div class="main-feed-column">
    <div class="follow-subchannel-bar">全部关注　好友关注</div><div class="feed-scroll-container"><div class="content">阅读正文</div></div>
    </div></div></section></div></div></div></div>
    </div></main></div></div><nav class="mobile-bottom-nav">首页　数码　＋　发现　我的</nav></div>
    <script>(async()=>{
      // 无头浏览器的虚拟时间不会稳定推进合成动画，显式完成后检查最终几何位置。
      const wait=()=>new Promise(resolve=>{void document.body.offsetHeight;setTimeout(()=>{document.getAnimations().forEach(animation=>animation.finish());resolve();},300);});
      const shell=document.querySelector('.app-shell'), list=document.querySelector('.feed-scroll-container');
      const box=selector=>document.querySelector(selector).getBoundingClientRect();
      const sample=()=>({top:box('.mobile-reading-topbar').height,tabs:box('.home-toolbar').height,filters:box('.follow-subchannel-bar').height,viewport:box('.pager-viewport').height,padding:parseFloat(getComputedStyle(list).paddingBottom),dock:box('.mobile-bottom-nav').top,controls:box('.top-bar').height});
      await wait();const before=sample();const dock=box('.mobile-bottom-nav');shell.classList.add('reading-navigation-hidden');await wait();const hidden=sample();
      shell.classList.remove('reading-navigation-hidden');await wait();const restored=sample();
      const mobile=${width<=720};
      const checks={width:${width},searchCollapsed:!mobile||hidden.top<1,spaceReleased:mobile?hidden.viewport>before.viewport+40&&hidden.padding<before.padding:Math.abs(hidden.viewport-before.viewport)<1,tabsPreserved:hidden.tabs===before.tabs&&hidden.tabs>0,filtersPreserved:hidden.filters===before.filters&&hidden.filters>0,controlsPreserved:hidden.controls===before.controls&&hidden.controls>0,dockHidden:!mobile||hidden.dock>=innerHeight,restored:Math.abs(before.top-restored.top)<1&&Math.abs(before.viewport-restored.viewport)<1};
      checks.dockPositioned=!mobile||(Math.abs(dock.left-20)<1&&Math.abs(innerWidth-dock.right-20)<1&&Math.abs(innerHeight-dock.bottom-20)<1);
      checks.contentReserved=!mobile||before.padding>=84;
      parent.postMessage({checks,legacy:${legacy},before,hidden,restored},'*');
    })();</script></body></html>`;
  const scopedHtml = html.replace(/<([a-zA-Z][\w-]*)(?=[\s>])/g, '<$1 data-v-reading');
  return `<iframe style="width:${width}px;height:700px;border:0" srcdoc="${scopedHtml.replaceAll('&','&amp;').replaceAll('"','&quot;')}"></iframe>`;
});
const fixture = join(artifacts, 'reading.html');
writeFileSync(fixture, `<html><body><script>const results=[];addEventListener('message',event=>{results.push(event.data);document.body.dataset.results=encodeURIComponent(JSON.stringify(results));});</script>${frames.join('')}</body></html>`);
const result = spawnSync(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(artifacts,'profile')}`, '--window-size=1440,1000', '--virtual-time-budget=4000', '--dump-dom', pathToFileURL(fixture).href], { windowsHide: true, encoding: 'utf8', timeout: 25000, maxBuffer: 10 * 1024 * 1024 });
if (result.error) throw result.error;
const encoded = result.stdout.match(/data-results="([^"]+)"/)?.[1];
if (!encoded) throw new Error(`浏览器未返回结果：${result.stderr.slice(-500)}`);
const results = JSON.parse(decodeURIComponent(encoded));
console.log(JSON.stringify({ results, artifacts }, null, 2));
if (results.length !== cases.length || results.some(({ checks }) => Object.entries(checks).some(([key,value]) => key !== 'width' && !value))) throw new Error('移动阅读导航布局验证失败');
