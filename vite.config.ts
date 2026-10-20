import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const single = !!process.env.SINGLE;

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), ...(single ? [viteSingleFile()] : [])],
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
