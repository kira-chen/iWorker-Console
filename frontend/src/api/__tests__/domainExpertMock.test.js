// @vitest-environment jsdom
// （domainExpertMock → request.js → router 链路触达 window，故用 jsdom；同 positionMock.test）
import { describe, it, expect, beforeEach } from 'vitest'
import {
  listExperts,
  getExpert,
  createExpert,
  updateExpert,
  deleteExpert,
  getExpertDeleteImpact,
  listExpertSkillCandidates,
  addExpertSkill,
  removeExpertSkill,
  reorderExpertSkills,
  publishExpert,
  withdrawExpert,
  unpublishExpert,
  getExpertNextVersionLabel,
  listExpertPublications,
  delistExpertPublication,
  relistExpertPublication,
  getExpertKbScopeRefId,
  __resetExpertMock
} from '../domainExpertMock'

// vitest 用例随机顺序执行：每例前重置种子，杜绝状态顺序依赖
beforeEach(() => __resetExpertMock())

describe('domainExpertMock —— 专家模块 mock（2026-09-01 PRD 对齐轮）', () => {
  it('种子 4 条照原型：默认按最近更新时间降序，含分类/技能数/最新版本；法务审阅专家无版本', async () => {
    const { list, total } = await listExperts()
    expect(total).toBe(4)
    expect(list.map((e) => e.name)).toEqual(['经营分析专家', '研究报告专家', '企业知识助手', '法务审阅专家'])
    const [biz] = list
    expect(biz).toMatchObject({ category: '投资', skillCount: 2, latestVersionLabel: 'v2.3.0', status: 'published', pendingAction: null })
    // 法务审阅专家：未发布无版本；研究报告专家：已发布 + 新版审核中
    expect(list[3]).toMatchObject({ status: 'draft', latestVersionLabel: '' })
    expect(list[1]).toMatchObject({ status: 'published', pendingAction: 'PUBLISH' })
    // 升序
    const asc = await listExperts({ sort: 'asc' })
    expect(asc.list[0].name).toBe('法务审阅专家')
  })

  it('筛选：keyword 覆盖名称/描述/分类；category 精确；status 三态口径（review=在审）', async () => {
    expect((await listExperts({ keyword: '合同' })).list.map((e) => e.name)).toEqual(['法务审阅专家'])
    expect((await listExperts({ keyword: '投资' })).list).toHaveLength(2) // 分类命中
    expect((await listExperts({ category: '法律' })).list.map((e) => e.name)).toEqual(['法务审阅专家'])
    expect((await listExperts({ status: 'review' })).list.map((e) => e.name)).toEqual(['研究报告专家'])
    expect((await listExperts({ status: 'published' })).list.map((e) => e.name)).toEqual(['经营分析专家', '企业知识助手'])
    expect((await listExperts({ status: 'draft' })).list.map((e) => e.name)).toEqual(['法务审阅专家'])
  })

  it('详情：含职责描述 / 3 条示例问题 / 引用技能明细（实时取市场技能本体）与时间元信息', async () => {
    const d = await getExpert(201)
    expect(d.roleDesc).toContain('经营分析专家')
    expect(d.exampleQuestions).toHaveLength(3)
    expect(d.skills.map((s) => s.name)).toEqual(['经营数据分析', '合同风险检查'])
    expect(d.createdAt).toBeTruthy()
    expect(d.publishedAt).toBeTruthy()
  })

  // 2026-09-04 PRD-20260903 对齐：背景色种子 + 归一化（读写路径均回落默认 #DCF5E4）
  it('背景色：种子/详情出参带 backgroundColor；create/update 归一化，非法值回落默认 #DCF5E4', async () => {
    const { list } = await listExperts()
    expect(list.every((e) => e.backgroundColor === '#DCF5E4')).toBe(true) // 种子=原型归一化结果（默认色）
    expect((await getExpert(201)).backgroundColor).toBe('#DCF5E4')
    // create：合法 7 色板值大写落库；update 非法值回落默认
    const created = await createExpert({ name: '带色专家', backgroundColor: '#fae9df' })
    expect(created.backgroundColor).toBe('#FAE9DF')
    const updated = await updateExpert(created.id, { backgroundColor: 'not-a-color' })
    expect(updated.backgroundColor).toBe('#DCF5E4')
    // 专家 ↔ 知识库可见范围桥接映射种子（编辑抽屉只读「知识库」区块用）
    expect(getExpertKbScopeRefId(201)).toBe('ex_1')
    expect(getExpertKbScopeRefId(203)).toBeNull()
  })

  it('市场技能候选：3 条种子；keyword 覆盖名称/描述/分类', async () => {
    expect(await listExpertSkillCandidates()).toHaveLength(3)
    expect((await listExpertSkillCandidates({ keyword: '数据分析' })).map((s) => s.id)).toEqual([302])
    expect((await listExpertSkillCandidates({ keyword: '办公效率' })).map((s) => s.id)).toEqual([304])
  })

  it('新建：落草稿并支持一次性带 skillIds（新建态即可勾选）；重名按 name 字段级报错', async () => {
    const created = await createExpert({
      name: '新专家', category: '通用', avatar: '☆', intro: '简介', roleDesc: '职责',
      exampleQuestions: ['一', '二', '三'], skillIds: [302]
    })
    expect(created).toMatchObject({ status: 'draft', skillCount: 1, latestVersionLabel: '' })
    expect(created.exampleQuestions).toEqual(['一', '二', '三'])
    await expect(createExpert({ name: '经营分析专家' })).rejects.toMatchObject({ field: 'name' })
  })

  it('更新：部分字段 + skillIds 全量替换；审核中锁定拒改', async () => {
    const d = await updateExpert(203, { intro: '改简介', skillIds: [302, 307] })
    expect(d.intro).toBe('改简介')
    expect(d.skills.map((s) => s.skillId)).toEqual([302, 307])
    await expect(updateExpert(204, { intro: 'x' })).rejects.toMatchObject({ code: 409 })
  })

  it('删除：返回解除的引用数并移除本体；delete-impact 接口保留可用', async () => {
    const impact = await getExpertDeleteImpact(201)
    expect(impact).toMatchObject({ name: '经营分析专家', skillRefCount: 2, published: true })
    expect(await deleteExpert(201)).toBe(2)
    expect((await listExperts()).total).toBe(3)
  })

  it('引用/解除/重排（接口保留）：add 幂等、remove 断关联不动本体、reorder 按数组顺序', async () => {
    await addExpertSkill(203, 307)
    await addExpertSkill(203, 307) // 幂等
    let d = await getExpert(203)
    expect(d.skillIds).toEqual([304, 307])
    d = await reorderExpertSkills(203, [307, 304])
    expect(d.skillIds).toEqual([307, 304])
    d = await removeExpertSkill(203, 304)
    expect(d.skillIds).toEqual([307])
    expect(await listExpertSkillCandidates()).toHaveLength(3) // 技能本体不受影响
  })

  it('发布流：无技能拦发布；提交发布进审核（语义化版本号）；撤回清 pending*', async () => {
    await updateExpert(203, { skillIds: [] })
    await expect(publishExpert(203)).rejects.toMatchObject({ message: expect.stringContaining('至少引用 1 个市场技能') })
    await updateExpert(203, { skillIds: [304] })
    await publishExpert(203, { bump: 'NONE', releaseNotes: '首发' })
    let row = (await listExperts({ status: 'review' })).list.find((e) => e.id === 203)
    expect(row).toMatchObject({ pendingAction: 'PUBLISH', pendingVersion: 'v1.0.0' })
    await withdrawExpert(203)
    row = (await listExperts({ status: 'draft' })).list.find((e) => e.id === 203)
    expect(row).toMatchObject({ pendingAction: null, pendingVersion: null })
  })

  it('已发布迭代：next-label = 最新版 patch+1；bump 决定版本号', async () => {
    expect(await getExpertNextVersionLabel(201)).toBe('v2.3.1')
    await publishExpert(201, { bump: 'MINOR', releaseNotes: '加能力' })
    const row = (await listExperts()).list.find((e) => e.id === 201)
    expect(row.pendingVersion).toBe('v2.4.0')
  })

  it('停用：仅已发布可提交，进入停用审核（pendingAction=DELIST）', async () => {
    await expect(unpublishExpert(203)).rejects.toMatchObject({ message: '仅已发布专家可停用' })
    await unpublishExpert(202)
    const row = (await listExperts({ status: 'review' })).list.find((e) => e.id === 202)
    expect(row.pendingAction).toBe('DELIST')
  })

  it('版本历史：按 publicationId 禁用/启用；启用互斥；最后一个启用版本不可禁用', async () => {
    let rows = await listExpertPublications(201)
    expect(rows.map((r) => r.versionLabel)).toEqual(['v2.3.0', 'v2.2.0'])
    const [active, delisted] = rows
    // 启用旧版 → 互斥：原 ACTIVE 自动转禁用
    await relistExpertPublication(201, delisted.id)
    rows = await listExpertPublications(201)
    expect(rows.find((r) => r.id === delisted.id).status).toBe('ACTIVE')
    expect(rows.find((r) => r.id === active.id).status).toBe('DELISTED')
    // 此刻仅剩一个启用版本 → 护栏拒禁
    await expect(delistExpertPublication(201, delisted.id)).rejects.toMatchObject({
      message: expect.stringContaining('最后一个启用版本')
    })
  })
})
