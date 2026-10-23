import ts from 'typescript';
import type { Plugin } from 'vite';

/** 将供应商内嵌的解码线程保留为独立资源，避免主线程解析整份线程源码字符串。 */
export function extractHeicWorker(code: string, workerUrl: string) {
  const source = ts.createSourceFile('heic.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let literal: ts.StringLiteral | undefined;
  function visit(node: ts.Node) {
    if (ts.isStringLiteral(node) && node.text.length > 1_000_000) literal = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!literal) throw new Error('HEIC 内嵌线程结构已变化，请检查供应商升级');
  let declaration: ts.Node = literal;
  while (declaration.parent && !ts.isVariableStatement(declaration)) declaration = declaration.parent;
  let factory = declaration.parent;
  while (factory && !ts.isArrowFunction(factory)) factory = factory.parent;
  let workerArgument: ts.Expression | undefined;
  function findWorker(node: ts.Node) {
    if (ts.isNewExpression(node) && node.expression.getText(source) === 'Worker') workerArgument = node.arguments?.[0];
    ts.forEachChild(node, findWorker);
  }
  if (factory) findWorker(factory);
  if (!ts.isVariableStatement(declaration) || !workerArgument || !declaration.getText(source).includes('new Blob')) {
    throw new Error('HEIC 线程创建方式已变化，请检查供应商升级');
  }
  const edits = [
    { start: declaration.getStart(source), end: declaration.end, text: '' },
    { start: workerArgument.getStart(source), end: workerArgument.end, text: workerUrl },
  ].sort((a, b) => b.start - a.start);
  let output = code;
  for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return { code: output, worker: literal.text };
}

export function heicWorkerPlugin(): Plugin {
  return {
    name: 'heic-worker-asset',
    apply: 'build',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/heic-to/dist/csp/heic-to.js')) return;
      const extracted = extractHeicWorker(code, '__HEIC_WORKER_URL__');
      const reference = this.emitFile({ type: 'asset', name: 'heic-decoder.worker.js', source: extracted.worker });
      return { code: extracted.code.replace('__HEIC_WORKER_URL__', `import.meta.ROLLUP_FILE_URL_${reference}`), map: null };
    },
  };
}
