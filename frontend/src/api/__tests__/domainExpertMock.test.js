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

// vitest 用例随机顺序执行：每例前重置种子（含审核快照表，2026-09-12 T23），杜绝状态顺序依赖
beforeEach(() => __resetExpertMock())

// 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/03能力/专家/prd.专家.md §二.2 排序 / §二.3.3 发布 /
// §二.3.4 撤回 / §二.3.5 停用 / §二.3.7 删除 / §四.3 版本历史；提交快照的写销见 reviewSnapshot.test.js
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

  // 2026-09-20 待办 yuepu#6②：专家类型 / 所属岗位落数据层（md 专家 §一 类型筛选、§二.1 类型列与引用情况、§三 L167-168）
  it('专家类型：种子三型齐全且列表出参带 type/positionIds/positionCount（岗位私有可多选绑定，种子 203 绑 2 个岗位）；type 筛选生效', async () => {
    const { list } = await listExperts()
    const byName = Object.fromEntries(list.map((e) => [e.name, e]))
    expect(byName['经营分析专家']).toMatchObject({ type: 'PLATFORM', positionIds: [], positionCount: 0 })
    expect(byName['企业知识助手']).toMatchObject({ type: 'SYSTEM_DEFAULT', positionIds: [], positionCount: 0 })
    expect(byName['法务审阅专家']).toMatchObject({ type: 'POSITION', positionIds: [401, 402], positionCount: 2 })
    expect(byName['法务审阅专家']).not.toHaveProperty('positionId')
    expect((await listExperts({ type: 'POSITION' })).list.map((e) => e.name)).toEqual(['法务审阅专家'])
    expect((await listExperts({ type: 'PLATFORM' })).list.map((e) => e.name)).toEqual(['经营分析专家', '研究报告专家'])
    expect((await listExperts({ type: 'SYSTEM_DEFAULT' })).total).toBe(1)
  })

  it('专家类型：新建落 type，岗位私有可先不绑岗位（4229ae6）、可多选绑定多个岗位（去空去重）、非岗位私有丢弃 positionIds；非法 type 字段级报错', async () => {
    const pos = await createExpert({ name: '私有专家', type: 'POSITION' })
    expect(pos).toMatchObject({ type: 'POSITION', positionIds: [], positionCount: 0 })
    const bound = await createExpert({ name: '私有专家2', type: 'POSITION', positionIds: [402, 401] })
    expect(bound).toMatchObject({ type: 'POSITION', positionIds: [402, 401], positionCount: 2 })
    const dirty = await createExpert({ name: '私有专家3', type: 'POSITION', positionIds: [401, 401, null, 402] })
    expect(dirty).toMatchObject({ positionIds: [401, 402], positionCount: 2 })
    const plat = await createExpert({ name: '市场专家', type: 'PLATFORM', positionIds: [402] })
    expect(plat).toMatchObject({ type: 'PLATFORM', positionIds: [], positionCount: 0 })
    // 缺省回落市场专家（与连接器三件套 mock 同口径，必选由表单把关）
    expect((await createExpert({ name: '缺省专家' })).type).toBe('PLATFORM')
    await expect(createExpert({ name: '坏类型', type: 'WHATEVER' })).rejects.toMatchObject({ field: 'type' })
  })

  it('专家类型创建后不可改；所属岗位（多选）编辑时可增减，仅岗位私有生效、其它类型带了也忽略', async () => {
    const bound = await createExpert({ name: '可改岗位专家', type: 'POSITION', positionIds: [402] })
    // 类型不可改：带 type 也忽略；岗位可改：增到两个、再减回一个、再清空
    const added = await updateExpert(bound.id, { type: 'PLATFORM', positionIds: [401, 402], intro: 'x' })
    expect(added).toMatchObject({ type: 'POSITION', positionIds: [401, 402], positionCount: 2, intro: 'x' })
    expect(await updateExpert(bound.id, { positionIds: [401] })).toMatchObject({ positionIds: [401], positionCount: 1 })
    expect(await updateExpert(bound.id, { positionIds: [] })).toMatchObject({ positionIds: [], positionCount: 0 })
    // 不传 positionIds 则不动
    await updateExpert(bound.id, { positionIds: [402] })
    expect(await updateExpert(bound.id, { intro: 'y' })).toMatchObject({ positionIds: [402] })
    // 市场专家带 positionIds 也忽略
    const plat = await createExpert({ name: '不可绑岗位的市场专家', type: 'PLATFORM' })
    expect(await updateExpert(plat.id, { positionIds: [401] })).toMatchObject({ type: 'PLATFORM', positionIds: [], positionCount: 0 })
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

  // 2026-09-12 测试审计 T55：md §二.3.7「【删除】仅在"未发布"且无审核中操作时展示」——
  // 原用例拿已发布的 201 删，等于把「已发布可删」锁进用例；改用唯一的草稿种子 203。
  it('删除未发布专家 203：返回解除的引用数并移除本体；delete-impact 接口保留可用（md §二.3.7）', async () => {
    const impact = await getExpertDeleteImpact(203)
    expect(impact).toMatchObject({ name: '法务审阅专家', skillRefCount: 1, published: false })
    expect(await deleteExpert(203)).toBe(1)
    const { list, total } = await listExperts()
    expect(total).toBe(3)
    expect(list.map((e) => e.name)).not.toContain('法务审阅专家')
  })

  // 2026-09-12 审计 K27 闭环：mock 侧补状态守卫，UI 藏按钮之外不留后门
  it('删除已发布专家 201 / 审核中专家 204 → 409 拒绝，列表不变（md §二.3.7「已发布需先完成停用审核」「审核中按钮隐藏」）', async () => {
    await expect(deleteExpert(201)).rejects.toMatchObject({ code: 409 })
    await expect(deleteExpert(204)).rejects.toMatchObject({ code: 409 })
    const { total, list } = await listExperts()
    expect(total).toBe(4)
    expect(list.map((e) => e.name)).toEqual(expect.arrayContaining(['经营分析专家', '研究报告专家']))
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

  // 2026-09-12 测试审计 T55 · md §二.3.4「新版本审核撤回后线上仍为当前已发布版本」+
  // 「撤回时统一清理 pendingAction、pendingVersion 和 pendingReleaseNotes」
  it('已发布专家 204 撤回新版审核 → 仍是已发布、pendingVersion 清空、最新版本仍为 v1.1.0（md §二.3.4）', async () => {
    const before = (await listExperts()).list.find((e) => e.id === 204)
    expect(before).toMatchObject({ status: 'published', pendingAction: 'PUBLISH', pendingVersion: 'v1.2.0' })
    await withdrawExpert(204)
    const row = (await listExperts({ status: 'published' })).list.find((e) => e.id === 204)
    expect(row).toMatchObject({ status: 'published', pendingAction: null, pendingVersion: null, latestVersionLabel: 'v1.1.0' })
    // 三态展示口径：不再命中「审核中」筛选
    expect((await listExperts({ status: 'review' })).list.map((e) => e.id)).not.toContain(204)
    // 版本历史不因撤回生成新快照
    expect((await listExpertPublications(204)).map((r) => r.versionLabel)).toEqual(['v1.1.0', 'v1.0.0'])
  })

  it('已发布迭代：next-label = 最新版 patch+1；bump 决定版本号', async () => {
    expect(await getExpertNextVersionLabel(201)).toBe('v2.3.1')
    await publishExpert(201, { bump: 'MINOR', releaseNotes: '加能力' })
    const row = (await listExperts()).list.find((e) => e.id === 201)
    expect(row.pendingVersion).toBe('v2.4.0')
  })

  it('停用：仅已发布可提交，进入停用审核（pendingAction=DELIST）；且不刷新最近更新时间', async () => {
    await expect(unpublishExpert(203)).rejects.toMatchObject({ message: '仅已发布专家可停用' })
    // 2026-09-09 PRD 复核批次 0 · A20/Q199：md `prd.专家.md` §二.2 只列
    // 「保存配置、提交审核或撤回提交后」三种刷新场景，**停用不在其内**（口径同 prd-模型.md §二.2）。
    const before = (await listExperts()).list.find((e) => e.id === 202).updatedAt
    await unpublishExpert(202)
    const row = (await listExperts({ status: 'review' })).list.find((e) => e.id === 202)
    expect(row.pendingAction).toBe('DELIST')
    expect(row.updatedAt).toBe(before)
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
