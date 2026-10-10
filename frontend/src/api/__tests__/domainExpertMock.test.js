// @vitest-environment jsdom
// （domainExpertMock → request.js → router 链路触达 window，故用 jsdom；同 positionMock.test）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  forceRevokeExpert,
  applyExpertReviewResult,
  getExpertNextVersionLabel,
  listExpertPublications,
  delistExpertPublication,
  relistExpertPublication,
  getExpertKbScopeRefId,
  __resetExpertMock
} from '../domainExpertMock'
import { opsRecords, resetAccessAuditMock } from '../accessAuditMock'
import { listReviews } from '../reviewsMock'
import { _getRaw as getRawSkill, _reset as resetSkillRaw } from '../unifiedSkillMock'

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

  it('市场技能候选：实时读已发布市场技能（2026-09-23 待办 yuepu#10③，此前是脱钩的静态 3 条）', async () => {
    // 市场技能（PLATFORM）种子 302/304/307/309 中，307 是草稿——候选只算已发布的 302/304/309；
    // 分类也改为技能模块的真实分类（此前静态候选的分类与技能模块本身对不上）
    const candidates = await listExpertSkillCandidates()
    expect(candidates.map((s) => s.id).sort((a, b) => a - b)).toEqual([302, 304, 309])
    expect((await listExpertSkillCandidates({ keyword: '数据分析' })).map((s) => s.id)).toEqual([302])
    expect((await listExpertSkillCandidates({ keyword: '行业专业' })).map((s) => s.id)).toEqual([304])
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
    const d = await updateExpert(203, { intro: '改简介', skillIds: [302, 304] })
    expect(d.intro).toBe('改简介')
    expect(d.skills.map((s) => s.skillId)).toEqual([302, 304])
    await expect(updateExpert(204, { intro: 'x' })).rejects.toMatchObject({ code: 409 })
  })

  // 待办 yuepu#57⑤：整批 skillIds 须在候选内（已发布的市场技能）；存量引用不因技能后来被回收而被拒（md §3.5.1 专家自身的技能引用不受影响）
  it('skillIds 整批校验：新增未发布 / 不存在的技能被拒（create / update 都拦）；存量引用的技能被回收后，保存其它字段与原引用不被拒', async () => {
    await expect(updateExpert(201, { skillIds: [302, 307] })).rejects.toMatchObject({ field: 'skillIds' }) // 307 竞品信息汇总：未发布
    await expect(updateExpert(201, { skillIds: [302, 99999] })).rejects.toMatchObject({ field: 'skillIds' })
    await expect(createExpert({ name: '整批校验新专家', skillIds: [307] })).rejects.toMatchObject({ field: 'skillIds' })
    expect((await getExpert(201)).skills.map((s) => s.skillId)).toEqual([302, 304]) // 被拒后原引用不变
    // 304 被强制回收（回未发布）后不再是候选，但 201 的存量引用保留：改简介 + 原样带回 skillIds 仍成功
    resetSkillRaw('sk_304', { status: 'draft', delisted: true })
    try {
      const d = await updateExpert(201, { intro: '回收后仍可改', skillIds: [302, 304] })
      expect(d.intro).toBe('回收后仍可改')
      expect(d.skills.map((s) => s.skillId)).toEqual([302, 304])
      await expect(updateExpert(201, { skillIds: [302, 304, 307] })).rejects.toMatchObject({ field: 'skillIds' }) // 新增的仍须在候选内
    } finally {
      resetSkillRaw('sk_304', { status: 'published', delisted: false })
    }
  })

  it('示例问题每条 ≤300 字符：create / update 超长被拒回 field，恰 300 通过（一览表「专家帮你做」）', async () => {
    const long = ['问'.repeat(301), 'b', 'c']
    await expect(createExpert({ name: '超长示例专家', exampleQuestions: long })).rejects.toMatchObject({ field: 'exampleQuestions', message: '示例问题每条最多 300 个字符' })
    await expect(updateExpert(201, { exampleQuestions: long })).rejects.toMatchObject({ field: 'exampleQuestions' })
    const ok = await updateExpert(201, { exampleQuestions: ['问'.repeat(300), 'b', 'c'] })
    expect(ok.exampleQuestions[0]).toHaveLength(300)
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
    // 307 是草稿技能，不再是有效候选（yuepu#10③），改用已发布的 309 验证
    await addExpertSkill(203, 309)
    await addExpertSkill(203, 309) // 幂等
    let d = await getExpert(203)
    expect(d.skillIds).toEqual([304, 309])
    d = await reorderExpertSkills(203, [309, 304])
    expect(d.skillIds).toEqual([309, 304])
    d = await removeExpertSkill(203, 304)
    expect(d.skillIds).toEqual([309])
    expect(await listExpertSkillCandidates()).toHaveLength(3) // 技能本体不受影响
  })

  it('引用变化回写技能 refNames：add/remove/改名/删专家 都同步（2026-09-23 待办 yuepu#10③）', async () => {
    // unifiedSkillMock 是模块级共享内存，跨用例不重置（同文件其它用例可能已经改动过 refNames）：
    // 显式 _reset 建立已知基线，不依赖种子/其它用例的历史状态
    resetSkillRaw('sk_304', { refNames: ['经营分析专家', '法务审阅专家'] })
    resetSkillRaw('sk_309', { refNames: [] })

    // add：sk_309 此前未被任何专家引用，引用后 refNames 追加专家名
    expect(getRawSkill('sk_309').refNames).toEqual([])
    await addExpertSkill(203, 309)
    expect(getRawSkill('sk_309').refNames).toEqual(['法务审阅专家'])

    // 改名：sk_304 已引用 203（法务审阅专家），改名后 refNames 里同步换成新名
    expect(getRawSkill('sk_304').refNames).toContain('法务审阅专家')
    await updateExpert(203, { name: '法务审阅专家改名' })
    expect(getRawSkill('sk_304').refNames).toContain('法务审阅专家改名')
    expect(getRawSkill('sk_304').refNames).not.toContain('法务审阅专家')
    expect(getRawSkill('sk_309').refNames).toEqual(['法务审阅专家改名'])

    // remove：解除引用摘掉 refNames
    await removeExpertSkill(203, 309)
    expect(getRawSkill('sk_309').refNames).toEqual([])

    // 删专家：级联摘掉该专家在所有已引用技能上的 refNames（此前 bug：删专家 203 后 sk_304 引用清单仍列它）
    await deleteExpert(203)
    expect(getRawSkill('sk_304').refNames).not.toContain('法务审阅专家改名')
  })

  it('发布流：无技能拦发布；升级说明必填（md §二.3.1 L230，2026-09-18 待办 yuepu#13·专家 E4：此前数据层不拦）；提交发布进审核（语义化版本号）；撤回清 pending*', async () => {
    await updateExpert(203, { skillIds: [] })
    await expect(publishExpert(203)).rejects.toMatchObject({ message: expect.stringContaining('至少引用 1 个市场技能') })
    await updateExpert(203, { skillIds: [304] })
    await expect(publishExpert(203, { bump: 'NONE' })).rejects.toMatchObject({ message: expect.stringContaining('升级说明必填') })
    await expect(publishExpert(203, { bump: 'NONE', releaseNotes: '   ' })).rejects.toMatchObject({ message: expect.stringContaining('升级说明必填') })
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

  it('版本历史：按 publicationId 禁用/启用；启用互斥；最后一个启用版本不可禁用；「最新版本」不受影响（2026-09-18 待办 yuepu#13·专家 E2）', async () => {
    let rows = await listExpertPublications(201)
    expect(rows.map((r) => r.versionLabel)).toEqual(['v2.3.0', 'v2.2.0'])
    const [active, delisted] = rows
    // 启用旧版 → 互斥：原 ACTIVE 自动转禁用
    await relistExpertPublication(201, delisted.id)
    rows = await listExpertPublications(201)
    expect(rows.find((r) => r.id === delisted.id).status).toBe('ACTIVE')
    expect(rows.find((r) => r.id === active.id).status).toBe('DELISTED')
    // md §二.1 L49「最新版本=最近一次审核通过并正式发布的版本号」：启用旧版属版本历史操作，不是
    // 重新走审核，不应把「最新版本」改写成被启用的旧版本号
    expect((await getExpert(201)).latestVersionLabel).toBe('v2.3.0')
    // 此刻仅剩一个启用版本 → 护栏拒禁
    await expect(delistExpertPublication(201, delisted.id)).rejects.toMatchObject({
      message: expect.stringContaining('最后一个启用版本')
    })
  })
})

