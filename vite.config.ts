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
    // tests/gates/ 放门禁脚本自身的失败路径用例（纯 Node，不进浏览器）；
    // tests/e2e/ 是 Playwright 的规格，不在这里收走。
    include: ['src/**/*.test.{ts,tsx}', 'tests/gates/*.test.mjs'],
    // 覆盖率口径（只在带 --coverage 的那条路上生效，见 package.json 的 test:coverage）：
    // 分母只算 src/ 下我们自己写的可执行代码。
    //   src/data/ 是 build:data 写出的语料 JSON，不是代码；测试文件自身不计；
    //   src/styles.css 不是可执行代码，v8 执行不到它，算进分母只会让数字失真。
    // 门禁脚本（scripts/*.mjs）由 tests/gates/ 的失败路径用例从行为上测——
    // 它们是被 spawn 出去的子进程，v8 插桩抓不到，所以不列进分母。
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**'],
      exclude: ['src/data/**', 'src/**/*.test.{ts,tsx}', 'src/styles.css'],
      thresholds: {
        // 阈值取本轮补测试收口后的实测（94.23 / 87.56 / 94.89 / 95.79，13 个文件 249 条单元与组件用例，见 DESIGN.md 6 节与 CHANGELOG），
        // 各留 3～5 个百分点余量：门禁要能拦住"覆盖掉了"，但不该因为一次小重构就红。
        // 本轮中途（补 App 那批用例之前）的实测是 93.37 / 86.78 / 93.19 / 94.79，阈值只按最后一轮实测定一次，
        // 不在同一轮里追着实数拧两次。
        lines: 91,
        statements: 90,
        functions: 90,
        branches: 83,
      },
    },
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
