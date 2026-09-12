import { createApp, h, nextTick } from 'vue'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

/**
 * 真实挂载冒烟共用件（2026-09-12 测试审计抽出）。
 *
 * 与页面级单测的「全桩」相反：这里 `app.use(ElementPlus)` 真装 Element Plus、真注册全部图标
 * （与 src/main.js 同一套），**不桩任何组件**，只由各用例自行 vi.mock api 层。
 * 目的是拦住桩测拦不住的那类故障——组件 setup 期报错、模板里孤立字符、子组件 props 形状不对
 * （如 2026-09-11 分页条 TDZ 白屏），断言口径：mount 不抛 + 探针文案 + console.error 零调用。
 *
 * jsdom 缺 ResizeObserver / matchMedia / scrollTo：Element Plus 的表格、抽屉、下拉会在挂载期触碰，
 * 这里给最小空实现（不影响断言）。
 */
export function installJsdomPolyfills() {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return false }
    })
  }
  if (typeof window !== 'undefined' && typeof window.scrollTo !== 'function') {
    window.scrollTo = () => {}
  }
  if (typeof Element !== 'undefined' && typeof Element.prototype.scrollTo !== 'function') {
    Element.prototype.scrollTo = () => {}
  }
}

/**
 * 真实挂载一个页面/组件。返回 { app, container, unmount }。
 * @param {object} Component 被测 SFC 的 default 导出
 * @param {object} [props] 传给组件的 props（含 onXxx 事件监听）
 * @param {object} [options]
 * @param {Array}  [options.plugins] 额外 app.use 的插件（如 router / pinia）
 */
export function mountReal(Component, props = {}, { plugins = [] } = {}) {
  installJsdomPolyfills()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const app = createApp({ render: () => h(Component, props) })
  for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component)
  }
  app.use(ElementPlus)
  for (const p of plugins) app.use(p)
  app.mount(container)
  return {
    app,
    container,
    unmount() {
      app.unmount()
      container.remove()
    }
  }
}

/** 连续冲刷微任务 + 渲染队列（mock api 的 resolved promise + 若干 watch 才能落到 DOM）。 */
export async function flushAll(times = 8) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
