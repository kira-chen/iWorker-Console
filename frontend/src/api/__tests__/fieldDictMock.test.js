// @vitest-environment jsdom
// （fieldDictMock → request.js → router 链路触达 window，故用 jsdom）
// 注意：vitest 全局随机顺序执行——用例间不得有状态顺序依赖：
// 种子断言只查从不被本文件改写的字段；改写类用例基于当前态自洽断言。
import { describe, it, expect } from 'vitest'
import { listFieldDict, saveFieldOptions, getFieldOptionNames } from '../fieldDictMock'

describe('fieldDictMock —— 字段字典（2026-09-01 PRD 对齐轮：草稿整存模型）', () => {
  it('内置 4 字段权威默认选项（原型 fields 数据；只断言本文件不改写的字段）', async () => {
    const dict = await listFieldDict()
    expect(Object.keys(dict).sort()).toEqual(['expertCategory', 'riskLevel', 'riskType', 'skillCategory'])
    expect(dict.skillCategory.map((o) => o.name)).toEqual([
      '办公效率', '智能创作', '数据分析', '开发编程', 'IT运维与安全', '行业专业', '知识与学习', '其他'
    ])
    expect(dict.expertCategory.map((o) => o.name)).toEqual([
      '通用', '法律', '财税', '政务', '供应链', '投资', '审计', '知识产权'
    ])
  })

  it('整字段覆盖保存：同名保留原 id、新名分配新 id、删除的行不保留', async () => {
    const before = (await listFieldDict()).riskType
    const kept = before[0]
    const saved = await saveFieldOptions('riskType', [kept.name, `新风险-${Date.now()}`])
    expect(saved).toHaveLength(2)
    expect(saved[0]).toEqual({ id: kept.id, name: kept.name })
    expect(saved[1].id).not.toBe(kept.id)
    expect(getFieldOptionNames('riskType')).toEqual(saved.map((o) => o.name))
  })

  it('保存兜底校验：空值/重名/未知字段拒绝（不改动存量数据）', async () => {
    const before = getFieldOptionNames('riskLevel')
    await expect(saveFieldOptions('riskLevel', [...before, ' '])).rejects.toThrow('选项值不能为空')
    await expect(saveFieldOptions('riskLevel', [...before, before[0]])).rejects.toThrow('选项值不能重复')
    await expect(saveFieldOptions('nope', ['x'])).rejects.toThrow('字段不存在')
    expect(getFieldOptionNames('riskLevel')).toEqual(before)
  })
})
