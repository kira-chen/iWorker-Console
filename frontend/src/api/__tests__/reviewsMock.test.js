import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  listReviews,
  getReview,
  approveReview,
  rejectReview,
  submitReviewRow,
  cancelReviewRow,
  resetReviewsMock
} from '../reviewsMock'

/**
 * 审核中心 mock 层回归保护（2026-09-12 对齐 md `prd.审核中心.md` §二 / §3.1 / §5.1 / §5.2 / §六）：
 * 种子 = 8 条待审记录 + 1 条知识库待审记录（2026-09-09 PRD 复核·G3G6 · A6）；列表只出待审核（md §六 L88）；
 * 业务类型八项筛选（md §二.2，含知识库；MCP/API 由 TOOL+subType 拆分）；申请类型筛选（md §二.3）；
 * submittedAt 排序默认 desc（md §3.1）；通过（含停用申请 → 已下架，md §5.2 L80）/ 驳回后记录离开待审列表（md §5.1 L71 / §5.2 L82）。
 * 2026-09-12 测试审计 T56：补提交端接线（submitReviewRow 覆盖在审行、新 id 避开种子 / cancelReviewRow 静默，md §六 L92）；F9 补 restore 形状守卫。
 *
 * 【超时放宽到 20s】2026-09-12 负责人决策 5（审计 J12）起，approveReview / rejectReview 会联动业务对象
 * （按行 type 动态 import 对应业务 mock 再落态，见 reviewsMock.js LOADERS）。首次调用要现场加载一个
 * 千行级业务 mock，叠上各 mock 自带的 delay(150~900) 拟真耗时，全量并行跑（160 个测试文件抢 CPU）时
 * 会顶破 vitest 5s 默认超时翻假红。放宽的是等待上限，断言一个没松。
 */
