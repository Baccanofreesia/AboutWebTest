import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // 关键配置：使用相对路径，确保在 GitHub Pages 子目录下能找到资源
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  }
});