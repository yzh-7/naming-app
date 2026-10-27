import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import pkg from './package.json' with { type: 'json' };

const single = !!process.env.SINGLE;

// 应用版本只有一个来源：package.json。写错形态（多了引号、空格、前缀）就地停构建，
// 而不是让界面和 sw.js 拿到一个怪字符串。口径见 DESIGN.md「版本与缓存」。
const version: string = /^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(pkg.version)
  ? pkg.version
  : (() => {
      throw new Error(`package.json 的 version 不是 x.y.z 形态：${JSON.stringify(pkg.version)}`);
    })();

// vite 的 define 只替换 JS，不动 index.html：index.html 里的占位符由下面的 transformIndexHtml 替换。
// 版本一共三处出口，全部来自上面那一个 version——JS 常量（界面页脚）、index.html 的 meta、sw.js 注册参数 ?v=。
const injectVersion = {
  name: 'inject-app-version',
  transformIndexHtml: (html: string) => html.replaceAll('__APP_VERSION__', version),
};

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react(), tailwindcss(), injectVersion, ...(single ? [viteSingleFile()] : [])],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: 'index.html',
      // 站点版：不变的数据/供应商代码与业务代码分开，既降低首屏主包体积，也让缓存更稳。
      // 单文件版必须关掉分包——viteSingleFile 会把 codeSplitting 设为 false，此时 manualChunks 会让构建直接报错。
      output: single
        ? {}
        : {
            manualChunks(id: string) {
              if (id.includes('node_modules')) return 'vendor';
              if (/[\\/]src[\\/]data[\\/]/.test(id)) return 'data';
              return undefined;
            },
          },
    },
  },
});
