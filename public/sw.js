/* ═══════════════════════════════════════════════════════════════
   MathDuel Service Worker —— 最小可用 PWA 策略
   ────────────────────────────────────────────────────────────────
   原则（与 CF Pages + HTML max-age=0 must-revalidate 约束共存）：
   1. /api/、/ws（WebSocket 升级）绝不拦截 —— 实时与账号数据永远走网络
   2. /assets/（vite 带 hash、内容不变）与 /fonts/：cache-first
   3. 页面导航（HTML）：network-first —— 永远优先最新版，断网才用缓存
   4. 其余同源静态（/shared/、图标等）：stale-while-revalidate
   换版本：V 常量升级即弃旧缓存。
   ═══════════════════════════════════════════════════════════════ */
const V = 'mdsw-v1';
const ASSET_RE = /^\/(assets|fonts)\//;
const ICON_RE = /^\/(icon\.svg|favicon\.ico|apple-touch-icon\.png|og-image\.svg|manifest\.webmanifest)$/;

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws' || url.pathname.startsWith('/ws')) return;

  // 1) 带内容 hash 的构建产物与字体：cache-first（immutable）
  if (ASSET_RE.test(url.pathname) || ICON_RE.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(V).then((c) => c.put(req, clone));
        }
        return res;
      }))
    );
    return;
  }

  // 2) 页面导航：network-first，离线回落缓存
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(V).then((c) => c.put(req, clone));
        }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
    );
    return;
  }

  // 3) 其余同源静态：stale-while-revalidate
  event.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(V).then((c) => c.put(req, clone));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