describe('reviewsMock · 审核中心内存 mock', { timeout: 20000 }, () => {
  beforeEach(() => resetReviewsMock())

  it('默认列表：9 条全待审（含知识库 A6 新增行），按 submittedAt desc', async () => {
    const { list, total } = await listReviews()
    expect(total).toBe(9)
    expect(list.every((r) => r.status === 'PENDING_REVIEW')).toBe(true)
    const times = list.map((r) => r.submittedAt)
    expect(times).toEqual([...times].sort().reverse())
    expect(list[0].name).toBe('法规与标准库') // 2026-08-28 11:02 最新（A6 知识库行）
  })

  it('申请类型补丁：id 3/6=停用 v2.0.0，id 1/4/8=首次发布 —，其余=新版本发布（id 2 取技能 sk_302 在审号 v1.5.0，余 v1.2.0）', async () => {
    const { list } = await listReviews()
    const byId = Object.fromEntries(list.map((r) => [r.id, r]))
    expect(byId[3].requestAction).toBe('DELIST')
    expect(byId[3].version).toBe('v2.0.0')
    expect(byId[1].requestAction).toBe('FIRST_PUBLISH')
    expect(byId[1].version).toBe('—')
    expect(byId[2].requestAction).toBe('VERSION_PUBLISH')
    // 2026-09-12 审计 K19：id 2 指向 sk_302，其在审版本已改 v1.5.0（由线上 v1.4.0 递增），
    // 审核中心列表要与技能详情/审核快照同号，故这里也是 v1.5.0；其余新版本发布行仍 v1.2.0。
    expect(byId[2].version).toBe('v1.5.0')
    expect(byId[5].version).toBe('v1.2.0')
  })

  it('业务类型筛选：CONNECTOR_MCP / CONNECTOR_API 由 TOOL+subType 拆分', async () => {
    const mcp = await listReviews({ type: 'CONNECTOR_MCP' })
    expect(mcp.list.map((r) => r.id)).toEqual([8])
    const api = await listReviews({ type: 'CONNECTOR_API' })
    expect(api.list.map((r) => r.id)).toEqual([1])
    const skill = await listReviews({ type: 'SKILL' })
    expect(skill.list.map((r) => r.id).sort()).toEqual([2, 7])
    const biz = await listReviews({ type: 'CONNECTOR_BIZ' })
    expect(biz.list.map((r) => r.id)).toEqual([3])
  })

  it('2026-09-08 原型复刻批次 2B（G-4）：POSITION 行 5 refId 接线岗位 mock 403（借财务审核岗示意）', async () => {
    const row = await getReview(5)
    expect(row.type).toBe('POSITION')
    expect(row.refId).toBe(403)
  })

  it('keyword 过滤域 = 名称/描述/提交人（搜提交人 zhangwei 命中技能行）', async () => {
    const { list } = await listReviews({ keyword: 'zhangwei' })
    expect(list.map((r) => r.id)).toEqual([7])
  })

  it('申请类型筛选 + 升序排序', async () => {
    // 取 VERSION_PUBLISH 做多行样本：DELIST 自 2026-09-09 起只剩 id 3 一条（原 id 6 改指
    // 在审的专家 204、方向为 VERSION_PUBLISH），单行验证不出排序。按提交时间升序：
    // 5(08-27 14:05) → 7(08-28 08:55) → 2(08-28 09:18) → 6(08-28 10:18)
    const { list } = await listReviews({ requestAction: 'VERSION_PUBLISH', sortDir: 'asc' })
    expect(list.map((r) => r.id)).toEqual([5, 7, 2, 6])
    // DELIST 仍可筛出且只此一条
    const delist = await listReviews({ requestAction: 'DELIST' })
    expect(delist.list.map((r) => r.id)).toEqual([3])
  })

  it('通过发布申请 → PUBLISHED 并移出待审列表', async () => {
    const row = await approveReview(1)
    expect(row.status).toBe('PUBLISHED')
    const { total } = await listReviews()
    expect(total).toBe(8)
  })

  it('通过停用申请 → DELISTED（md §5.2 L80「停用申请通过后，对象变为未发布 / 已下架」）', async () => {
    const row = await approveReview(3)
    expect(row.status).toBe('DELISTED')
  })

  it('驳回：原因必填，成功后 REJECTED 带 rejectReason', async () => {
    await expect(rejectReview(2, '   ')).rejects.toThrow('请输入驳回原因')
    const row = await rejectReview(2, '描述不完整')
    expect(row.status).toBe('REJECTED')
    expect(row.rejectReason).toBe('描述不完整')
    const { total } = await listReviews()
    expect(total).toBe(8)
  })

  // 2026-09-09 PRD 复核·G3G6 · A6（Q265③「知识库也需要发布审核」；md `prd.审核中心.md` §二.2/§3.1）
  it('A6 知识库：种子含 KNOWLEDGE_BASE 待审行，可按业务类型筛出，refId 指向 kb_3', async () => {
    const { list } = await listReviews({ type: 'KNOWLEDGE_BASE' })
    expect(list.map((r) => r.id)).toEqual([9])
    expect(list[0].refId).toBe('kb_3')
    expect(list[0].requestAction).toBe('FIRST_PUBLISH')
    // 其它类型筛选不被知识库行污染
    const skill = await listReviews({ type: 'SKILL' })
    expect(skill.list.every((r) => r.type === 'SKILL')).toBe(true)
  })

  it('getReview：按 id 取单条；不存在抛 404', async () => {
    const row = await getReview(5)
    // 2026-09-09 PRD 复核·G2 顺修：种子名对齐 refId 所指实体（403 财务审核岗），
    // 原「合同审阅专员」只出自已退役原型 html、与所指岗位不同名（refId 借名缺陷）
    expect(row.name).toBe('财务审核岗')
    expect(row.refId).toBe(403)
    await expect(getReview(999)).rejects.toMatchObject({ code: 404 })
  })

  /* ---------------- 提交端接线（2026-09-12 测试审计 T56 补缺口；reviewsMock.js:114-140） ---------------- */

  it('submitReviewRow：同一对象已在审（同 type+refId）→ 覆盖原行不新建（md §六 L92「同一对象同一时间只允许存在一条待审核申请」）', async () => {
    // 种子 id 8 = TOOL/MCP knowledge_hub 在审
    const written = submitReviewRow({
      type: 'TOOL',
      subType: 'MCP',
      refId: 'knowledge_hub',
      name: '企业知识库 MCP',
      description: '重新提交后的描述',
      requestAction: 'VERSION_PUBLISH',
      version: 'v3.5.0',
      submittedAt: '2026-08-29 09:00'
    })
    expect(written.id).toBe(8) // 沿用原行 id
    const { list, total } = await listReviews()
    expect(total).toBe(9) // 不多出一行
    const row = list.find((r) => r.id === 8)
    expect(row.description).toBe('重新提交后的描述')
    expect(row.version).toBe('v3.5.0')
    expect(row.status).toBe('PENDING_REVIEW')
  })

  it('submitReviewRow：新对象 → 新建行，id 避开种子 1..9（取现有最大 id + 1），带默认提交人与「—」版本', async () => {
    const written = submitReviewRow({
      type: 'EXPERT',
      refId: 205,
      name: '合规审阅专家',
      requestAction: 'FIRST_PUBLISH',
      submittedAt: '2026-08-29 09:00'
    })
    expect(written.id).toBe(10)
    expect(written).toMatchObject({ status: 'PENDING_REVIEW', submitterName: 'config.admin', version: '—' })
    const { list, total } = await listReviews()
    expect(total).toBe(10)
    expect(list[0].name).toBe('合规审阅专家') // 08-29 比种子最新的 08-28 11:02 更晚，倒序排第一
  })

  it('cancelReviewRow：命中在审行即摘掉（撤回后离开待审列表）；无匹配对象静默、列表不变', async () => {
    cancelReviewRow('TOOL', 'api_1103') // 种子 id 1
    expect((await listReviews()).list.some((r) => r.id === 1)).toBe(false)
    expect((await listReviews()).total).toBe(8)
    expect(() => cancelReviewRow('EXPERT', 99999)).not.toThrow()
    expect((await listReviews()).total).toBe(8)
  })
})

