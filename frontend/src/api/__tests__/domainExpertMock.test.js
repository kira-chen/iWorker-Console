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
  applyExpertReviewResult,
  getExpertNextVersionLabel,
  listExpertPublications,
  delistExpertPublication,
  relistExpertPublication,
  bindExpertToPosition,
  unbindExpertFromPosition,
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
  // 2026-11-09 产品优化需求-202611 R13：补种子 205「经营数据核查专家」（岗位私有、已发布、被 401 引用），共 5 条
  it('种子 5 条：默认按最近更新时间降序，含分类/技能数/最新版本；法务审阅专家无版本', async () => {
    const { list, total } = await listExperts()
    expect(total).toBe(5)
    expect(list.map((e) => e.name)).toEqual(['经营数据核查专家', '经营分析专家', '研究报告专家', '企业知识助手', '法务审阅专家'])
    const biz = list[1]
    expect(biz).toMatchObject({ category: '投资', skillCount: 2, latestVersionLabel: 'v2.3.0', status: 'published', pendingAction: null })
    // 法务审阅专家：未发布无版本；研究报告专家：已发布 + 新版审核中；经营数据核查专家：岗位私有已发布样本
    expect(list[4]).toMatchObject({ status: 'draft', latestVersionLabel: '' })
    expect(list[2]).toMatchObject({ status: 'published', pendingAction: 'PUBLISH' })
    expect(list[0]).toMatchObject({ type: 'POSITION', status: 'published', positionIds: [401] })
    // 升序
    const asc = await listExperts({ sort: 'asc' })
    expect(asc.list[0].name).toBe('法务审阅专家')
  })

  it('筛选：keyword 覆盖名称/描述/分类；category 精确；status 三态口径（review=在审）', async () => {
    expect((await listExperts({ keyword: '合同' })).list.map((e) => e.name)).toEqual(['法务审阅专家'])
    expect((await listExperts({ keyword: '投资' })).list).toHaveLength(2) // 分类命中
    expect((await listExperts({ category: '法律' })).list.map((e) => e.name)).toEqual(['法务审阅专家'])
    expect((await listExperts({ status: 'review' })).list.map((e) => e.name)).toEqual(['研究报告专家'])
    expect((await listExperts({ status: 'published' })).list.map((e) => e.name)).toEqual(['经营数据核查专家', '经营分析专家', '企业知识助手'])
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
    expect(byName['经营数据核查专家']).toMatchObject({ type: 'POSITION', positionIds: [401], positionCount: 1 })
    expect((await listExperts({ type: 'POSITION' })).list.map((e) => e.name)).toEqual(['经营数据核查专家', '法务审阅专家'])
    expect((await listExperts({ type: 'PLATFORM' })).list.map((e) => e.name)).toEqual(['经营分析专家', '研究报告专家'])
    expect((await listExperts({ type: 'SYSTEM_DEFAULT' })).total).toBe(1)
  })

  // 产品优化需求-202611 R13 §2：所属岗位改由岗位侧「专家与专家团」页签引用维护，新建时不再选岗位，
  // createExpert / updateExpert 不再接收 payload.positionIds（取代原「新建可多选绑定 / 编辑时可增减」口径）
  it('专家类型：新建落 type；新建时不再选岗位，payload.positionIds 带了也忽略（R13）；非法 type 字段级报错', async () => {
    const pos = await createExpert({ name: '私有专家', type: 'POSITION' })
    expect(pos).toMatchObject({ type: 'POSITION', positionIds: [], positionCount: 0 })
    const withIds = await createExpert({ name: '私有专家2', type: 'POSITION', positionIds: [402, 401] })
    expect(withIds).toMatchObject({ type: 'POSITION', positionIds: [], positionCount: 0 })
    const plat = await createExpert({ name: '市场专家', type: 'PLATFORM', positionIds: [402] })
    expect(plat).toMatchObject({ type: 'PLATFORM', positionIds: [], positionCount: 0 })
    // 缺省回落市场专家（与连接器三件套 mock 同口径，必选由表单把关）
    expect((await createExpert({ name: '缺省专家' })).type).toBe('PLATFORM')
    await expect(createExpert({ name: '坏类型', type: 'WHATEVER' })).rejects.toMatchObject({ field: 'type' })
  })

  it('专家类型创建后不可改；updateExpert 带 positionIds 也不改所属岗位（R13）；岗位侧引用后详情的所属岗位随之变化', async () => {
    // 203 被 401 / 402 引用：带 type / positionIds 都忽略，其它字段照改
    const updated = await updateExpert(203, { type: 'PLATFORM', positionIds: [999], intro: 'x' })
    expect(updated).toMatchObject({ type: 'POSITION', positionIds: [401, 402], positionCount: 2, intro: 'x' })
    expect(await updateExpert(203, { positionIds: [] })).toMatchObject({ positionIds: [401, 402], positionCount: 2 })
    // 绑定关系只从岗位侧写入（bindExpertToPosition）；专家编辑页只读展示的就是这里的 positionIds
    const created = await createExpert({ name: '待岗位引用专家', type: 'POSITION' })
    bindExpertToPosition(created.id, 402)
    expect(await getExpert(created.id)).toMatchObject({ positionIds: [402], positionCount: 1 })
  })

  it('详情：含职责描述 / 3 条示例问题 / 引用技能明细（实时取技能本体，带技能类型）与时间元信息', async () => {
    const d = await getExpert(201)
    expect(d.roleDesc).toContain('经营分析专家')
    expect(d.exampleQuestions).toHaveLength(3)
    expect(d.skills.map((s) => s.name)).toEqual(['经营数据分析', '合同风险检查'])
    expect(d.createdAt).toBeTruthy()
    expect(d.publishedAt).toBeTruthy()
    // 2026-11-10：岗位私有专家 205 同时引用市场技能 302 与岗位私有技能 301，明细逐项带技能类型（编辑抽屉卡片标签用）
    expect((await getExpert(205)).skills.map((s) => [s.name, s.type])).toEqual([
      ['经营数据分析', 'PLATFORM'],
      ['日报周报生成', 'POSITION']
    ])
  })

  // 2026-09-04 PRD-20260903 对齐：背景色种子 + 归一化（读写路径均回落默认 #DCF5E4）
  it('背景色：种子/详情出参带 backgroundColor；create/update 归一化，非法值回落默认 #DCF5E4', async () => {
    const { list } = await listExperts()
    // 原型种子 201-204 = 原型归一化结果（默认色）；2026-11-09 新种子 205 用 7 色板里的 #DCECF7
    expect(list.filter((e) => e.id !== 205).every((e) => e.backgroundColor === '#DCF5E4')).toBe(true)
    expect(list.find((e) => e.id === 205).backgroundColor).toBe('#DCECF7')
    expect((await getExpert(201)).backgroundColor).toBe('#DCF5E4')
    // create：合法 7 色板值大写落库；update 非法值回落默认
    const created = await createExpert({ name: '带色专家', backgroundColor: '#fae9df' })
    expect(created.backgroundColor).toBe('#FAE9DF')
    const updated = await updateExpert(created.id, { backgroundColor: 'not-a-color' })
    expect(updated.backgroundColor).toBe('#DCF5E4')
  })

  /* 技能候选（2026-11-10 专家按类型引用技能；2026-09-23 待办 yuepu#10③ 起实时读 unifiedSkillMock，此前是脱钩的静态 3 条）：
   * 岗位私有专家 = 已发布的岗位私有 + 市场 + 通用技能；市场专家、通用专家 = 已发布的市场 + 通用技能。
   * 技能种子里已发布的：301 / 305 岗位私有，302 / 304 / 309 市场，303 通用；306（通用，已回收）/ 307（市场）/ 308（岗位私有）未发布，不进候选。 */
  it('技能候选 · 岗位私有专家：已发布的岗位私有 + 市场 + 通用技能，每项带技能类型', async () => {
    const candidates = await listExpertSkillCandidates({ expertType: 'POSITION' })
    expect(Object.fromEntries(candidates.map((s) => [s.id, s.type]))).toEqual({
      301: 'POSITION',
      302: 'PLATFORM',
      303: 'SYSTEM_DEFAULT',
      304: 'PLATFORM',
      305: 'POSITION',
      309: 'PLATFORM'
    })
    // 分类取技能模块的真实分类（此前静态候选的分类与技能模块本身对不上）
    expect(candidates.find((s) => s.id === 305)).toMatchObject({ name: '客户拜访准备', category: '办公效率' })
  })

  it('技能候选 · 市场专家、通用专家：只有已发布的市场 + 通用技能，不含岗位私有技能', async () => {
    for (const expertType of ['PLATFORM', 'SYSTEM_DEFAULT']) {
      const candidates = await listExpertSkillCandidates({ expertType })
      expect(candidates.map((s) => s.id).sort((a, b) => a - b)).toEqual([302, 303, 304, 309])
      expect(candidates.map((s) => s.type)).not.toContain('POSITION')
    }
  })

  it('技能候选 · 没给专家类型（新建还没选类型）或类型非法 → 空列表', async () => {
    expect(await listExpertSkillCandidates()).toEqual([])
    expect(await listExpertSkillCandidates({ keyword: '数据分析' })).toEqual([])
    expect(await listExpertSkillCandidates({ expertType: 'WHATEVER' })).toEqual([])
  })

  it('技能候选 · keyword 在该类型范围内按名称 / 描述 / 分类过滤', async () => {
    expect((await listExpertSkillCandidates({ expertType: 'PLATFORM', keyword: '数据分析' })).map((s) => s.id)).toEqual([302])
    expect((await listExpertSkillCandidates({ expertType: 'PLATFORM', keyword: '行业专业' })).map((s) => s.id)).toEqual([304])
    // 「拜访」只命中岗位私有技能 305：岗位私有专家搜得到，市场专家搜不到
    expect((await listExpertSkillCandidates({ expertType: 'POSITION', keyword: '拜访' })).map((s) => s.id)).toEqual([305])
    expect(await listExpertSkillCandidates({ expertType: 'PLATFORM', keyword: '拜访' })).toEqual([])
  })

  it('市场专家不能引用岗位私有技能：addExpertSkill 拒绝，专家引用与技能的专家引用名都不变', async () => {
    await expect(addExpertSkill(201, 301)).rejects.toMatchObject({ code: 404, message: '技能不存在或不在本专家可引用的范围内' })
    expect((await getExpert(201)).skillIds).toEqual([302, 304])
    expect(getRawSkill('sk_301').expertRefNames).not.toContain('经营分析专家')
  })

  it('市场 / 通用专家新建或保存时带岗位私有技能 → skillIds 字段级报错，不落库', async () => {
    const msg = '只能引用本专家类型可引用的已发布技能，请刷新候选后重试'
    await expect(createExpert({ name: '越界市场专家', type: 'PLATFORM', skillIds: [302, 301] })).rejects.toMatchObject({ field: 'skillIds', message: msg })
    await expect(createExpert({ name: '越界通用专家', type: 'SYSTEM_DEFAULT', skillIds: [305] })).rejects.toMatchObject({ field: 'skillIds', message: msg })
    await expect(updateExpert(202, { skillIds: [302, 303, 301] })).rejects.toMatchObject({ field: 'skillIds', message: msg })
    expect((await listExperts({ keyword: '越界' })).total).toBe(0)
    expect((await getExpert(202)).skillIds).toEqual([302, 303])
  })

  it('岗位私有专家可引用岗位私有技能：技能的 expertRefNames 追加专家名，岗位引用 refNames 不动', async () => {
    // 显式基线（unifiedSkillMock 跨用例不重置）
    resetSkillRaw('sk_305', { refNames: ['客户成功岗', '市场研究岗'], expertRefNames: [] })
    const d = await addExpertSkill(203, 305)
    expect(d.skills.map((s) => [s.skillId, s.type])).toEqual([[304, 'PLATFORM'], [305, 'POSITION']])
    expect(getRawSkill('sk_305').expertRefNames).toEqual(['法务审阅专家'])
    expect(getRawSkill('sk_305').refNames).toEqual(['客户成功岗', '市场研究岗'])
    // 新建时一次性带岗位私有技能同样放行
    const created = await createExpert({ name: '带岗位私有技能的新专家', type: 'POSITION', skillIds: [305] })
    expect(created.skillIds).toEqual([305])
    expect(getRawSkill('sk_305').expertRefNames).toEqual(['法务审阅专家', '带岗位私有技能的新专家'])
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

  // 待办 yuepu#57⑤：整批 skillIds 须在该专家类型的候选内（已发布技能，2026-11-10 起按类型定范围）；存量引用不因技能后来被回收而被拒（md §3.5.1 专家自身的技能引用不受影响）
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
  it('被岗位引用的专家不能删（R13 §5）：203 是草稿、被 401 / 402 引用 → 拦并列出岗位，专家仍在', async () => {
    await expect(deleteExpert(203)).rejects.toThrow('该专家被 2 个岗位引用（经营分析岗、客户成功岗），需先从岗位中移除后再删除')
    expect((await listExperts()).list.map((e) => e.name)).toContain('法务审阅专家')
  })

  it('删除未发布专家 203：返回解除的引用数并移除本体；delete-impact 接口保留可用（md §二.3.7）', async () => {
    const impact = await getExpertDeleteImpact(203)
    expect(impact).toMatchObject({ name: '法务审阅专家', skillRefCount: 1, published: false })
    // 先从岗位侧解除引用（被岗位引用的专家不能删，见上一条）
    unbindExpertFromPosition(203, 401)
    unbindExpertFromPosition(203, 402)
    expect(await deleteExpert(203)).toBe(1)
    const { list, total } = await listExperts()
    expect(total).toBe(4)
    expect(list.map((e) => e.name)).not.toContain('法务审阅专家')
  })

  // 2026-09-12 审计 K27 闭环：mock 侧补状态守卫，UI 藏按钮之外不留后门
  it('删除已发布专家 201 / 审核中专家 204 → 409 拒绝，列表不变（md §二.3.7「已发布需先完成停用审核」「审核中按钮隐藏」）', async () => {
    await expect(deleteExpert(201)).rejects.toMatchObject({ code: 409 })
    await expect(deleteExpert(204)).rejects.toMatchObject({ code: 409 })
    const { total, list } = await listExperts()
    expect(total).toBe(5)
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
    // 技能本体不受影响：304 仍是已发布、仍在岗位私有专家的候选里
    expect((await listExpertSkillCandidates({ expertType: 'POSITION' })).map((s) => s.id)).toContain(304)
  })

  /* 引用变化回写技能的专家引用名（2026-09-23 待办 yuepu#10③；2026-11-10 起专家引用名单独存 expertRefNames，
   * 技能 refNames 只放岗位名）。unifiedSkillMock 是模块级共享内存，跨用例不重置：各例显式 _reset 建立已知基线。 */
  it('引用变化回写技能 expertRefNames：add / remove / 删专家 都同步，技能的岗位引用 refNames 不受影响', async () => {
    resetSkillRaw('sk_304', { refNames: [], expertRefNames: ['经营分析专家', '法务审阅专家'] })
    resetSkillRaw('sk_309', { refNames: [], expertRefNames: [] })

    // add：sk_309 此前未被任何专家引用，引用后 expertRefNames 追加专家名
    await addExpertSkill(203, 309)
    expect(getRawSkill('sk_309').expertRefNames).toEqual(['法务审阅专家'])
    expect(getRawSkill('sk_309').refNames).toEqual([])

    // remove：解除引用摘掉 expertRefNames
    await removeExpertSkill(203, 309)
    expect(getRawSkill('sk_309').expertRefNames).toEqual([])

    // 删专家：级联摘掉该专家在所有已引用技能上的专家引用名（此前 bug：删专家 203 后 sk_304 引用清单仍列它）
    unbindExpertFromPosition(203, 401) // 被岗位引用的专家不能删（R13），先解除
    unbindExpertFromPosition(203, 402)
    await deleteExpert(203)
    expect(getRawSkill('sk_304').expertRefNames).toEqual(['经营分析专家'])
    expect(getRawSkill('sk_304').refNames).toEqual([])
  })

  // 改名同步的前提：203 已引用 sk_304，且改名本身成功（与下一条拆开，各守一条规则）
  it('改名前提：203 法务审阅专家引用 sk_304，改名成功后详情用新名', async () => {
    resetSkillRaw('sk_304', { refNames: [], expertRefNames: ['经营分析专家', '法务审阅专家'] })
    expect((await getExpert(203)).skillIds).toContain(304)
    expect((await updateExpert(203, { name: '法务审阅专家改名' })).name).toBe('法务审阅专家改名')
  })

  // 2026-11-10 修复：updateExpert 改名时原先改的是技能的 refNames（岗位名组），改名后技能「引用情况 / 停用拦截」里还是旧专家名
  it('专家改名后，所引用技能的 expertRefNames 换成新名、不再留旧名', async () => {
    resetSkillRaw('sk_304', { refNames: [], expertRefNames: ['经营分析专家', '法务审阅专家'] })
    await updateExpert(203, { name: '法务审阅专家改名' })
    expect(getRawSkill('sk_304').expertRefNames).toEqual(['经营分析专家', '法务审阅专家改名'])
  })

  it('发布流：无技能拦发布；升级说明必填（md §二.3.1 L230，2026-09-18 待办 yuepu#13·专家 E4：此前数据层不拦）；提交发布进审核（语义化版本号）；撤回清 pending*', async () => {
    await updateExpert(203, { skillIds: [] })
    await expect(publishExpert(203)).rejects.toMatchObject({ message: '至少引用 1 个技能才能发布' })
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

// 强制回收（PRD 专家 §3.5.1，2026-10-12 改版）：不再是独立动作，而是 unpublishExpert 的 { forceRevoke, reason } 勾选项，
// 与普通停用走同一条审核链路，审核通过才回收。201 经营分析专家 = 已发布 v2.3.0；204 研究报告专家 = 已发布 + 新版在审；203 法务审阅专家 = 未发布
describe('unpublishExpert({ forceRevoke }) —— 强制回收（停用勾选项，审核通过才生效）', () => {
  beforeEach(() => resetAccessAuditMock())
  const reviewTotal = async () => (await listReviews({ size: 1000 })).total
  const revoke = (id, reason) => unpublishExpert(id, { forceRevoke: true, reason })

  it('前置条件：与普通停用同口径——未发布 / 已有在途审核的专家不能提交', async () => {
    await expect(revoke(203, '风险')).rejects.toThrow('仅已发布专家可停用')
    await expect(revoke(204, '风险')).rejects.toThrow('该专家已有在途审核')
    await revoke(201, '风险')
    await expect(revoke(201, '再来一次')).rejects.toThrow('该专家已有在途审核')
  })

  it('原因必填且 ≤500 字；校验不通过时不提交、不进审核中心', async () => {
    const reviewsBefore = await reviewTotal()
    await expect(revoke(201, ' ')).rejects.toMatchObject({ message: '请输入回收原因', code: 40001 })
    await expect(revoke(201, 'x'.repeat(501))).rejects.toThrow('最多 500 字')
    expect(await getExpert(201)).toMatchObject({ status: 'published', pendingAction: null })
    expect(await reviewTotal()).toBe(reviewsBefore)
  })

  it('提交后与普通停用状态一致：审核中、仍是已发布、未标已回收、不写审计；审核中心有一条带强制回收标记的待审停用申请', async () => {
    await revoke(201, ' 专家输出异常 ')
    expect(await getExpert(201)).toMatchObject({ status: 'published', pendingAction: 'DELIST', latestVersionLabel: 'v2.3.0', revoked: null })
    expect(opsRecords.some((x) => x.action === '强制回收' && x.module === '专家')).toBe(false) // 全站种子里有技能 / API 的「已回收」样例审计，按模块过滤
    const row = (await listReviews({ size: 1000 })).list.find((r) => r.refId === 201 && r.type === 'EXPERT')
    expect(row).toMatchObject({ requestAction: 'FORCE_REVOKE', status: 'PENDING_REVIEW', forceRevokeReason: '专家输出异常' })
  })

  it('审核通过后才生效：回「未发布」（版本历史 / 最新版本号 / 最近发布时间保留）、行与详情带 revoked，并写一条访问审计', async () => {
    const before = await getExpert(201)
    await revoke(201, ' 召唤链路异常 ')
    expect(applyExpertReviewResult(201, 'DELIST', true)).toBe(true)

    const detail = await getExpert(201)
    expect(detail).toMatchObject({ status: 'draft', pendingAction: null, latestVersionLabel: 'v2.3.0', publishedAt: before.publishedAt })
    expect(detail.revoked).toMatchObject({ reason: '召唤链路异常', at: expect.any(String), operator: 'demo' }) // 无登录身份 → 内置演示管理员
    const { list } = await listExperts({ status: 'draft' })
    expect(list.find((e) => e.id === 201).revoked).toEqual(detail.revoked)
    expect((await listExpertPublications(201)).length).toBe(2)
    expect((await getExpert(202)).revoked).toBeNull() // 未回收的行 revoked 为 null
    expect((await getExpert(201)).skillIds).toEqual([302, 304]) // 专家自身对技能的引用不受影响

    const rec = opsRecords.find((x) => x.action === '强制回收' && x.target === '经营分析专家')
    expect(rec).toMatchObject({ module: '专家', detail: '召唤链路异常', version: 'v2.3.0', live: true })
  })

  // 访问审计 §6.2：操作人为提交申请的管理员（不是审核人）
  it('操作人 = 提交强制回收的管理员：A 提交、演示身份切成 B 后审核通过，revoked.operator 与审计操作人都是 A', async () => {
    const asUser = (username) =>
      Object.defineProperty(globalThis, 'localStorage', {
        value: { getItem: (k) => (k === 'ai_assistant_user' ? JSON.stringify({ username }) : null), setItem() {}, removeItem() {}, key: () => null, length: 0 },
        writable: true,
        configurable: true
      })
    try {
      asUser('admin_a')
      await revoke(201, '输出异常')
      asUser('reviewer_b')
      expect(applyExpertReviewResult(201, 'DELIST', true)).toBe(true)
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true, configurable: true })
    }
    expect((await getExpert(201)).revoked.operator).toBe('admin_a')
    expect(opsRecords.find((x) => x.action === '强制回收' && x.target === '经营分析专家').operator).toBe('admin_a')
  })

  // 专家被岗位引用时停用不拦截（PRD 专家 §3.5：停用 / 强制回收均不受岗位引用拦截；岗位侧随后按“引用已回收对象”处理）
  describe('被岗位引用（positionIds 非空）的专家停用不拦截', () => {
    /** 203 法务审阅专家 = 岗位私有、绑定 401+402，种子为未发布：走发布审核通过后得到「已发布 + 被两个岗位引用」。 */
    async function mkPublishedPositionExpert() {
      await publishExpert(203, { bump: 'NONE', releaseNotes: '首发' })
      expect(applyExpertReviewResult(203, 'FIRST_PUBLISH', true)).toBe(true)
      expect(await getExpert(203)).toMatchObject({ status: 'published', positionIds: [401, 402], positionCount: 2 })
    }

    it('普通停用：成功入审（审核中、仍已发布）', async () => {
      await mkPublishedPositionExpert()
      await expect(unpublishExpert(203)).resolves.toBeDefined()
      expect(await getExpert(203)).toMatchObject({ status: 'published', pendingAction: 'DELIST', positionIds: [401, 402] })
    })

    it('强制回收：成功入审，审核通过后已回收且岗位绑定关系保持不动', async () => {
      await mkPublishedPositionExpert()
      await expect(revoke(203, '引用岗位也要回收')).resolves.toBeDefined()
      expect(applyExpertReviewResult(203, 'DELIST', true)).toBe(true)
      expect(await getExpert(203)).toMatchObject({ status: 'draft', positionIds: [401, 402], revoked: { reason: '引用岗位也要回收' } })
    })
  })

  it('审核驳回 / 撤回：专家仍是已发布、无已回收标记、不落审计，且回收原因不残留到下一次普通停用', async () => {
    await revoke(201, '风险')
    applyExpertReviewResult(201, 'DELIST', false) // 驳回
    expect(await getExpert(201)).toMatchObject({ status: 'published', pendingAction: null, revoked: null })

    await revoke(201, '风险')
    await withdrawExpert(201) // 撤回
    expect(await getExpert(201)).toMatchObject({ status: 'published', pendingAction: null, revoked: null })

    await unpublishExpert(201) // 普通停用通过：不得沿用上次被丢弃的回收原因
    applyExpertReviewResult(201, 'DELIST', true)
    expect(await getExpert(201)).toMatchObject({ status: 'draft', revoked: null })
    expect(opsRecords.some((x) => x.action === '强制回收' && x.module === '专家')).toBe(false) // 全站种子里有技能 / API 的「已回收」样例审计，按模块过滤
  })

  it('普通停用审核通过：只回「未发布」，不标已回收、不落强制回收审计', async () => {
    await unpublishExpert(201)
    applyExpertReviewResult(201, 'DELIST', true)
    expect(await getExpert(201)).toMatchObject({ status: 'draft', revoked: null })
    expect(opsRecords.some((x) => x.action === '强制回收' && x.module === '专家')).toBe(false) // 全站种子里有技能 / API 的「已回收」样例审计，按模块过滤
  })

  it('重新发布：撤回 / 驳回不清 revoked，审核通过后清除并回到已发布', async () => {
    await revoke(201, '异常')
    applyExpertReviewResult(201, 'DELIST', true)
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
describe('domainExpertMock · 持久化读回（mockPersist v10；key iworker-demo-mock:domainExpert）', () => {
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

  it('createExpert 落盘（v=10）→ 重新 import 模块（模拟刷新）→ 列表与详情仍有新建专家', async () => {
    const first = await import('@/api/domainExpertMock')
    const created = await first.createExpert({ name: '读回验证专家', type: 'PLATFORM', category: '通用', avatar: '☆', intro: '读回', roleDesc: '你是读回专家', exampleQuestions: ['一', '二', '三'] })
    expect(JSON.parse(globalThis.localStorage.getItem(KEY)).v).toBe(10)
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

  // 2026-10-09 /test-audit 补缺口 C1（PRD 专家 §3.5.1）：强制回收通过是写点，刷新后「已回收」必须还在；10-12 改为提交 → 审核通过两步
  it('强制回收审核通过后刷新页面 → 专家仍是未发布，且带回收原因 / 时间 / 操作人', async () => {
    const first = await import('@/api/domainExpertMock')
    await first.unpublishExpert(201, { forceRevoke: true, reason: '刷新后仍应标已回收' })
    first.applyExpertReviewResult(201, 'DELIST', true)
    vi.resetModules()
    const fresh = await import('@/api/domainExpertMock')
    const detail = await fresh.getExpert(201)
    expect(detail.status).toBe('draft')
    expect(detail.revoked).toEqual({ reason: '刷新后仍应标已回收', at: expect.any(String), operator: 'demo' })
    expect((await fresh.listExperts({ status: 'draft' })).list.find((e) => e.id === 201).revoked.reason).toBe('刷新后仍应标已回收')
  })

  // 旧快照兼容：强制回收并入停用审核前落盘的快照，在审停用行没有 pendingRevokeReason / pendingRevokeBy
  it('旧 v7 快照里在审停用（pendingAction:DELIST）且缺回收原因 → 审核通过按普通停用处理：未发布、无已回收、无强制回收审计', async () => {
    const first = await import('@/api/domainExpertMock')
    await first.createExpert({ name: '触发落盘', type: 'PLATFORM' })
    const snap = JSON.parse(globalThis.localStorage.getItem(KEY))
    const old = snap.data.experts.find((e) => e.id === 201)
    old.pendingAction = 'DELIST'
    delete old.pendingRevokeReason
    delete old.pendingRevokeBy
    globalThis.localStorage.setItem(KEY, JSON.stringify(snap))
    vi.resetModules()
    const fresh = await import('@/api/domainExpertMock')
    const audit = await import('@/api/accessAuditMock')
    expect(fresh.applyExpertReviewResult(201, 'DELIST', true)).toBe(true)
    expect(await fresh.getExpert(201)).toMatchObject({ status: 'draft', revoked: null })
    expect(audit.opsRecords.some((x) => x.live && x.module === '专家' && x.action === '强制回收')).toBe(false)
  })

  // 审核中的强制回收申请刷新后不丢：pendingRevokeReason 在快照里，通过时才能照样落「已回收」
  it('强制回收提交后刷新页面（审核未完成）→ 专家仍是已发布 + 审核中；之后审核通过仍标已回收', async () => {
    const first = await import('@/api/domainExpertMock')
    await first.unpublishExpert(201, { forceRevoke: true, reason: '审核中刷新' })
    vi.resetModules()
    const fresh = await import('@/api/domainExpertMock')
    expect(await fresh.getExpert(201)).toMatchObject({ status: 'published', pendingAction: 'DELIST', revoked: null })
    fresh.applyExpertReviewResult(201, 'DELIST', true)
    expect((await fresh.getExpert(201)).revoked).toMatchObject({ reason: '审核中刷新' })
  })
})
