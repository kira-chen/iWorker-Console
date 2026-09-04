// @vitest-environment jsdom
// （positionMock → request.js → router 链路触达 window，故用 jsdom；同 positionMock.test）
import { describe, it, expect, beforeEach } from 'vitest'
import {
  listPositions,
  createPosition,
  getPosition,
  updatePosition,
  createAgent,
  updateAgent,
  deleteAgent,
  assignSkill,
  detachSkill,
  publishPosition,
  __resetPositionMock
} from '../positionMock'
import { _getRaw, _reset } from '../unifiedSkillMock'

beforeEach(() => __resetPositionMock())

describe('positionMock · 工作台详情树（2026-09-02 补 mock）', () => {
  it('getPosition 返回岗位树：身份卡字段齐全 + agents[].skills[] 本体从 unifiedSkillMock 同源取', async () => {
    const d = await getPosition(401)
    expect(d.positionId).toBe(401)
    expect(d.name).toBe('经营分析岗')
    expect(d.status).toBe('published')
    expect(Array.isArray(d.claimDesc)).toBe(true)
    expect(d.recommendedQuestions).toHaveLength(4)
    expect(d.intakeSchema.length).toBeGreaterThan(0)
    // 同源联动：3 个 Agent、技能并集 1（与列表行 agentCount:3 / skillCount:1 一致）
    expect(d.agents).toHaveLength(3)
    const skills = d.agents.flatMap((a) => a.skills)
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({ skillId: 'sk_301', name: '日报周报生成' })
    // 类别派生：sk_301 未引用业务系统 → 查询类
    expect(skills[0].category).toBe('QUERY')
  })

  it('getPosition 岗位不存在 → 404', async () => {
    await expect(getPosition(999)).rejects.toThrow('岗位不存在')
  })

  it('updatePosition 保存身份卡并回详情树；重名被拦（field=name）', async () => {
    const d = await updatePosition(404, { name: '市场研究岗', persona: '爱查资料', description: '新描述' })
    expect(d.persona).toBe('爱查资料')
    expect(d.description).toBe('新描述')
    expect(d.warnings).toEqual([])
    // 列表行 description 同步（同一真相源）
    const row = (await listPositions({ keyword: '市场研究岗' })).list[0]
    expect(row.description).toBe('新描述')
    await expect(updatePosition(404, { name: '经营分析岗' })).rejects.toMatchObject({ field: 'name' })
  })

  it('推荐问题部分更新语义：payload 未含该字段 = 不改', async () => {
    const before = (await getPosition(401)).recommendedQuestions
    const after = (await updatePosition(401, { persona: 'x' })).recommendedQuestions
    expect(after).toEqual(before)
    const set = await updatePosition(401, { recommendedQuestions: ['a', 'b', 'c', 'd'] })
    expect(set.recommendedQuestions).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('positionMock · 人格新要素与业务系统引用（2026-09-04 PRD-20260903 对齐）', () => {
  it('详情树带新字段种子：认领说明 / 示例问题 3 条 / 岗位 SOP / businessSystemIds', async () => {
    const d = await getPosition(401)
    expect(d.claimDescriptions).toEqual(['自动汇总各业务线经营数据', '识别异常波动并分析原因', '生成周度经营分析报告'])
    expect(d.exampleQuestions).toHaveLength(3)
    expect(d.exampleQuestions.every((q) => q.trim())).toBe(true)
    expect(d.positionSop.startsWith('1. ')).toBe(true)
    expect(d.businessSystemIds).toEqual(['biz_2101'])
    // 空白岗位（市场研究岗）新字段为空态
    const empty = await getPosition(404)
    expect(empty.claimDescriptions).toEqual([])
    expect(empty.exampleQuestions).toEqual(['', '', ''])
    expect(empty.positionSop).toBe('')
    expect(empty.businessSystemIds).toEqual([])
  })

  it('updatePosition 部分更新新字段并回详情树；businessSystemIds 引用可写', async () => {
    const d = await updatePosition(404, {
      claimDescriptions: ['第一条说明'],
      exampleQuestions: ['q1', 'q2', 'q3'],
      positionSop: '1. 第一步。',
      businessSystemIds: ['biz_2101']
    })
    expect(d.claimDescriptions).toEqual(['第一条说明'])
    expect(d.exampleQuestions).toEqual(['q1', 'q2', 'q3'])
    expect(d.positionSop).toBe('1. 第一步。')
    expect(d.businessSystemIds).toEqual(['biz_2101'])
    // 未含字段 = 不改
    const after = await updatePosition(404, { persona: 'x' })
    expect(after.claimDescriptions).toEqual(['第一条说明'])
  })

  it('mock 校验：描述 >500 / 认领说明 >6 条或单条 >100 / 示例问题单条 >60 / SOP >4000 均被拦', async () => {
    await expect(updatePosition(404, { description: 'x'.repeat(501) })).rejects.toMatchObject({ field: 'description' })
    await expect(updatePosition(404, { claimDescriptions: Array.from({ length: 7 }, (_, i) => `条${i}`) })).rejects.toMatchObject({ field: 'claimDescriptions' })
    await expect(updatePosition(404, { claimDescriptions: ['y'.repeat(101)] })).rejects.toMatchObject({ field: 'claimDescriptions' })
    await expect(updatePosition(404, { exampleQuestions: ['z'.repeat(61), '', ''] })).rejects.toMatchObject({ field: 'exampleQuestions' })
    await expect(updatePosition(404, { positionSop: 's'.repeat(4001) })).rejects.toMatchObject({ field: 'positionSop' })
    // createPosition 同口径校验描述 500
    await expect(createPosition({ name: '超长描述岗', description: 'x'.repeat(501) })).rejects.toMatchObject({ field: 'description' })
  })
})

describe('positionMock · Agent CRUD 与列表计数同源联动', () => {
  it('createAgent 追加 Agent 并回写列表 agentCount；重名自动加序号', async () => {
    const a1 = await createAgent(404, { name: '新 Agent' })
    const a2 = await createAgent(404, { name: '新 Agent' })
    expect(a1.name).toBe('新 Agent')
    expect(a2.name).toBe('新 Agent 2')
    const row = (await listPositions({ keyword: '市场研究岗' })).list[0]
    expect(row.agentCount).toBe(2)
  })

  it('updateAgent 改名重名 1005；deleteAgent 回 orphanedSkillCount 并同步技能数', async () => {
    const d = await getPosition(401)
    const [withSkill, empty] = d.agents
    await expect(updateAgent(empty.agentId, { name: withSkill.name })).rejects.toMatchObject({ code: 1005 })
    const res = await deleteAgent(withSkill.agentId)
    expect(res.orphanedSkillCount).toBe(1)
    const row = (await listPositions({ keyword: '经营分析岗' })).list[0]
    expect(row.agentCount).toBe(2)
    expect(row.skillCount).toBe(0)
  })
})

describe('positionMock · 技能引用 assign/detach（与技能页 refNames 同源联动）', () => {
  it('assignSkill 拉入技能：列表技能数 +1，技能 refNames 追加岗位名；detach 反向摘除', async () => {
    const d = await getPosition(404)
    const agent = await createAgent(404, { name: '研究员' })
    expect(d.agents).toHaveLength(0)
    const vo = await assignSkill('sk_301', agent.agentId)
    expect(vo).toMatchObject({ skillId: 'sk_301', name: '日报周报生成' })
    let row = (await listPositions({ keyword: '市场研究岗' })).list[0]
    expect(row.skillCount).toBe(1)
    expect(_getRaw('sk_301').refNames).toContain('市场研究岗')
    await detachSkill(agent.agentId, 'sk_301')
    row = (await listPositions({ keyword: '市场研究岗' })).list[0]
    expect(row.skillCount).toBe(0)
    expect(_getRaw('sk_301').refNames).not.toContain('市场研究岗')
  })

  it('本岗位其它 Agent 已引用 → assign 视为跨泳道迁移；不存在的技能/Agent → 404', async () => {
    const d = await getPosition(401)
    const [a1, a2] = d.agents
    await assignSkill('sk_301', a2.agentId)
    const after = await getPosition(401)
    expect(after.agents.find((a) => a.agentId === a1.agentId).skills).toHaveLength(0)
    expect(after.agents.find((a) => a.agentId === a2.agentId).skills).toHaveLength(1)
    // 迁移不改并集计数
    const row = (await listPositions({ keyword: '经营分析岗' })).list[0]
    expect(row.skillCount).toBe(1)
    await expect(assignSkill('sk_nope', a2.agentId)).rejects.toThrow('技能不存在')
    await expect(assignSkill('sk_301', 88888)).rejects.toThrow('Agent 不存在')
  })
})

describe('positionMock · 新建岗位 → 工作台 / 发布链路', () => {
  it('createPosition 返回完整详情树，getPosition 立即可用（新建弹窗 → 跳工作台）', async () => {
    const created = await createPosition({ name: '售后支持岗', description: '售后答疑' })
    expect(created).toMatchObject({ name: '售后支持岗', status: 'draft', agents: [] })
    const d = await getPosition(created.positionId)
    expect(d.recommendedQuestions).toHaveLength(4)
    // 新岗位可直接建 Agent + 引用技能（全链路落内存）
    const agent = await createAgent(created.positionId, { name: '答疑' })
    await assignSkill('sk_301', agent.agentId)
    const row = (await listPositions({ keyword: '售后支持岗' })).list[0]
    expect(row).toMatchObject({ agentCount: 1, skillCount: 1 })
    // 清理 refNames（unifiedSkillMock 无全量 reset，避免污染同文件其它用例）
    _reset('sk_301', { refNames: _getRaw('sk_301').refNames.filter((n) => n !== '售后支持岗') })
  })

  it('publishPosition 显式 versionLabel（工作台 N5 链路）以之为准；列表 bump 口径不受影响', async () => {
    await publishPosition(402, { versionLabel: 'v002', releaseNotes: '工作台发布' })
    const row = (await listPositions({ keyword: '客户成功岗' })).list[0]
    expect(row.pendingAction).toBe('PUBLISH')
    expect(row.latestVersion).toBe('v002')
  })
})
