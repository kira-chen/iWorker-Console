// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

/**
 * storageSpaceMock · 持久化（mockPersist v4，key iworker-demo-mock:storageSpace）。
 * 2026-10-09 /test-audit 补缺口：storageSpaceMock.test.js 整体 vi.mock 了 mockPersist，只能验业务规则，
 * 验不到「写入 → 刷新 → 真读回」。对齐项目 mock 持久化约定（刷新后数据仍在；改种子 / 快照结构须 bump version，
 * 旧快照作废回种子；坏快照不白屏）与 prd.存储空间.md 的持久化口径（快照只存业务数据，员工身份 / 岗位是派生值）。
 *
 * 仿 runtimeSpecMockPersist.test.js：注入内存版 localStorage + vi.resetModules 动态 import，模拟「写入 → 刷新 → 重载」。
 * 用户模块 / 岗位分配 / 访问审计也带持久化（同一个内存 localStorage），不影响存储空间自己的 key。
 * 覆盖：单个调整 / 批量 / 同意 / 拒绝之后重载读回；快照里员工只存五个业务字段；只含业务字段的快照 restore 后
 * 首次读取经 reconcile 补出用户名 / 显示名 / 岗位 / 在职；v3 旧快照作废；坏形状兜底。
 */
const KEY = 'iworker-demo-mock:storageSpace'
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
const readSnapshot = () => JSON.parse(globalThis.localStorage.getItem(KEY))
const memberOf = async (m, username) => (await m.listStorageMembers({ size: 50 })).list.find((x) => x.username === username)

// 冷导入整条依赖链（用户 / 岗位 / 审计 mock）较慢，并行跑全量时第一条用例可能越过默认 20s；预热一次，转译缓存不会被 resetModules 清掉
beforeAll(async () => {
  Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), writable: true, configurable: true })
  await import('../storageSpaceMock')
}, 60000)

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), writable: true, configurable: true })
  vi.resetModules()
})
afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true, configurable: true })
  vi.resetModules()
})

describe('storageSpaceMock · 持久化（刷新后读回 / 快照只存业务字段 / 旧版作废 / 坏快照兜底）', () => {
  it('单个调整容量后刷新（重新加载模块）→ 新总量与「个人设置」来源仍在', async () => {
    const first = await import('../storageSpaceMock')
    await first.adjustStorageQuota(201, 8) // 张伟
    vi.resetModules()
    const fresh = await import('../storageSpaceMock')
    expect(await memberOf(fresh, 'zhangwei')).toMatchObject({ totalGb: 8, quotaSource: 'PERSONAL' })
  })

  it('批量设置后刷新 → 每个被改的员工容量仍在', async () => {
    const first = await import('../storageSpaceMock')
    await first.batchAdjustStorageQuota([201, 202], 9)
    vi.resetModules()
    const fresh = await import('../storageSpaceMock')
    expect((await memberOf(fresh, 'zhangwei')).totalGb).toBe(9)
    expect((await memberOf(fresh, 'li.na')).totalGb).toBe(9)
  })

  it('同意扩容后刷新 → 申请仍是已同意（带新总量与处理人），员工容量仍是新总量，待处理角标少 1', async () => {
    const first = await import('../storageSpaceMock')
    await first.approveExpansionRequest('ER-1006', 12) // 陈宇
    vi.resetModules()
    const fresh = await import('../storageSpaceMock')
    expect(await fresh.getExpansionRequest('ER-1006')).toMatchObject({ status: 'APPROVED', newTotalGb: 12, handler: 'demo' })
    expect(await memberOf(fresh, 'chenyu')).toMatchObject({ totalGb: 12, pendingRequestId: null })
    expect((await fresh.getStorageOverview()).pendingCount).toBe(3)
  })

  it('拒绝扩容后刷新 → 申请仍是已拒绝并保留原因，员工容量不变', async () => {
    const first = await import('../storageSpaceMock')
    await first.rejectExpansionRequest('ER-1005', '请先清理历史产物') // 王芳
    vi.resetModules()
    const fresh = await import('../storageSpaceMock')
    expect(await fresh.getExpansionRequest('ER-1005')).toMatchObject({ status: 'REJECTED', rejectReason: '请先清理历史产物' })
    expect(await memberOf(fresh, 'wangfang')).toMatchObject({ totalGb: 5, state: 'FULL' })
  })

  it('落盘的快照里员工只存五个业务字段，用户名 / 显示名 / 岗位 / 在职标记是派生值不落存档', async () => {
    const m = await import('../storageSpaceMock')
    await m.adjustStorageQuota(201, 8)
    const { v, data } = readSnapshot()
    expect(v).toBe(4)
    expect(Object.keys(data).sort()).toEqual(['members', 'requests'])
    for (const member of data.members) {
      expect(Object.keys(member).sort()).toEqual(['cacheGb', 'finalGb', 'quotaGb', 'statAt', 'userId'])
    }
  })

  it('只含业务字段的快照 restore 后，首次读取经 reconcile 补出用户名 / 显示名 / 在职，岗位取岗位分配当前值', async () => {
    const m = await import('../storageSpaceMock')
    await m.adjustStorageQuota(201, 8)
    const stored = readSnapshot()
    vi.resetModules()
    globalThis.localStorage.setItem(KEY, JSON.stringify(stored))
    const fresh = await import('../storageSpaceMock')
    const row = await memberOf(fresh, 'zhangwei')
    expect(row).toMatchObject({ username: 'zhangwei', name: '张伟', totalGb: 8 })
    expect(row.position).toBeTruthy() // 张伟绑定了岗位分配里的岗位，列表上显示岗位名而不是「—」
  })

  it('本地存着 v3 旧版快照 → 丢弃旧数据，回到种子（陈宇仍有待处理申请、容量来自种子）', async () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify({
      v: 3,
      data: { members: [{ userId: 201, username: 'zhangwei', finalGb: 1, cacheGb: 0, quotaGb: 77, statAt: null }], requests: [] }
    }))
    const m = await import('../storageSpaceMock')
    expect((await memberOf(m, 'zhangwei')).totalGb).toBe(5) // 旧快照里的 77 作废
    expect((await m.getStorageOverview()).pendingCount).toBe(4)
  })

  it('本地快照版本对但形状不合法（members 不是数组）→ 兜底回种子，页面不白屏', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 4, data: { members: 'oops', requests: [] } }))
    const m = await import('../storageSpaceMock')
    expect((await m.getStorageOverview()).pendingCount).toBe(4)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