// 强制回收（PRD 专家 §3.5.1，2026-09-30）：201 经营分析专家 = 已发布 v2.3.0；204 研究报告专家 = 已发布 + 新版在审；203 法务审阅专家 = 未发布
describe('forceRevokeExpert —— 强制回收', () => {
  beforeEach(() => resetAccessAuditMock())
  const reviewTotal = async () => (await listReviews({ size: 1000 })).total

  it('前置条件：仅「已发布且无在途审核」可回收——未发布 / 在审 / 重复回收均抛「状态已变化」', async () => {
    await expect(forceRevokeExpert(203, { reason: '风险' })).rejects.toThrow('专家状态已变化，请刷新后重试')
    await expect(forceRevokeExpert(204, { reason: '风险' })).rejects.toThrow('专家状态已变化，请刷新后重试')
    await forceRevokeExpert(201, { reason: '风险' })
    await expect(forceRevokeExpert(201, { reason: '再来一次' })).rejects.toThrow('专家状态已变化，请刷新后重试')
  })

  it('原因必填且 ≤500 字；校验不通过时状态不变', async () => {
    await expect(forceRevokeExpert(201, { reason: ' ' })).rejects.toThrow('请输入回收原因')
    await expect(forceRevokeExpert(201, { reason: 'x'.repeat(501) })).rejects.toThrow('最多 500 字')
    expect((await getExpert(201)).status).toBe('published')
  })

  it('回收后：立即回「未发布」（版本历史 / 最新版本号 / 最近发布时间保留）、行与详情带 revoked、不进审核中心', async () => {
    const before = await getExpert(201)
    const reviewsBefore = await reviewTotal()
    const r = await forceRevokeExpert(201, { reason: ' 专家输出异常 ' })
    expect(r.revoked).toMatchObject({ reason: '专家输出异常' })
    expect(r.revoked.at).toBeTruthy()
    expect(r.revoked.operator).toBeTruthy()

    const detail = await getExpert(201)
    expect(detail).toMatchObject({ status: 'draft', pendingAction: null, latestVersionLabel: 'v2.3.0', publishedAt: before.publishedAt })
    expect(detail.revoked).toEqual(r.revoked)
    const { list } = await listExperts({ status: 'draft' })
    expect(list.find((e) => e.id === 201).revoked).toEqual(r.revoked)
    expect((await listExpertPublications(201)).length).toBe(2)
    expect(await reviewTotal()).toBe(reviewsBefore) // 立即生效，不 enrollReview
    expect((await getExpert(202)).revoked).toBeNull() // 未回收的行 revoked 为 null
  })

  it('专家自身对市场技能的引用不受影响', async () => {
    await forceRevokeExpert(201, { reason: '风险' })
    expect((await getExpert(201)).skillIds).toEqual([302, 304])
  })

  it('写一条访问审计：模块=专家、动作=强制回收、变更内容=原因、带回收时的版本号', async () => {
    await forceRevokeExpert(201, { reason: '召唤链路异常' })
    const rec = opsRecords.find((x) => x.action === '强制回收' && x.target === '经营分析专家')
    expect(rec).toMatchObject({ module: '专家', detail: '召唤链路异常', version: 'v2.3.0', live: true })
  })

  it('重新发布：撤回 / 驳回不清 revoked，审核通过后清除并回到已发布', async () => {
    await forceRevokeExpert(201, { reason: '异常' })
    await publishExpert(201, { bump: 'NONE', releaseNotes: '修复后重发' })
    await withdrawExpert(201) // 撤回不清
    expect((await getExpert(201)).revoked).toBeTruthy()

    await publishExpert(201, { bump: 'NONE', releaseNotes: '修复后重发' })
    applyExpertReviewResult(201, 'VERSION_PUBLISH', false) // 驳回不清
    expect((await getExpert(201)).revoked).toBeTruthy()

    await publishExpert(201, { bump: 'NONE', releaseNotes: '修复后重发' })
    applyExpertReviewResult(201, 'VERSION_PUBLISH', true) // 通过 → 清
    const d = await getExpert(201)
    expect(d.revoked).toBeNull()
    expect(d).toMatchObject({ status: 'published', latestVersionLabel: 'v2.3.1' })
  })
})

