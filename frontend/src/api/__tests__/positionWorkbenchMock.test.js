// @vitest-environment jsdom
// （positionMock → request.js → router 链路触达 window，故用 jsdom；同 positionMock.test）
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
import { _getRaw, _reset, createSkill, removeSkill, forceRevokeSkill, listUnifiedSkills } from '../unifiedSkillMock'
import { listMcpSync, listMcp, forceRevokeMcpService, __resetMcpMock } from '../mcpConnectorMock'
import { revokedConnectorNames } from '../positionRevokedRefs'
import { listApisSync, listApis, forceRevokeApi, __resetApiMock } from '../apiConnectorMock'
import { listBizSystemsSync, listBizSystems, forceRevokeBizSystem, __resetBizSystemMock } from '../bizSystemMock'
import { resetAccessAuditMock } from '../accessAuditMock'

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
    // md §8.1 L506 / §8.2 L524：连接器页签「岗位私有 MCP / API」引用清单；401 种子绑了报销系统 MCP + 报销单查询 API
    // （2026-09-28 待办 yuepu#42：此前种子未绑定，连接器页签两个区域即便修好 store 也全空、演示不出绑定态）
    expect(d.connectorMcpIds).toEqual(['expense_mcp'])
    expect(d.connectorApiIds).toEqual(['api_1101'])
    // 空态样本改用「新建岗位」：种子 404 市场研究岗已于 2026-09-09 补全为六项齐备，
    // 全套种子里不再有空白岗位；新建态才是这些字段真正的空态来源。
    const empty = await createPosition({ name: `空白岗_${Date.now()}`, description: '空态验证' })
    expect(empty.claimDescriptions).toEqual([])
    expect(empty.exampleQuestions).toEqual(['', '', ''])
    expect(empty.positionSop).toBe('')
    expect(empty.businessSystemIds).toEqual([])
    expect(empty.connectorMcpIds).toEqual([])
    expect(empty.connectorApiIds).toEqual([])
  })

  it('私有连接器双向同源：连接器侧 referencedByPositions 里的每个岗位，其详情的 connectorMcpIds / connectorApiIds / businessSystemIds 都必须含该连接器（待办 yuepu#42）', async () => {
    const pairs = [
      [listMcpSync(), 'connectorMcpIds'],
      [listApisSync(), 'connectorApiIds'],
      [listBizSystemsSync(), 'businessSystemIds']
    ]
    let checked = 0
    for (const [rows, key] of pairs) {
      for (const r of rows) {
        for (const ref of r.referencedByPositions || []) {
          const d = await getPosition(ref.positionId)
          expect(d[key], `${r.id} 被岗位 ${ref.positionId} 引用，但该岗位详情 ${key} 缺它`).toContain(r.id)
          checked += 1
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(7) // 401：1+1+1；402：2+2+1
    // 反向：岗位详情里列出的连接器，连接器侧也必须回引该岗位
    for (const pid of [401, 402, 403, 404]) {
      const d = await getPosition(pid)
      for (const id of d.connectorMcpIds) {
        expect(listMcpSync().find((m) => m.id === id).referencedByPositions.map((p) => p.positionId)).toContain(pid)
      }
      for (const id of d.connectorApiIds) {
        expect(listApisSync().find((m) => m.id === id).referencedByPositions.map((p) => p.positionId)).toContain(pid)
      }
    }
  })

  it('连接器页签绑定弹窗的候选条件 { type: POSITION, state: PUBLISHED } 在三个连接器 mock 上都生效：只剩岗位私有且已发布的（md 岗位 §8.1–§8.3；待办 yuepu#24③）', async () => {
    const cond = { type: 'POSITION', state: 'PUBLISHED' }
    const mcps = (await listMcp(cond)).list
    const apis = (await listApis(cond)).list
    const bizs = (await listBizSystems(cond)).list
    // 种子里：私有 MCP 只有 expense_mcp 已发布（mail_center 未发布、crm 审核中）；私有 API 与业务系统各有已发布行
    expect(mcps.map((m) => m.id)).toEqual(['expense_mcp'])
    expect(apis.length).toBeGreaterThan(0)
    expect(bizs.map((b) => b.id)).toContain('biz_2101')
    for (const r of [...mcps, ...apis, ...bizs]) expect(r.type).toBe('POSITION')
  })

  it('updatePosition 部分更新新字段并回详情树；businessSystemIds/connectorMcpIds/connectorApiIds 引用可写', async () => {
    const d = await updatePosition(404, {
      claimDescriptions: ['第一条说明'],
      exampleQuestions: ['q1', 'q2', 'q3'],
      positionSop: '1. 第一步。',
      businessSystemIds: ['biz_2101'],
      connectorMcpIds: ['knowledge_hub'],
      connectorApiIds: ['api_1101']
    })
    expect(d.claimDescriptions).toEqual(['第一条说明'])
    expect(d.exampleQuestions).toEqual(['q1', 'q2', 'q3'])
    expect(d.positionSop).toBe('1. 第一步。')
    expect(d.businessSystemIds).toEqual(['biz_2101'])
    expect(d.connectorMcpIds).toEqual(['knowledge_hub'])
    expect(d.connectorApiIds).toEqual(['api_1101'])
    // 2026-09-23 待办 yuepu#7①④：此前只写 Pinia store 未上送 payload，保存后刷新即丢——
    // 验证 getPosition 重新拉取后仍在（真正的持久化回归，不只是 updatePosition 出参回显）
    const reloaded = await getPosition(404)
    expect(reloaded.connectorMcpIds).toEqual(['knowledge_hub'])
    expect(reloaded.connectorApiIds).toEqual(['api_1101'])
    // 未含字段 = 不改
    const after = await updatePosition(404, { persona: 'x' })
    expect(after.claimDescriptions).toEqual(['第一条说明'])
    expect(after.connectorMcpIds).toEqual(['knowledge_hub'])
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
  it('createAgent 追加 Agent 并回写列表 agentCount；重名拒绝 1005（2026-09-18 待办 yuepu#13·岗位 P4：新建与编辑共用同一抽屉表单，均需显式填名，不再静默加序号——此前与 updateAgent 的重名报错口径矛盾）', async () => {
    const a1 = await createAgent(404, { name: '新 Agent', description: '职责描述' })
    expect(a1.name).toBe('新 Agent')
    await expect(createAgent(404, { name: '新 Agent', description: '职责描述' })).rejects.toMatchObject({ field: 'name', message: 'Agent 名已存在' })
    const row = (await listPositions({ keyword: '市场研究岗' })).list[0]
    // 2 = 种子 1 个（研究纪要整理，2026-09-09 补全）+ 本用例新建 1 个（重名那次被拒，不计入）
    expect(row.agentCount).toBe(2)
  })

  it('createAgent / updateAgent 必填与长度（md §6.2 + 一览表 #5.1 / #5.2：名称必填 ≤64、职责描述必填 ≤2000；yuepu#61①）', async () => {
    await expect(createAgent(404, { description: '有职责' })).rejects.toMatchObject({ field: 'name', message: '请填写 Agent 名称' })
    await expect(createAgent(404, { name: '   ', description: '有职责' })).rejects.toMatchObject({ field: 'name' })
    await expect(createAgent(404, { name: '有名称' })).rejects.toMatchObject({ field: 'description', message: '请填写职责描述' })
    await expect(createAgent(404, { name: 'n'.repeat(65), description: 'd' })).rejects.toMatchObject({ field: 'name' })
    await expect(createAgent(404, { name: '职责超长', description: 'd'.repeat(2001) })).rejects.toMatchObject({ field: 'description' })
    // 边界放行：名称 64、职责 2000
    const ok = await createAgent(404, { name: 'n'.repeat(64), description: 'd'.repeat(2000) })
    expect(ok.description).toHaveLength(2000)
    // 编辑态同口径
    await expect(updateAgent(ok.agentId, { description: '  ' })).rejects.toMatchObject({ field: 'description' })
    await expect(updateAgent(ok.agentId, { description: 'd'.repeat(2001) })).rejects.toMatchObject({ field: 'description' })
    await expect(updateAgent(ok.agentId, { name: 'n'.repeat(65) })).rejects.toMatchObject({ field: 'name' })
    const row = (await listPositions({ keyword: '市场研究岗' })).list[0]
    expect(row.agentCount).toBe(2) // 种子 1 + 边界那条；被拒的都没落库
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

  it('deleteAgent 级联清空自动化任务的 execAgentId，不留悬空裸 id（md §7.6，2026-09-23 待办 yuepu#9⑦）', async () => {
    const sampleTaskMock = await import('../sampleTaskMock')
    sampleTaskMock.__resetSampleTaskMock()
    const d = await getPosition(401)
    const agent = d.agents[0]
    const created = await sampleTaskMock.createSampleTask(401, {
      name: '待测任务', execType: 'AGENT', execAgentId: agent.agentId, sopDoc: '执行步骤说明'
    })
    expect(created.execAgentId).toBe(agent.agentId)
    await deleteAgent(agent.agentId)
    const after = await sampleTaskMock.getSampleTask(401, created.id)
    expect(after.execAgentId).toBeNull()
  })
})

describe('positionMock · 技能引用 assign/detach（与技能页 refNames 同源联动）', () => {
  it('assignSkill 拉入技能：列表技能数 +1，技能 refNames 追加岗位名；detach 反向摘除', async () => {
    // 404 种子自 2026-09-09 起有 1 个 Agent（研究纪要整理）+ 1 个技能（sk_305，故基线为 1 而非 0；
    // 2026-09-23 待办 yuepu#9⑤：原引用 sk_303 违反 md §6.4 岗位私有类型限制，改引 sk_305）
    const d = await getPosition(404)
    expect(d.agents).toHaveLength(1)
    const agent = await createAgent(404, { name: '研究员', description: '职责描述' })
    const vo = await assignSkill('sk_301', agent.agentId)
    expect(vo).toMatchObject({ skillId: 'sk_301', name: '日报周报生成' })
    let row = (await listPositions({ keyword: '市场研究岗' })).list[0]
    expect(row.skillCount).toBe(2) // sk_305（种子）+ sk_301（本用例）
    expect(_getRaw('sk_301').refNames).toContain('市场研究岗')
    await detachSkill(agent.agentId, 'sk_301')
    row = (await listPositions({ keyword: '市场研究岗' })).list[0]
    expect(row.skillCount).toBe(1) // 摘除 sk_301 后只剩种子的 sk_305
    expect(_getRaw('sk_301').refNames).not.toContain('市场研究岗')
  })

  it('assignSkill 拒绝非岗位私有类型技能（md §6.4，2026-09-23 待办 yuepu#9⑤）', async () => {
    const agent = await createAgent(404, { name: '研究员', description: '职责描述' })
    // sk_303 通用（SYSTEM_DEFAULT）、sk_302 市场技能（PLATFORM）均应被拒绝
    await expect(assignSkill('sk_303', agent.agentId)).rejects.toThrow('岗位私有')
    await expect(assignSkill('sk_302', agent.agentId)).rejects.toThrow('岗位私有')
    const after = await getPosition(404)
    expect(after.agents.find((a) => a.agentId === agent.agentId).skills).toHaveLength(0)
  })

  it('技能被删除后悬空引用不计入 skillCount，展示仍保留占位提示管理员清理（md §9.1 第 8 条，yuepu#9⑤）', async () => {
    const empty = await createPosition({ name: `悬空引用岗_${Date.now()}` })
    const agent = await createAgent(empty.positionId, { name: '研究员', description: '职责描述' })
    const { skillId } = await createSkill({ name: `待删技能_${Date.now()}`, type: 'POSITION', categoryName: '办公效率' })
    await assignSkill(skillId, agent.agentId)
    let row = (await listPositions({ keyword: empty.name })).list[0]
    expect(row.skillCount).toBe(1)
    // 悬空引用要模拟的是「技能本体没了、岗位侧引用还留着」——不能走 detachSkill（那会同步摘掉引用）；
    // 直接摆脱技能模块自己的引用保护（_reset 清 refNames，同单测惯用法）后再删
    _reset(skillId, { refNames: [] })
    await removeSkill(skillId)
    row = (await listPositions({ keyword: empty.name })).list[0]
    expect(row.skillCount).toBe(0) // 悬空引用不计数
    const detail = await getPosition(empty.positionId)
    const skillVo = detail.agents.find((a) => a.agentId === agent.agentId).skills[0]
    expect(skillVo).toMatchObject({ name: '（技能已删除）', deleted: true }) // 展示仍保留占位，提示管理员清理
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
    const agent = await createAgent(created.positionId, { name: '答疑', description: '职责描述' })
    await assignSkill('sk_301', agent.agentId)
    const row = (await listPositions({ keyword: '售后支持岗' })).list[0]
    expect(row).toMatchObject({ agentCount: 1, skillCount: 1 })
    // 清理 refNames（unifiedSkillMock 无全量 reset，避免污染同文件其它用例）
    _reset('sk_301', { refNames: _getRaw('sk_301').refNames.filter((n) => n !== '售后支持岗') })
  })

  it('图标 / 发布前复核（待办 yuepu#18②③）：updatePosition 可清空图标；publishPosition 与详情页同用 computePublishCheck，缺图标 / 领用页文案 / 采集字段都被拦；新建空岗位一次列全缺项', async () => {
    const cleared = await updatePosition(401, { icon: '' })
    expect(cleared.icon).toBe('') // 原 `|| p.icon` 让图标永远清不掉
    await expect(publishPosition(401, { bump: 'MINOR', releaseNotes: 'x' })).rejects.toThrow('请先选择岗位图标')
    await updatePosition(401, { icon: '▤', claimDescriptions: [], intakeSchema: [] })
    await expect(publishPosition(401, { bump: 'MINOR', releaseNotes: 'x' })).rejects.toThrow('领用页文案（至少 1 条）；至少配置 1 个采集字段')
    await __resetPositionMock()
    await expect(publishPosition(401, { bump: 'MINOR', releaseNotes: 'x' })).resolves.toEqual({}) // 复位后种子齐备，放行

    const blank = await createPosition({ name: `空白岗_${Date.now()}`, description: '空态验证' })
    const err = await publishPosition(blank.positionId, { releaseNotes: '首发' }).catch((e) => e)
    expect(err.message).toContain('发布前检查未通过')
    for (const part of ['岗位图标', '领用页文案', '示例问题', '岗位 SOP', '采集字段', '自动化任务']) expect(err.message).toContain(part)
    expect((await listPositions({ keyword: blank.name })).list[0].pendingAction).toBeNull() // 被拦的不进审核
  })

  // 岗位 PRD §6.4 / §8「被强制回收」：引用保留 + 详情带回收标记 + 发布阻断；对象回收后自然退出「仅已发布」的候选
  describe('引用了被强制回收的技能 / 连接器', () => {
    const restoreSkill = () => _reset('sk_301', { status: 'published', delisted: false, revoked: null })
    afterEach(() => { restoreSkill(); __resetMcpMock(); __resetApiMock(); __resetBizSystemMock(); resetAccessAuditMock() })

    it('技能被回收：岗位详情技能子行带 revoked，引用不自动解除，仍可【移除】（detachSkill）', async () => {
      const before = (await getPosition(401)).agents.flatMap((a) => a.skills)
      expect(before[0].revoked).toBeNull()
      await forceRevokeSkill('sk_301', { reason: '存在安全风险' })
      const d = await getPosition(401)
      const sk = d.agents.flatMap((a) => a.skills)[0]
      expect(sk).toMatchObject({ skillId: 'sk_301', revoked: { reason: '存在安全风险' } })
      expect(sk.revoked.at).toBeTruthy()
      expect(d.agents[0].skills).toHaveLength(1) // 引用保留
      await detachSkill(501, 'sk_301')
      expect((await getPosition(401)).agents[0].skills).toHaveLength(0)
    })

    it('技能被回收：发布前检查阻断，提示「引用的「XX」已被回收，请移除后再发布」；移除引用后放行', async () => {
      await forceRevokeSkill('sk_301', { reason: '下线' })
      await expect(publishPosition(401, { bump: 'MINOR', releaseNotes: 'x' })).rejects.toThrow('引用的「日报周报生成」已被回收，请移除后再发布')
      await detachSkill(501, 'sk_301')
      // 移除后回收阻断消失（此岗位只剩空 Agent，转而被「至少引用 1 个技能」拦）
      const e = await publishPosition(401, { bump: 'MINOR', releaseNotes: 'x' }).catch((x) => x)
      expect(e.message).not.toContain('已被回收')
    })

    it('连接器被回收：详情带回 revokedConnectors，发布阻断；解除引用后放行', async () => {
      const name = listMcpSync().find((m) => m.id === 'expense_mcp').name
      expect((await getPosition(401)).revokedConnectors).toEqual([])
      await forceRevokeMcpService('expense_mcp', '凭据泄露')
      expect((await getPosition(401)).revokedConnectors).toEqual([name])
      expect(revokedConnectorNames({ connectorMcpIds: ['expense_mcp'] })).toEqual([name])
      expect(revokedConnectorNames({ connectorMcpIds: ['mail_center'], connectorApiIds: ['不存在的id'] })).toEqual([]) // 未回收 / 悬空引用不算
      await expect(publishPosition(401, { bump: 'MINOR', releaseNotes: 'x' })).rejects.toThrow(`引用的「${name}」已被回收，请移除后再发布`)
      await updatePosition(401, { connectorMcpIds: [] })
      await expect(publishPosition(401, { bump: 'MINOR', releaseNotes: 'x' })).resolves.toEqual({})
    })

    // 2026-10-09 /test-audit 补缺口 A9/A10（岗位 PRD §8 / §9.1）：API 与业务系统各一条正向 + 三类共存顺序
    it('API 被回收：revokedConnectorNames 列出其名称；未回收的 API 不列入', async () => {
      const name = listApisSync().find((a) => a.id === 'api_1101').name
      expect(revokedConnectorNames({ connectorApiIds: ['api_1101'] })).toEqual([])
      await forceRevokeApi('api_1101', '接口下线')
      expect(revokedConnectorNames({ connectorApiIds: ['api_1101'] })).toEqual([name])
      expect(revokedConnectorNames({ connectorApiIds: ['api_1103'] })).toEqual([])
    })

    it('业务系统被回收：revokedConnectorNames 列出其名称；未回收的业务系统不列入', async () => {
      const name = listBizSystemsSync().find((b) => b.id === 'biz_2101').name
      expect(revokedConnectorNames({ businessSystemIds: ['biz_2101'] })).toEqual([])
      await forceRevokeBizSystem('biz_2101', '系统停用')
      expect(revokedConnectorNames({ businessSystemIds: ['biz_2101'] })).toEqual([name])
      expect(revokedConnectorNames({ businessSystemIds: ['biz_2102'] })).toEqual([])
    })

    it('三类都被回收且岗位都引用：名称顺序固定 MCP → API → 业务系统（与回收先后无关）；悬空 id 与未回收项被跳过', async () => {
      const mcpName = listMcpSync().find((m) => m.id === 'expense_mcp').name
      const apiName = listApisSync().find((a) => a.id === 'api_1101').name
      const bizName = listBizSystemsSync().find((b) => b.id === 'biz_2101').name
      // 故意按「业务系统 → API → MCP」的反序回收，证明顺序由类别决定而不是回收先后
      await forceRevokeBizSystem('biz_2101', '系统停用')
      await forceRevokeApi('api_1101', '接口下线')
      await forceRevokeMcpService('expense_mcp', '凭据泄露')
      expect(revokedConnectorNames({
        connectorMcpIds: ['mail_center', 'expense_mcp', '不存在的mcp'], // 未回收 + 已回收 + 悬空
        connectorApiIds: ['不存在的api', 'api_1103', 'api_1101'],
        businessSystemIds: ['biz_2101', 'biz_2102', '不存在的biz']
      })).toEqual([mcpName, apiName, bizName])
    })

    it('选择弹窗候选口径：回收后的技能不再出现在「已发布」候选里（回未发布）', async () => {
      const ids = async () => (await listUnifiedSkills({ status: 'PUBLISHED', type: 'POSITION', size: 200 })).list.map((s) => s.id)
      expect(await ids()).toContain('sk_301')
      await forceRevokeSkill('sk_301', { reason: '下线' })
      expect(await ids()).not.toContain('sk_301')
    })
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
