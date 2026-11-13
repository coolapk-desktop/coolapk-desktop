import { isWebBuild } from '../api/runtime';

const nativeSettings = new Set(['downloads', 'network', 'startup', 'device', 'agent', 'diagnostics']);

export function webRouteFallback(path: string): string | undefined {
  if (!isWebBuild) return;
  path = path.toLowerCase().replace(/\/$/, '');
  if (path === '/downloads') return '/apps';
  if (path.startsWith('/settings/') && nativeSettings.has(path.slice('/settings/'.length))) {
    return '/settings/appearance';
  }
}
