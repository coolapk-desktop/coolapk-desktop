import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// 验证全局无图样式按设置放行详情图片，并始终显示验证码图片。
const browser = process.env.LAYOUT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
if (!existsSync(browser)) throw new Error('请通过 LAYOUT_BROWSER 指定 Chromium 浏览器路径');
const artifacts = mkdtempSync(join(tmpdir(), 'coolapk-no-image-detail-'));
const source = readFileSync('src/styles/index.css', 'utf8');
const css = source.slice(source.indexOf('/* 无图模式'));
const fixture = join(artifacts, 'detail.html');
const image = '<div class="app-image-container"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></div>';
writeFileSync(fixture, `<!doctype html><html data-no-image-mode="true"><head><style>${css}</style></head><body>
  <section id="list">${image}<div class="image-placeholder">占位</div></section>
  <section id="detail" class="no-image-detail-enabled">${image}<div class="image-placeholder">占位</div><video></video></section>
  <div id="viewer" class="image-viewer-backdrop no-image-detail-enabled">${image}</div>
  <div class="captcha-popup-host">${image}</div>
  <script>
  const visible=selector=>{const el=document.querySelector(selector);return getComputedStyle(el).display!=='none'&&el.getClientRects().length>0;};
  const checks={listHidden:!visible('#list img')&&!visible('#list .image-placeholder'),detailVisible:visible('#detail img')&&visible('#detail .app-image-container'),viewerVisible:visible('#viewer')&&visible('#viewer img'),videoHidden:!visible('#detail video')};
  document.querySelector('#detail').classList.remove('no-image-detail-enabled');
  checks.optionDisabledHidesImages=!visible('#detail img');
  checks.captchaVisible=visible('.captcha-popup-host img');
  document.documentElement.removeAttribute('data-no-image-mode');
  checks.normalModeRestoresImages=visible('#list img')&&visible('#detail img');
  document.body.dataset.results=encodeURIComponent(JSON.stringify(checks));
  </script></body></html>`);
const result = spawnSync(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(artifacts, 'profile'), '--dump-dom', pathToFileURL(fixture).href], { windowsHide: true, encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
if (result.error) throw result.error;
const encoded = result.stdout.match(/data-results="([^"]+)"/)?.[1];
if (!encoded) throw new Error('浏览器未返回验证结果');
const checks = JSON.parse(decodeURIComponent(encoded));
console.log(JSON.stringify({ checks, artifacts }, null, 2));
if (Object.values(checks).some(value => !value)) throw new Error('无图模式详情样式验证失败');
