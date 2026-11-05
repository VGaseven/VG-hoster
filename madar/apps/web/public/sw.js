// عامل خدمة بسيط: يجعل التطبيق قابلًا للتثبيت ويعرض الصفحة المخزنة عند انقطاع الشبكة.
// لا نخزّن استجابات /api (بيانات شخصية وتقديرات خرائط).
const CACHE = 'madar-shell-v1';
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/icon.svg', '/manifest.webmanifest'])).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api')) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')));
  }
});
