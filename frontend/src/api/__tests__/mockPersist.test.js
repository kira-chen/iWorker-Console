// mockPersist 公共持久化工具单测：重点验证「任何异常都不能让页面挂掉」的兜底铁律。
// 工具在模块加载时探测 globalThis.localStorage，故每个用例用 vi.resetModules + 动态 import。
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

function makeStorageStub() {
  const map = new Map()
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map
  }
}

async function importFresh(overrides) {
  vi.resetModules()
  vi.doMock('../mockSeedOverrides.json', () => ({ default: overrides || { entries: {} } }))
  return import('../mockPersist')
}

afterEach(() => {
  delete globalThis.localStorage
  vi.doUnmock('../mockSeedOverrides.json')
  vi.restoreAllMocks()
})

describe('mockPersist', () => {
  beforeEach(() => {
    globalThis.localStorage = makeStorageStub()
  })

  it('无 localStorage 环境：attachPersist 返回 no-op，不抛错', async () => {
    delete globalThis.localStorage
    const { attachPersist } = await importFresh()
    const persist = attachPersist('m1', { snapshot: () => ({}), restore: () => {} })
    expect(() => persist()).not.toThrow()
  })

  it('往返：persist 后重新 attach 会用存量快照调用 restore', async () => {
    const { attachPersist } = await importFresh()
    let rows = ['seed']
    const opts = {
      version: 1,
      snapshot: () => ({ rows }),
      restore: (d) => {
        rows = d.rows
      }
    }
    const persist = attachPersist('m1', opts)
    rows = ['edited']
    persist()

    rows = ['seed'] // 模拟刷新后回到种子
    attachPersist('m1', opts)
    expect(rows).toEqual(['edited'])
  })

  it('版本不符：不调用 restore，且清掉旧 key', async () => {
    const { attachPersist } = await importFresh()
    globalThis.localStorage.setItem('iworker-demo-mock:m1', JSON.stringify({ v: 1, data: {} }))
    const restore = vi.fn()
    attachPersist('m1', { version: 2, snapshot: () => ({}), restore })
    expect(restore).not.toHaveBeenCalled()
    expect(globalThis.localStorage.getItem('iworker-demo-mock:m1')).toBeNull()
  })

  it('存量 JSON 损坏：静默回退种子并清 key，不抛错', async () => {
    const { attachPersist } = await importFresh()
    globalThis.localStorage.setItem('iworker-demo-mock:m1', '{broken')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() =>
      attachPersist('m1', { snapshot: () => ({}), restore: () => {} })
    ).not.toThrow()
    expect(globalThis.localStorage.getItem('iworker-demo-mock:m1')).toBeNull()
  })

  it('restore 抛异常：被捕获并清 key，页面继续用种子', async () => {
    const { attachPersist } = await importFresh()
    globalThis.localStorage.setItem('iworker-demo-mock:m1', JSON.stringify({ v: 1, data: {} }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() =>
      attachPersist('m1', {
        version: 1,
        snapshot: () => ({}),
        restore: () => {
          throw new Error('bad shape')
        }
      })
    ).not.toThrow()
    expect(globalThis.localStorage.getItem('iworker-demo-mock:m1')).toBeNull()
  })

  it('写入失败（配额满等）：persist 不抛错，仅告警一次', async () => {
    const { attachPersist } = await importFresh()
    const persist = attachPersist('m1', { snapshot: () => ({}), restore: () => {} })
    globalThis.localStorage.setItem = () => {
      throw new Error('QuotaExceeded')
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => {
      persist()
      persist()
    }).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('出厂数据：无存量时用 mockSeedOverrides 恢复', async () => {
    const { attachPersist } = await importFresh({ entries: { m1: { v: 1, data: { rows: ['出厂'] } } } })
    let rows = ['seed']
    attachPersist('m1', { version: 1, snapshot: () => ({ rows }), restore: (d) => { rows = d.rows } })
    expect(rows).toEqual(['出厂'])
  })

  it('出厂数据：localStorage 存量优先于出厂数据', async () => {
    globalThis.localStorage.setItem(
      'iworker-demo-mock:m1',
      JSON.stringify({ v: 1, data: { rows: ['本机改动'] } })
    )
    const { attachPersist } = await importFresh({ entries: { m1: { v: 1, data: { rows: ['出厂'] } } } })
    let rows = ['seed']
    attachPersist('m1', { version: 1, snapshot: () => ({ rows }), restore: (d) => { rows = d.rows } })
    expect(rows).toEqual(['本机改动'])
  })

  it('出厂数据：版本不符则忽略，保持代码种子', async () => {
    const { attachPersist } = await importFresh({ entries: { m1: { v: 1, data: { rows: ['旧出厂'] } } } })
    let rows = ['seed']
    attachPersist('m1', { version: 2, snapshot: () => ({ rows }), restore: (d) => { rows = d.rows } })
    expect(rows).toEqual(['seed'])
  })

  it('出厂数据：无 localStorage 环境（纯内存模式）也应生效', async () => {
    delete globalThis.localStorage
    const { attachPersist } = await importFresh({ entries: { m1: { v: 1, data: { rows: ['出厂'] } } } })
    let rows = ['seed']
    attachPersist('m1', { version: 1, snapshot: () => ({ rows }), restore: (d) => { rows = d.rows } })
    expect(rows).toEqual(['出厂'])
  })

  it('出厂数据：restore 抛错被兜底，保持代码种子不挂', async () => {
    const { attachPersist } = await importFresh({ entries: { m1: { v: 1, data: {} } } })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() =>
      attachPersist('m1', {
        version: 1,
        snapshot: () => ({}),
        restore: () => {
          throw new Error('bad bundled shape')
        }
      })
    ).not.toThrow()
  })

  it('clearAllMockState 只清本工具前缀的 key', async () => {
    const { clearAllMockState } = await importFresh()
    globalThis.localStorage.setItem('iworker-demo-mock:a', '1')
    globalThis.localStorage.setItem('iworker-demo-mock:b', '2')
    globalThis.localStorage.setItem('other-key', 'keep')
    clearAllMockState()
    expect(globalThis.localStorage.getItem('iworker-demo-mock:a')).toBeNull()
    expect(globalThis.localStorage.getItem('iworker-demo-mock:b')).toBeNull()
    expect(globalThis.localStorage.getItem('other-key')).toBe('keep')
  })
})
