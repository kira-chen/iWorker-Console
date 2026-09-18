// @vitest-environment jsdom
// （bizSystemMock → request.js → router 链路触达 window，故用 jsdom；同 fieldDictMock.test.js）
// 注意：vitest 全局随机顺序执行——用例间不得有状态顺序依赖：
// 种子断言只查从不被本文件改写/删除的行（biz_2102/biz_2103）；
// 软引用删除用例专删 biz_2101；状态机用例各自新建专属行自洽驱动；
// 持久化用例 vi.resetModules() 后动态 import 拿独立实例，不碰顶层实例。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * bizSystemMock.js 数据层单测。对齐 docs/PRD/数字员工管理端PRD/03能力/连接器/业务系统/prd-业务系统.md：
 *   §一.1 搜索按名称或描述 / 状态筛选；§二.1 L30 按最近更新时间排序；
 *   §二.3 / §二.4 三态状态机（发布 / 停用均过审，撤回与驳回按待审类型恢复）；软引用删除；
 *   §三.2 / §三.7 保存校验（名称必填 ≤64 平台内不可重复、图标、描述、登录地址、示例问题 3 条）；
 *   §三.4 业务系统专属技能；+ 持久化（10 个写点 persist 一次、快照形状、bizSeq 延续）。
 * mockPersist 走 vi.hoisted 桩（范式同 runtimeSpecMock.test.js）。
 */

const persistHarness = vi.hoisted(() => ({ modules: new Map() }))
vi.mock('../mockPersist', () => ({
  attachPersist(moduleKey, options) {
    const persist = vi.fn()
    persistHarness.modules.set(moduleKey, { options, persist })
    return persist
  }
}))

import {
  listBizSystems,
  getBizSystem,
  createBizSystem,
  updateBizSystem,
  deleteBizSystem,
  publishBizSystem,
  withdrawBizSystem,
  deactivateBizSystem,
  approveBizSystem,
  rejectBizSystem,
  listBizSystemSkills,
  createBizSystemOwnedSkill,
  deleteBizSystemOwnedSkill,
} from '../bizSystemMock'

const VALID = {
  icon: '✓',
  description: '测试用业务系统',
  loginUrl: 'https://demo.example.com/login',
  bizPages: [],
  exampleQuestions: ['帮我发起一个审批', '帮我打开工作台', '帮我查一条记录']
}
// 新建一条合法业务系统（名称唯一）
async function mk(name) {
  return createBizSystem({ name, ...VALID })
}

