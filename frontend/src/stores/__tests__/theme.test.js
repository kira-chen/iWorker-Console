// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useThemeStore } from '@/stores/theme'

/**
 * stores/theme（全站浅/暗双主题单一管理点）契约——2026-09-12 审计 T57 新建（此前零单测）。
 *
 * 主题不是 PRD 功能条目，属站内既有设计语言（CLAUDE.md「视觉与交互延续既有设计语言：Notion 风格令牌与双主题」）；
 * AdminRail 头像菜单的「外观切换」（AdminRail.test.js）直接依赖本 store。钉住三件事：
 *  1. 存量非法值（如旧版写过的 'blue'）→ 回默认 light，不把脏值带上 <html>；
 *  2. apply('dark') → <html data-theme="dark"> + localStorage ai_theme='dark'（EP 弹层挂 body 也能命中）；
 *  3. apply('x') 非法值忽略：theme / DOM / 存储三处都不动。
 */

// 本仓 jsdom 环境下 globalThis.localStorage 为 undefined（同 sampleTaskMock.test.js:98 / AdminRail.test.js:138），
// 注入最小内存版：store 只用 getItem / setItem。
function makeStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear()
  }
}

beforeEach(() => {
  globalThis.localStorage = makeStorage()
  document.documentElement.removeAttribute('data-theme')
  setActivePinia(createPinia())
})
afterEach(() => {
  delete globalThis.localStorage
  document.documentElement.removeAttribute('data-theme')
})

describe('stores/theme · 双主题', () => {
  it('存量 ai_theme=blue（非法）→ 初始主题回默认 light；init() 后 <html data-theme="light"> 且存储被纠正', () => {
    localStorage.setItem('ai_theme', 'blue')
    const store = useThemeStore()
    expect(store.theme).toBe('light')

    store.init()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(localStorage.getItem('ai_theme')).toBe('light')
  })

  it('apply("dark") → theme=dark、<html data-theme="dark">、localStorage ai_theme=dark；刷新后（新 pinia）仍是 dark', () => {
    useThemeStore().apply('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('ai_theme')).toBe('dark')

    setActivePinia(createPinia()) // 模拟刷新：store 重新从 localStorage 读
    expect(useThemeStore().theme).toBe('dark')
  })

  it('apply("x") 非法值 → 忽略：theme 仍 light、<html> 不写 data-theme、存储不写', () => {
    const store = useThemeStore()
    store.apply('x')
    expect(store.theme).toBe('light')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(localStorage.getItem('ai_theme')).toBeNull()
  })

  it('toggle() 浅暗互切：light → dark → light，每次都落到 <html> 与存储', () => {
    const store = useThemeStore()
    store.toggle()
    expect(store.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    store.toggle()
    expect(store.theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('ai_theme')).toBe('light')
  })
})
