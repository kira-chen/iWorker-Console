// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * instanceMock · 持久化（mockPersist v2，key iworker-demo-mock:instanceManagement）。
 * 2026-10-08 对齐 docs/PRD/数字员工管理端PRD/04运行/实例管理/prd.实例管理.md §四.6「操作提交后…更新实例状态」/
 * §九.3 按最新规格重建：处置结果刷新页面后仍在（instanceMock 头注「浏览器刷新后保留本地演示状态」）。
 *
 * instanceMock.test.js 整体 vi.mock 了 mockPersist，验不到真读回；本文件仿 adminUserMock.test.js 持久化段：
 * 注入内存版 localStorage + vi.resetModules 动态 import，模拟「操作 → 刷新 → 重载」。
 * 断言受理态、刷新后恢复和后续状态推进均可持久化。
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

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), writable: true, configurable: true })
  vi.resetModules()
})
afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true, configurable: true })
  vi.resetModules()
})

describe('instanceMock · 持久化', () => {
  it('对赵敏实例按最新规格重建后刷新页面：先恢复启动中快照，再推进为空闲并更新实际规格', async () => {
    const first = await import('../instanceMock')
    await first.operateInstance('ins-240904', 'rebuild')
    vi.resetModules()
    const fresh = await import('../instanceMock')
    const item = await fresh.getInstance('ins-240904')
    expect(item.actualSpec).toBe('标准')
    expect(item.status).toBe('STARTING')
    expect(item.operable).toBe(false)
    expect(item.records[0]).toMatchObject({ type: '按最新规格重建', result: '已受理' })
    expect((await fresh.listInstances({ pending: true })).total).toBe(1)
    expect((await fresh.listInstances({ pending: true })).total).toBe(0)
    const completed = await fresh.getInstance('ins-240904')
    expect(completed).toMatchObject({ actualSpec: '重', status: 'IDLE', operable: true })
    expect(completed.records[0].result).toBe('成功')
  })
})
