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
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true, configurable: true })
  vi.doUnmock('../mockSeedOverrides.json')
  vi.restoreAllMocks()
})

describe('mockPersist', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: makeStorageStub(), writable: true, configurable: true })
  })

  it('无 localStorage 环境：attachPersist 返回 no-op，不抛错', async () => {
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true, configurable: true })
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
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true, configurable: true })
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

  /**
   * 2026-09-12 审计 T57 补：URL 带 ?resetMock=1 打开 → 模块首次 import 时清空全部 mock 存储回出厂态
   * （mockPersist.js:88-100；文件头注「重置」段）。node 环境无 window，这里临时挂一个只带 location 的 window。
   */
  it('URL 带 ?resetMock=1 → 模块加载即清空本工具前缀的全部存量（站点其它 key 不动），并 console.info 提示', async () => {
    globalThis.localStorage.setItem('iworker-demo-mock:a', JSON.stringify({ v: 1, data: {} }))
    globalThis.localStorage.setItem('iworker-demo-mock:b', JSON.stringify({ v: 1, data: {} }))
    globalThis.localStorage.setItem('ai_theme', 'dark')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    globalThis.window = { location: { search: '?foo=1&resetMock=1' } }
    try {
      const { attachPersist } = await importFresh()
      expect(globalThis.localStorage.getItem('iworker-demo-mock:a')).toBeNull()
      expect(globalThis.localStorage.getItem('iworker-demo-mock:b')).toBeNull()
      expect(globalThis.localStorage.getItem('ai_theme')).toBe('dark')
      expect(info).toHaveBeenCalledWith(expect.stringContaining('resetMock=1'))
      // 清空后 attach 走代码种子：restore 不被调用
      const restore = vi.fn()
      attachPersist('a', { version: 1, snapshot: () => ({}), restore })
      expect(restore).not.toHaveBeenCalled()
    } finally {
      delete globalThis.window
    }
  })

  it('URL 不带 resetMock（或值不是 1）→ 存量保留', async () => {
    globalThis.localStorage.setItem('iworker-demo-mock:a', JSON.stringify({ v: 1, data: { rows: ['本机改动'] } }))
    globalThis.window = { location: { search: '?resetMock=0' } }
    try {
      const { attachPersist } = await importFresh()
      let rows = ['seed']
      attachPersist('a', { version: 1, snapshot: () => ({ rows }), restore: (d) => { rows = d.rows } })
      expect(rows).toEqual(['本机改动'])
    } finally {
      delete globalThis.window
    }
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

  /**
   * 2026-10-08 对齐 mockPersist.js 头注「出厂数据」段（/test-audit 共享层补缺口）：URL 带 ?exportMock=1 打开 →
   * 模块首次 import 时把本机全部 mock 存量打成 JSON 下载，用于制作出厂数据 mockSeedOverrides.json。
   * 本文件为 node 环境：临时挂只带 location 的 window、只带 createElement 的 document，并桩 URL.createObjectURL
   * 截住被下载的 Blob 读回内容；下载文件结构须能直接粘进 mockSeedOverrides.json（{ exportedAt, entries }）。
   */
  async function runExport(search) {
    const anchor = { href: '', download: '', click: vi.fn() }
    let blob = null
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      blob = b
      return 'blob:mock-export'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    globalThis.window = { location: { search } }
    globalThis.document = { createElement: vi.fn(() => anchor) }
    try {
      await importFresh()
    } finally {
      delete globalThis.window
      delete globalThis.document
    }
    return { anchor, blob, json: blob ? JSON.parse(await blob.text()) : null }
  }

  it('URL 带 ?exportMock=1 → 自动下载一份 iworker-demo-data-*.json（点了一次下载链接）', async () => {
    globalThis.localStorage.setItem('iworker-demo-mock:a', JSON.stringify({ v: 1, data: { rows: ['甲'] } }))
    const { anchor, blob } = await runExport('?exportMock=1')
    expect(anchor.click).toHaveBeenCalledTimes(1)
    expect(anchor.download).toMatch(/^iworker-demo-data-\d{8}-\d{4}\.json$/)
    expect(blob.type).toBe('application/json')
  })

  it('导出内容结构为 { exportedAt, entries }，entries 以去掉前缀的模块名为键、值为原快照', async () => {
    globalThis.localStorage.setItem('iworker-demo-mock:a', JSON.stringify({ v: 1, data: { rows: ['甲'] } }))
    globalThis.localStorage.setItem('iworker-demo-mock:b', JSON.stringify({ v: 3, data: { n: 2 } }))
    const { json } = await runExport('?exportMock=1')
    expect(Object.keys(json).sort()).toEqual(['entries', 'exportedAt'])
    expect(Number.isNaN(Date.parse(json.exportedAt))).toBe(false)
    expect(json.entries).toEqual({ a: { v: 1, data: { rows: ['甲'] } }, b: { v: 3, data: { n: 2 } } })
  })

  it('只导出 iworker-demo-mock: 前缀的 key：主题、登录态等站点其它数据不进出厂包', async () => {
    globalThis.localStorage.setItem('iworker-demo-mock:a', JSON.stringify({ v: 1, data: {} }))
    // 站点其它 key 用能被 JSON.parse 的值：若用 'dark' 这类裸串，解析失败会被「单条损坏跳过」顺手挡掉，测不出前缀过滤
    globalThis.localStorage.setItem('ai_assistant_user', JSON.stringify({ username: 'demo', roles: ['ADMIN'] }))
    globalThis.localStorage.setItem('ai_theme', JSON.stringify('dark'))
    const { json } = await runExport('?exportMock=1')
    expect(Object.keys(json.entries)).toEqual(['a'])
  })

  it('某条存量 JSON 损坏 → 跳过该条，其余照常导出', async () => {
    globalThis.localStorage.setItem('iworker-demo-mock:a', JSON.stringify({ v: 1, data: {} }))
    globalThis.localStorage.setItem('iworker-demo-mock:bad', '{broken')
    const { json } = await runExport('?exportMock=1')
    expect(Object.keys(json.entries)).toEqual(['a'])
  })

  it('URL 不带 exportMock（或值不是 1）→ 不触发下载', async () => {
    globalThis.localStorage.setItem('iworker-demo-mock:a', JSON.stringify({ v: 1, data: {} }))
    const { anchor, blob } = await runExport('?exportMock=0')
    expect(anchor.click).not.toHaveBeenCalled()
    expect(blob).toBeNull()
  })
})
