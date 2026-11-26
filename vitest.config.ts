import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // tsconfig 的 jsx 是 preserve（交给 Next 处理）；vitest 里跑 .tsx 组件测试需要显式指定自动运行时
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
