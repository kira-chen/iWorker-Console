// @vitest-environment jsdom
// （versionMock → request.js 链路触达 window，故用 jsdom；同 versionMock.test.js）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * versionMock 持久化读回（2026-10-08 /test-audit 补缺口新建）。
 * 2026-10-08 对齐 docs/PRD/数字员工管理端PRD/05治理/版本管理/prd.版本管理.md §五「发布 = 提交审核，进入审核中」
 * + 05治理/审核中心/prd.审核中心.md §三「列表只展示待审核记录」：提交发布后刷新页面，版本仍是「审核中」、
 * 审核中心那一行仍在（数据存在浏览器里，不因刷新丢失）。
 *
 * 写法同 accessAuditMock.test.js：注入内存版 localStorage + vi.resetModules + 动态 import 模拟「刷新」。
 * 【为什么单独成文件，不并进 versionMock.test.js】那边的用例静态导入 versionMock，但审核通过 / 驳回要经
 * reviewsMock 动态 import('./versionMock') 落地——本块一做 vi.resetModules，之后 reviewsMock 动态拿到的是
 * **新的** versionMock 实例，与静态导入的那份不是同一份，同文件 20 条审核落地用例按乱序随机假红（seed=7 实测）。
 */
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
const WIN_NEW = 4 // 种子 Windows v1.3.0：从未发布

describe('versionMock · 持久化：提交发布 → 刷新 → 读回（key iworker-demo-mock:version）', { timeout: 20000 }, () => {
  let original
  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), writable: true, configurable: true })
    vi.resetModules()
  })
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true, configurable: true })
    vi.resetModules()
  })

  it('提交发布后刷新 → 版本仍是「审核中」，审核中心里这条发布申请仍在', async () => {
    const m = await import('../versionMock')
    expect((await m.getVersion(WIN_NEW)).status).toBe('UNPUBLISHED')
    await m.publishVersion(WIN_NEW)

    vi.resetModules()
    const reloaded = await import('../versionMock')
    const reviews = await import('../reviewsMock')
    expect((await reloaded.getVersion(WIN_NEW)).status).toBe('PENDING_REVIEW')
    const row = (await reviews.listReviews({ size: 50 })).list.find((r) => r.type === 'VERSION' && String(r.refId) === String(WIN_NEW))
    expect(row).toMatchObject({ status: 'PENDING_REVIEW', name: 'Windows v1.3.0', requestAction: 'VERSION_PUBLISH' })
  })
})
