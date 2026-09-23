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

})

describe('positionMock · 人格新要素与业务系统引用（2026-09-04 PRD-20260903 对齐）', () => {
  it('详情树带新字段种子：领用页文案（claimDescriptions）/ 示例问题 3 条 / 岗位 SOP / businessSystemIds', async () => {
    const d = await getPosition(401)
    expect(d.claimDescriptions).toEqual(['自动汇总各业务线经营数据', '识别异常波动并分析原因', '生成周度经营分析报告'])
    expect(d.exampleQuestions).toHaveLength(3)
    expect(d.exampleQuestions.every((q) => q.trim())).toBe(true)
    expect(d.positionSop.startsWith('1. ')).toBe(true)
    expect(d.businessSystemIds).toEqual(['biz_2101'])
    // 空态样本改用「新建岗位」：种子 404 市场研究岗已于 2026-09-09 补全为六项齐备，
    // 全套种子里不再有空白岗位；新建态才是这些字段真正的空态来源。
    const empty = await createPosition({ name: `空白岗_${Date.now()}`, description: '空态验证' })
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

  it('mock 校验：描述 >2000（2026-09-20 待办 yuepu#8，原 500 与 UI/一览表不同源）/ 领用页文案 >6 条或单条 >300（同上，原 100）/ 示例问题单条 >300（2026-09-18 待办 yuepu#5⑥，原 60）/ SOP >4000 均被拦', async () => {
    // 描述 2000 以内放行、2001 拦（人格页 DESCRIPTION_MAX_LEN / 新建弹窗同口径）
    await expect(updatePosition(404, { description: 'x'.repeat(2000) })).resolves.toBeTruthy()
    await expect(updatePosition(404, { description: 'x'.repeat(2001) })).rejects.toMatchObject({ field: 'description' })
    await expect(updatePosition(404, { claimDescriptions: Array.from({ length: 7 }, (_, i) => `条${i}`) })).rejects.toMatchObject({ field: 'claimDescriptions' })
    // 领用页文案 300 放行 / 301 拦（CLAIM_NOTE_LEN 同口径）
    await expect(updatePosition(404, { claimDescriptions: ['y'.repeat(300)] })).resolves.toBeTruthy()
    await expect(updatePosition(404, { claimDescriptions: ['y'.repeat(301)] })).rejects.toMatchObject({ field: 'claimDescriptions' })
    await expect(updatePosition(404, { exampleQuestions: ['z'.repeat(301), '', ''] })).rejects.toMatchObject({ field: 'exampleQuestions' })
    await expect(updatePosition(404, { positionSop: 's'.repeat(4001) })).rejects.toMatchObject({ field: 'positionSop' })
    // createPosition 同口径校验描述 2000（一览表 L14）：2000 放行 / 2001 拦
    await expect(createPosition({ name: '描述恰 2000 岗', description: 'x'.repeat(2000) })).resolves.toMatchObject({ name: '描述恰 2000 岗' })
    await expect(createPosition({ name: '超长描述岗', description: 'x'.repeat(2001) })).rejects.toMatchObject({ field: 'description' })
  })
})

describe('positionMock · Agent CRUD 与列表计数同源联动', () => {
  it('createAgent 追加 Agent 并回写列表 agentCount；重名自动加序号', async () => {
    const a1 = await createAgent(404, { name: '新 Agent' })
    const a2 = await createAgent(404, { name: '新 Agent' })
    expect(a1.name).toBe('新 Agent')
    expect(a2.name).toBe('新 Agent 2')
    const row = (await listPositions({ keyword: '市场研究岗' })).list[0]
    // 3 = 种子 1 个（竞品跟踪，2026-09-09 补全）+ 本用例新建 2 个
    expect(row.agentCount).toBe(3)
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
    // 404 种子自 2026-09-09 起有 1 个 Agent（竞品跟踪）+ 1 个技能（sk_307），故基线为 1 而非 0
    const d = await getPosition(404)
    expect(d.agents).toHaveLength(1)
    const agent = await createAgent(404, { name: '研究员' })
    const vo = await assignSkill('sk_301', agent.agentId)
    expect(vo).toMatchObject({ skillId: 'sk_301', name: '日报周报生成' })
    let row = (await listPositions({ keyword: '市场研究岗' })).list[0]
    expect(row.skillCount).toBe(2) // sk_307（种子）+ sk_301（本用例）
    expect(_getRaw('sk_301').refNames).toContain('市场研究岗')
    await detachSkill(agent.agentId, 'sk_301')
    row = (await listPositions({ keyword: '市场研究岗' })).list[0]
    expect(row.skillCount).toBe(1) // 摘除 sk_301 后只剩种子的 sk_307
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
  it('新建岗位不预置默认图标（2026-09-21 负责人拍板岗位图标必填：须由配置者在人格页签自行选择）；显式传入则原样保留', async () => {
    const bare = await createPosition({ name: '无图标岗_A', description: '图标必填验证' })
    expect(bare.icon).toBe('')
    expect((await getPosition(bare.positionId)).icon).toBe('')
    const withIcon = await createPosition({ name: '有图标岗_B', description: '图标必填验证', icon: '◈' })
    expect(withIcon.icon).toBe('◈')
  })

  it('createPosition 返回完整详情树，getPosition 立即可用（新建弹窗 → 跳工作台）', async () => {
    const created = await createPosition({ name: '售后支持岗', description: '售后答疑' })
    expect(created).toMatchObject({ name: '售后支持岗', status: 'draft', agents: [] })
    const d = await getPosition(created.positionId)
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
    // 显式 versionLabel 走 pendingVersion；latestVersion 不动（md §二.1 不展示待审核版本号）
    expect(row.pendingVersion).toBe('v002')
    expect(row.latestVersion).toBe('v1.4.0')
  })
})
