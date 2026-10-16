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
    command: 'npx vite preview --port 5180 --strictPort',
    url: 'http://127.0.0.1:5180',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
