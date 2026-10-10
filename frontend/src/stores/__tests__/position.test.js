import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// mock api/position：store 测试只验证态机/树操作，不打真实后端
vi.mock('@/api/position', () => ({
  getPosition: vi.fn(),
  updatePosition: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
  updateSkill: vi.fn(),
  assignSkill: vi.fn(),
  getSkill: vi.fn(),
  detachSkill: vi.fn()
}))

import * as api from '@/api/position'
import { usePositionStore } from '@/stores/position'

function sampleDetail() {
  return {
    positionId: 5,
    name: '销售',
    status: 'draft',
    intakeSchema: [],
    agents: [
      { agentId: 11, name: 'A', skills: [{ skillId: 101, name: 's1' }, { skillId: 102, name: 's2' }] },
      { agentId: 12, name: 'B', skills: [{ skillId: 201, name: 's3' }] }
    ]
  }
}

describe('position store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('load + hydrate 拆出 basic，派生 allSkills 扁平含归属', async () => {
    api.getPosition.mockResolvedValue(sampleDetail())
    const store = usePositionStore()
    await store.load(5)
    expect(store.basic.name).toBe('销售')
    expect(store.positionId).toBe(5)
    expect(store.allSkills.length).toBe(3)
    expect(store.allSkills[0]).toMatchObject({ agentId: 11, agentName: 'A' })
  })

  it('initNew 建空白草稿态', () => {
    const store = usePositionStore()
    store.initNew()
    expect(store.positionId).toBeNull()
    expect(store.agents).toEqual([])
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
  // 前 8 项（名称 / 图标 / 描述 / 领用页文案 / 示例问题 / SOP / 采集字段 / Agent 与技能）的输入由真实 store 的
  // checkInput 汇出；第 9 项「自动化任务」条数由详情页独立预取（不在 store），此处不涉及。
  it('checkInput 汇出发布检查所需输入：名称、图标、描述、领用页文案、示例问题、SOP、采集字段、Agent（含技能）', async () => {
    const intake = [{ label: '负责区域', key: 'region', type: 'text', required: true, options: [] }]
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
    const store = usePositionStore()
    await store.load(5)
    expect(store.checkInput).toEqual({
      name: '销售',
      icon: '▤',
      intro: '简介',
      description: '负责销售线索跟进',
      claimDescriptions: ['自动汇总经营数据'],
      positionSop: '1. 理解意图',
      intakeSchema: intake,
      exampleQuestions: ['q1', 'q2', 'q3'],
      agents: sampleDetail().agents
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

  it('详情缺领用页文案 / 示例问题 / 采集字段 → checkInput 给空数组与 3 个空格位（发布检查按「未填」判，不因 undefined 报错）', async () => {
    api.getPosition.mockResolvedValue({ positionId: 6, name: '空岗', status: 'draft', agents: [] })
    const store = usePositionStore()
    await store.load(6)
    expect(store.checkInput.claimDescriptions).toEqual([])
    expect(store.checkInput.exampleQuestions).toEqual(['', '', ''])
    expect(store.checkInput.intakeSchema).toEqual([])
    expect(store.checkInput.agents).toEqual([])
    expect(store.checkInput.icon).toBe('')
  })

  it('addAgent 追加到泳道', async () => {
    api.getPosition.mockResolvedValue(sampleDetail())
    api.createAgent.mockResolvedValue({ agentId: 13, name: '新 Agent', skills: [] })
    const store = usePositionStore()
    await store.load(5)
    await store.addAgent({ name: '新 Agent' })
    expect(store.agents.length).toBe(3)
    expect(store.agents[2].agentId).toBe(13)
  })

  it('removeAgent 删 Agent 后其技能子行一并移除（新口径：不转挂、不残留在任何 Agent 行下）', async () => {
    api.getPosition.mockResolvedValue(sampleDetail())
    api.deleteAgent.mockResolvedValue({ orphanedSkillCount: 2 })
    const store = usePositionStore()
    await store.load(5)
    const res = await store.removeAgent(11)
    // Agent 从白板移除
    expect(store.agents.find((a) => a.agentId === 11)).toBeUndefined()
    // 其技能（101/102）不再出现在白板任何泳道（收纳区已退役）
    expect(store.allSkills.map((x) => x.skill.skillId)).not.toContain(101)
    expect(store.allSkills.map((x) => x.skill.skillId)).not.toContain(102)
    // 后端回的 orphanedSkillCount 透传给组件做提示/跳转
    expect(res.orphanedSkillCount).toBe(2)
  })

  it('patchSkill 原地更新（无迁移）', async () => {
    api.getPosition.mockResolvedValue(sampleDetail())
    api.updateSkill.mockResolvedValue({ skillId: 101, name: 's1-改' })
    const store = usePositionStore()
    await store.load(5)
    await store.patchSkill(101, { name: 's1-改' })
    expect(store.agents[0].skills.find((s) => s.skillId === 101).name).toBe('s1-改')
  })

  it('assignSkillToAgent 跨 Agent 迁移走 assign 端点', async () => {
    api.getPosition.mockResolvedValue(sampleDetail())
    api.assignSkill.mockResolvedValue({ skillId: 101, name: 's1', agentId: 12 })
    const store = usePositionStore()
    await store.load(5)
    await store.assignSkillToAgent(101, 12)
    expect(api.assignSkill).toHaveBeenCalledWith(101, 12)
    expect(store.agents.find((a) => a.agentId === 11).skills.map((s) => s.skillId)).not.toContain(101)
    expect(store.agents.find((a) => a.agentId === 12).skills.map((s) => s.skillId)).toContain(101)
  })

  it('无游离技能：store 无 orphan 派生，allSkills 仅含挂在 Agent 行下的技能子行', async () => {
    api.getPosition.mockResolvedValue(sampleDetail())
    const store = usePositionStore()
    await store.load(5)
    // store 的 orphan 派生 + loadUnboundSkills 均已退役（getUnboundSkills 端点亦从 api 删除，store 不再 import）。
    expect(store.orphanSkills).toBeUndefined()
    expect(store.orphanLoading).toBeUndefined()
    expect(store.loadUnboundSkills).toBeUndefined()
    // allSkills 仅含挂在 Agent 下的技能（3 个），无未绑定项。
    expect(store.allSkills.length).toBe(3)
    expect(store.allSkills.every((x) => x.agentId != null)).toBe(true)
  })

  it('saveBasic 的 PUT 详情 hydrate 后 Agent 行 / 技能子行正常，不引入任何 orphan 幻影', async () => {
    api.getPosition.mockResolvedValue(sampleDetail())
    api.updatePosition.mockResolvedValue({ ...sampleDetail(), name: '销售-改' })
    const store = usePositionStore()
    await store.load(5)
    await store.saveBasic({ name: '销售-改' })
    expect(store.basic.name).toBe('销售-改')
    // 白板仍只含挂载技能（3 个），无 orphan 概念。
    expect(store.allSkills.length).toBe(3)
    expect(store.detail.orphanSkills).toBeUndefined()
  })

  it('patchSkill 不再做迁移（仅原地更新本体）', async () => {
    api.getPosition.mockResolvedValue(sampleDetail())
    api.updateSkill.mockResolvedValue({ skillId: 101, name: 's1-改' })
    const store = usePositionStore()
    await store.load(5)
    await store.patchSkill(101, { name: 's1-改' })
    expect(api.updateSkill).toHaveBeenCalledWith(101, { name: 's1-改' })
    expect(store.agents[0].skills.find((s) => s.skillId === 101).name).toBe('s1-改')
  })

  it('detachSkillFromAgent 从指定 Agent 移除引用 → 该 Agent 行下的技能子行消失（V84 可逆：技能本体留库，仅本地移除）', async () => {
    api.getPosition.mockResolvedValue(sampleDetail())
    api.detachSkill.mockResolvedValue(undefined)
    const store = usePositionStore()
    await store.load(5)
    await store.detachSkillFromAgent(11, 101)
    expect(api.detachSkill).toHaveBeenCalledWith(11, 101)
    // 原 Agent 泳道不再有它
    expect(store.agents.find((a) => a.agentId === 11).skills.map((s) => s.skillId)).toEqual([102])
    // 白板本地移除：技能从白板消失（去向是技能页，本体留库可再引用）
    expect(store.allSkills.map((x) => x.skill.skillId)).not.toContain(101)
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
