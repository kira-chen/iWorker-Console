import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Vite 配置（纯前端 demo：无后端，/api 请求由前端侧 mock 层接管，后续逐步补齐）
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  // 预打包重依赖：dev 冷启动一次性 esbuild 预构建，避免 Element Plus / 图标按数百个子模块逐个请求，
  // 缩短 dev 首屏加载耗时（生产 build 本就打包，此项仅影响 dev 体验）。
  optimizeDeps: {
    include: [
      'element-plus',
      'element-plus/es/locale/lang/zh-cn',
      '@element-plus/icons-vue'
    ]
  },
  server: {
    port: 5173
  }
})
