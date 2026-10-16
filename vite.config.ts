import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const single = !!process.env.SINGLE;

// base './'：相对路径产物，file:// 双击、局域网 http.server、任意子路径托管都能跑
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), ...(single ? [viteSingleFile()] : [])],
  test: {
    // DOM 测试统一走 jsdom，公共初始化（jest-dom 断言 + cleanup）集中在 setup 里，测试文件不再各写一遍
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
  build: {
    // 业务码/供应商码都必须远小于 500 KB；唯一超标的是词典数据 chunk（约 1.15 MB min / 225 KB gz），
    // 它是构建期固化、运行时不请求的静态数据，已单独拆出以便长期缓存，故阈值定在它上方。
    // 真正的发布门禁是 scripts/size-check.mjs 的「资源 gzip 合计 ≤ 400 KB」，而非这条告警。
    chunkSizeWarningLimit: 1200,
    // 单文件版（SINGLE=1）由 vite-plugin-singlefile 关掉 code splitting，禁用 manualChunks
    ...(single ? {} : {
      rollupOptions: {
        output: {
          // 把不变的数据/供应商代码与业务代码分开：既降低首屏主包体积，也让缓存更稳
          manualChunks(id: string) {
            if (id.includes('node_modules')) return 'vendor';
            if (/[\\/]src[\\/]data[\\/]/.test(id)) return 'data';
            return undefined;
          },
        },
      },
    }),
  },
});
