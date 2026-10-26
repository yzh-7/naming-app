import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-single',
      'test-results',
      'playwright-report',
      'coverage',
      'node_modules',
      'data/raw',
      'src/data',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    // Service Worker 不在页面上下文里跑，之前整份被 ignore，等于没有任何静态检查；
    // 结果它的两个问题（多余的转义、未用的 catch 变量）直到被拷进产物、
    // 再被下一次 lint 撞上才暴露。这里改成按 service-worker 全局跑一遍规则。
    files: ['public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  // 最后一个：关掉所有与 Prettier 冲突的格式规则
  prettier,
);
