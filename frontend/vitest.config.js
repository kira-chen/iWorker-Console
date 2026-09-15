import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Vitest 配置：复用 @ → src 别名；纯逻辑单测默认 node 环境，
// 涉及 localStorage/DOM 的用例在文件头部用 // @vitest-environment jsdom 单独声明（如有）。
// 引入 vue 插件以便单测可挂载 .vue 组件（如 ChatMarkdown 渲染回归）。
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.{test,spec}.js', 'tests/**/*.{test,spec}.js'],
    // *.browser.test.js 是真浏览器用例（视觉/布局效果层），归 vitest.browser.config.js 跑，
    // jsdom/node 环境不渲染不合成，跑它们只会假绿 → 此处显式互斥。
    exclude: ['**/node_modules/**', '**/*.browser.test.js'],
    globals: false,
    // 默认随机顺序执行（2026-08-08 质量强化）：靠「写在前面」保证前置条件的隐式顺序依赖
    // 会在此暴露——曾有弹窗 Esc 用例因此翻红（详见 docs/update/2026-08-08.md §11）。
    // 每次运行种子随机，失败时控制台会打印 seed，用 --sequence.seed=<seed> 可精确复现。
    sequence: { shuffle: true },
    // 2026-09-12 审计 J22：element-plus 与其依赖 async-validator 改为内联转换，不走 Node 外置加载。
    // 根因：async-validator 是 CJS（exports.default），被 Node ESM 互操作外置加载后 default 拿到的是整个
    // exports 对象，ElFormItem 内 `new AsyncValidator()` 直接抛错、又被 ElForm.validate 吞成 resolve(true)
    // ——真挂载的表单在 jsdom 里永远校验不出红字，空表单点【接入】也能调到 createModel（假绿）。
    // 内联后真 ElForm 校验可信（modelConfigEditDialogSmoke A12 四条即靠此断 DOM 红字），全量约 +3s。
    server: { deps: { inline: ['element-plus', 'async-validator'] } }
  }
})