describe('bizSystemMock —— 业务系统三态状态机 + 软引用删除（md §二.3 / §二.4）', () => {
  it('种子行内直接带 display 字段（status/pendingAction/refs/icon/时间），列表免二次请求', async () => {
    const b = await getBizSystem('biz_2102') // 审核中种子行，本文件从不改写
    expect(b.status).toBe('PENDING_REVIEW')
    expect(b.pendingAction).toBe('PUBLISH')
    expect(b.icon).toBe('▦')
    expect(b.refs).toEqual(['员工信息查询'])
    expect(b.referencedBySkillCount).toBe(1)
    expect(b.exampleQuestions).toHaveLength(3)
    expect(b.exampleQuestions.every((q) => q.trim())).toBe(true)
    expect(b.createdAt).toBeTruthy()
    expect(b.updatedAt).toBeTruthy()
  })

  it('搜索覆盖名称 + 描述，命中的每一条都含关键词；状态筛选只留该状态（md §一.1 L10-11）', async () => {
    const byDesc = await listBizSystems({ keyword: '入转调离' })
    expect(byDesc.list.length).toBeGreaterThan(0)
    expect(byDesc.list.every((b) => b.name.includes('入转调离') || b.description.includes('入转调离'))).toBe(true)
    expect(byDesc.list.map((b) => b.id)).toContain('biz_2102')
    expect(byDesc.list.map((b) => b.id)).not.toContain('biz_2103')
    const byState = await listBizSystems({ state: 'PENDING_REVIEW' })
    expect(byState.list.length).toBeGreaterThan(0)
    expect(byState.list.every((b) => b.status === 'PENDING_REVIEW')).toBe(true)
    expect(byState.list.map((b) => b.id)).toContain('biz_2102')
    expect(byState.list.map((b) => b.id)).not.toContain('biz_2103')
  })

  it('type 只留该连接器类型；行带 type/positionId/positionCount（2026-09-18 待办 yuepu#1；种子 biz_2101 会被其它用例删，只查稳定的 biz_2102/2103 + 自建行）', async () => {
    const hr = await getBizSystem('biz_2102')
    expect(hr).toMatchObject({ type: 'PLATFORM', positionId: null, positionCount: 0 })
    const contract = await getBizSystem('biz_2103')
    expect(contract).toMatchObject({ type: 'SYSTEM_DEFAULT', positionId: null, positionCount: 0 })
    const created = await createBizSystem({ ...VALID, name: `类型筛选-${Date.now()}`, type: 'POSITION', positionId: 402 })
    expect(created).toMatchObject({ type: 'POSITION', positionId: 402, positionCount: 1 })
    const { list: pos } = await listBizSystems({ type: 'POSITION' })
    expect(pos.map((b) => b.id)).toContain(created.id)
    expect(pos.every((b) => b.type === 'POSITION')).toBe(true)
  })

  it('type/positionId 只在 createBizSystem 落一次，updateBizSystem 不改动（创建后不可改）；未传 type 落 PLATFORM 默认值', async () => {
    const created = await createBizSystem({ ...VALID, name: `岗位私有-${Date.now()}`, type: 'POSITION', positionId: 401 })
    expect(created).toMatchObject({ type: 'POSITION', positionId: 401 })
    const updated = await updateBizSystem(created.id, { ...VALID, name: created.name, description: '改描述', type: 'PLATFORM', positionId: null })
    expect(updated).toMatchObject({ type: 'POSITION', positionId: 401, description: '改描述' })
    const noType = await createBizSystem({ ...VALID, name: `无类型-${Date.now()}` })
    expect(noType).toMatchObject({ type: 'PLATFORM', positionId: null })
  })

  it('列表按最近更新时间排序（默认由近到远；sort=asc 反向）（md §二.1 L30）', async () => {
    const a = await mk(`排序甲-${Date.now()}`)
    const b = await mk(`排序乙-${Date.now()}`)
    const { list } = await listBizSystems({ keyword: '排序' })
    const idx = (id) => list.findIndex((x) => x.id === id)
    expect(idx(b.id)).toBeLessThan(idx(a.id)) // 后建（更近更新）在前
    const asc = await listBizSystems({ keyword: '排序', sort: 'asc' })
    const idxAsc = (id) => asc.list.findIndex((x) => x.id === id)
    expect(idxAsc(a.id)).toBeLessThan(idxAsc(b.id))
  })

  it('必填校验：图标 / 描述 / 登录地址 / 示例问题 3 条 各回 field（md §三.2 / §三.7）', async () => {
    const base = { ...VALID, name: `校验-${Date.now()}`, description: 'd', loginUrl: 'https://x.example.com', exampleQuestions: ['a', 'b', 'c'] }
    await expect(createBizSystem({ ...base, icon: '' })).rejects.toMatchObject({ field: 'icon', message: '请选择图标' })
    await expect(createBizSystem({ ...base, description: '' })).rejects.toMatchObject({ field: 'description', message: '系统描述必填' })
    await expect(createBizSystem({ ...base, loginUrl: 'notaurl' })).rejects.toMatchObject({
      field: 'loginUrl',
      message: '登录地址必须以 http:// 或 https:// 开头'
    })
    await expect(createBizSystem({ ...base, exampleQuestions: ['a', '', 'c'] })).rejects.toMatchObject({
      field: 'exampleQuestions',
      message: '示例问题固定 3 条，须全部填写'
    })
    // 每条 ≤300（2026-09-18 待办 yuepu#5⑥：BIZ_QUESTION_MAX 曾卡在 60，输入框已放宽到 300，此前保存会被拒）
    await expect(createBizSystem({ ...base, exampleQuestions: ['x'.repeat(301), 'b', 'c'] })).rejects.toMatchObject({
      field: 'exampleQuestions',
      message: '示例问题每条最多 300 个字符'
    })
    // 换个名字，避免这条成功创建的行占掉 base.name、影响本测试后续复用同名的失败态断言
    await expect(createBizSystem({ ...base, name: `${base.name}-ok`, exampleQuestions: ['x'.repeat(300), 'b', 'c'] })).resolves.toMatchObject({
      exampleQuestions: expect.arrayContaining(['x'.repeat(300)])
    })
    await expect(createBizSystem({ ...base, bizPages: Array.from({ length: 21 }, () => ({ url: 'https://a.com', name: 'p' })) })).rejects.toMatchObject({
      field: 'bizPages',
      message: '业务页最多 20 条'
    })
  })

  // 2026-09-12 测试审计 T58（A31）：md §三.2 L86「系统名称：必填，平台内不可重复」+ 一览表 §七「最多 64 字符」
  it('系统名称：空 / 65 字 / 与种子「人力资源系统」同名 → rejects field=name；64 字通过', async () => {
    await expect(createBizSystem({ ...VALID, name: '   ' })).rejects.toMatchObject({ field: 'name', message: '系统名称必填' })
    await expect(createBizSystem({ ...VALID, name: 'x'.repeat(65) })).rejects.toMatchObject({
      field: 'name',
      message: '系统名称最多 64 个字符'
    })
    await expect(createBizSystem({ ...VALID, name: '人力资源系统' })).rejects.toMatchObject({
      field: 'name',
      message: '系统名称平台内不可重复'
    })
    const ok = await createBizSystem({ ...VALID, name: `名${'长'.repeat(63)}` })
    expect(ok.name.length).toBe(64)
  })

  it('编辑：与自身同名不算重复（updatedAt 刷新、bizPages/描述按 payload 覆盖）；改成别人的名字算重复', async () => {
    const row = await mk(`编辑甲-${Date.now()}`)
    const other = await mk(`编辑乙-${Date.now()}`)
    const before = row.updatedAt
    await new Promise((r) => setTimeout(r, 5))
    const updated = await updateBizSystem(row.id, {
      ...VALID,
      name: row.name,
      description: '改过的描述',
      bizPages: [{ url: 'https://demo.example.com/ws', name: '工作台', description: '' }]
    })
    expect(updated.description).toBe('改过的描述')
    expect(updated.bizPagesCount).toBe(1)
    // K41（2026-09-12 md §三.3 L108）：整行空白的业务页 mock 侧同样丢弃，仅空格 / 全空行不落库；非空行照存
    const withBlank = await updateBizSystem(row.id, {
      ...VALID,
      name: row.name,
      bizPages: [
        { url: '', name: '', description: '' },
        { url: 'https://demo.example.com/ws', name: '工作台', description: '' },
        { url: '  ', name: ' ', description: '' },
        { url: '', name: '', description: '只填了说明' }
      ]
    })
    expect(withBlank.bizPagesCount).toBe(2)
    expect(withBlank.bizPages.map((p) => [p.name, p.description])).toEqual([['工作台', ''], ['', '只填了说明']])
    expect(updated.updatedAt >= before).toBe(true)
    await expect(updateBizSystem(row.id, { ...VALID, name: other.name })).rejects.toMatchObject({ field: 'name' })
    await expect(updateBizSystem('biz_nope', { ...VALID, name: 'x' })).rejects.toThrow('业务系统不存在')
  })

  it('状态机：发布过审→撤回回未发布→审核通过→停用过审→撤回回已发布→停用审核通过回未发布（md §二.3 L45-49 / §二.4）', async () => {
    const row = await mk(`状态机-${Date.now()}`)
    expect(row.status).toBe('NOT_PUBLISHED')
    // 发布 → 审核中（pendingAction=PUBLISH）
    const p = await publishBizSystem(row.id)
    expect(p.status).toBe('PENDING_REVIEW')
    expect(p.pendingAction).toBe('PUBLISH')
    // 撤回待审发布 → 未发布
    const w = await withdrawBizSystem(row.id)
    expect(w.status).toBe('NOT_PUBLISHED')
    // 再发布并审核通过 → 已发布 + publishedAt
    await publishBizSystem(row.id)
    const ok = await approveBizSystem(row.id)
    expect(ok.status).toBe('PUBLISHED')
    expect(ok.publishedAt).toBeTruthy()
    // 停用过审：状态转审核中，pendingAction=DEACTIVATE
    const d = await deactivateBizSystem(row.id)
    expect(d.status).toBe('PENDING_REVIEW')
    expect(d.pendingAction).toBe('DEACTIVATE')
    // 撤回待审停用 → 恢复已发布
    const w2 = await withdrawBizSystem(row.id)
    expect(w2.status).toBe('PUBLISHED')
    // 停用审核通过 → 未发布
    await deactivateBizSystem(row.id)
    const done = await approveBizSystem(row.id)
    expect(done.status).toBe('NOT_PUBLISHED')
  })

  // 2026-09-12 测试审计 T58（A31）：md §二.3 L49「被拒绝或撤回后恢复"已发布"」
  it('驳回与撤回同向：待审停用被驳回 → 保持已发布；待审发布被驳回 → 未发布；无待审事项驳回报错', async () => {
    const row = await mk(`驳回-${Date.now()}`)
    await publishBizSystem(row.id)
    const r1 = await rejectBizSystem(row.id)
    expect([r1.status, r1.pendingAction]).toEqual(['NOT_PUBLISHED', null])
    await publishBizSystem(row.id)
    await approveBizSystem(row.id)
    await deactivateBizSystem(row.id)
    const r2 = await rejectBizSystem(row.id)
    expect([r2.status, r2.pendingAction]).toEqual(['PUBLISHED', null])
    await expect(rejectBizSystem(row.id)).rejects.toThrow('该业务系统没有待审事项')
    await expect(approveBizSystem(row.id)).rejects.toThrow('该业务系统没有待审事项')
  })

  it('越界动作各自拒绝：非未发布不可发布、非审核中不可撤回、非已发布不可停用', async () => {
    const row = await mk(`越界-${Date.now()}`)
    await expect(withdrawBizSystem(row.id)).rejects.toThrow('仅审核中状态可撤回')
    await expect(deactivateBizSystem(row.id)).rejects.toThrow('仅已发布状态可停用')
    await publishBizSystem(row.id)
    await expect(publishBizSystem(row.id)).rejects.toThrow('仅未发布状态可提交发布')
  })

  it('软引用删除：被技能引用亦可删（md §二.3 L52 / §四）', async () => {
    const before = await getBizSystem('biz_2101')
    expect(before.referencedBySkillCount).toBeGreaterThan(0)
    await expect(deleteBizSystem('biz_2101')).resolves.toEqual({})
    await expect(getBizSystem('biz_2101')).rejects.toThrow('不存在')
  })

  it('专属技能（md §三.4）：新建 → 列表 → 删除；技能名空报错', async () => {
    const created = await createBizSystemOwnedSkill('biz_2102', { name: '入职材料核对' })
    expect(created.skillId).toBeTruthy()
    let skills = await listBizSystemSkills('biz_2102')
    expect(skills.some((s) => s.skillId === created.skillId)).toBe(true)
    await deleteBizSystemOwnedSkill('biz_2102', created.skillId)
    skills = await listBizSystemSkills('biz_2102')
    expect(skills.some((s) => s.skillId === created.skillId)).toBe(false)
    await expect(createBizSystemOwnedSkill('biz_2102', { name: ' ' })).rejects.toMatchObject({ field: 'name' })
  })

  it('专属技能名最多 64 个字符（2026-09-18 待办 yuepu#5④，原 128；与技能模块技能名同口径，此前无长度校验）', async () => {
    await expect(createBizSystemOwnedSkill('biz_2102', { name: 'x'.repeat(65) })).rejects.toMatchObject({
      field: 'name',
      message: '技能名最多 64 个字符'
    })
    const ok = await createBizSystemOwnedSkill('biz_2102', { name: 'x'.repeat(64) })
    expect(ok.name.length).toBe(64)
  })

})

