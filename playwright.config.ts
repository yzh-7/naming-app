import { defineConfig, devices } from '@playwright/test';

// 端到端只跑真实浏览器上的关键路径（生成→收藏→筛选）与 axe 可访问性扫描。
// 依赖 dist/ 里的构建产物，先 `npm run build` 再跑本套件。
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:5180', trace: 'on-first-retry' },
  webServer: {
    // --host 127.0.0.1：runner 上 localhost 可能优先解析到 IPv6 ::1，
    // 与 baseURL 的 127.0.0.1 对不上，health check 会一直超时。
    command: 'npx vite preview --host 127.0.0.1 --port 5180 --strictPort',
    url: 'http://127.0.0.1:5180',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  // 三个浏览器都要过。理由是发布口径里有 iOS 与安卓的 PWA——Safari 的 <details>/<summary> 样式、
  // 粘顶页头、focus() 之后滚不滚、隐私模式下 localStorage 直接抛，都和 Chromium 不是一套行为；
  // 卡片上「另有 N 处出处」那种折叠区恰好全吃这些差异。
  //
  // 本机（Ubuntu 26.04）跑不动 WebKit：系统缺 libevent-2.1、libavif16、libmanette、libgav1、
  // libhidapi-hidraw、libbacktrace 六个库，逐个 apt-get download 解到浏览器自己的 sys/lib 之后
  // 进程起得来，页面握手仍 30 秒超时（补齐那六个库并没有凑齐 WPE 要的全部依赖）。
  // 所以本机默认只跑 chromium + firefox，CI 跑三档（那里 --with-deps 装得全）。
  // 本机想自己试三档：PLAYWRIGHT_WEBKIT=1 npx playwright test。
  // CI 里三档从 0.20.0 起一并拦发布：WebKit 此前在 0.18.0 与 0.19.0 两次 CI 里连着绿过，
  // 按 0.18.0 写定的规矩（连着两次绿就并进拦发布那一档）今天转正。
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    ...(process.env.CI || process.env.PLAYWRIGHT_WEBKIT === '1'
      ? [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }]
      : []),
  ],
});
