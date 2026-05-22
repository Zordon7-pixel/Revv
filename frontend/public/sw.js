const CACHE = 'revv-v7';
const SHELL = ['/', '/index.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

function isHtmlResponse(res) {
  return (res.headers.get('content-type') || '').includes('text/html');
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always hit network for API calls and non-GET requests.
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  const dest = e.request.destination;
  const isNavigation = e.request.mode === 'navigate' || dest === 'document';
  const isScriptLike = dest === 'script' || dest === 'worker' || dest === 'style';

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Never cache or serve HTML as JS/CSS. A stale SPA fallback here makes
        // Vite's dynamic script loader throw: Unexpected token '<'.
        if (isScriptLike && isHtmlResponse(res)) return Response.error();

        if (res.ok && !isScriptLike) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => {
        if (isNavigation) return caches.match('/index.html');
        return caches.match(e.request).then(r => r || Response.error());
      })
  );
});
