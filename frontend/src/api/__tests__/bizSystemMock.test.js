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

  it('type 只留该连接器类型；行带 type/referencedByPositions/positionCount，不再有 positionId（种子 biz_2101 会被其它用例删，只查稳定的 biz_2102/2103 + 自建行）', async () => {
    const hr = await getBizSystem('biz_2102')
    expect(hr).toMatchObject({ type: 'PLATFORM', positionCount: 0, referencedByPositions: [] })
    expect(hr).not.toHaveProperty('positionId')
    const contract = await getBizSystem('biz_2103')
    expect(contract).toMatchObject({ type: 'SYSTEM_DEFAULT', positionCount: 0, referencedByPositions: [] })
    // 岗位私有新建后没有任何岗位引用（引用关系在岗位侧产生），payload 带 positionId 也被忽略
    const created = await createBizSystem({ ...VALID, name: `类型筛选-${Date.now()}`, type: 'POSITION', positionId: 402 })
    expect(created).toMatchObject({ type: 'POSITION', positionCount: 0, referencedByPositions: [] })
    expect(created).not.toHaveProperty('positionId')
    const { list: pos } = await listBizSystems({ type: 'POSITION' })
    expect(pos.map((b) => b.id)).toContain(created.id)
    expect(pos.every((b) => b.type === 'POSITION')).toBe(true)
  })

  it('type 只在 createBizSystem 落一次，updateBizSystem 不改动（创建后不可改）；未传 type 落 PLATFORM 默认值', async () => {
    const created = await createBizSystem({ ...VALID, name: `岗位私有-${Date.now()}`, type: 'POSITION' })
    expect(created).toMatchObject({ type: 'POSITION' })
    const updated = await updateBizSystem(created.id, { ...VALID, name: created.name, description: '改描述', type: 'PLATFORM' })
    expect(updated).toMatchObject({ type: 'POSITION', description: '改描述' })
    const noType = await createBizSystem({ ...VALID, name: `无类型-${Date.now()}` })
    expect(noType).toMatchObject({ type: 'PLATFORM', positionCount: 0 })
  })

  it('列表按最近更新时间排序（默认由近到远；sort=asc 反向）（md §二.1 L30）', async () => {
    // 时间戳是秒级 +08:00 串（2026-09-23 待办 yuepu#20 起统一 nowIsoLocal）：甲乙若落在同一秒就并列、
    // 靠稳定排序碰运气——只冻结 Date 拨 2s，保证乙确实比甲晚（真实 delay 仍照常走）
    vi.useFakeTimers({ toFake: ['Date'] })
    const a = await mk(`排序甲-${Date.now()}`)
    vi.setSystemTime(Date.now() + 2000)
    const b = await mk(`排序乙-${Date.now()}`)
    vi.useRealTimers()
    // +08:00 本地 ISO 而非 UTC「Z」串（2026-09-23 待办 yuepu#20）
    expect(a.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/)
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

  it('状态变更刷新最近更新时间（待办 yuepu#45 负责人拍板）：提交发布 / 撤回 / 审核通过 / 提交停用 / 驳回 / 停用通过都刷新，停用通过后列表时间不再原地不动', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const row = await mk(`状态时间-${Date.now()}`)
      let last = row.updatedAt
      const steps = [
        ['提交发布', () => publishBizSystem(row.id)],
        ['撤回', () => withdrawBizSystem(row.id)],
        ['再提交发布', () => publishBizSystem(row.id)],
        ['审核通过', () => approveBizSystem(row.id)],
        ['提交停用', () => deactivateBizSystem(row.id)],
        ['停用被驳回', () => rejectBizSystem(row.id)],
        ['再提交停用', () => deactivateBizSystem(row.id)],
        ['停用审核通过', () => approveBizSystem(row.id)]
      ]
      for (const [label, step] of steps) {
        vi.setSystemTime(Date.now() + 2000)
        await step()
        const now = (await getBizSystem(row.id)).updatedAt
        expect(Date.parse(now), label).toBeGreaterThan(Date.parse(last))
        last = now
      }
      expect((await getBizSystem(row.id)).status).toBe('NOT_PUBLISHED')
    } finally {
      vi.useRealTimers()
    }
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

  it('删除状态守卫 + 软引用：已发布不可删；停用审核通过回到未发布后，被引用仍可删（md §2 L43-45 / §二.3 L52 / §四，2026-09-23 待办 yuepu#7②）', async () => {
    // biz_2101 种子已发布且被 2 个技能引用——此前只靠 UI 藏按钮，直调 mock 能绕过状态限制
    const before = await getBizSystem('biz_2101')
    expect(before.referencedBySkillCount).toBeGreaterThan(0)
    await expect(deleteBizSystem('biz_2101')).rejects.toMatchObject({ message: expect.stringContaining('删除仅适用于未发布状态') })
    await expect(getBizSystem('biz_2101')).resolves.toBeTruthy() // 未被误删

    // 走完整停用审核回到未发布态：引用关系不受影响，软引用规则下仍可删除
    await deactivateBizSystem('biz_2101')
    const afterApprove = await approveBizSystem('biz_2101')
    expect(afterApprove.status).toBe('NOT_PUBLISHED')
    expect((await getBizSystem('biz_2101')).referencedBySkillCount).toBeGreaterThan(0)
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

  it('11 个写点（含强制回收）各调 persist() 恰一次；读操作不调；快照 version=4 且含 bizSeq/skillSeq/bizRows', async () => {
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
      // 2026-10-09 补缺口 C2：强制回收（prd-业务系统.md §3）也是写点；回收后回未发布，重新走一轮发布审核再接着停用
      () => m.forceRevokeBizSystem(row.id, '持久化回收'),
      () => m.publishBizSystem(row.id),
      () => m.approveBizSystem(row.id),
      () => m.deactivateBizSystem(row.id),
      // 停用审核通过 → 未发布（md §2 L43-45「删除仅未发布状态展示」，2026-09-23 待办 yuepu#7②）：
      // 删除前必须先把行落回未发布态，否则会撞新加的状态守卫
      () => m.approveBizSystem(row.id),
      () => m.createBizSystemOwnedSkill(row.id, { name: '专属技能' }),
      () => m.deleteBizSystemOwnedSkill(row.id, 'sk_own_3'),
      () => m.deleteBizSystem(row.id)
    ]
    expect(harness.persist).toHaveBeenCalledTimes(1) // create
    for (let i = 0; i < steps.length; i++) {
      await run(steps[i]())
      expect(harness.persist).toHaveBeenCalledTimes(i + 2)
    }
    expect(harness.options.version).toBe(4)
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

describe('bizSystemMock —— 强制回收（prd-业务系统.md §3）', () => {
  const reason = '系统停用，紧急回收'
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  // 每例冷 import 拿全新种子；audit 与 mock 同一模块注册表
  async function fresh() {
    vi.resetModules()
    const m = await import('../bizSystemMock')
    const audit = await import('../accessAuditMock')
    const harness = persistHarness.modules.get('bizSystem')
    const run = async (p) => {
      p.catch(() => {})
      await vi.runAllTimersAsync()
      return p
    }
    return { m, audit, harness, run }
  }

  it('已发布行可回收：状态回未发布、写 revoked、保留 publishedAt；不进审核（无待审类型）；引用清单保留', async () => {
    const { m, harness, run } = await fresh()
    const before = await run(m.getBizSystem('biz_2101'))
    expect(before.revoked).toBeNull()
    harness.persist.mockClear()
    const row = await run(m.forceRevokeBizSystem('biz_2101', reason))
    expect(row.status).toBe('NOT_PUBLISHED')
    expect(row.pendingAction).toBeNull()
    expect(row.revoked).toEqual({ reason, at: expect.any(String), operator: expect.any(String) })
    expect(row.publishedAt).toBe(before.publishedAt)
    expect(row.referencedBySkills).toEqual(before.referencedBySkills)
    expect(row.referencedByPositions).toEqual(before.referencedByPositions)
    expect(harness.persist).toHaveBeenCalledTimes(1)
    const listed = (await run(m.listBizSystems({ state: 'NOT_PUBLISHED' }))).list.find((b) => b.id === 'biz_2101')
    expect(listed.revoked.reason).toBe(reason)
  })

  it('写访问审计：模块 业务系统 · 动作 强制回收 · 变更内容 = 回收原因', async () => {
    const { m, audit, run } = await fresh()
    const n = audit.opsRecords.length
    await run(m.forceRevokeBizSystem('biz_2101', reason))
    expect(audit.opsRecords.length).toBe(n + 1)
    expect(audit.opsRecords[0]).toMatchObject({ module: '业务系统', action: '强制回收', target: '客户管理系统 CRM', detail: reason })
  })

  it('前置条件：未发布 / 审核中（发布审核、停用审核）/ 不存在一律拒绝', async () => {
    const { m, run } = await fresh()
    await expect(run(m.forceRevokeBizSystem('biz_2103', reason))).rejects.toThrow('状态已变化，请刷新后重试') // 未发布
    await expect(run(m.forceRevokeBizSystem('biz_2102', reason))).rejects.toThrow('状态已变化，请刷新后重试') // 待审发布
    await run(m.deactivateBizSystem('biz_2101')) // 已发布 → 待审停用
    await expect(run(m.forceRevokeBizSystem('biz_2101', reason))).rejects.toThrow('状态已变化，请刷新后重试')
    await expect(run(m.forceRevokeBizSystem('nope', reason))).rejects.toThrow('业务系统不存在')
  })

  it('重新发布：提交 / 撤回 / 驳回不清 revoked，审核通过才清（approveBizSystem 与审核中心落地两条路径）', async () => {
    const { m, run } = await fresh()
    await run(m.forceRevokeBizSystem('biz_2101', reason))
    await run(m.publishBizSystem('biz_2101'))
    expect((await run(m.getBizSystem('biz_2101'))).revoked).not.toBeNull()
    await run(m.withdrawBizSystem('biz_2101'))
    expect((await run(m.getBizSystem('biz_2101'))).revoked).not.toBeNull()
    await run(m.publishBizSystem('biz_2101'))
    await run(m.rejectBizSystem('biz_2101'))
    expect((await run(m.getBizSystem('biz_2101'))).revoked).not.toBeNull()
    await run(m.publishBizSystem('biz_2101'))
    await run(m.approveBizSystem('biz_2101'))
    let done = await run(m.getBizSystem('biz_2101'))
    expect(done.status).toBe('PUBLISHED')
    expect(done.revoked).toBeNull()
    // 审核中心落地路径
    await run(m.forceRevokeBizSystem('biz_2101', reason))
    await run(m.publishBizSystem('biz_2101'))
    expect(m.applyBizSystemReviewResult('biz_2101', undefined, false)).toBe(true)
    expect((await run(m.getBizSystem('biz_2101'))).revoked).not.toBeNull()
    await run(m.publishBizSystem('biz_2101'))
    expect(m.applyBizSystemReviewResult('biz_2101', undefined, true)).toBe(true)
    done = await run(m.getBizSystem('biz_2101'))
    expect(done.revoked).toBeNull()
  })

  // 2026-10-09 /test-audit 补缺口 C1：回收 → 快照 → 在全新模块实例里还原（等价刷新；mockPersist 在本文件被桩掉，走 snapshot/restore 这条缝）
  it('持久化往返：回收后刷新 → 仍是未发布，且带回收原因 / 时间 / 操作人', async () => {
    const first = await fresh()
    await first.run(first.m.forceRevokeBizSystem('biz_2101', reason))
    const snap = JSON.parse(JSON.stringify(first.harness.options.snapshot()))
    const { m, harness, run } = await fresh()
    harness.options.restore(snap)
    const row = await run(m.getBizSystem('biz_2101'))
    expect(row.status).toBe('NOT_PUBLISHED')
    expect(row.revoked).toEqual({ reason, at: expect.any(String), operator: expect.any(String) })
    expect((await run(m.listBizSystems({ state: 'NOT_PUBLISHED' }))).list.find((b) => b.id === 'biz_2101').revoked.reason).toBe(reason)
  })

  it('持久化：restore 兼容缺 revoked 的旧快照行', async () => {
    const { m, harness, run } = await fresh()
    const snap = JSON.parse(JSON.stringify(harness.options.snapshot()))
    snap.bizRows.forEach((b) => delete b.revoked)
    harness.options.restore(snap)
    // 2026-10-09 补缺口 C3：不用 ?? null 掩盖——现状 restore 不给缺键行补 null，出参是 undefined（见审计报告）
    expect((await run(m.getBizSystem('biz_2101'))).revoked).toBeUndefined()
    const row = await run(m.forceRevokeBizSystem('biz_2101', reason))
    expect(row.revoked.reason).toBe(reason)
  })
})
