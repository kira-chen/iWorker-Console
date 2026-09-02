// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

/**
 * EChart 封装单测（设计 §6.3）：
 * - stub echarts.init：单测不在 jsdom 真渲染 canvas，只断言 init 被调一次 + setOption 收到组装好的 option。
 * - 双主题：buildOption 接到的 colors 由 colorKeys 经 getComputedStyle(--c-*) 解析；
 *   切 theme 后重算并再次 setOption（断言 setOption 调用次数增加）。
 * - dispose：卸载时调用实例 dispose。
 */

const chartInstance = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
const initSpy = vi.fn(() => chartInstance)

// mock echarts/core：init 返回替身实例；use 为 noop
vi.mock('echarts/core', () => ({
  init: (...args) => initSpy(...args),
  use: vi.fn()
}))
// 按需 chart/component/feature/renderer：mock 为空对象（仅供 use() 引用，不真用）
vi.mock('echarts/charts', () => ({ PieChart: {}, BarChart: {} }))
vi.mock('echarts/components', () => ({
  GridComponent: {},
  TooltipComponent: {},
  LegendComponent: {},
  TitleComponent: {},
  DatasetComponent: {}
}))
vi.mock('echarts/features', () => ({ LabelLayout: {} }))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

import { useThemeStore } from '@/stores/theme'

let container
let app

async function mount(props) {
  const EChart = (await import('@/components/common/EChart.vue')).default
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(EChart, props) })
  app.mount(container)
  await nextTick()
  return container
}

beforeEach(() => {
  setActivePinia(createPinia())
  initSpy.mockClear()
  chartInstance.setOption.mockClear()
  chartInstance.dispose.mockClear()
  if (!('localStorage' in globalThis) || typeof globalThis.localStorage?.getItem !== 'function') {
    const mem = new Map()
    globalThis.localStorage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
      clear: () => mem.clear()
    }
  }
  // 注入语义色 CSS 变量供 getComputedStyle 解析
  document.documentElement.style.setProperty('--c-success', '#0f7b6c')
  document.documentElement.style.setProperty('--c-danger', '#e03e3e')
  // 无 --c- 前缀的表面/边框令牌（tokens.css 中实际命名），用于验证回退解析
  document.documentElement.style.setProperty('--bg-surface', '#ffffff')
  document.documentElement.style.setProperty('--border-base', 'rgba(55, 53, 47, 0.1)')
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('EChart 封装', () => {
  it('惰性 init + buildOption 收到 colorKeys 解析后的真实色值，setOption 被调用', async () => {
    const buildOption = vi.fn((c) => ({ color: [c.success, c.danger] }))
    await mount({ buildOption, colorKeys: ['success', 'danger'] })

    expect(initSpy).toHaveBeenCalledTimes(1)
    // buildOption 收到从 --c-success/--c-danger 解析的真实色值
    expect(buildOption).toHaveBeenCalledWith({ success: '#0f7b6c', danger: '#e03e3e' })
    // 组装好的 option 塞进 setOption（notMerge=true）
    expect(chartInstance.setOption).toHaveBeenCalledWith({ color: ['#0f7b6c', '#e03e3e'] }, true)
  })

  it('切主题：重解析语义色 + 再次 setOption（暗色跟随）', async () => {
    const buildOption = vi.fn((c) => ({ color: [c.success] }))
    await mount({ buildOption, colorKeys: ['success'] })
    const callsBefore = chartInstance.setOption.mock.calls.length

    // 模拟暗色：变量值变化 + theme 切换
    document.documentElement.style.setProperty('--c-success', '#2dbd9b')
    useThemeStore().apply('dark')
    await nextTick()
    await nextTick()

    expect(chartInstance.setOption.mock.calls.length).toBeGreaterThan(callsBefore)
    // 最后一次拿到暗色色值
    const last = chartInstance.setOption.mock.calls.at(-1)
    expect(last[0]).toEqual({ color: ['#2dbd9b'] })
  })

  it('无 --c- 前缀令牌（bg-surface/border-base）回退解析到 --bg-surface/--border-base', async () => {
    const buildOption = vi.fn((c) => ({
      surface: c['bg-surface'],
      border: c['border-base'],
      // 同时验证有 --c- 前缀的仍优先取 --c-*
      ok: c.success
    }))
    await mount({ buildOption, colorKeys: ['bg-surface', 'border-base', 'success'] })

    expect(buildOption).toHaveBeenCalledWith({
      'bg-surface': '#ffffff',
      'border-base': 'rgba(55, 53, 47, 0.1)',
      success: '#0f7b6c'
    })
    expect(chartInstance.setOption).toHaveBeenCalledWith(
      { surface: '#ffffff', border: 'rgba(55, 53, 47, 0.1)', ok: '#0f7b6c' },
      true
    )
  })

  it('chartData 变化（deep）触发重渲染', async () => {
    const dataset = { items: [{ v: 1 }] }
    const buildOption = vi.fn(() => ({ n: dataset.items.length }))
    const EChart = (await import('@/components/common/EChart.vue')).default
    container = document.createElement('div')
    document.body.appendChild(container)
    const { reactive } = await import('vue')
    const state = reactive({ data: dataset })
    app = createApp({
      render: () => h(EChart, { buildOption, colorKeys: [], chartData: state.data })
    })
    app.mount(container)
    await nextTick()
    const callsBefore = chartInstance.setOption.mock.calls.length

    // 深层数据变化应触发重渲染
    state.data.items.push({ v: 2 })
    await nextTick()

    expect(chartInstance.setOption.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('卸载时 dispose 实例', async () => {
    await mount({ buildOption: () => ({}), colorKeys: [] })
    app.unmount()
    app = null
    expect(chartInstance.dispose).toHaveBeenCalledTimes(1)
  })
})
