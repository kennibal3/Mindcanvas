// =============================================================
// MindCanvas v4.1 - Vite 构建配置
// V4.3 P2-B：chunk 分割最终方案
//
// 背景：echarts-for-react 依赖 react，手动将 echarts 和 react
//   分到不同 chunk 会导致 Rollup 循环依赖警告。
//
// 最终策略：
//   - 只单独拆出 Excalidraw（完全独立，体积 3.7MB，缓存价值最高）
//   - 其余 node_modules 全部归入 vendor（让 Rollup 自行解决依赖顺序）
//   - 业务侧的 assignment-utils 单独拆出（配合路由懒加载）
//   - 不再手动拆 echarts/react/i18n，消除循环依赖警告
// =============================================================
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Excalidraw 约 3.7MB，vendor 约 3.4MB，设置足够大阈值
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // 只做一件事：把 Excalidraw 单独拆出
          // 理由：完全独立无循环依赖，体积最大，长期缓存价值最高
          // 用户访问白板后 Excalidraw chunk 长期命中缓存，不随业务代码更新失效
          if (id.includes('node_modules/@excalidraw')) {
            return 'excalidraw'
          }

          // 作业评价业务工具函数：配合路由懒加载，首屏不加载
          if (
            id.includes('/utils/assignmentApi') ||
            id.includes('/utils/tokenApi') ||
            id.includes('/types/assignment') ||
            id.includes('/types/token')
          ) {
            return 'assignment-utils'
          }

          // 其余所有 node_modules（react/echarts/zustand/lucide/i18n 等）
          // 统一归入 vendor，让 Rollup 自行处理内部依赖顺序，消除循环警告
          if (id.includes('node_modules')) {
            return 'vendor'
          }
        },
      },
    },
  },
})
