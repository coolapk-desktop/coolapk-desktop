import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

// jsdom 不执行 CSP；使用真实浏览器验证保存原图所需的 Blob 读取和原始字节。
const policy = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).app.security.csp;
const baseline = policy.replace(/(connect-src[^;]*)\bblob:\s*/, '$1');
assert.notEqual(policy, baseline, '保存 Blob 图片需要 connect-src 允许 blob:');
const browser = process.env.LAYOUT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const artifacts = mkdtempSync(join(tmpdir(), 'coolapk-image-save-csp-'));
const probe = `
(async () => {
  const result = { dataUrl: null, error: '', violations: [] };
  document.addEventListener('securitypolicyviolation', e => result.violations.push({ directive: e.effectiveDirective, uri: e.blockedURI }));
  const url = URL.createObjectURL(new Blob(['GIF89a'], { type: 'image/gif' }));
  try {
    const blob = await (await fetch(url)).blob();
    result.dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch (error) { result.error = error.message; }
  finally { URL.revokeObjectURL(url); }
  try { await fetch('https://image-save-csp-test.invalid/blocked'); } catch {}
  setTimeout(() => { document.body.dataset.result = encodeURIComponent(JSON.stringify(result)); }, 100);
})();
`;
const server = createServer((req, res) => {
  if (req.url === '/probe.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(probe); return; }
  res.setHeader('Content-Security-Policy', req.url === '/baseline' ? baseline : policy);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><body><script src="/probe.js"></script></body>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const checks = [];
  for (const name of ['baseline', 'fixed']) {
    const output = await new Promise((resolve, reject) => {
      const child = spawn(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--user-data-dir=' + join(artifacts, name), '--virtual-time-budget=3000', '--dump-dom',
        'http://127.0.0.1:' + server.address().port + '/' + name], { windowsHide: true });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error(name + ' 浏览器检查超时')); }, 30000);
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', () => { clearTimeout(timer); resolve({ stdout, stderr }); });
    });
    const encoded = output.stdout.match(/data-result="([^"]+)"/)?.[1];
    assert.ok(encoded, name + ' 未返回结果：' + output.stderr.slice(-400));
    const result = JSON.parse(decodeURIComponent(encoded));
    assert.equal(result.dataUrl, name === 'fixed' ? 'data:image/gif;base64,R0lGODlh' : null);
    assert.equal(result.violations.some(v => v.directive === 'connect-src' && v.uri.startsWith('blob')), name === 'baseline');
    assert.ok(result.violations.some(v => v.directive === 'connect-src' && v.uri.startsWith('https://image-save-csp-test.invalid')), '其他网络来源仍应被拦截');
    checks.push({ name, ...result });
  }
  console.log(JSON.stringify({ checks, artifacts }, null, 2));
} finally { server.closeAllConnections(); server.close(); }
