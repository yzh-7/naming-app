// 离线 shell：首访后同源 GET 走 cache-first + 回填，断网也能打开。
// 本应用运行时零网络请求，这里只是把静态产物缓存下来，方便离线/可安装。
//
// 缓存名不手计、也不写死（旧版写死 naming-app-v5：改一次代码就得手改一次，漏改就把新产物塞进旧缓存）。
// 现在按当前部署算出来，顺序是：
//   1) 取一次 index.html，用 cache: 'no-store'（缓存里的那份可能属于旧版本，不能拿它算名字），
//      把它引用的带 hash 的产物名排序后做指纹——产物一变名字就变，旧缓存由 activate 删掉；
//   2) 没有分包产物（单文件版）时退回 index.html 里的 meta[name="app-version"]（构建注入的 package.json 版本）；
//   3) 连 index.html 都取不到（离线安装）时退回注册参数 ?v=（pwa.ts 注册时带上的同一个版本）。
// 同一个 worker 实例只解析一次：install / activate / fetch 用的是同一个名字。
// 口径见 DESIGN.md「版本与缓存」。
const PREFIX = 'naming-app-';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

const shortHash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

function nameFromShell(text) {
  const assets = [...text.matchAll(/assets\/[\w.-]+?\.(?:js|css)/g)].map((m) => m[0]).sort();
  if (assets.length) return PREFIX + shortHash(assets.join('|'));
  const version = (text.match(/name="app-version" content="([^"]*)"/) || [])[1];
  return version ? PREFIX + version : null;
}

let resolved = null;
async function cacheName() {
  if (resolved) return resolved;
  let text = '';
  try {
    const res = await fetch('./index.html', { cache: 'no-store' });
    if (res.ok) text = await res.text();
  } catch {
    // 取不到就往下走回退链，不让 install 因此失败
  }
  const fromQuery = new URL(self.location).searchParams.get('v');
  resolved = nameFromShell(text) || PREFIX + (fromQuery || 'unreleased');
  return resolved;
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    cacheName()
      .then((name) => caches.open(name).then((c) => c.addAll(SHELL)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    cacheName()
      .then((name) =>
        caches
          .keys()
          .then((keys) =>
            Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== name).map((k) => caches.delete(k))),
          ),
      )
      .then(() => self.clients.claim()),
  );
});

// 页面在新版本就绪、用户点「刷新」时发来 SKIP_WAITING：立即激活等待中的新 worker
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// 资源离线又没缓存时给一个明确的 504：不让请求挂在那里，也不把这个响应写进缓存（put 只在 fetch 成功分支里调用）
const offlineAsset = () =>
  new Response('offline', { status: 504, headers: { 'content-type': 'text/plain; charset=utf-8' } });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const put = (res) => {
    if (res && res.status === 200 && res.type === 'basic') {
      const copy = res.clone();
      // 回填进「当前这一版」的缓存，不是随便哪个同名前缀的旧缓存
      cacheName().then((name) => caches.open(name).then((c) => c.put(req, copy)));
    }
    return res;
  };
  // 导航请求走 network-first：新版本部署后刷新即可拿到新 index.html，不会被旧缓存顶住。
  // 带哈希的静态资源仍是 cache-first（内容变了文件名就变，不存在陈旧问题）。
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(put)
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
    );
    return;
  }
  // 资源请求在离线且本地没有缓存时，不能退回 index.html：那等于把一段 HTML 当作 .js/.css 交给浏览器，
  // 换来的是「脚本语法错误」这种看不懂的坏法。这里直接给 504，让资源干净地失败，页面自己的离线提示负责说话。
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req)
          .then(put)
          .catch(() => offlineAsset()),
    ),
  );
});
