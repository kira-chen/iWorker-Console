import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// mock api/position：store 测试只验证态机 / 引用增删，不打真实后端。
// 2026-11-12 产品优化需求-202611 修改点 1（R1）：取消 Agent，岗位直接引用技能（detail.skills[]），
// 技能引用走 attachPositionSkill / detachPositionSkill；修改点 2（R13）：专家与专家团引用走 getPositionExperts 单独加载。
vi.mock('@/api/position', () => ({
  getPosition: vi.fn(),
  updatePosition: vi.fn(),
  updateSkill: vi.fn(),
  attachPositionSkill: vi.fn(),
  detachPositionSkill: vi.fn(),
  getSkill: vi.fn(),
  getPositionExperts: vi.fn(),
  bindPositionExpert: vi.fn(),
  unbindPositionExpert: vi.fn(),
  bindPositionTeam: vi.fn(),
  unbindPositionTeam: vi.fn()
}))

import * as api from '@/api/position'
import { usePositionStore } from '@/stores/position'

function sampleDetail() {
  return {
    positionId: 5,
    name: '销售',
    status: 'draft',
    intakeSchema: [],
    skills: [
      { skillId: 101, name: 's1' },
      { skillId: 102, name: 's2' },
      { skillId: 201, name: 's3' }
    ]
  }
}

