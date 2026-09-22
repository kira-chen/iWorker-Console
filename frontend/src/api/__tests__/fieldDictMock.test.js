// @vitest-environment jsdom
// （fieldDictMock → request.js → router 链路触达 window，故用 jsdom）
// 注意：vitest 全局随机顺序执行——用例间不得有状态顺序依赖：
// 种子断言只查从不被本文件改写的字段；改写类用例基于当前态自洽断言。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { listFieldDict, saveFieldOptions, getFieldOptionNames } from '../fieldDictMock'

describe('fieldDictMock —— 字段字典（2026-09-01 PRD 对齐轮：草稿整存模型）', () => {
  it('内置 2 字段权威默认选项（2026-09-08 决议第 6 项：风险类型/风险等级两组已删，不再出现在字典中）', async () => {
    const dict = await listFieldDict()
    expect(Object.keys(dict).sort()).toEqual(['expertCategory', 'skillCategory'])
    expect(dict.riskType).toBeUndefined()
    expect(dict.riskLevel).toBeUndefined()
    expect(dict.skillCategory.map((o) => o.name)).toEqual([
      'AI Agent', 'IT 运维与安全', '办公效率', '行业专业', '教育学习', '开发编程', '内容创作', '商业运营', '设计多媒体', '数据分析', '知识管理'
    ])
    expect(dict.expertCategory.map((o) => o.name)).toEqual([
      '通用', '法律', '财税', '政务', '供应链', '投资', '审计', '知识产权'
    ])
  })

  // 下两例只改写 expertCategory 的「追加」部分且不动种子顺序前缀，与种子断言互不干扰。
  it('整字段覆盖保存：同名保留原 id、新名分配新 id、删除的行不保留', async () => {
    const before = (await listFieldDict()).expertCategory
    const kept = before[0]
    const saved = await saveFieldOptions('expertCategory', [kept.name, `新分类-${Date.now()}`])
    expect(saved).toHaveLength(2)
    expect(saved[0]).toEqual({ id: kept.id, name: kept.name })
    expect(saved[1].id).not.toBe(kept.id)
    expect(getFieldOptionNames('expertCategory')).toEqual(saved.map((o) => o.name))
    // 恢复种子，避免影响随机顺序下的其他用例
    await saveFieldOptions('expertCategory', before.map((o) => o.name))
  })

  it('保存兜底校验：空值/重名/未知字段拒绝（不改动存量数据）', async () => {
    const before = getFieldOptionNames('expertCategory')
    await expect(saveFieldOptions('expertCategory', [...before, ' '])).rejects.toThrow('选项值不能为空')
    await expect(saveFieldOptions('expertCategory', [...before, before[0]])).rejects.toThrow('选项值不能重复')
    await expect(saveFieldOptions('nope', ['x'])).rejects.toThrow('字段不存在')
    expect(getFieldOptionNames('expertCategory')).toEqual(before)
  })

  it('风险类型 / 风险等级已不属于字典：保存被拒绝为「字段不存在」', async () => {
    await expect(saveFieldOptions('riskType', ['x'])).rejects.toThrow('字段不存在')
    await expect(saveFieldOptions('riskLevel', ['x'])).rejects.toThrow('字段不存在')
    expect(getFieldOptionNames('riskType')).toEqual([])
  })
})

/* ---------------- F9：restore 形状守卫（fieldDictMock.js:37-39；mockPersist 兜底回种子；2026-09-12 测试审计） ---------------- */
describe('fieldDictMock · 持久化 restore 形状守卫', () => {
  // 本仓 jsdom 环境下 globalThis.localStorage 为 undefined（mockPersist 探测后走纯内存模式），
  // 与 positionMock.test 同款：注入内存版存储 + vi.resetModules + 动态 import 模拟「刷新后重新加载模块」。
  const KEY = 'iworker-demo-mock:fieldDict'
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

  it('存量快照版本对但缺字段键 / 值非数组 → 启动时抛「快照形状不合法」被兜底：两字段回 md §2.2 种子、坏 key 被清掉', async () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 3, data: { seq: 1, store: { skillCategory: 'not-an-array' } } }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fresh = await import('../fieldDictMock')
    const dict = await fresh.listFieldDict()
    expect(dict.skillCategory.map((o) => o.name)).toEqual(['AI Agent', 'IT 运维与安全', '办公效率', '行业专业', '教育学习', '开发编程', '内容创作', '商业运营', '设计多媒体', '数据分析', '知识管理'])
    expect(dict.expertCategory.map((o) => o.name)).toEqual(['通用', '法律', '财税', '政务', '供应链', '投资', '审计', '知识产权'])
    expect(globalThis.localStorage.getItem(KEY)).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('fieldDict 存量数据不可用'), expect.any(Error))
    warn.mockRestore()
  })
})
