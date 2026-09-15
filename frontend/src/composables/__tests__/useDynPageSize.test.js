// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createApp, h, nextTick, watch } from 'vue'
import { useDynPageSize, computeDynPageSize } from '@/composables/useDynPageSize'

/**
 * useDynPageSize 组件内分支（resize 防抖重算）——2026-09-12 审计 T57 补。
 *
 * 对齐 docs/PRD/数字员工管理端PRD/02岗位/岗位管理/prd.岗位管理.md L48「根据页面可用高度动态计算每页条数，
 * 最少 5 条、最多 30 条，窗口尺寸变化后按新高度重新计算」。
 * 纯函数分支（computeDynPageSize 夹取 5–30、900 兜底）已在 useAdminList.test.js 钉住；
 * 这里只测需要组件上下文 + window 的那段（useDynPageSize.js:52-66）：
 *  - mounted 后 resize → 200ms 防抖 → 按新高度重算（900→9 变 1080→12）；
 *  - 200ms 内连续 resize 只算最后一次；
 *  - 高度变了但算出的条数没变 → ref 不动（避免 useAdminList 无意义重拉）；
 *  - 卸载后 resize 不再重算。
 */

let app, host, size

function mountWith(height) {
  window.innerHeight = height
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    setup() {
      size = useDynPageSize()
      return () => h('div', String(size.value))
    }
  })
  app.mount(host)
}

function resizeTo(height) {
  window.innerHeight = height
  window.dispatchEvent(new Event('resize'))
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  app?.unmount()
  host?.remove()
  vi.useRealTimers()
  window.innerHeight = 768 // jsdom 默认
})

describe('useDynPageSize · 组件内 resize 防抖重算（岗位管理 md L48）', () => {
  it('窗口 900 高挂载 → 9 条；resize 到 1080 后 200ms → 12 条（未到 200ms 仍是 9）', async () => {
    mountWith(900)
    expect(size.value).toBe(9)
    expect(computeDynPageSize(1080)).toBe(12)

    resizeTo(1080)
    vi.advanceTimersByTime(199)
    expect(size.value, '防抖窗口内不重算').toBe(9)
    vi.advanceTimersByTime(1)
    expect(size.value).toBe(12)
    await nextTick()
    expect(host.textContent).toBe('12')
  })

  it('200ms 内连续 resize（1080 → 400）只按最后一次高度算：夹到下限 5', () => {
    mountWith(900)
    resizeTo(1080)
    vi.advanceTimersByTime(100)
    resizeTo(400)
    vi.advanceTimersByTime(199)
    expect(size.value).toBe(9)
    vi.advanceTimersByTime(1)
    expect(size.value).toBe(5)
  })

  it('高度变了但条数不变（900 → 920 都是 9）→ ref 不触发变更（不让列表页无意义重拉）', () => {
    mountWith(900)
    const seen = []
    const stop = watch(size, (v) => seen.push(v)) // 观察 ref 是否被写入
    resizeTo(920)
    vi.advanceTimersByTime(200)
    expect(size.value).toBe(9)
    expect(seen).toEqual([])
    stop()
  })

  it('卸载后 resize 不再重算（监听已移除）', () => {
    mountWith(900)
    app.unmount()
    app = null
    resizeTo(1080)
    vi.advanceTimersByTime(200)
    expect(size.value).toBe(9)
  })
})
