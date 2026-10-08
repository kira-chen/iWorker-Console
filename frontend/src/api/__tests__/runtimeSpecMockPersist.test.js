// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * runtimeSpecMock · 持久化（mockPersist v2，key iworker-demo-mock:runtimeSpec）。
 * 2026-10-08 对齐 docs/PRD/数字员工管理端PRD/04运行/运行规格/prd.运行规格.md §三.2「新建规格成功后排在最前」
 * + 项目 mock 持久化约定（刷新后数据仍在；改种子须 bump version，旧快照作废回种子；坏快照不白屏）。
 *
 * runtimeSpecMock.test.js 整体 vi.mock 了 mockPersist，只能验「调了 persist」，验不到「刷新后真读回」。
 * 本文件仿 adminUserMock.test.js 持久化段：注入内存版 localStorage + vi.resetModules 动态 import，模拟「写入 → 刷新 → 重载」。
 * 覆盖：新建规格后重载读回；v1 旧快照被丢弃回种子 5 条；形状不合法的快照走兜底回种子。
 */
const KEY = 'iworker-demo-mock:runtimeSpec'
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
const SEED_NAMES = ['轻', '标准', '重', '高敏', '专属 · 生产计划员']
const NEW_SPEC = {
  name: '刷新留存档', boundaryDesc: '验证刷新后仍在', cpu: 1, memoryGi: 2, diskGi: 5,
  readinessTimeoutMin: 5, idleRecycleMin: 5, maxLifetimeHours: 0, positionIds: [], allowUserApply: false
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), writable: true, configurable: true })
  vi.resetModules()
})
afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true, configurable: true })
  vi.resetModules()
})

describe('runtimeSpecMock · 持久化（刷新后读回 / 旧版作废 / 坏快照兜底）', () => {
  it('新建规格后刷新页面（重新加载模块）→ 新规格仍在列表首位，总数 6 条', async () => {
    const first = await import('../runtimeSpecMock')
    const created = await first.createRuntimeSpec(NEW_SPEC)
    vi.resetModules()
    const fresh = await import('../runtimeSpecMock')
    const { list, total } = await fresh.listRuntimeSpecs()
    expect(total).toBe(6)
    expect(list[0]).toMatchObject({ id: created.id, name: '刷新留存档' })
  })

  it('本地存着 v1 旧版快照 → 丢弃旧数据，回到种子 5 条，读不到旧快照里的规格', async () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify({
      v: 1,
      data: { seq: 99, specs: [{ id: 99, name: '旧版幽灵规格', positionIds: [], directUsers: [], isDefault: true }] }
    }))
    const m = await import('../runtimeSpecMock')
    const { list, total } = await m.listRuntimeSpecs()
    expect(total).toBe(5)
    expect(list.map((s) => s.name).sort()).toEqual([...SEED_NAMES].sort())
    expect(list.some((s) => s.name === '旧版幽灵规格')).toBe(false)
  })

  it('本地快照版本对但形状不合法（specs 不是数组）→ 兜底回种子 5 条，页面不白屏', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 2, data: { seq: 12, specs: 'oops' } }))
    const m = await import('../runtimeSpecMock')
    const { list, total } = await m.listRuntimeSpecs()
    expect(total).toBe(5)
    expect(list.map((s) => s.name).sort()).toEqual([...SEED_NAMES].sort())
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
