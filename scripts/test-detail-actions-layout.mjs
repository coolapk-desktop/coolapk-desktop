import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, compileStyle } from '@vue/compiler-sfc';

// 真实浏览器验证详情底栏完全移出视口，并同步回收底部占位。
const artifacts = mkdtempSync(join(tmpdir(), 'coolapk-detail-actions-'));
const css = readFileSync('src/styles/tokens.css', 'utf8') + ['src/pages/FeedDetailPage.vue', 'src/components/feed/FeedActionBar.vue'].map(path => parse(readFileSync(path, 'utf8')).descriptor.styles.map(style => compileStyle({ source: style.content, filename: path, id: 'detail', scoped: false }).code).join('\n')).join('\n');
const fixture = join(artifacts, 'detail.html');
writeFileSync(fixture, `<!doctype html><html><head><style>${css}html,body{margin:0;height:100%;}</style></head><body>
  <div class="feed-detail-page is-official-mobile"><div class="feed-detail-shell"><div style="height:2000px">正文和评论</div></div></div>
  <div class="feed-action-bar official-detail-actions"><button class="official-write-comment">写评论</button><button>评论</button><button>点赞</button><button>收藏</button><button>转发</button></div>
  <script>(async()=>{
    const page=document.querySelector('.feed-detail-page'),bar=document.querySelector('.feed-action-bar');
    const settle=()=>new Promise(resolve=>{void document.body.offsetHeight;setTimeout(()=>{document.getAnimations().forEach(animation=>animation.finish());resolve();},300);});
    const sample=()=>({top:bar.getBoundingClientRect().top,padding:parseFloat(getComputedStyle(document.querySelector('.feed-detail-shell')).paddingBottom)});
    await settle();const before=sample();page.classList.add('reading-actions-hidden');bar.classList.add('reading-hidden');await settle();const hidden=sample();
    const pointerDisabled=getComputedStyle(bar).pointerEvents==='none';
    page.classList.remove('reading-actions-hidden');bar.classList.remove('reading-hidden');await settle();const restored=sample();
    const checks={hiddenBelowViewport:hidden.top>=innerHeight,paddingReleased:hidden.padding===0&&before.padding>0,pointerDisabled,restored:Math.abs(restored.top-before.top)<1&&restored.padding===before.padding};
    document.body.dataset.results=encodeURIComponent(JSON.stringify({checks,before,hidden,restored}));
  })();</script></body></html>`);
const browser = process.env.LAYOUT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const result = spawnSync(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(artifacts, 'profile'), '--window-size=500,700', '--virtual-time-budget=3000', '--dump-dom', pathToFileURL(fixture).href], { windowsHide: true, encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
if (result.error) throw result.error;
const encoded = result.stdout.match(/data-results="([^"]+)"/)?.[1];
if (!encoded) throw new Error('浏览器未返回详情底栏验证结果');
const report = JSON.parse(decodeURIComponent(encoded));
console.log(JSON.stringify({ ...report, artifacts }, null, 2));
if (Object.values(report.checks).some(value => !value)) throw new Error('详情底栏布局验证失败');
