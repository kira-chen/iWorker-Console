// @vitest-environment jsdom
// （positionMock → request.js → router 链路触达 window，故用 jsdom；同 positionMock.test）
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'

/**
 * 2026-10-09 · 待办 yuepu#52 #51 · md 岗位。
 * 待办 yuepu#52：岗位 id 不得复用，删岗要清岗位知识库。
 * 待办 yuepu#51：岗位保存连接器绑定会回写连接器侧「被岗位引用」清单，且该回写随连接器 mock 落盘（刷新 / 重新加载后仍在）。
 *
 * 背景：按 positionId 存数据的模块（分配 / 任务 / 档案 / 运行规格 / 知识库 / 专家 / 连接器）各自持久化，
 * positionMock 升版本丢弃旧快照后 posSeq 回到 405，新建岗位复用旧 id 即继承旧数据。
 * 做法：positionMock 另存不随快照版本走的 id 水位线（iworker-demo-mock:position-id-floor），并在启动时读取旧快照的 posSeq 兜底。
 * 本文件用内存版 localStorage + vi.resetModules 模拟「写入 → 升级 / 刷新 → 重新加载模块」。
 */
const POS_KEY = 'iworker-demo-mock:position'
const FLOOR_KEY = 'iworker-demo-mock:position-id-floor'
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

describe('positionMock · 岗位 id 水位线（yuepu#52）', () => {
  it('前提：全新环境首个新建岗位拿到 405', async () => {
    const m = await import('../positionMock')
    const p = await m.createPosition({ name: '水位线前提岗' })
    expect(p.positionId).toBe(405)
  })

  it('升级场景：旧版本快照（posSeq=407，已建过 405/406）被版本戳丢弃后，新建岗位拿到 407 而不是复用 405', async () => {
    globalThis.localStorage.setItem(POS_KEY, JSON.stringify({ v: 1, data: { posSeq: 407, agentSeq: 520, positions: [{ positionId: 405 }, { positionId: 406 }], publications: {}, workbench: {} } }))
    const m = await import('../positionMock')
    const p = await m.createPosition({ name: '升级后新建岗' })
    expect(p.positionId).toBe(407)
  })

  it('升级场景（旧快照没有 posSeq 字段也按最大岗位 id + 1 兜底）', async () => {
    globalThis.localStorage.setItem(POS_KEY, JSON.stringify({ v: 1, data: { positions: [{ positionId: 409 }] } }))
    const m = await import('../positionMock')
    const p = await m.createPosition({ name: '无 posSeq 兜底岗' })
    expect(p.positionId).toBe(410)
  })

  it('水位线独立落盘：建岗后即使 position 快照被整份丢弃，再新建的岗位也不复用 405', async () => {
    const first = await import('../positionMock')
    expect((await first.createPosition({ name: '先建一个岗' })).positionId).toBe(405)
    expect(globalThis.localStorage.getItem(FLOOR_KEY)).toBe('406')
    globalThis.localStorage.removeItem(POS_KEY) // 模拟升级丢弃快照
    vi.resetModules()
    const second = await import('../positionMock')
    expect((await second.createPosition({ name: '升级后再建岗' })).positionId).toBe(406)
  })

  it('__resetPositionMock 清掉水位线，回到种子 405', async () => {
    const m = await import('../positionMock')
    await m.createPosition({ name: '重置前建岗' })
    m.__resetPositionMock()
    expect(globalThis.localStorage.getItem(FLOOR_KEY)).toBeNull()
    expect((await m.createPosition({ name: '重置后建岗' })).positionId).toBe(405)
  })
})

describe('positionMock.deletePosition · 清岗位知识库可见范围（yuepu#52）', () => {
  it('删岗后以它为可见范围的岗位知识库保留但 scopeRefId 置空；其它库的可见范围不动；同 id 新岗位不会继承', async () => {
    const pos = await import('../positionMock')
    const kb = await import('../knowledgeBaseMock')
    const p = await pos.createPosition({ name: '知识库级联岗' })
    const mine = await kb.create({ name: '级联岗位库', icon: '📘', kbType: 'POSITION', scopeRefId: p.positionId, description: '随岗位删除' })
    expect(String((await kb.get(mine.id)).scopeRefId)).toBe(String(p.positionId))
    await pos.deletePosition(p.positionId)
    const after = await kb.get(mine.id)
    expect(after.scopeRefId).toBeNull()
    expect(after.scopeRefName).toBe('')
    // 其它库不受影响：种子岗位库 kb_4 仍指向 401
    expect(String((await kb.get('kb_4')).scopeRefId)).toBe('401')
    // 同 id 不复用及岗位库不被继承，见下一条（重新加载后的强断言）
  })

  it('删岗后模拟升级丢弃岗位快照 + 重新加载两个模块：同 id 不复用（新岗位 id 恰为 p+1），且没有任何岗位库指向它', async () => {
    const pos = await import('../positionMock')
    const kb = await import('../knowledgeBaseMock')
    const p = await pos.createPosition({ name: '水位线收紧岗' })
    await kb.create({ name: '收紧级联库', icon: '📘', kbType: 'POSITION', scopeRefId: p.positionId, description: '随岗位删除' })
    await pos.deletePosition(p.positionId)
    globalThis.localStorage.removeItem(POS_KEY) // 升级丢弃岗位快照，只剩独立落盘的水位线
    vi.resetModules()
    const pos2 = await import('../positionMock')
    const kb2 = await import('../knowledgeBaseMock')
    const next = await pos2.createPosition({ name: '后建岗' })
    expect(next.positionId).toBe(p.positionId + 1)
    const { list } = await kb2.list({ size: 100 })
    const pointing = list.filter((k) => String(k.scopeRefId) === String(next.positionId))
    expect(pointing).toEqual([])
  })
})

