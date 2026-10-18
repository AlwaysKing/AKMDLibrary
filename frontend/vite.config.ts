import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    // 编译时刻的时间戳，用于生成前端版本号
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 8802,
    headers: {
      'Cache-Control': 'no-store',
    },
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8801',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