/**
 * 持久化（2026-09-12 测试审计 T58 / F11）：写点=新建/编辑/删除、发布/撤回/停用/审核通过/驳回、专属技能增删 共 10 处；
 * restore 做最小形状校验；bizSeq/skillSeq 从快照延续（刷新后新建的 id 不与存量撞车）。
 * 每条用例 vi.resetModules() 拿全新模块实例（不影响上面顶层实例的用例）。
 */
describe('bizSystemMock —— 持久化', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  async function fresh() {
    vi.resetModules()
    const m = await import('../bizSystemMock')
    const harness = persistHarness.modules.get('bizSystem')
    harness.persist.mockClear()
    // 每个 mock 操作都 await delay()：用假定时器一次跑完，免得 30 多次串行调用吃掉几秒
    const run = async (p) => {
      p.catch(() => {})
      await vi.runAllTimersAsync()
      return p
    }
    return { m, harness, run }
  }

  it('10 个写点各调 persist() 恰一次；读操作不调；快照 version=2 且含 bizSeq/skillSeq/bizRows', async () => {
    const { m, harness, run } = await fresh()
    await run(m.listBizSystems())
    await run(m.getBizSystem('biz_2103'))
    await run(m.listBizSystemSkills('biz_2101'))
    expect(harness.persist).not.toHaveBeenCalled()
    const row = await run(m.createBizSystem({ ...VALID, name: '持久化系统' }))
    const steps = [
      () => m.updateBizSystem(row.id, { ...VALID, name: '持久化系统', description: '改' }),
      () => m.publishBizSystem(row.id),
      () => m.withdrawBizSystem(row.id),
      () => m.publishBizSystem(row.id),
      () => m.rejectBizSystem(row.id),
      () => m.publishBizSystem(row.id),
      () => m.approveBizSystem(row.id),
      () => m.deactivateBizSystem(row.id),
      () => m.createBizSystemOwnedSkill(row.id, { name: '专属技能' }),
      () => m.deleteBizSystemOwnedSkill(row.id, 'sk_own_3'),
      () => m.deleteBizSystem(row.id)
    ]
    expect(harness.persist).toHaveBeenCalledTimes(1) // create
    for (let i = 0; i < steps.length; i++) {
      await run(steps[i]())
      expect(harness.persist).toHaveBeenCalledTimes(i + 2)
    }
    expect(harness.options.version).toBe(2)
    const snap = harness.options.snapshot()
    expect(Number.isFinite(snap.bizSeq)).toBe(true)
    expect(Number.isFinite(snap.skillSeq)).toBe(true)
    expect(snap.bizRows.some((b) => b.id === row.id)).toBe(false)
    expect(snap.bizRows.some((b) => b.id === 'biz_2103')).toBe(true)
  })

  it('restore：形状不合法抛「bizSystem 快照形状不合法」，合法快照写回后 bizSeq / skillSeq 延续、行数据以快照为准', async () => {
    const { m, harness, run } = await fresh()
    expect(() => harness.options.restore(null)).toThrow('bizSystem 快照形状不合法')
    expect(() => harness.options.restore({ bizSeq: 1, skillSeq: 1, bizRows: 'x' })).toThrow('bizSystem 快照形状不合法')
    expect(() => harness.options.restore({ bizSeq: 'a', skillSeq: 1, bizRows: [] })).toThrow('bizSystem 快照形状不合法')
    const snap = JSON.parse(JSON.stringify(harness.options.snapshot()))
    snap.bizSeq = 9000
    snap.skillSeq = 77
    snap.bizRows = snap.bizRows.filter((b) => b.id !== 'biz_2103')
    harness.options.restore(snap)
    await expect(run(m.getBizSystem('biz_2103'))).rejects.toThrow('业务系统不存在')
    const created = await run(m.createBizSystem({ ...VALID, name: '延续序号' }))
    expect(created.id).toBe('biz_9000')
    const skill = await run(m.createBizSystemOwnedSkill(created.id, { name: 'x' }))
    expect(skill.skillId).toBe('sk_own_77')
  })
})