describe('knowledgeBaseMock.clearPositionScope · 落盘读回（yuepu#52）', () => {
  it('清空后重新加载模块，岗位库 scopeRefId 仍为 null（不是只改了内存）', async () => {
    const kb = await import('../knowledgeBaseMock')
    expect(String((await kb.get('kb_4')).scopeRefId)).toBe('401')
    kb.clearPositionScope(401)
    vi.resetModules()
    const kb2 = await import('../knowledgeBaseMock')
    expect((await kb2.get('kb_4')).scopeRefId).toBeNull()
    // 另一岗位的库不受牵连
    expect(String((await kb2.get('kb_5')).scopeRefId)).toBe('403')
  })

  it('kbType 不是 POSITION 但 scopeRefId 同值的库不被清（只清岗位库）', async () => {
    const kb = await import('../knowledgeBaseMock')
    const other = await kb.create({ name: '同值非岗位库', icon: '📘', kbType: 'EXPERT', scopeRefId: 401, description: '专家库误指同值' })
    kb.clearPositionScope(401)
    expect((await kb.get('kb_4')).scopeRefId).toBeNull()
    expect(String((await kb.get(other.id)).scopeRefId)).toBe('401')
    vi.resetModules()
    const kb2 = await import('../knowledgeBaseMock')
    expect(String((await kb2.get(other.id)).scopeRefId)).toBe('401')
  })
})

describe('positionMock.createPosition · 带连接器 id 新建同样回写引用清单（yuepu#90①）', () => {
  it('新建岗位 payload 带三类连接器 id，连接器侧引用清单含新岗位', async () => {
    const pos = await import('../positionMock')
    const created = await pos.createPosition({ name: '带连接器新建岗', connectorMcpIds: ['mail_center'], connectorApiIds: ['api_1103'], businessSystemIds: ['biz_2101'] })
    const mcp = await import('../mcpConnectorMock')
    const api = await import('../apiConnectorMock')
    const biz = await import('../bizSystemMock')
    expect((await mcp.getMcp('mail_center')).referencedByPositions.map((x) => x.positionId)).toContain(created.positionId)
    expect((await api.getApi('api_1103')).referencedByPositions.map((x) => x.positionId)).toContain(created.positionId)
    expect((await biz.getBizSystem('biz_2101')).referencedByPositions.map((x) => x.positionId)).toContain(created.positionId)
  })
})

describe('positionMock.updatePosition · 连接器引用回写落盘读回（yuepu#51）', () => {
  // 种子：401（已发布）绑 expense_mcp / api_1101 / biz_2101；biz_2101 另被 402 引用
  it('解绑：401 清空三类连接器后，重新加载各连接器 mock，引用数与引用清单反映改后状态', async () => {
    const pos = await import('../positionMock')
    await pos.updatePosition(401, { connectorMcpIds: [], connectorApiIds: [], businessSystemIds: [] })
    vi.resetModules()
    const mcp = await import('../mcpConnectorMock')
    const api = await import('../apiConnectorMock')
    const biz = await import('../bizSystemMock')
    const m = mcp.listMcpSync().find((r) => r.id === 'expense_mcp')
    const a = api.listApisSync().find((r) => r.id === 'api_1101')
    const b = biz.listBizSystemsSync().find((r) => r.id === 'biz_2101')
    expect(m.positionCount).toBe(0)
    expect(a.positionCount).toBe(0)
    expect(b.positionCount).toBe(1) // 402 仍引用
    expect((await mcp.getMcp('expense_mcp')).referencedByPositions).toEqual([])
    expect((await biz.getBizSystem('biz_2101')).referencedByPositions.map((x) => x.positionId)).toEqual([402])
  })

  it('绑定：草稿岗 404 绑私有 mail_center / api_1103 / biz_2101 后，重新加载各连接器 mock，引用清单含 404', async () => {
    const pos = await import('../positionMock')
    await pos.updatePosition(404, { connectorMcpIds: ['mail_center'], connectorApiIds: ['api_1103'], businessSystemIds: ['biz_2101'] })
    vi.resetModules()
    const mcp = await import('../mcpConnectorMock')
    const api = await import('../apiConnectorMock')
    const biz = await import('../bizSystemMock')
    expect(mcp.listMcpSync().find((r) => r.id === 'mail_center').positionCount).toBe(1)
    expect(api.listApisSync().find((r) => r.id === 'api_1103').positionCount).toBe(2)
    expect(biz.listBizSystemsSync().find((r) => r.id === 'biz_2101').positionCount).toBe(3)
    expect((await mcp.getMcp('mail_center')).referencedByPositions.map((x) => x.positionId)).toEqual([404])
    expect((await api.getApi('api_1103')).referencedByPositions.map((x) => x.positionId)).toContain(404)
  })
})
