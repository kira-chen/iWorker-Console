// @vitest-environment jsdom
// （撤回 / 重新提交 2026-09-18 起经业务模块分发，业务 mock → request.js → router 触达 window，故用 jsdom）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * 我的申请 mock 层回归保护（2026-09-18 R1 重写，对齐 md `prd.我的申请.md` §二 / §3.1 / §4.1 / §4.3 / §五 / §六 / §七）：
 * - 种子 18 行：13 条待审与审核中心逐笔同一（护栏见 govSeedRefIntegrity.test），5 条历史（含对象已删除样例 510）；
 * - 撤回 / 重新提交**不再只翻本表**：分发到业务模块的撤回 / 提交入口，模块经 reviewEnroll 同步审核中心行与本表行
 *   （09-18 审查 G-4/G-5：原实现撤回后审核中心仍可通过并真的发布、重提后审核中心根本没这条）；
 * - 审核结论回写按 businessType + refId + applicationType 匹配（G-7：不再把停用申请标成「首发已通过」）。
 *
 * 【为什么所有接口都动态 import】本文件末尾的 restore 守卫用例会 vi.resetModules()；且撤回 / 重提内部会动态
 * import 业务 mock，业务 mock 又静态 import 本模块——顶层静态 import 拿到的实例可能与它们不是同一份。
 * 每个用例在 beforeEach 里重新取一次，保证共用同一实例。
 */
