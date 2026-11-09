self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.destination !== 'image' || request.mode !== 'no-cors') return;
  if (new URL(request.url).origin !== 'https://image.coolapk.com') return;

  // 保持浏览器直连 CDN，只替换会触发 567 的图片 Accept 请求头。
  const headers = new Headers(request.headers);
  headers.set('Accept', '*/*');
  // 重建跨站请求时明确保留无来源策略，并重新校验旧的 567 缓存。
  event.respondWith(fetch(new Request(request, { headers, referrerPolicy: 'no-referrer', cache: 'no-cache' })));
});
