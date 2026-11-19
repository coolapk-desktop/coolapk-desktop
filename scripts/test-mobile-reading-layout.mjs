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
const components = ['layout/AppShell', 'layout/MobileTopBar', 'layout/MobileBottomNav', 'feed/MobileHomePager', 'feed/FeedTabs', 'feed/FeedCard', 'feed/FeedCommentSection'];
const css = ['tokens.css', 'themes.css', 'reset.css'].map(file => readFileSync('src/styles/' + file, 'utf8')).join('\n') + components.map(name => {
  const descriptor = parse(readFileSync(`src/components/${name}.vue`, 'utf8')).descriptor;
  return descriptor.styles.map(style => compileStyle({ source: style.content, filename: name + '.vue', id: 'data-v-reading', scoped: true }).code).join('\n');
}).join('\n') + ['HomeTabPanel', 'FeedDetailPage'].flatMap(page => parse(readFileSync(`src/pages/${page}.vue`, 'utf8')).descriptor.styles.map(style => compileStyle({ source: style.content, filename: `${page}.vue`, id: 'data-v-reading', scoped: true }).code)).join('\n');
// 模拟旧内核丢弃 max() 声明；自定义属性仍保留原样，才能发现计算时失效的问题。
const legacyStyles = postcss.parse(css);
legacyStyles.walkAtRules('supports', rule => { if (/\bmax\(/.test(rule.params)) rule.remove(); });
legacyStyles.walkDecls(declaration => { if (!declaration.prop.startsWith('--') && /\bmax\(/.test(declaration.value)) declaration.remove(); });
const cases = [390, 600, 1280].flatMap(width => [false, true].map(legacy => ({ width, legacy, inset: 0 })));
cases.push({ width: 390, legacy: false, inset: 24 }, { width: 390, legacy: true, inset: 24 });
const frames = cases.map(({ width, legacy, inset }) => {
  const html = `<!doctype html><html><head><style>${legacy ? legacyStyles.toString() : css}
    html,body{height:100%;margin:0;} .home-toolbar{height:48px;background:var(--surface);} .follow-subchannel-bar{height:40px;flex-shrink:0;}
    .top-bar{height:32px;min-height:32px;flex-shrink:0;display:flex;} .content{height:2400px;}
    html{--android-safe-area-bottom:${inset}px;}
    </style></head><body><div class="app-shell has-mobile-window-controls has-mobile-bottom-nav${inset ? ' is-android' : ''}">
    <div class="top-bar has-window-controls">窗口按钮</div>
    <div class="mobile-reading-topbar"><div class="mobile-reading-topbar-content"><header class="mobile-top-bar"><button class="mobile-search-entry">搜索你感兴趣的内容</button></header></div></div>
    <div class="app-body"><div class="app-content-column"><main class="app-main-content"><div class="app-page-content">
    <div class="mobile-home-pager"><div class="home-main-column"><div class="home-toolbar">关注　头条　热榜　快讯　新机　摄影</div>
    <div class="pager-viewport"><div class="pager-track"><section class="pager-page"><div class="home-page-layout"><div class="main-feed-column">
    <div class="follow-subchannel-bar">全部关注　好友关注</div><div class="feed-scroll-container"><div class="content">阅读正文</div></div>
    </div></div></section></div></div></div></div>
    </div></main></div></div><nav class="mobile-bottom-nav"><button class="mobile-nav-item">首页</button><button class="mobile-nav-item">数码</button><button class="mobile-publish">＋</button><button class="mobile-nav-item">发现</button><button class="mobile-nav-item">我的</button></nav></div>
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
      const inset=${inset}, offset=${legacy} ? inset+8 : Math.max(8,inset);
      checks.dockPositioned=!mobile||(dock.left>=20&&Math.abs(dock.left-(innerWidth-dock.right))<1&&innerHeight-dock.bottom===offset);
      checks.contentReserved=!mobile||(dock.height===56&&before.padding>=dock.height+offset+8);
      if(mobile){
        const windowBar=document.querySelector('.top-bar');
        const safeTop=inset ? 28 : 0;
        const titleHeight=inset ? 0 : windowBar.getBoundingClientRect().height;
        if(inset){
          shell.classList.remove('has-mobile-window-controls');
          windowBar.style.display='none';
        }
        shell.classList.add('has-home-navigation');
        document.documentElement.style.setProperty('--android-safe-area-top',safeTop+'px');
        document.querySelector('.mobile-home-pager').classList.add('has-joined-toolbar');
        const tabs=document.querySelector('.home-toolbar');
        tabs.classList.add('is-mobile-toolbar');
        const stack=document.createElement('div');
        stack.setAttribute('data-v-reading','');
        stack.className='mobile-reading-topbar-stack';
        const search=document.querySelector('.mobile-top-bar');
        search.parentElement.append(stack);
        stack.append(search,tabs);
        const homeTabs=box('.home-toolbar');
        const homeSearch=box('.mobile-search-entry');
        checks.homeHeaderCompact=box('.mobile-top-bar').height===safeTop+44&&homeTabs.top===titleHeight+safeTop+44&&homeTabs.height===44;
        checks.homeContentAligned=parseFloat(getComputedStyle(list,'::before').height)===homeTabs.bottom-titleHeight;

        shell.classList.remove('has-home-navigation');
        shell.classList.add('has-discovery-navigation');
        search.classList.add('is-digital-page');
        document.querySelector('.mobile-search-entry').classList.add('digital-search-entry');
        tabs.remove();
        const sectionTabs=document.createElement('div');
        sectionTabs.setAttribute('data-v-reading','');
        sectionTabs.className='feed-tabs-wrapper mobile-section-tabs';
        const pageContent=document.querySelector('.app-page-content');
        pageContent.prepend(sectionTabs);
        await wait();
        const discoveryTabs=sectionTabs.getBoundingClientRect();
        const discoverySearch=box('.mobile-search-entry');
        checks.sectionHeadersAligned=discoveryTabs.top===homeTabs.top&&discoveryTabs.height===homeTabs.height&&discoverySearch.top===homeSearch.top&&discoverySearch.height===homeSearch.height;
        shell.classList.add('reading-navigation-hidden');
        await wait();
        checks.sectionHeaderCollapses=sectionTabs.getBoundingClientRect().top===titleHeight+safeTop;
        shell.classList.remove('reading-navigation-hidden','has-discovery-navigation');
      }
      if(inset){
        shell.classList.remove('has-mobile-bottom-nav');
        shell.classList.add('has-immersive-feed-detail');
        const pageContent=document.querySelector('.app-page-content');
        pageContent.innerHTML='<div data-v-reading class="feed-detail-page is-official-mobile reading-actions-hidden"><div data-v-reading class="feed-detail-header-backdrop" style="display:none"><div data-v-reading class="feed-detail-edge-blur"><span data-v-reading></span><span data-v-reading></span><span data-v-reading></span><span data-v-reading></span></div></div><div data-v-reading class="feed-detail-shell"><article data-v-reading class="feed-card is-official-mobile-detail"><header data-v-reading class="official-detail-author">作者<button data-v-reading class="official-follow-author">关注</button></header><section data-v-reading class="official-detail-comments"><div data-v-reading class="comment-toolbar"><div data-v-reading class="comment-toolbar-main"><strong data-v-reading class="comment-title">共 47 回复</strong><div data-v-reading class="comment-sort"><button data-v-reading class="comment-sort-button is-active">默认</button><button data-v-reading class="comment-sort-button">最新</button></div></div><div data-v-reading class="comment-toolbar-actions"><button data-v-reading class="comment-toolbar-action comment-search-trigger">搜</button></div></div><div class="content">动态评论</div></section></article></div></div>';
        const detail=document.querySelector('.feed-detail-page');
        const toolbar=document.querySelector('.comment-toolbar');
        const author=document.querySelector('.official-detail-author');
        const backdrop=document.querySelector('.feed-detail-header-backdrop');
        document.querySelector('.feed-detail-shell').style.setProperty('--feed-detail-header-height',author.offsetHeight+'px');
        const bottomOverlay=getComputedStyle(shell,'::after');
        checks.feedHeaderOpaque=getComputedStyle(author).backgroundColor===getComputedStyle(detail).backgroundColor&&getComputedStyle(backdrop).display==='none';
        detail.scrollTop=detail.scrollHeight;
        detail.classList.add('has-joined-comment-header');
        backdrop.style.removeProperty('display');
        checks.detailFillsViewport=detail.getBoundingClientRect().bottom===innerHeight;
        checks.detailBottomUncovered=bottomOverlay.content==='none'&&bottomOverlay.backgroundImage==='none';
        const chromeHeight=author.offsetHeight+toolbar.offsetHeight;
        backdrop.style.setProperty('--feed-detail-backdrop-content-height',chromeHeight+'px');
        backdrop.style.setProperty('--feed-detail-backdrop-author-height',author.offsetHeight+'px');
        const edge=document.querySelector('.feed-detail-edge-blur');
        const edgeTint=getComputedStyle(edge,'::after');
        const blurLayers=Array.from(edge.children,child=>getComputedStyle(child));
        checks.commentToolbarCompact=getComputedStyle(toolbar).padding==='2px 0px 4px';
        checks.commentHeaderFade=backdrop.offsetHeight===0&&backdrop.getBoundingClientRect().top===detail.getBoundingClientRect().top&&edge.offsetHeight===chromeHeight&&edge.offsetWidth===detail.clientWidth&&edgeTint.pointerEvents==='none'&&edgeTint.backgroundImage.startsWith('linear-gradient');
        checks.commentReadingAreaClear=edge.getBoundingClientRect().bottom<=toolbar.getBoundingClientRect().bottom+1;
        checks.commentHeaderProgressiveBlur=blurLayers.length===4&&blurLayers.every((layer,index)=>layer.backdropFilter==='blur('+[1,2,4,8][index]+'px)'&&layer.maskImage.startsWith('linear-gradient'));
        checks.commentHeaderTransparent=getComputedStyle(author).backgroundColor==='rgba(0, 0, 0, 0)'&&getComputedStyle(toolbar).backgroundColor==='rgba(0, 0, 0, 0)';
        const follow=getComputedStyle(document.querySelector('.official-follow-author'));
        const sort=getComputedStyle(document.querySelector('.comment-sort'));
        const search=getComputedStyle(document.querySelector('.comment-search-trigger'));
        const actionsWrap=getComputedStyle(document.querySelector('.comment-toolbar-actions'));
        checks.commentControlsShareFill=follow.backgroundColor===sort.backgroundColor&&sort.backgroundColor===search.backgroundColor&&follow.backgroundColor!=='rgba(0, 0, 0, 0)'&&follow.backgroundImage.startsWith('linear-gradient')&&follow.backgroundImage===sort.backgroundImage&&sort.backgroundImage===search.backgroundImage&&follow.borderTopColor===sort.borderTopColor&&sort.borderTopColor===search.borderTopColor&&actionsWrap.backgroundColor==='rgba(0, 0, 0, 0)'&&box('.comment-search-trigger').height===box('.comment-sort').height;
        const lastCommentGap=innerHeight-box('.content').bottom;
        const contentPadding=['.is-official-mobile-detail','.official-detail-comments']
          .reduce((sum,selector)=>sum+parseFloat(getComputedStyle(document.querySelector(selector)).paddingBottom),0);
        checks.noExtraDetailBottomSpace=Math.abs(lastCommentGap-contentPadding)<=1;
      }
      parent.postMessage({checks,legacy:${legacy},inset,before,hidden,restored},'*');
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
