// 离线 shell：首访后同源 GET 走 cache-first + 回填，断网也能打开。
// 本应用运行时零网络请求，这里只是把静态产物缓存下来，方便离线/可安装。
// 自选页由 compose.html 并入 index.html 的 #/compose，HTML 壳变了：升版本清掉旧缓存，避免老用户停在旧壳
const CACHE = 'naming-app-v5';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 页面在新版本就绪、用户点「刷新」时发来 SKIP_WAITING：立即激活等待中的新 worker
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const put = (res) => {
    if (res && res.status === 200 && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  };
  // 导航请求走 network-first：新版本部署后刷新即可拿到新 index.html，不会被旧缓存顶住。
  // 带哈希的静态资源仍是 cache-first（内容变了文件名就变，不存在陈旧问题）。
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(put).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))));
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then(put).catch(() => caches.match('./index.html'))),
  );
});
