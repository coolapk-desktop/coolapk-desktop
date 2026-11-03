import { sanitizeCoolapkHtml } from './sanitizeHtml';
import { renderCoolapkEmoji } from './coolapkEmoji';

/**
 * 统一渲染酷安富文本：先安全化（去标签/防注入），再渲染 [表情] 代码。
 * 所有动态/评论/通知正文渲染都应走此函数。
 */
export function renderCoolapkRichText(text: string, keyword?: string): string {
  if (!text) return '';
  return renderCoolapkEmoji(sanitizeCoolapkHtml(text, keyword));
}

/** 通知中的纯文本网址也显示为独立链接，只处理文本节点，保留已有链接和安全化结果。 */
export function renderNotificationRichText(text: string): string {
  const doc = new DOMParser().parseFromString(renderCoolapkRichText(text), 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.parentElement?.closest('a')) nodes.push(node);
  }
  for (const node of nodes) {
    const fragment = doc.createDocumentFragment();
    let offset = 0;
    for (const match of (node.textContent || '').matchAll(/https?:\/\/[^\s<>"，。！？、）]+/gi)) {
      fragment.append(doc.createTextNode(node.textContent!.slice(offset, match.index)));
      const anchor = doc.createElement('a');
      anchor.setAttribute('href', match[0]);
      anchor.setAttribute('rel', 'noopener noreferrer');
      anchor.textContent = match[0];
      fragment.append(anchor);
      offset = match.index! + match[0].length;
    }
    fragment.append(doc.createTextNode(node.textContent!.slice(offset)));
    node.replaceWith(fragment);
  }
  return doc.body.innerHTML;
}
