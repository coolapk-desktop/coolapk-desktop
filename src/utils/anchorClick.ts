import { router } from '../router';
import { CoolapkTauriAPI } from '../api/coolapk';
import { useSettingsStore } from '../stores/settings';
import { getCoolapkUserLinkName, normalizeCoolapkRoute } from './coolapkRoute';
import { openFeedDetail } from './feedNavigation';

/**
 * 统一处理富文本内 <a> 的点击：
 *  - /feed/<id> 站内动态链接 → 进入完整动态页；
 *  - 其余站内路径（/ 开头）优先走内部路由（如 /u/xxx 用户页），
 *    未命中路由时用酷安官网域名拼装，避免加载应用自身 origin 产生空白页；
 *  - 酷安网页按设置打开；非酷安域名由 openUrl 直接调起系统浏览器。
 */
export function handleAnchorClick(e: Event, feedId?: string | number) {
  const anchor = (e.target as HTMLElement).closest('a');
  if (!anchor) return false;
  const href = anchor.getAttribute('href') || '';
  const text = anchor.textContent?.trim() || '';
  e.preventDefault();

  if (text.includes('查看更多') || !href || href === '#' || /^javascript:/i.test(href.trim())) {
    const targetId = feedId || href.match(/\d+/)?.[0];
    return targetId ? openFeedDetail(router, targetId) : false;
  }

  // 显式协议仅允许正常网页和系统链接，禁止执行脚本或打开本地文件。
  const scheme = href.trim().match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme && !['http', 'https', 'mailto', 'tel', 'coolmarket'].includes(scheme)) return false;
  const feedMatch = href.match(/^\/feed\/(\d+)/);
  if (feedMatch?.[1]) {
    return openFeedDetail(router, feedMatch[1]);
  }

  if (getCoolapkUserLinkName(href)) {
    return CoolapkTauriAPI.openUrl(new URL(href, 'https://www.coolapk.com').href, 'internal');
  }

  const normalizedRoute = normalizeCoolapkRoute(href);
  if (normalizedRoute && router.resolve(normalizedRoute).matched.length) {
    return router.push(normalizedRoute);
  }

  if (href.startsWith('/') && !href.startsWith('//')) {
    const target = !/^\/feed\//i.test(href) ? href : '';
    if (target && router.resolve(target).matched.length) {
      return router.push(target);
    }
    return CoolapkTauriAPI.openUrl(`https://www.coolapk.com${href}`);
  }

  return CoolapkTauriAPI.openUrl(href.startsWith('//') ? href : anchor.href, useSettingsStore().settings.externalLinkMode);
}