/* ==================== 审核结论联动（2026-09-12 负责人决策 5 · 审计 J12） ====================
 * md `prd.审核中心.md` §5.2 L79-82「首次发布、新版本发布通过后，对象更新为已发布并启用相应版本；
 * 停用申请通过后，对象变为未发布 / 已下架……确认后记录审核人和审核时间」、§5.1 L71（驳回同记）；
 * `prd.我的申请.md` §六 L87「每条申请保存：……审核结果、审核人、审核时间和驳回原因」。
 *
 * 走的是真链路：先把对象推进在审态并写审核中心行，再 approveReview / rejectReview，
 * 最后用各业务模块的读取接口验落态——不直接改任何模块内部数组。
 *
 * 【为什么每条用例都自己造在审态】vitest 配了 sequence.shuffle（见 vitest.config.js），
 * 同文件用例随机序执行、业务 mock 模块态跨用例共享；靠种子自带的在审态会被兄弟用例先消费掉。
 * 故一律先用 _reset / 撤回把对象摆到已知起点，再走该模块自己的提交入口。
 *
 * 【为什么审核中心接口也走动态 import】文件末尾的 restore 形状守卫用例会 vi.resetModules()
 * 换掉模块注册表。之后本文件顶层 import 拿到的 reviewsMock 与 knowledgeBaseMock /
 * mcpConnectorMock 内部 import 的那份就不是同一个实例——业务 mock 提交端写进去的审核行，
 * 顶层实例的 listReviews 读不到（随机序下只有该守卫块先跑时才翻红）。每条用例在 beforeEach 里
 * 重新动态取一次，保证与业务 mock 共用同一实例。
 */
