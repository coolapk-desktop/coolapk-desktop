import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export const isDesktopWeb = typeof document !== 'undefined'
  && document.querySelector('meta[name="coolapk-desktop-web"]') !== null;
export const isWebBuild = import.meta.env.MODE === 'web' || isDesktopWeb;
export const isWebDemo = isWebBuild && !isDesktopWeb && typeof document !== 'undefined'
  && document.querySelector('meta[name="coolapk-web-demo"]') !== null;

let sessionReady: Promise<void> | undefined;

async function checkResponse(response: Response) {
  if (response.ok) return;
  const payload = await response.json().catch(() => null);
  throw new Error(payload?.error || `Web 服务请求失败（HTTP ${response.status}）`);
}

export function initializeSession(): Promise<void> {
  sessionReady ??= fetch('/api/session', { method: 'POST', credentials: 'same-origin' })
    .then(checkResponse)
    .catch(error => {
      sessionReady = undefined;
      throw error;
    });
  return sessionReady;
}

export async function renewSession(): Promise<void> {
  const previous = sessionReady;
  if (previous) {
    await previous;
    if (sessionReady === previous) sessionReady = undefined;
  }
  await initializeSession();
}

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isWebBuild) return args === undefined ? tauriInvoke<T>(command) : tauriInvoke<T>(command, args);

  const payload = args ?? {};
  const files = Object.entries(payload).filter((entry): entry is [string, Uint8Array<ArrayBuffer>] => entry[1] instanceof Uint8Array);
  let body: BodyInit;
  let path: string;
  let headers: HeadersInit | undefined;
  if (files.length) {
    const form = new FormData();
    const metadata = { ...payload };
    for (const [name, bytes] of files) {
      form.append(name, new Blob([bytes]), name);
      delete metadata[name];
    }
    form.append('metadata', JSON.stringify(metadata));
    body = form;
    path = 'upload';
  } else {
    headers = { 'Content-Type': 'application/json' };
    body = JSON.stringify(payload);
    path = 'command';
  }
  return requestJson<T>(`/api/${path}/${encodeURIComponent(command)}`, { headers, body });
}

export async function requestJson<T>(path: string, options: Pick<RequestInit, 'headers' | 'body'>): Promise<T> {
  const session = initializeSession();
  await session;
  const request = () => fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    ...options,
  });
  let response = await request();
  if (response.status === 401) {
    // The server rejects missing sessions before executing the command.
    if (sessionReady === session) sessionReady = undefined;
    await initializeSession();
    response = await request();
  }
  await checkResponse(response);
  return response.json() as Promise<T>;
}

export function downloadInBrowser(url: string, fileName: string): string {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener noreferrer';
  document.body.append(link);
  link.click();
  link.remove();
  return fileName;
}
