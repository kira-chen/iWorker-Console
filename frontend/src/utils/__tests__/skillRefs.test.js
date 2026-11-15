import { describe, it, expect } from 'vitest'
import { skillRefGroups, skillRefCount, skillRefSubjects, skillRefBlockMessage } from '../skillRefs'

/**
 * utils/skillRefs 单测（2026-11-10 专家按类型引用技能）。
 * 技能的引用分两组：岗位引用（positionRefNames，只有岗位私有技能会有）与专家引用（expertRefNames，三类技能都可能有）。
 * 技能列表「引用情况」、引用清单弹窗、停用 / 删除拦截文案都从这里取，页面与 mock 共用一套口径。
 * 三种样本：两组都有（岗位私有技能被岗位和专家同时引用）/ 只有一组 / 都没有。
 */

const BOTH = { positionRefNames: ['经营分析岗', '财务审核岗'], expertRefNames: ['经营数据核查专家'] }
const EXPERT_ONLY = { positionRefNames: [], expertRefNames: ['经营分析专家', '法务审阅专家'] }
const POSITION_ONLY = { positionRefNames: ['客户成功岗'], expertRefNames: [] }
const NONE = { positionRefNames: [], expertRefNames: [] }

describe('skillRefGroups：按引用方分组，只留有引用的组，岗位在前', () => {
  it('两组都有 → [岗位, 专家]', () => {
    expect(skillRefGroups(BOTH)).toEqual([
      { subject: '岗位', names: ['经营分析岗', '财务审核岗'] },
      { subject: '专家', names: ['经营数据核查专家'] }
    ])
  })

  it('只有一组 → 只返回那一组', () => {
    expect(skillRefGroups(EXPERT_ONLY)).toEqual([{ subject: '专家', names: ['经营分析专家', '法务审阅专家'] }])
    expect(skillRefGroups(POSITION_ONLY)).toEqual([{ subject: '岗位', names: ['客户成功岗'] }])
  })

  it('都没有 / 字段缺失或不是数组 / 入参为空 → []', () => {
    expect(skillRefGroups(NONE)).toEqual([])
    expect(skillRefGroups({ refCount: 3, refNames: ['旧字段残值'] })).toEqual([])
    expect(skillRefGroups({ positionRefNames: '经营分析岗', expertRefNames: null })).toEqual([])
    expect(skillRefGroups(null)).toEqual([])
    expect(skillRefGroups(undefined)).toEqual([])
  })
})

describe('skillRefCount：岗位引用数 + 专家引用数', () => {
  it('两组相加；单组即该组人数；无引用为 0', () => {
    expect(skillRefCount(BOTH)).toBe(3)
    expect(skillRefCount(EXPERT_ONLY)).toBe(2)
    expect(skillRefCount(POSITION_ONLY)).toBe(1)
    expect(skillRefCount(NONE)).toBe(0)
  })
})


describe('skillRefSubjects：停用弹窗「当前已被 N 个{引用方}引用」里的引用方', () => {
  it('两组都有 →「岗位 / 专家」；单组 → 那一方；无引用 → 空串', () => {
    expect(skillRefSubjects(BOTH)).toBe('岗位 / 专家')
    expect(skillRefSubjects(POSITION_ONLY)).toBe('岗位')
    expect(skillRefSubjects(EXPERT_ONLY)).toBe('专家')
    expect(skillRefSubjects(NONE)).toBe('')
  })
})

describe('skillRefBlockMessage：停用 / 删除被引用时的拦截文案', () => {
  it('两组都有 → 数量顿号相连、清单按组分号相隔，动作词照传入', () => {
    expect(skillRefBlockMessage(BOTH, '停用')).toBe(
      '该技能被 2 个岗位、1 个专家引用（经营分析岗、财务审核岗；经营数据核查专家），需先解除引用后再停用。'
    )
  })

  it('只有一组 → 只写那一组', () => {
    expect(skillRefBlockMessage(EXPERT_ONLY, '删除')).toBe('该技能被 2 个专家引用（经营分析专家、法务审阅专家），需先解除引用后再删除。')
    expect(skillRefBlockMessage(POSITION_ONLY, '停用')).toBe('该技能被 1 个岗位引用（客户成功岗），需先解除引用后再停用。')
  })

  it('无引用 → 空串（调用方据此判断不拦截）', () => {
    expect(skillRefBlockMessage(NONE, '停用')).toBe('')
  })
})
