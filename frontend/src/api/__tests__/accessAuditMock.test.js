// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { opsRecords, appendOpsRecord, resetAccessAuditMock } from '../accessAuditMock'

/**
 * accessAuditMock「管理端操作」记录：种子 + 运行期写入（2026-09-20，版本管理发布 / 停用写记录）。
 * 对齐 prd.访问审计.md §6.2（操作对象 / 变更内容）与 prd.版本管理.md §八「审计」。
 */

beforeEach(() => resetAccessAuditMock())

describe('版本管理种子记录', () => {
  const seeds = () => opsRecords.filter((r) => r.module === '版本管理' && !r.live)

  it('含各版本的历史发布记录：动作均为「发布」，操作人是登录用户名，操作对象为「终端 + 版本号」', () => {
    expect(seeds().map((r) => r.target).sort()).toEqual(
      ['Mac v1.0.0', 'Mac v1.1.0', 'Windows v1.0.0', 'Windows v1.1.0', 'Windows v1.2.0']
    )
    for (const r of seeds()) {
      expect(r.action).toBe('发布')
      expect(r.operator).toMatch(/^[a-z]+(\.[a-z]+)?$/) // 用户名（zhang.wei / li.na），不是姓名
      expect(r.target).toMatch(/^(Windows|Mac) v\d+\.\d+\.\d+$/)
      expect(r.detail).toBeTruthy() // 发布记录的变更内容 = 更新说明
    }
  })

  it('操作对象名称里已含版本号，故记录本身不带 version 字段（页面不再附灰色版本号小标签）', () => {
    for (const r of seeds()) expect(r).not.toHaveProperty('version')
  })

  it('种子 id 与其它模块不冲突', () => {
    const ids = opsRecords.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('appendOpsRecord（运行期写入）', () => {
  it('新记录插在最前，id 从 100 起递增，时间精确到分钟，带 live 标记；返回副本', () => {
    const before = opsRecords.length
    const a = appendOpsRecord({ operator: 'xiaomei', module: '版本管理', action: '发布', target: 'Windows v1.3.0', detail: '更新说明' })
    const b = appendOpsRecord({ operator: 'xiaomei', module: '版本管理', action: '停用', target: 'Windows v1.3.0' })
    expect(opsRecords.length).toBe(before + 2)
    expect(opsRecords[0]).toMatchObject({ id: b.id, action: '停用', detail: '' }) // detail 缺省为空串
    expect(opsRecords[1]).toMatchObject({ id: a.id, operator: 'xiaomei', module: '版本管理', target: 'Windows v1.3.0', detail: '更新说明', live: true })
    expect(a.id).toBeGreaterThanOrEqual(100)
    expect(b.id).toBe(a.id + 1)
    expect(a.time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    a.detail = '被改了' // 返回的是副本，不影响库内数据
    expect(opsRecords[1].detail).toBe('更新说明')
  })

  it('resetAccessAuditMock 只清运行期新增记录，种子不动，id 计数回到 100', () => {
    const seedCount = opsRecords.filter((r) => !r.live).length
    appendOpsRecord({ operator: 'a', module: '版本管理', action: '发布', target: 'Mac v9.9.9' })
    resetAccessAuditMock()
    expect(opsRecords.some((r) => r.live)).toBe(false)
    expect(opsRecords.length).toBe(seedCount)
    expect(appendOpsRecord({ operator: 'a', module: '版本管理', action: '发布', target: 'x' }).id).toBe(100)
  })
})

describe('持久化（mockPersist v1，key iworker-demo-mock:accessAuditOps）', () => {
  const KEY = 'iworker-demo-mock:accessAuditOps'
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
  const snap = () => JSON.parse(globalThis.localStorage.getItem(KEY))

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), writable: true, configurable: true })
    vi.resetModules()
  })
  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true, configurable: true })
    vi.resetModules()
  })

  it('只落盘运行期新增记录（不含种子）；刷新（重新加载模块）后新增记录仍在最前，种子仍以代码为准', async () => {
    const m = await import('../accessAuditMock')
    const seedCount = m.opsRecords.length
    m.appendOpsRecord({ operator: 'xiaomei', module: '版本管理', action: '发布', target: 'Windows v1.3.0', detail: '说明' })
    expect(snap().v).toBe(1)
    expect(snap().data.live).toHaveLength(1)
    expect(Object.keys(snap().data).sort()).toEqual(['live', 'opsSeq'])

    vi.resetModules()
    const reloaded = await import('../accessAuditMock')
    expect(reloaded.opsRecords).toHaveLength(seedCount + 1)
    expect(reloaded.opsRecords[0]).toMatchObject({ operator: 'xiaomei', target: 'Windows v1.3.0', live: true })
    // 计数接着走，不与已有新增记录撞 id
    expect(reloaded.appendOpsRecord({ operator: 'a', module: '版本管理', action: '停用', target: 'x' }).id).toBe(101)
  })

  it('存量快照形状不合法 → 兜底：忽略坏快照、只剩种子，不抛错', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 1, data: { opsSeq: 100, live: 'oops' } }))
    const m = await import('../accessAuditMock')
    expect(m.opsRecords.some((r) => r.live)).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
