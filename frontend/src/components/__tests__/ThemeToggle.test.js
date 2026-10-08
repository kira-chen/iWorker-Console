// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { useThemeStore } from '@/stores/theme'

/**
 * ThemeToggle.vue（顶栏浅 / 暗主题切换钮）—— 2026-10-08 对齐组件头注「日/月图标，点击即时切换并持久化」
 * 与 stores/theme.js（/test-audit 共享层补缺口）。
 *
 * 覆盖点：提示文案与 aria-label 随当前主题给出「下一步会切到哪」（浅色时「切换到暗色」、暗色时「切换到浅色」）；
 * 点击调用 themeStore.toggle，主题真的切过去（<html data-theme> 跟着变），按钮文案随之翻转；图标日 / 月对应。
 * 真实挂载组件与真实 theme store；EP 的 el-tooltip / el-icon 与全局注册的 Moon / Sunny 图标打最小桩。
 */

const stubs = {
  'el-tooltip': { props: ['content'], template: '<div class="el-tooltip" :data-content="content"><slot /></div>' },
  'el-icon': { template: '<i class="el-icon"><slot /></i>' },
  Moon: { template: '<span class="icon-moon" />' },
  Sunny: { template: '<span class="icon-sunny" />' }
}

// 本仓 jsdom 下 globalThis.localStorage 可能为 undefined，写法同 utils/__tests__/demoIdentity.test.js：仅缺失时补桩、已有只清空
const makeStorage = () => {
  const map = new Map()
  return {
    get length() { return map.size },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear()
  }
}

let app, container, pinia
function mount(initialTheme) {
  if (initialTheme) globalThis.localStorage.setItem('ai_theme', initialTheme)
  pinia = createPinia()
  setActivePinia(pinia)
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(ThemeToggle)
  app.use(pinia)
  Object.entries(stubs).forEach(([n, c]) => app.component(n, c))
  app.mount(container)
  return useThemeStore()
}
const button = () => container.querySelector('button.theme-toggle')
const tip = () => container.querySelector('.el-tooltip').dataset.content

beforeEach(() => {
  if (!globalThis.localStorage || typeof globalThis.localStorage.getItem !== 'function') {
    Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), writable: true, configurable: true })
  }
  globalThis.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('ThemeToggle 主题切换钮', () => {
  it('当前浅色 → 提示与 aria-label 都是「切换到暗色」，图标为太阳', () => {
    mount('light')
    expect(tip()).toBe('切换到暗色')
    expect(button().getAttribute('aria-label')).toBe('切换到暗色')
    expect(container.querySelector('.icon-sunny')).toBeTruthy()
    expect(container.querySelector('.icon-moon')).toBeNull()
  })

  it('当前暗色 → 提示与 aria-label 都是「切换到浅色」，图标为月亮', () => {
    mount('dark')
    expect(tip()).toBe('切换到浅色')
    expect(button().getAttribute('aria-label')).toBe('切换到浅色')
    expect(container.querySelector('.icon-moon')).toBeTruthy()
  })

  it('点击按钮 → 调用 themeStore.toggle', async () => {
    const store = mount('light')
    const spy = vi.spyOn(store, 'toggle')
    button().click()
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('浅色下点击 → 切到暗色：<html data-theme> 变 dark，按钮改提示「切换到浅色」', async () => {
    const store = mount('light')
    button().click()
    await nextTick()
    expect(store.theme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(button().getAttribute('aria-label')).toBe('切换到浅色')
    expect(tip()).toBe('切换到浅色')
  })

  it('暗色下点击 → 切回浅色，按钮改提示「切换到暗色」', async () => {
    const store = mount('dark')
    button().click()
    await nextTick()
    expect(store.theme).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(button().getAttribute('aria-label')).toBe('切换到暗色')
  })
})
