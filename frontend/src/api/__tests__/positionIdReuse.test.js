// @vitest-environment jsdom
// （positionMock → request.js → router 链路触达 window，故用 jsdom；同 positionMock.test）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * 待办 yuepu#52：岗位 id 不得复用，删岗要清岗位知识库。
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
    // 同 id 复用不会发生（水位线），新岗位拿到新 id 且没有任何岗位库指向它
    const next = await pos.createPosition({ name: '后建岗' })
    expect(next.positionId).toBeGreaterThan(p.positionId)
  })
})