/* 2026-10-08 /test-audit 补缺口：持久化「写入 → 刷新 → 读回」（mock 层 localStorage 约定，见 api/mockPersist.js）。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/专家/prd.专家.md §三.7（创建专家后列表可见）；写法照 unifiedSkillMock.test.js 同名块：
 * jsdom 下 globalThis.localStorage 为 undefined，注入内存版存储 + vi.resetModules + 动态 import 模拟刷新。
 * 本文件其余用例走顶部静态导入（导入时无存储 → 纯内存），不受本块影响。 */
describe('domainExpertMock · 持久化读回（mockPersist v6；key iworker-demo-mock:domainExpert）', () => {
  const KEY = 'iworker-demo-mock:domainExpert'
  const makeStorage = () => {
    const map = new Map()
    return {
      get length() { return map.size },
      key: (i) => [...map.keys()][i] ?? null,
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear()
    }
  }
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), writable: true, configurable: true })
    vi.resetModules()
  })
  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true, configurable: true })
    vi.resetModules()
  })

  it('createExpert 落盘（v=6）→ 重新 import 模块（模拟刷新）→ 列表与详情仍有新建专家', async () => {
    const first = await import('@/api/domainExpertMock')
    const created = await first.createExpert({ name: '读回验证专家', type: 'PLATFORM', category: '通用', avatar: '☆', intro: '读回', roleDesc: '你是读回专家', exampleQuestions: ['一', '二', '三'] })
    expect(JSON.parse(globalThis.localStorage.getItem(KEY)).v).toBe(6)
    vi.resetModules()
    const fresh = await import('@/api/domainExpertMock')
    const { list } = await fresh.listExperts({ keyword: '读回验证专家' })
    expect(list.map((e) => e.id)).toContain(created.id)
    expect((await fresh.getExpert(created.id)).name).toBe('读回验证专家')
  })

  it('存量版本号 ≠ 当前版本的快照 → 丢弃回种子（201 在、伪造行不在），旧 key 被清掉', async () => {
    globalThis.localStorage.setItem(
      KEY,
      JSON.stringify({ v: 5, data: { expertSeq: 9999, experts: [{ id: 9998, name: '伪造专家', status: 'draft' }], publications: {}, reviewSnapshots: {} } })
    )
    const fresh = await import('@/api/domainExpertMock')
    const { list } = await fresh.listExperts({})
    expect(list.some((e) => e.id === 201)).toBe(true)
    expect(list.some((e) => e.name === '伪造专家')).toBe(false)
    expect(globalThis.localStorage.getItem(KEY)).toBeNull()
  })

  // 2026-10-09 /test-audit 补缺口 C1（PRD 专家 §3.5.1）：强制回收是写点，刷新后「已回收」必须还在
  it('强制回收后刷新页面 → 专家仍是未发布，且带回收原因 / 时间 / 操作人', async () => {
    const first = await import('@/api/domainExpertMock')
    const r = await first.forceRevokeExpert(201, { reason: '刷新后仍应标已回收' })
    vi.resetModules()
    const fresh = await import('@/api/domainExpertMock')
    const detail = await fresh.getExpert(201)
    expect(detail.status).toBe('draft')
    expect(detail.revoked).toEqual({ reason: '刷新后仍应标已回收', at: expect.any(String), operator: expect.any(String) })
    expect(detail.revoked).toEqual(r.revoked)
    expect((await fresh.listExperts({ status: 'draft' })).list.find((e) => e.id === 201).revoked.reason).toBe('刷新后仍应标已回收')
  })
})