// 超时放宽到 20s：本块每条用例都要「摆起点 → 走业务模块提交入口 → 审核 → 回读」跑一串链路，
// 各业务 mock 的每步都带 delay(150~900) 拟真耗时，叠起来逼近 vitest 5s 默认超时；
// 全量并行跑（160 个测试文件抢 CPU）时会偶发假红。放宽的是等待上限，不是放宽断言。
describe('reviewsMock · 审核结论联动业务对象与我的申请（J12）', { timeout: 20000 }, () => {
  /** 与业务 mock 同实例的审核中心接口（见上方块注释）。 */
  let gov
  beforeEach(async () => {
    gov = await import('../reviewsMock')
    gov.resetReviewsMock()
  })

  /** 提交端还没接线的模块，测试里手工补一行审核中心行（等价于业务模块提交时该写的那行）。 */
  const enroll = (row) => gov.submitReviewRow({ submittedAt: '2026-09-12 10:00', ...row })

  /** 把技能摆到「已发布 vX + 无在审」的已知起点（抹掉兄弟用例留下的状态）。 */
  const resetSkill = async (id, version, snapshots) => {
    const skillMock = await import('../unifiedSkillMock')
    skillMock._reset(id, {
      status: 'published', version, delisted: false,
      pendingAction: null, pendingVersion: '', pendingReleaseNotes: '',
      snapshots: snapshots.map((s) => ({ ...s }))
    })
    return skillMock
  }
  const ACTIVE_SNAP = (version) => ({ version, status: 'ACTIVE', size: '19.3 KB', publisher: '管理员', publishedAt: '2026-08-20 15:30', disabledAt: '', notes: '当前线上版本' })

  it('通过 SKILL 新版本发布行 → 技能变已发布并启用新版本；审核行记审核人与审核时间（md §5.2 L79/L82）', async () => {
    const skillMock = await resetSkill('sk_304', 'v1.1.0', [ACTIVE_SNAP('v1.1.0')])
    await skillMock.publishSkill('sk_304', { bump: 'PATCH', releaseNotes: '补充违约条款识别规则' })
    const pendingVersion = skillMock._getRaw('sk_304').pendingVersion
    const row = enroll({ type: 'SKILL', refId: 'sk_304', name: '合同风险检查', requestAction: 'VERSION_PUBLISH', version: pendingVersion })

    const approved = await gov.approveReview(row.id)

    expect(approved.status).toBe('PUBLISHED')
    expect(approved.reviewer).toBe('演示管理员') // demo 内置身份（utils/demoIdentity），非硬编码人名
    expect(approved.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    const after = skillMock._getRaw('sk_304')
    expect(after.status).toBe('published')
    expect(after.version).toBe(pendingVersion) // 线上版本号推进到审核通过的那一版
    expect(after.pendingAction).toBeFalsy()
    // 新版本自动启用、原启用版本自动禁用（md `prd.技能.md` L120）
    const snaps = await skillMock.listSnapshots('sk_304')
    expect(snaps[0]).toMatchObject({ version: pendingVersion, status: 'ACTIVE' })
    expect(snaps.filter((x) => x.status === 'ACTIVE')).toHaveLength(1)
    expect(snaps.find((x) => x.version === 'v1.1.0').status).toBe('DELISTED')
  })

  it('通过 SKILL 停用行 → 技能变未发布、版本历史保留（md `prd.技能.md` L97 / 审核中心 §六 L91）', async () => {
    const skillMock = await resetSkill('sk_309', 'v1.0.0', [ACTIVE_SNAP('v1.0.0')])
    await skillMock.delistSkill('sk_309')
    const row = enroll({ type: 'SKILL', refId: 'sk_309', name: '行业研究助手', requestAction: 'DELIST', version: 'v1.0.0' })

    const approved = await gov.approveReview(row.id)

    expect(approved.status).toBe('DELISTED')
    const after = skillMock._getRaw('sk_309')
    expect(after.status).toBe('draft')
    expect(after.delisted).toBe(true)
    expect(after.pendingAction).toBeFalsy()
    expect(await skillMock.listSnapshots('sk_309')).toHaveLength(1) // 停用通过不删历史版本
  })

  it('驳回 SKILL 新版本发布行 → 不生成快照、技能回提交前的已发布态（md `prd.技能.md` L237）', async () => {
    const skillMock = await resetSkill('sk_302', 'v1.4.0', [ACTIVE_SNAP('v1.4.0')])
    await skillMock.publishSkill('sk_302', { bump: 'MINOR', releaseNotes: '将被驳回的版本' })
    const row = enroll({ type: 'SKILL', refId: 'sk_302', name: '经营数据分析', requestAction: 'VERSION_PUBLISH', version: 'v1.5.0' })

    const rejected = await gov.rejectReview(row.id, '版本说明不充分')

    expect(rejected).toMatchObject({ status: 'REJECTED', rejectReason: '版本说明不充分', reviewer: '演示管理员' })
    const after = skillMock._getRaw('sk_302')
    expect(after.status).toBe('published')
    expect(after.version).toBe('v1.4.0') // 线上版本号未被推进
    expect(after.pendingAction).toBeFalsy()
    expect(await skillMock.listSnapshots('sk_302')).toHaveLength(1) // 驳回不生成快照
  })

  it('通过 POSITION 新版本发布行 → 岗位已发布、latestVersion 推进到在审号、新版本唯一启用（md `prd.岗位.md` §3.3 L78/§八 L117）', async () => {
    const posMock = await import('../positionMock')
    posMock.__resetPositionMock()
    await posMock.publishPosition(401, { bump: 'MINOR', releaseNotes: '联动验证' })
    const row = enroll({ type: 'POSITION', refId: 401, name: '经营分析岗', requestAction: 'VERSION_PUBLISH', version: 'v2.2.0' })

    await gov.approveReview(row.id)

    const p = await posMock.getPosition(401)
    expect(p.status).toBe('published')
    expect(p.latestVersion).toBe('v2.2.0')
    expect(p.pendingAction).toBeFalsy()
    const pubs = await posMock.listPositionPublications(401)
    expect(pubs[0]).toMatchObject({ versionLabel: 'v2.2.0', status: 'ACTIVE' })
    expect(pubs.filter((r) => r.status === 'ACTIVE')).toHaveLength(1)
    expect(posMock.getPositionReviewSnapshot(401)).toBeNull() // 审核有结论 → 本次提交快照销毁
  })

  it('通过 POSITION 停用行 → 岗位变未发布，版本历史保留（md `prd.岗位.md` §3.5 L92/审核中心 §六 L91）', async () => {
    const posMock = await import('../positionMock')
    posMock.__resetPositionMock()
    await posMock.unpublishPosition(402)
    const row = enroll({ type: 'POSITION', refId: 402, name: '客户成功岗', requestAction: 'DELIST', version: 'v1.4.0' })

    await gov.approveReview(row.id)

    const p = await posMock.getPosition(402)
    expect(p.status).toBe('draft')
    expect(p.pendingAction).toBeFalsy()
    expect((await posMock.listPositionPublications(402)).length).toBe(2) // 停用不删历史版本
  })

  it('驳回 POSITION 发布行 → 岗位回未发布（md `prd.岗位.md` §3.3 L78「审核被拒绝后回到未发布」）', async () => {
    const posMock = await import('../positionMock')
    posMock.__resetPositionMock()
    await posMock.publishPosition(404, { releaseNotes: '首发' })
    const row = enroll({ type: 'POSITION', refId: 404, name: '市场研究岗', requestAction: 'FIRST_PUBLISH', version: 'v1.0.0' })

    await gov.rejectReview(row.id, '岗位说明不完整')

    const p = await posMock.getPosition(404)
    expect(p.status).toBe('draft')
    expect(p.latestVersion).toBe('')
    expect(p.pendingAction).toBeFalsy()
  })

  it('通过 EXPERT 新版本发布行 → 专家已发布、最新版本推进、原启用版本自动禁用（md `prd.专家.md` L229）', async () => {
    const expertMock = await import('../domainExpertMock')
    expertMock.__resetExpertMock()
    await expertMock.publishExpert(201, { bump: 'MINOR', releaseNotes: '联动验证' })
    const row = enroll({ type: 'EXPERT', refId: 201, name: '经营分析专家', requestAction: 'VERSION_PUBLISH', version: 'v2.4.0' })

    await gov.approveReview(row.id)

    const e = await expertMock.getExpert(201)
    expect(e.status).toBe('published')
    expect(e.latestVersionLabel).toBe('v2.4.0')
    const pubs = await expertMock.listExpertPublications(201)
    expect(pubs[0]).toMatchObject({ versionLabel: 'v2.4.0', status: 'ACTIVE' })
    expect(pubs.filter((r) => r.status === 'ACTIVE')).toHaveLength(1)
  })

  it('驳回 EXPERT 停用行 → 专家恢复已发布（md `prd.专家.md` L102「被拒绝或撤回后恢复已发布」）', async () => {
    const expertMock = await import('../domainExpertMock')
    expertMock.__resetExpertMock()
    await expertMock.unpublishExpert(202)
    const row = enroll({ type: 'EXPERT', refId: 202, name: '合同审阅专家', requestAction: 'DELIST', version: 'v1.6.0' })

    await gov.rejectReview(row.id, '停用理由不充分')

    const e = await expertMock.getExpert(202)
    expect(e.status).toBe('published')
    expect(e.pendingAction).toBeFalsy()
  })

  /** 把知识库摆到「未发布 + 无在审」起点，再走它自己的提交入口（transition 自带提交端接线）。 */
  const submitKb = async (id) => {
    const kbMock = await import('../knowledgeBaseMock')
    const cur = await kbMock.get(id)
    if (cur.pendingAction) await kbMock.transition(id, 'withdraw')
    if ((await kbMock.get(id)).status === 'PUBLISHED') {
      await kbMock.transition(id, 'delist')
      const delistRow = (await gov.listReviews({ type: 'KNOWLEDGE_BASE', size: 50 })).list.find((r) => r.refId === id)
      await gov.approveReview(delistRow.id) // 停用通过 → 回未发布
      gov.resetReviewsMock()
    }
    await kbMock.transition(id, 'publish')
    const row = (await gov.listReviews({ type: 'KNOWLEDGE_BASE', size: 50 })).list.find((r) => r.refId === id)
    expect(row, `${id} 提交发布后应出现在审核中心`).toBeTruthy()
    return { kbMock, row }
  }

  it('通过 KNOWLEDGE_BASE 发布行 → 知识库变已发布，我的申请变已通过并记审核人/审核时间（md §5.2 L79/我的申请 §六 L87）', async () => {
    const appMock = await import('../myApplicationsMock')
    appMock.resetMyApplicationsMock()
    const { kbMock, row } = await submitKb('kb_3')

    const approved = await gov.approveReview(row.id)

    expect((await kbMock.get('kb_3')).status).toBe('PUBLISHED')
    const app = (await appMock.listMyApplications({ businessType: 'KNOWLEDGE_BASE', size: 50 })).list.find((r) => r.refId === 'kb_3')
    expect(app.result).toBe('APPROVED')
    expect(app.reviewer).toBe('演示管理员')
    expect(app.reviewedAt).toBe(approved.reviewedAt)
    expect(app.rejectReason).toBe('')
  })

  it('驳回 KNOWLEDGE_BASE 行 → 知识库回未发布，我的申请变已驳回并带驳回原因（md §5.1 L71/我的申请 §六 L87）', async () => {
    const appMock = await import('../myApplicationsMock')
    appMock.resetMyApplicationsMock()
    const { kbMock, row } = await submitKb('kb_6')

    await gov.rejectReview(row.id, '数据源未配置完整')

    expect((await kbMock.get('kb_6')).status).toBe('DRAFT')
    expect((await kbMock.get('kb_6')).pendingAction).toBeFalsy()
    const app = (await appMock.listMyApplications({ businessType: 'KNOWLEDGE_BASE', size: 50 })).list.find((r) => r.refId === 'kb_6')
    expect(app.result).toBe('REJECTED')
    expect(app.rejectReason).toBe('数据源未配置完整')
    expect(app.reviewer).toBe('演示管理员')
  })

  it('通过 MODEL 发布行 → 模型变已发布（md `prd-模型.md` §八 L186）', async () => {
    const modelMock = await import('../adminModelMock')
    const cur = await modelMock.getModel('md_105')
    if (cur.pendingAction) await modelMock.withdrawModel('md_105')
    if ((await modelMock.getModel('md_105')).status === 'PUBLISHED') {
      await modelMock.delistModel('md_105')
      modelMock.applyModelReviewResult('md_105', 'DELIST', true) // 摆回未发布起点
    }
    await modelMock.verifyModel('md_105') // 连通性验证通过后才可提交发布（md §五 L123）
    await modelMock.publishModel('md_105')
    const row = enroll({ type: 'MODEL', refId: 'md_105', name: '营销文生图', requestAction: 'FIRST_PUBLISH' })

    await gov.approveReview(row.id)

    const m = await modelMock.getModel('md_105')
    expect(m.status).toBe('PUBLISHED')
    expect(m.pendingAction).toBeFalsy()
  })

  it('通过 MODEL 停用行 → 模型变未发布并摘掉默认标记（md `prd-模型.md` L152/L155）', async () => {
    const modelMock = await import('../adminModelMock')
    const cur = await modelMock.getModel('md_101')
    if (cur.pendingAction) await modelMock.withdrawModel('md_101')
    if ((await modelMock.getModel('md_101')).status !== 'PUBLISHED') {
      await modelMock.verifyModel('md_101')
      await modelMock.publishModel('md_101')
      modelMock.applyModelReviewResult('md_101', 'FIRST_PUBLISH', true) // 摆回已发布起点
    }
    await modelMock.setDefaultModel('md_101')
    expect((await modelMock.getModel('md_101')).isDefault).toBe(true)
    await modelMock.delistModel('md_101')
    const row = enroll({ type: 'MODEL', refId: 'md_101', name: '通义千问 Max', requestAction: 'DELIST' })

    await gov.approveReview(row.id)

    const m = await modelMock.getModel('md_101')
    expect(m.status).toBe('DRAFT')
    expect(m.isDefault).toBe(false)
  })

  it('通过 TOOL/API 发布行 → API 变已发布（md `prd-API.md` L65）', async () => {
    const apiMock = await import('../apiConnectorMock')
    const cur = await apiMock.getApi('api_1106')
    if (cur.status === 'PENDING_REVIEW') await apiMock.withdrawApi('api_1106')
    if ((await apiMock.getApi('api_1106')).status === 'PUBLISHED') {
      await apiMock.deactivateApi('api_1106')
      apiMock.applyApiReviewResult('api_1106', 'DELIST', true) // 摆回未发布起点
    }
    await apiMock.healthCheckApi('api_1106') // 连通性验证通过后才可提交发布（md §二.4）
    await apiMock.publishApi('api_1106')
    const row = enroll({ type: 'TOOL', subType: 'API', refId: 'api_1106', name: '星火任务链执行', requestAction: 'FIRST_PUBLISH' })

    await gov.approveReview(row.id)

    expect((await apiMock.getApi('api_1106')).status).toBe('PUBLISHED')
  })

  it('驳回 TOOL/API 停用行 → API 保持已发布（md `prd-API.md` L70「被拒绝或撤回后恢复已发布」）', async () => {
    const apiMock = await import('../apiConnectorMock')
    const cur = await apiMock.getApi('api_1105')
    if (cur.status === 'PENDING_REVIEW') await apiMock.withdrawApi('api_1105')
    if ((await apiMock.getApi('api_1105')).status !== 'PUBLISHED') {
      await apiMock.healthCheckApi('api_1105')
      await apiMock.publishApi('api_1105')
      apiMock.applyApiReviewResult('api_1105', 'FIRST_PUBLISH', true) // 摆回已发布起点
    }
    await apiMock.deactivateApi('api_1105')
    const row = enroll({ type: 'TOOL', subType: 'API', refId: 'api_1105', name: '星火智能体会话', requestAction: 'DELIST' })

    await gov.rejectReview(row.id, '暂不停用')

    expect((await apiMock.getApi('api_1105')).status).toBe('PUBLISHED')
  })

  it('通过 TOOL/MCP 停用行 → MCP 聚合态变未发布（md `prd-连接器-MCP.md` §八 L161）', async () => {
    const mcpMock = await import('../mcpConnectorMock')
    const agg = async () => (await mcpMock.getMcpServicePublishStatus('calendar')).targets[0]
    if ((await agg()).aggregateStatus === 'PENDING_REVIEW') await mcpMock.withdrawMcpService('calendar')
    if ((await agg()).aggregateStatus !== 'PUBLISHED') await mcpMock.relistMcpService('calendar')
    await mcpMock.delistMcpService('calendar') // 提交端已接线：同时写审核中心 DELIST 行
    const row = (await gov.listReviews({ type: 'CONNECTOR_MCP', size: 50 })).list.find((r) => r.refId === 'calendar')
    expect(row, 'calendar 提交停用后应出现在审核中心').toBeTruthy()
    expect(row.requestAction).toBe('DELIST')

    await gov.approveReview(row.id)

    const st = await agg()
    expect(st.aggregateStatus).toBe('NOT_PUBLISHED')
    expect(st.pendingAction).toBeFalsy()
  })

  it('通过 BIZ_SYSTEM 发布行 → 业务系统变已发布（md `prd-业务系统.md` L46）', async () => {
    const bizMock = await import('../bizSystemMock')
    const cur = await bizMock.getBizSystem('biz_2102')
    if (cur.status === 'PENDING_REVIEW') await bizMock.withdrawBizSystem('biz_2102')
    if ((await bizMock.getBizSystem('biz_2102')).status === 'PUBLISHED') {
      await bizMock.deactivateBizSystem('biz_2102')
      bizMock.applyBizSystemReviewResult('biz_2102', 'DELIST', true) // 摆回未发布起点
    }
    await bizMock.publishBizSystem('biz_2102')
    const row = enroll({ type: 'BIZ_SYSTEM', refId: 'biz_2102', name: '人力资源系统', requestAction: 'FIRST_PUBLISH' })

    await gov.approveReview(row.id)

    const b = await bizMock.getBizSystem('biz_2102')
    expect(b.status).toBe('PUBLISHED')
    expect(b.pendingAction).toBeFalsy()
  })

  it('对象没有在途审核事项时静默跳过：审核行照常落结论，业务对象不被误改（审核中心不该被单个对象打断）', async () => {
    const modelMock = await import('../adminModelMock')
    const cur = await modelMock.getModel('md_104')
    if (cur.pendingAction) await modelMock.withdrawModel('md_104')
    const statusBefore = (await modelMock.getModel('md_104')).status

    // 种子审核行 4 指 md_104，但该模型并无待审事项（跨模块种子不自洽，见 J12 报告）
    const approved = await gov.approveReview(4)

    expect(approved.status).toBe('PUBLISHED') // 审核行自身照常落结论
    expect((await modelMock.getModel('md_104')).status).toBe(statusBefore) // 业务对象不被误改
  })

  it('我的申请无对应待审行时不新建行（申请行只由提交端创建）', async () => {
    const appMock = await import('../myApplicationsMock')
    const posMock = await import('../positionMock')
    posMock.__resetPositionMock()
    appMock.resetMyApplicationsMock()
    const before = (await appMock.listMyApplications({ size: 100 })).total

    await gov.approveReview(5) // POSITION 403：我的申请里没有 refId 403 的待审行

    expect((await appMock.listMyApplications({ size: 100 })).total).toBe(before)
  })
})

/* ---------------- F9：restore 形状守卫（reviewsMock.js:155-157；mockPersist 兜底回种子） ---------------- */
describe('reviewsMock · 持久化 restore 形状守卫', () => {
  // 本仓 node/jsdom 环境均无可用 localStorage（mockPersist 探测后走纯内存模式），
  // 与 positionMock.test / mockPersist.test 同款：注入内存版存储 + vi.resetModules + 动态 import 模拟「刷新后重新加载模块」。
  const KEY = 'iworker-demo-mock:reviews'
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

  it('存量快照版本对但 reviews 不是数组 → 启动时抛「快照形状不合法」被兜底：回种子 9 条、坏 key 被清掉', async () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 6, data: { reviews: 'oops' } }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fresh = await import('../reviewsMock')
    expect((await fresh.listReviews()).total).toBe(9)
    expect(globalThis.localStorage.getItem(KEY)).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reviews 存量数据不可用'), expect.any(Error))
    warn.mockRestore()
  })

  it('对照：形状合法的存量快照（v=6）会被读回——列表按快照而非种子', async () => {
    const seedOnly = [{ id: 42, name: '快照里的唯一行', type: 'MODEL', refId: 'md_104', requestAction: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-09-01 10:00', status: 'PENDING_REVIEW' }]
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 6, data: { reviews: seedOnly } }))
    const fresh = await import('../reviewsMock')
    const { list, total } = await fresh.listReviews()
    expect(total).toBe(1)
    expect(list[0].name).toBe('快照里的唯一行')
  })
})
