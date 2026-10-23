import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import { extractHeicWorker } from './heic-worker-plugin.ts';

test('真实 HEIC 线程逐字保留，按需只创建一次并保留错误处理', () => {
  const source = readFileSync(new URL('../node_modules/heic-to/dist/csp/heic-to.js', import.meta.url), 'utf8');
  const result = extractHeicWorker(source, '"/assets/heic-worker.js"');
  assert.ok(result.worker.length > 2_000_000);
  assert.ok(result.code.length < 10_000);
  assert.ok(result.code.includes('i.onerror='));
  assert.ok(!result.code.includes('new Blob'));
  const parsed = ts.createSourceFile('heic.js', result.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let factory;
  function visit(node) {
    if (ts.isArrowFunction(node) && node.getText(parsed).includes('new Worker')) factory = node;
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(factory);
  const urls = [];
  const create = runInNewContext(`let i; (${factory.getText(parsed)})`, { Worker: class { constructor(url) { urls.push(url); } }, console });
  const worker = create();
  assert.equal(create(), worker);
  assert.deepEqual(urls, ['/assets/heic-worker.js']);
  assert.equal(typeof worker.onerror, 'function');
  // 重新解析原始线程字面量，确保解码器源码没有截断或改写。
  let original;
  const raw = ts.createSourceFile('raw.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function find(node) { if (ts.isStringLiteral(node) && node.text.length > 1_000_000) original = node.text; ts.forEachChild(node, find); }
  find(raw);
  assert.equal(result.worker, original);
});

test('供应商布局变化时停止打包，避免静默产生损坏的解码器', () => {
  assert.throws(() => extractHeicWorker('export const changed = true;', 'url'), /HEIC/);
});