describe('position store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('load + hydrate 拆出 basic；skills 即岗位直接引用的技能，按详情顺序（产品优化需求-202611 修改点 1：单层表格，一行一个技能）', async () => {
    api.getPosition.mockResolvedValue(sampleDetail())
    const store = usePositionStore()
    await store.load(5)
    expect(store.basic.name).toBe('销售')
    expect(store.positionId).toBe(5)
    expect(store.skills.map((s) => s.skillId)).toEqual([101, 102, 201])
  })

  it('initNew 建空白草稿态', () => {
    const store = usePositionStore()
    store.initNew()
    expect(store.positionId).toBeNull()
    expect(store.skills).toEqual([])
    expect(store.basic.name).toBe('')
    // 连接器页签的三个引用清单都从空数组起步（待办 yuepu#42：此前只有 businessSystemIds，另两个恒 undefined）
    expect(store.basic.businessSystemIds).toEqual([])
    expect(store.basic.connectorMcpIds).toEqual([])
    expect(store.basic.connectorApiIds).toEqual([])
  })

  it('hydrate 把详情里的 connectorMcpIds / connectorApiIds 灌进 basic；缺键或非数组兜底为空数组（待办 yuepu#42）', async () => {
    const store = usePositionStore()
    api.getPosition.mockResolvedValue({
      ...sampleDetail(),
      businessSystemIds: ['biz_2101'],
      connectorMcpIds: ['expense_mcp'],
      connectorApiIds: ['api_1101']
    })
    await store.load(5)
    expect(store.basic.connectorMcpIds).toEqual(['expense_mcp'])
    expect(store.basic.connectorApiIds).toEqual(['api_1101'])
    expect(store.basic.businessSystemIds).toEqual(['biz_2101'])

    api.getPosition.mockResolvedValue({ ...sampleDetail(), connectorMcpIds: 'oops', connectorApiIds: null })
    await store.load(5)
    expect(store.basic.connectorMcpIds).toEqual([])
    expect(store.basic.connectorApiIds).toEqual([])
  })

  // 2026-10-08 对齐 docs/PRD/数字员工管理端PRD/02岗位/岗位/prd.岗位.md §9.1 阻断校验九项：
  // 前 8 项（名称 / 图标 / 描述 / 领用页文案 / 示例问题 / SOP / 采集字段 / 技能）的输入由真实 store 的
  // checkInput 汇出；第 9 项「自动化任务」条数由详情页独立预取（不在 store），此处不涉及。
  // 产品优化需求-202611 修改点 2：引用的专家 / 专家团不可用（未发布、停用、回收、缺员、成员没加入本岗位）与
  // 自动化任务执行对象不可用进发布前检查的动态阻断项，所以 checkInput 同时带上 experts / teams / execTargetIssues。
  it('checkInput 汇出发布检查所需输入：名称、图标、描述、领用页文案、示例问题、SOP、采集字段、技能，以及专家与专家团引用', async () => {
    const intake = [{ label: '负责区域', key: 'region', type: 'text', required: true, options: [] }]
    const refs = {
      experts: [{ expertId: 203, name: '法务审阅专家', unavailable: '未发布' }],
      teams: [{ teamId: 304, name: '经营复盘团', unavailable: '', missingCount: 0, unboundMembers: [] }],
      execTargetIssues: [{ taskName: '周度复盘', targetName: '已删除的专家团' }]
    }
    api.getPosition.mockResolvedValue({
      ...sampleDetail(),
      icon: '▤',
      intro: '简介',
      description: '负责销售线索跟进',
      claimDescriptions: ['自动汇总经营数据'],
      exampleQuestions: ['q1', 'q2', 'q3'],
      positionSop: '1. 理解意图',
      intakeSchema: intake
    })
    api.getPositionExperts.mockResolvedValue(refs)
    const store = usePositionStore()
    await store.load(5)
    expect(api.getPositionExperts).toHaveBeenCalledWith(5)
    expect(store.checkInput).toEqual({
      name: '销售',
      icon: '▤',
      intro: '简介',
      description: '负责销售线索跟进',
      claimDescriptions: ['自动汇总经营数据'],
      positionSop: '1. 理解意图',
      intakeSchema: intake,
      exampleQuestions: ['q1', 'q2', 'q3'],
      skills: sampleDetail().skills,
      experts: refs.experts,
      teams: refs.teams,
      execTargetIssues: refs.execTargetIssues
    })
  })

  it('checkInput 随编辑实时变化：改名称、清空第 2 条示例问题后立刻反映（发布检查读到的是当前编辑值）', async () => {
    api.getPosition.mockResolvedValue({ ...sampleDetail(), exampleQuestions: ['q1', 'q2', 'q3'] })
    const store = usePositionStore()
    await store.load(5)
    store.basic.name = '销售二部'
    store.basic.exampleQuestions[1] = ''
    expect(store.checkInput.name).toBe('销售二部')
    expect(store.checkInput.exampleQuestions).toEqual(['q1', '', 'q3'])
  })

  it('详情缺领用页文案 / 示例问题 / 采集字段 / 技能 → checkInput 给空数组与 3 个空格位（发布检查按「未填」判，不因 undefined 报错）', async () => {
    api.getPosition.mockResolvedValue({ positionId: 6, name: '空岗', status: 'draft' })
    const store = usePositionStore()
    await store.load(6)
    expect(store.checkInput.claimDescriptions).toEqual([])
    expect(store.checkInput.exampleQuestions).toEqual(['', '', ''])
    expect(store.checkInput.intakeSchema).toEqual([])
    expect(store.checkInput.skills).toEqual([])
    expect(store.checkInput.icon).toBe('')
  })

  it('patchSkill 走 updateSkill，回显原地合并进岗位技能行（技能【编辑】返回后行内名称即时刷新，其余行不动）', async () => {
    api.getPosition.mockResolvedValue(sampleDetail())
    api.updateSkill.mockResolvedValue({ skillId: 101, name: 's1-改' })
    const store = usePositionStore()
    await store.load(5)
    await store.patchSkill(101, { name: 's1-改' })
    expect(api.updateSkill).toHaveBeenCalledWith(101, { name: 's1-改' })
    expect(store.skills.map((s) => [s.skillId, s.name])).toEqual([[101, 's1-改'], [102, 's2'], [201, 's3']])
  })

  it('attachSkill 走 attachPositionSkill(岗位 id, 技能 id)，引用成功后追加到岗位技能列表末尾（产品优化需求-202611 修改点 1「添加技能」）', async () => {
    api.getPosition.mockResolvedValue(sampleDetail())
    api.attachPositionSkill.mockResolvedValue({ skillId: 301, name: 's4' })
    const store = usePositionStore()
    await store.load(5)
    await store.attachSkill(301)
    expect(api.attachPositionSkill).toHaveBeenCalledWith(5, 301)
    expect(store.skills.map((s) => s.skillId)).toEqual([101, 102, 201, 301])
  })

  it('saveBasic 用 PUT 回的详情 hydrate：basic 更新为新值，技能列表随详情一并刷新、不丢', async () => {
    api.getPosition.mockResolvedValue(sampleDetail())
    api.updatePosition.mockResolvedValue({ ...sampleDetail(), name: '销售-改' })
    const store = usePositionStore()
    await store.load(5)
    await store.saveBasic({ name: '销售-改' })
    expect(api.updatePosition).toHaveBeenCalledWith(5, { name: '销售-改' })
    expect(store.basic.name).toBe('销售-改')
    expect(store.skills.map((s) => s.skillId)).toEqual([101, 102, 201])
  })

  it('detachSkill 走 detachPositionSkill(岗位 id, 技能 id)，成功后该技能从岗位技能列表消失（修改点 1【移除】：仅解除与岗位的关联，技能本体留库）', async () => {
    api.getPosition.mockResolvedValue(sampleDetail())
    api.detachPositionSkill.mockResolvedValue({})
    const store = usePositionStore()
    await store.load(5)
    await store.detachSkill(101)
    expect(api.detachPositionSkill).toHaveBeenCalledWith(5, 101)
    expect(store.skills.map((s) => s.skillId)).toEqual([102, 201])
  })

  /* ============== silent 静默刷新（window-focus refetch 闪烁修复） ============== */
  it('load(id,{silent:true}) 全程不切 loading（避免回切标签整页闪骨架）', async () => {
    // 用可控延迟 promise 卡住 getPosition，await 期间检查 loading 始终为 false。
    let resolveGet
    api.getPosition.mockReturnValue(new Promise((r) => { resolveGet = r }))
    const store = usePositionStore()
    expect(store.loading).toBe(false)
    const p = store.load(5, { silent: true })
    // 请求进行中：silent 模式不应把 loading 置 true
    expect(store.loading).toBe(false)
    resolveGet(sampleDetail())
    await p
    // 完成后仍为 false，且数据已 hydrate
    expect(store.loading).toBe(false)
    expect(store.basic.name).toBe('销售')
  })

  it('非 silent load 全程会切 loading（对照组）', async () => {
    let resolveGet
    api.getPosition.mockReturnValue(new Promise((r) => { resolveGet = r }))
    const store = usePositionStore()
    const p = store.load(5)
    expect(store.loading).toBe(true) // 进行中置 true（显骨架）
    resolveGet(sampleDetail())
    await p
    expect(store.loading).toBe(false) // 完成复位
  })

  it('silent load 失败：保留旧 detail，不置 error、不抛', async () => {
    // 先正常 load 拿到旧详情
    api.getPosition.mockResolvedValueOnce(sampleDetail())
    const store = usePositionStore()
    await store.load(5)
    const oldName = store.basic.name
    expect(oldName).toBe('销售')

    // 再 silent load 失败：不抛、不置 error、旧 detail/basic 保留
    api.getPosition.mockRejectedValueOnce(new Error('network boom'))
    await expect(store.load(5, { silent: true })).resolves.toBeUndefined()
    expect(store.error).toBe('')
    expect(store.detail).not.toBeNull()
    expect(store.basic.name).toBe(oldName)
    expect(store.loading).toBe(false)
  })

  it('非 silent load 失败：置 error 并抛（对照组，保留原行为）', async () => {
    api.getPosition.mockRejectedValueOnce(new Error('network boom'))
    const store = usePositionStore()
    await expect(store.load(5)).rejects.toThrow('network boom')
    expect(store.error).toBe('network boom')
    expect(store.loading).toBe(false)
  })
})
