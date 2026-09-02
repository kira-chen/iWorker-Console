import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import vue from '@vitejs/plugin-vue'

/**
 * Vitest Browser Mode 配置（视觉/实现效果层，质量闸 #3 首批，2026-08-08）。
 *
 * 与 vitest.config.js（node/jsdom 单测）互斥分工：*.browser.test.js 在真 Chromium 里渲染，
 * 可断言真实计算样式/布局合成（jsdom 不渲染不合成，测不到固定列透底这类问题）。
 *
 * 浏览器二进制复用 @playwright/test 已缓存的 Chromium（~/Library/Caches/ms-playwright），
 * 零额外下载。运行：npm run test:browser。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  optimizeDeps: {
    // 浏览器模式动态引真实组件树，预include 防止 Vite 中途 reload 打断测试（首跑告警清单固化）
    include: [
      '@element-plus/icons-vue',
      '@milkdown/vue',
      '@milkdown/kit/core',
      '@milkdown/kit/preset/commonmark',
      '@milkdown/kit/preset/gfm',
      '@milkdown/kit/plugin/history',
      '@milkdown/kit/plugin/listener',
      '@milkdown/kit/prose/state',
      '@milkdown/kit/prose/history',
      '@milkdown/kit/prose/inputrules',
      '@milkdown/kit/utils',
      'yaml',
      'unist-util-visit',
      'axios',
      'pinia',
      'vue-router'
    ]
  },
  test: {
    include: ['src/**/__tests__/**/*.browser.test.js'],
    globals: false,
    // 同 vitest.config.js：默认随机序，持续暴露隐式顺序依赖（本套件曾实测命中）
    sequence: { shuffle: true },
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      // 失败截图默认写 __screenshots__ 目录；视觉基线 diff（toMatchScreenshot）后续按需引入
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }]
    }
  }
})