describe('myApplicationsMock · 我的申请内存 mock', { timeout: 20000 }, () => {
  let app
  beforeEach(async () => {
    app = await import('../myApplicationsMock')
    app.resetMyApplicationsMock()
    ;(await import('../reviewsMock')).resetReviewsMock()
  })

  it('默认列表：18 条，按 submittedAt desc，最新一条是版本管理行 518（09-19 16:30）', async () => {
    const { list, total } = await app.listMyApplications({ size: 50 })
    expect(total).toBe(18)
    expect(list[0].id).toBe(518)
    const times = list.map((r) => r.submittedAt)
    expect(times).toEqual([...times].sort().reverse())
  })

  it('筛选：businessType / applicationType / result 组合', async () => {
    expect((await app.listMyApplications({ businessType: 'EXPERT' })).list.map((r) => r.id).sort()).toEqual([502, 510, 513])
    expect((await app.listMyApplications({ applicationType: 'DELIST' })).list.map((r) => r.id).sort()).toEqual([510, 515])
    expect((await app.listMyApplications({ result: 'REJECTED' })).list.map((r) => r.id).sort()).toEqual([503, 507])
    expect((await app.listMyApplications({ result: 'PENDING', size: 50 })).total).toBe(13) // 与审核中心 13 行逐笔对应
  })

  it('objectDeleted：默认 false；样例行 510 为 true，六个信息字段照常保留（md §四 L47）', async () => {
    const { list } = await app.listMyApplications({ size: 50 })
    expect(list.filter((r) => r.objectDeleted).map((r) => r.id)).toEqual([510])
    const gone = list.find((r) => r.id === 510)
    expect(gone).toMatchObject({ objectName: '合同审阅专员', businessType: 'EXPERT', applicationType: 'DELIST', version: 'v1.3.0', result: 'WITHDRAWN' })
    expect(gone.submittedAt).toBeTruthy()
  })

  it('keyword 过滤域 = 申请对象名称/描述（大小写不敏感）', async () => {
    expect((await app.listMyApplications({ keyword: 'kimi' })).list.map((r) => r.id)).toEqual([507])
    expect((await app.listMyApplications({ keyword: '入转调离' })).list.map((r) => r.id)).toEqual([506])
    // 前后空白不参与匹配（2026-09-18 待办 yuepu#13·治理 G4）
    expect((await app.listMyApplications({ keyword: '  kimi ' })).list.map((r) => r.id)).toEqual([507])
  })

  it('不存在的 id 抛 404', async () => {
    await expect(app.getMyApplication(999)).rejects.toMatchObject({ code: 404 })
  })

  /* ---------------- 撤回：经业务模块（md §4.1 / §七 L99） ---------------- */

  it('撤回待审行 506（业务系统 biz_2102 首发）→ 本行 WITHDRAWN、审核中心行摘掉、业务对象回未发布', async () => {
    const gov = await import('../reviewsMock')
    const biz = await import('../bizSystemMock')
    const row = await app.withdrawMyApplication(506)
    expect(row).toMatchObject({ result: 'WITHDRAWN', reviewer: '—' })
    expect(row.reviewedAt).toBeTruthy()
    expect((await gov.listReviews({ type: 'CONNECTOR_BIZ' })).list.some((r) => r.refId === 'biz_2102')).toBe(false)
    const b = await biz.getBizSystem('biz_2102')
    expect(b.status).toBe('NOT_PUBLISHED')
    expect(b.pendingAction).toBeFalsy()
  })

  /** kb_3 的在途态跨用例共享（随机序），先摆到「待审发布」起点，返回其待审申请行 id。 */
  const ensureKb3Pending = async () => {
    const kb = await import('../knowledgeBaseMock')
    if (!(await kb.get('kb_3')).pendingAction) await kb.transition('kb_3', 'publish') // 会经 reviewEnroll 落两行
    return (await app.listMyApplications({ businessType: 'KNOWLEDGE_BASE', result: 'PENDING' })).list.find((r) => r.refId === 'kb_3').id
  }

  it('撤回后审核中心再也审不到它：审核行已摘、对象无在途 → 通过不可能发生（09-18 G-5 回归）', async () => {
    const gov = await import('../reviewsMock')
    const appId = await ensureKb3Pending()
    const rowBefore = (await gov.listReviews({ type: 'KNOWLEDGE_BASE' })).list.find((r) => r.refId === 'kb_3')
    await app.withdrawMyApplication(appId)
    await expect(gov.approveReview(rowBefore.id)).rejects.toMatchObject({ code: 404 })
    const kb = await (await import('../knowledgeBaseMock')).get('kb_3')
    expect(kb.status).toBe('DRAFT')
    expect(kb.pendingAction).toBeFalsy()
  })

  it('撤回非待审核行（502 已通过）→ 409「该申请已被审核，无法撤回…」且状态不变（md §五 L81 / §七 L99）', async () => {
    await expect(app.withdrawMyApplication(502)).rejects.toMatchObject({ code: 409, message: '该申请已被审核，无法撤回，请查看最新审核结果' })
    expect((await app.getMyApplication(502)).result).toBe('APPROVED')
  })

  /* ---------------- 重新提交：经业务模块，生成新的一笔（md §4.3 L66「重新生成待审核申请」） ---------------- */

  it('重新提交已驳回行 503（岗位 401 新版本）→ 新申请行 PENDING + 审核中心新行 + 岗位进入审核中；原行保留为已驳回', async () => {
    const gov = await import('../reviewsMock')
    const pos = await import('../positionMock')
    pos.__resetPositionMock()
    const fresh = await app.resubmitMyApplication(503)
    expect(fresh.id).not.toBe(503)
    expect(fresh).toMatchObject({ businessType: 'POSITION', refId: 401, applicationType: 'VERSION_PUBLISH', result: 'PENDING', reviewer: '', rejectReason: '' })
    expect((await app.getMyApplication(503)).result).toBe('REJECTED') // 历史保留
    const p = await pos.getPosition(401)
    expect(p.pendingAction).toBe('PUBLISH')
    const review = (await gov.listReviews({ type: 'POSITION' })).list.find((r) => r.refId === 401)
    expect(review).toMatchObject({ requestAction: 'VERSION_PUBLISH', version: fresh.version })
    expect(fresh.version).toMatch(/^v2\.1\.\d+$/) // 由线上 v2.1.0 递增，不是原驳回行的 v2.2.0
  })

  it('重新提交后审核中心能真的审：通过 → 岗位已发布且版本推进，新申请行已通过（全链路）', async () => {
    const gov = await import('../reviewsMock')
    const pos = await import('../positionMock')
    pos.__resetPositionMock()
    const fresh = await app.resubmitMyApplication(503)
    const review = (await gov.listReviews({ type: 'POSITION' })).list.find((r) => r.refId === 401)
    await gov.approveReview(review.id)
    const p = await pos.getPosition(401)
    expect(p.status).toBe('published')
    expect(p.latestVersion).toBe(fresh.version)
    expect((await app.getMyApplication(fresh.id))).toMatchObject({ result: 'APPROVED', reviewer: '演示管理员' })
  })

  it('重新提交待审核（501）/ 已通过（502）行 → 409「仅已驳回或已撤回的申请可重新提交」（md §五 L80-81）', async () => {
    for (const [id, result] of [[501, 'PENDING'], [502, 'APPROVED']]) {
      await expect(app.resubmitMyApplication(id)).rejects.toMatchObject({ code: 409, message: '仅已驳回或已撤回的申请可重新提交' })
      expect((await app.getMyApplication(id)).result).toBe(result)
    }
  })

  it('对象已删除的行（510）不可重新提交 → 409（09-18 G-12）', async () => {
    await expect(app.resubmitMyApplication(510)).rejects.toMatchObject({ code: 409 })
    expect((await app.getMyApplication(510)).result).toBe('WITHDRAWN')
  })

  it('同一对象已有在途申请时不允许再提（md §六 L89）：撤回 kb_3 的待审行后重提两次，第二次 409', async () => {
    const appId = await ensureKb3Pending()
    await app.withdrawMyApplication(appId)
    const fresh = await app.resubmitMyApplication(appId)
    expect(fresh.result).toBe('PENDING')
    await expect(app.resubmitMyApplication(appId)).rejects.toMatchObject({ code: 409 })
    expect((await app.listMyApplications({ businessType: 'KNOWLEDGE_BASE', result: 'PENDING' })).total).toBe(1)
  })

  /* ---------------- 提交端接线（供各业务模块经 reviewEnroll 调用） ---------------- */

  it('submitApplicationRow：同一对象仍待审（同 businessType+refId）→ 覆盖原行不新建（md §六 L89）', async () => {
    const written = app.submitApplicationRow({ businessType: 'API', refId: 'api_1102', objectName: '提交付款申请', applicationType: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-08-29 09:00' })
    expect(written.id).toBe(501)
    const { total } = await app.listMyApplications({ size: 50 })
    expect(total).toBe(18)
  })

  it('submitApplicationRow：新对象 → 新建行，id 取现有最大 + 1，objectDeleted=false、result=PENDING', async () => {
    const written = app.submitApplicationRow({ businessType: 'MODEL', refId: 'md_101', objectName: '新模型', applicationType: 'FIRST_PUBLISH', submittedAt: '2026-08-29 09:00' })
    expect(written.id).toBe(519)
    expect(written).toMatchObject({ result: 'PENDING', objectDeleted: false, version: '—', submitter: 'config.admin' })
    const { list, total } = await app.listMyApplications({ size: 50 })
    expect(total).toBe(19)
    expect(list.find((r) => r.id === written.id).objectName).toBe('新模型')
  })

  it('withdrawApplicationRow：命中待审行 → 行保留、result=WITHDRAWN、审核人「—」；无匹配静默', async () => {
    app.withdrawApplicationRow('API', 'api_1102') // 501
    const row = await app.getMyApplication(501)
    expect(row.result).toBe('WITHDRAWN')
    expect(row.reviewer).toBe('—')
    expect(() => app.withdrawApplicationRow('MODEL', 'nope')).not.toThrow()
    expect((await app.listMyApplications({ size: 50 })).total).toBe(18)
  })

  it('applyApplicationReviewResult：按申请类型匹配——同一对象若同时有旧停用申请与新发布申请，只回写同类型那条（09-18 G-7）', async () => {
    app.submitApplicationRow({ businessType: 'MCP', refId: 'x_mcp', objectName: 'X', applicationType: 'DELIST', submittedAt: '2026-08-29 09:00' })
    // 第二条不同类型：submitApplicationRow 按 type+refId 去重会覆盖，这里直接再写一条 FIRST_PUBLISH 覆盖掉 DELIST 后再补回
    const delist = app.submitApplicationRow({ businessType: 'MCP', refId: 'x_mcp', objectName: 'X', applicationType: 'DELIST', submittedAt: '2026-08-29 09:00' })
    expect(app.applyApplicationReviewResult({ businessType: 'MCP', refId: 'x_mcp', applicationType: 'FIRST_PUBLISH', approved: true, reviewer: 'r' })).toBe(false)
    expect((await app.getMyApplication(delist.id)).result).toBe('PENDING')
    expect(app.applyApplicationReviewResult({ businessType: 'MCP', refId: 'x_mcp', applicationType: 'DELIST', approved: true, reviewer: 'r' })).toBe(true)
    expect((await app.getMyApplication(delist.id)).result).toBe('APPROVED')
  })
})

/* ---------------- restore 形状守卫（mockPersist 兜底回种子） ---------------- */
describe('myApplicationsMock · 持久化 restore 形状守卫', () => {
  const KEY = 'iworker-demo-mock:myApplications'
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

  it('存量快照版本对但 applications 不是数组 → 启动时抛「快照形状不合法」被兜底：回种子 18 条、坏 key 被清掉', async () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 7, data: { applications: { not: 'array' } } }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fresh = await import('../myApplicationsMock')
    expect((await fresh.listMyApplications({ size: 50 })).total).toBe(18)
    expect(globalThis.localStorage.getItem(KEY)).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('myApplications 存量数据不可用'), expect.any(Error))
    warn.mockRestore()
  })
})
