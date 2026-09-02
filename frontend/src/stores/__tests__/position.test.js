import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// mock api/position：store 测试只验证态机/树操作，不打真实后端
vi.mock('@/api/position', () => ({
  getPosition: vi.fn(),
  updatePosition: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
  createSkill: vi.fn(),
  updateSkill: vi.fn(),
  assignSkill: vi.fn(),
  getSkill: vi.fn(),
  deleteSkill: vi.fn(),
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

  it('removeAgent 删 Agent 后其技能彻底脱离白板（新口径：不再进收纳区/不在白板任何位置）', async () => {
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

  it('addSkill 挂到目标 Agent', async () => {
    api.getPosition.mockResolvedValue(sampleDetail())
    api.createSkill.mockResolvedValue({ skillId: 999, name: '新技能' })
    const store = usePositionStore()
    await store.load(5)
    await store.addSkill(12, { name: '新技能' })
    expect(store.agents.find((a) => a.agentId === 12).skills.map((s) => s.skillId)).toContain(999)
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

  it('收纳区退役：store 无 orphan 派生，allSkills 仅含挂载技能', async () => {
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

  it('saveBasic 的 PUT 详情 hydrate 后白板技能正常，不引入任何 orphan 幻影', async () => {
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

  it('removeSkill 从 Agent 泳道清除', async () => {
    api.getPosition.mockResolvedValue(sampleDetail())
    api.deleteSkill.mockResolvedValue(undefined)
    const store = usePositionStore()
    await store.load(5)
    await store.removeSkill(101)
    expect(store.allSkills.map((x) => x.skill.skillId)).not.toContain(101)
  })

  it('detachSkillFromAgent 从指定 Agent 移除引用 → 该泳道消失（V84 可逆：技能本体留库，白板本地移除）', async () => {
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

  it('reorderSkillsLocal 重排同泳道顺序', async () => {
    api.getPosition.mockResolvedValue(sampleDetail())
    const store = usePositionStore()
    await store.load(5)
    store.reorderSkillsLocal(11, [{ skillId: 102 }, { skillId: 101 }])
    expect(store.agents[0].skills.map((s) => s.skillId)).toEqual([102, 101])
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
