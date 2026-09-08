import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 配置：base 使用相对路径以兼容 Electron file:// 协议加载
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 表情包图片内联为 base64 data URL：界面显示与视觉模型 API（image_url）共用
    assetsInlineLimit: 100 * 1024 * 1024
  }
});
