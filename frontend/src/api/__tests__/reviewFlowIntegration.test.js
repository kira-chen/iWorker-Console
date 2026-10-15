// @vitest-environment jsdom
// （业务 mock → request.js → router 触达 window，故用 jsdom）
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

/**
 * 审核联动全链路集成测试（2026-09-18 R1 修复的守卫）
 *
 * 09-18 逻辑审查的头号发现：除知识库和 MCP 停用外，六个业务模块提交发布 / 停用后审核中心与我的申请都看不到，
 * 撤回不摘行、驳回把已发布对象打回未发布、我的申请重提 / 撤回只翻本表——而现有 2200 条用例一条没红，
 * 因为没有任何用例**横跨两个 mock**验证「提交 → 审核中心有行 → 通过 → 对象改态 → 我的申请同步」这条线。
 * 本文件对八类业务各跑一遍完整回路，任何一个模块漏接线、或 reviewsMock / myApplicationsMock 的匹配规则被改坏，这里立刻红。
 * 版本管理（VERSION，客户端安装包版本）的审核往返不在本文件，见 versionMock.test.js。
 *
 * 每条用例都自己把对象摆到已知起点（vitest 随机序、模块态跨用例共享），走各模块自己的公开入口，不碰内部数组。
 * 所有 mock 一律动态 import：撤回 / 审核内部会动态 import 业务 mock，业务 mock 又静态 import 治理 mock，
 * 顶层静态 import 可能拿到不同实例（见 reviewsMock.test 块注释）。
 */
const load = async () => ({
  gov: await import('../reviewsMock'),
  app: await import('../myApplicationsMock')
})

/** 在两张表里找某对象的待审行 */
async function pendingRows({ gov, app }, businessType, refId) {
  const reviewType = businessType === 'MCP' ? 'CONNECTOR_MCP' : businessType === 'API' ? 'CONNECTOR_API' : businessType === 'BIZ_SYSTEM' ? 'CONNECTOR_BIZ' : businessType
  const review = (await gov.listReviews({ type: reviewType, size: 50 })).list.find((r) => String(r.refId) === String(refId))
  const application = (await app.listMyApplications({ businessType, result: 'PENDING', size: 50 })).list.find((r) => String(r.refId) === String(refId))
  return { review, application }
}

describe('审核联动全链路：提交 → 两张表有行 → 通过/驳回/撤回 → 对象、审核中心、我的申请三方同步', { timeout: 30000 }, () => {
  let t
  beforeEach(async () => {
    t = await load()
    t.gov.resetReviewsMock()
    t.app.resetMyApplicationsMock()
  })

  it('岗位：已发布岗位提交新版本 → 驳回 → 仍是已发布、线上版本不变（不再被打回未发布）；再提交 → 通过 → 版本推进', async () => {
    const pos = await import('../positionMock')
    pos.__resetPositionMock()
    const before = await pos.getPosition(401) // 种子：published v2.1.0
    expect(before.status).toBe('published')

    await pos.publishPosition(401, { bump: 'MINOR', releaseNotes: '集成验证' })
    let { review, application } = await pendingRows(t, 'POSITION', 401)
    expect(review).toMatchObject({ requestAction: 'VERSION_PUBLISH', version: 'v2.2.0', name: '经营分析岗' })
    expect(application).toMatchObject({ applicationType: 'VERSION_PUBLISH', version: 'v2.2.0' })

    await t.gov.rejectReview(review.id, '说明不足')
    let p = await pos.getPosition(401)
    expect(p.status).toBe('published') // 09-18 P1：原实现打回 draft
    expect(p.latestVersion).toBe('v2.1.0')
    expect(p.pendingAction).toBeFalsy()
    expect((await t.app.getMyApplication(application.id))).toMatchObject({ result: 'REJECTED', rejectReason: '说明不足' })
    expect((await pendingRows(t, 'POSITION', 401)).review).toBeUndefined()

    await pos.publishPosition(401, { bump: 'MINOR', releaseNotes: '二次提交' })
    ;({ review } = await pendingRows(t, 'POSITION', 401))
    await t.gov.approveReview(review.id)
    p = await pos.getPosition(401)
    expect(p.status).toBe('published')
    expect(p.latestVersion).toBe('v2.2.0')
    expect((await pos.listPositionPublications(401)).filter((r) => r.status === 'ACTIVE')).toHaveLength(1)
  })

  it('岗位：停用 → 撤回 → 两张表都没有它、岗位仍已发布；停用 → 通过 → 未发布', async () => {
    const pos = await import('../positionMock')
    const posAssign = await import('../positionAssignmentMock')
    pos.__resetPositionMock()
    // 402 种子被 li.na（userId 202）领用，本用例测的是停用状态机，不是领用拦截（yuepu#9①）
    await posAssign.setUserPosition(202, null)
    await pos.unpublishPosition(402)
    let rows = await pendingRows(t, 'POSITION', 402)
    expect(rows.review.requestAction).toBe('DELIST')
    expect(rows.application.applicationType).toBe('DELIST')
    const appId = rows.application.id

    await pos.withdrawPosition(402)
    rows = await pendingRows(t, 'POSITION', 402)
    expect(rows.review).toBeUndefined()
    expect(rows.application).toBeUndefined()
    expect((await t.app.getMyApplication(appId)).result).toBe('WITHDRAWN')
    expect((await pos.getPosition(402)).status).toBe('published')

    await pos.unpublishPosition(402)
    rows = await pendingRows(t, 'POSITION', 402)
    await t.gov.approveReview(rows.review.id)
    expect((await pos.getPosition(402)).status).toBe('draft')
  })

  it('专家：已发布专家提交新版本 → 驳回 → 仍已发布（09-18 E2）；停用 → 通过 → 未发布', async () => {
    const ex = await import('../domainExpertMock')
    ex.__resetExpertMock()
    await ex.publishExpert(201, { bump: 'MINOR', releaseNotes: '集成验证' })
    let { review } = await pendingRows(t, 'EXPERT', 201)
    expect(review.requestAction).toBe('VERSION_PUBLISH')
    await t.gov.rejectReview(review.id, '不通过')
    const e = await ex.getExpert(201)
    expect(e.status).toBe('published')
    expect(e.latestVersionLabel).toBe('v2.3.0')

    await ex.unpublishExpert(201)
    ;({ review } = await pendingRows(t, 'EXPERT', 201))
    expect(review.requestAction).toBe('DELIST')
    await t.gov.approveReview(review.id)
    expect((await ex.getExpert(201)).status).toBe('draft')
  })

  it('技能：已下架技能再提交发布 → 撤回 → 回到「未发布」而不是已发布（09-18 S1：不能绕过审核上线）；再提交 → 通过 → 已发布', async () => {
    const sk = await import('../unifiedSkillMock')
    sk._reset('sk_309', { status: 'draft', version: 'v1.0.0', delisted: true, pendingAction: null, pendingVersion: '', pendingReleaseNotes: '', snapshots: [{ version: 'v1.0.0', status: 'DELISTED', size: '1 KB', publisher: '管理员', publishedAt: '2026-08-18 10:00', disabledAt: '2026-08-25 11:26', notes: '' }] })

    await sk.publishSkill('sk_309', { bump: 'MINOR', releaseNotes: '重新上架' })
    let { review } = await pendingRows(t, 'SKILL', 'sk_309')
    expect(review).toMatchObject({ requestAction: 'VERSION_PUBLISH', version: 'v1.1.0' })
    await sk.withdrawPublish('sk_309')
    let raw = sk._getRaw('sk_309')
    expect(raw.status).toBe('draft')
    expect(raw.delisted).toBe(true)
    expect((await pendingRows(t, 'SKILL', 'sk_309')).review).toBeUndefined()

    await sk.publishSkill('sk_309', { bump: 'MINOR', releaseNotes: '重新上架' })
    ;({ review } = await pendingRows(t, 'SKILL', 'sk_309'))
    await t.gov.rejectReview(review.id, '再想想')
    raw = sk._getRaw('sk_309')
    expect(raw.status).toBe('draft')
    expect(raw.delisted).toBe(true)

    await sk.publishSkill('sk_309', { bump: 'MINOR', releaseNotes: '重新上架' })
    ;({ review } = await pendingRows(t, 'SKILL', 'sk_309'))
    await t.gov.approveReview(review.id)
    raw = sk._getRaw('sk_309')
    expect(raw).toMatchObject({ status: 'published', delisted: false, version: 'v1.1.0' })
  })

  it('知识库：发布 → 通过 → 已发布；停用 → 驳回 → 仍已发布', async () => {
    const kb = await import('../knowledgeBaseMock')
    const cur = await kb.get('kb_3')
    if (cur.pendingAction) await kb.transition('kb_3', 'withdraw')
    if ((await kb.get('kb_3')).status !== 'DRAFT') {
      await kb.transition('kb_3', 'delist')
      await t.gov.approveReview((await pendingRows(t, 'KNOWLEDGE_BASE', 'kb_3')).review.id)
    }
    await kb.transition('kb_3', 'publish')
    let { review, application } = await pendingRows(t, 'KNOWLEDGE_BASE', 'kb_3')
    expect(review).toBeTruthy()
    await t.gov.approveReview(review.id)
    expect((await kb.get('kb_3')).status).toBe('PUBLISHED')
    expect((await t.app.getMyApplication(application.id)).result).toBe('APPROVED')

    await kb.transition('kb_3', 'delist')
    ;({ review } = await pendingRows(t, 'KNOWLEDGE_BASE', 'kb_3'))
    await t.gov.rejectReview(review.id, '继续使用')
    expect((await kb.get('kb_3')).status).toBe('PUBLISHED')
  })

  it('MCP：发布 → 两张表有行（原实现发布不写行）→ 通过 → 已发布；停用 → 撤回 → 行摘掉、仍已发布', async () => {
    const mcp = await import('../mcpConnectorMock')
    const agg = async () => (await mcp.getMcpServicePublishStatus('local_files')).targets[0]
    if ((await agg()).aggregateStatus === 'PENDING_REVIEW') await mcp.withdrawMcpService('local_files')
    await mcp.publishMcpService('local_files')
    let { review, application } = await pendingRows(t, 'MCP', 'local_files')
    expect(review).toMatchObject({ type: 'TOOL', subType: 'MCP', requestAction: 'FIRST_PUBLISH' })
    expect(application.businessType).toBe('MCP')
    await t.gov.approveReview(review.id)
    expect((await agg()).aggregateStatus).toBe('PUBLISHED')

    await mcp.delistMcpService('local_files')
    ;({ review } = await pendingRows(t, 'MCP', 'local_files'))
    expect(review.requestAction).toBe('DELIST')
    await mcp.withdrawMcpService('local_files')
    expect((await pendingRows(t, 'MCP', 'local_files')).review).toBeUndefined()
    expect((await agg()).aggregateStatus).toBe('PUBLISHED')
  })

  it('API：发布 → 通过；停用 → 驳回 → 仍已发布；两张表随之同步', async () => {
    const api = await import('../apiConnectorMock')
    const cur = await api.getApi('api_1102')
    if (cur.status === 'PENDING_REVIEW') await api.withdrawApi('api_1102')
    if ((await api.getApi('api_1102')).status === 'PUBLISHED') {
      await api.deactivateApi('api_1102')
      await t.gov.approveReview((await pendingRows(t, 'API', 'api_1102')).review.id)
    }
    await api.healthCheckApi('api_1102')
    await api.publishApi('api_1102')
    let { review, application } = await pendingRows(t, 'API', 'api_1102')
    expect(review).toMatchObject({ type: 'TOOL', subType: 'API' })
    await t.gov.approveReview(review.id)
    expect((await api.getApi('api_1102')).status).toBe('PUBLISHED')
    expect((await t.app.getMyApplication(application.id)).result).toBe('APPROVED')

    await api.deactivateApi('api_1102')
    ;({ review, application } = await pendingRows(t, 'API', 'api_1102'))
    await t.gov.rejectReview(review.id, '不停')
    expect((await api.getApi('api_1102')).status).toBe('PUBLISHED')
    expect((await t.app.getMyApplication(application.id)).result).toBe('REJECTED')
  })

  it('业务系统：发布 → 驳回 → 未发布（原种子被记成停用时驳回会误变已发布）；再发布 → 通过', async () => {
    const biz = await import('../bizSystemMock')
    const cur = await biz.getBizSystem('biz_2102')
    if (cur.status === 'PENDING_REVIEW') await biz.withdrawBizSystem('biz_2102')
    if ((await biz.getBizSystem('biz_2102')).status === 'PUBLISHED') {
      await biz.deactivateBizSystem('biz_2102')
      await t.gov.approveReview((await pendingRows(t, 'BIZ_SYSTEM', 'biz_2102')).review.id)
    }
    await biz.publishBizSystem('biz_2102')
    let { review } = await pendingRows(t, 'BIZ_SYSTEM', 'biz_2102')
    expect(review.requestAction).toBe('FIRST_PUBLISH')
    await t.gov.rejectReview(review.id, '资料不全')
    expect((await biz.getBizSystem('biz_2102')).status).toBe('NOT_PUBLISHED')

    await biz.publishBizSystem('biz_2102')
    ;({ review } = await pendingRows(t, 'BIZ_SYSTEM', 'biz_2102'))
    await t.gov.approveReview(review.id)
    expect((await biz.getBizSystem('biz_2102')).status).toBe('PUBLISHED')
  })

  it('模型：发布 → 通过；停用 → 通过 → 未发布且摘默认；我的申请两笔各自同步', async () => {
    const model = await import('../adminModelMock')
    const cur = await model.getModel('md_103')
    if (cur.pendingAction) await model.withdrawModel('md_103')
    if ((await model.getModel('md_103')).status === 'PUBLISHED') {
      await model.delistModel('md_103')
      await t.gov.approveReview((await pendingRows(t, 'MODEL', 'md_103')).review.id)
    }
    await model.verifyModel('md_103')
    await model.publishModel('md_103')
    let { review, application } = await pendingRows(t, 'MODEL', 'md_103')
    await t.gov.approveReview(review.id)
    expect((await model.getModel('md_103')).status).toBe('PUBLISHED')
    expect((await t.app.getMyApplication(application.id)).result).toBe('APPROVED')

    await model.delistModel('md_103')
    ;({ review, application } = await pendingRows(t, 'MODEL', 'md_103'))
    expect(review.requestAction).toBe('DELIST')
    await t.gov.approveReview(review.id)
    expect((await model.getModel('md_103')).status).toBe('DRAFT')
    expect((await t.app.getMyApplication(application.id)).result).toBe('APPROVED')
  })

  it('我的申请撤回 / 重新提交经业务模块：撤回后审核中心 404、对象无在途；重提后审核中心新行可通过', async () => {
    const ex = await import('../domainExpertMock')
    ex.__resetExpertMock()
    await ex.publishExpert(201, { bump: 'PATCH', releaseNotes: '走我的申请' })
    let { review, application } = await pendingRows(t, 'EXPERT', 201)
    await t.app.withdrawMyApplication(application.id)
    await expect(t.gov.approveReview(review.id)).rejects.toMatchObject({ code: 404 })
    expect((await ex.getExpert(201)).pendingAction).toBeFalsy()

    const fresh = await t.app.resubmitMyApplication(application.id)
    expect(fresh.result).toBe('PENDING')
    ;({ review } = await pendingRows(t, 'EXPERT', 201))
    expect(review.version).toBe(fresh.version)
    await t.gov.approveReview(review.id)
    expect((await ex.getExpert(201)).latestVersionLabel).toBe(fresh.version)
    expect((await t.app.getMyApplication(fresh.id)).result).toBe('APPROVED')
  })

  /* ---------------- 强制回收并入停用（2026-10-12）：五类对象的提交 / 通过 / 驳回 / 撤回联动 ----------------
   * 强制回收不是独立流程，而是停用弹窗里的勾选项（PRD 审核中心 §5.2、访问审计 §6.2 / §6.5.1、各模块「强制回收（停用时勾选）」）：
   * 提交后对象仍已发布、审核中；只有审核**通过**才回收生效并写访问审计；驳回 / 撤回无任何回收后果。
   * 注意：这里不断言审计的“操作人”（口径由另一处改动负责）。
   */
  describe('强制回收停用：对象 / 审核中心 / 我的申请 / 访问审计联动', () => {
    const REASON = '存在严重安全风险'
    // 每类对象：起点（种子里已发布且无在途）、停用入口、状态读取、撤回入口。state() 统一返回 { name, status, revoked }，status 为 PUBLISHED（已发布无在途）/ REVIEWING（审核中，提交停用后对象仍在对外提供）/ UNPUBLISHED
    const KINDS = {
      MCP: {
        refId: 'calendar', auditModule: 'MCP',
        setup: async () => { (await import('../mcpConnectorMock')).__resetMcpMock() },
        delist: async (opts) => (await import('../mcpConnectorMock')).delistMcpService('calendar', opts),
        withdraw: async () => (await import('../mcpConnectorMock')).withdrawMcpService('calendar'),
        state: async () => {
          const m = await import('../mcpConnectorMock')
          const row = await m.getMcp('calendar')
          const agg = (await m.getMcpServicePublishStatus('calendar')).targets[0].aggregateStatus
          return { name: row.name, status: { PUBLISHED: 'PUBLISHED', PENDING_REVIEW: 'REVIEWING' }[agg] || 'UNPUBLISHED', revoked: row.revoked }
        }
      },
      API: {
        refId: 'api_1101', auditModule: 'API',
        setup: async () => { (await import('../apiConnectorMock')).__resetApiMock() },
        delist: async (opts) => (await import('../apiConnectorMock')).deactivateApi('api_1101', opts),
        withdraw: async () => (await import('../apiConnectorMock')).withdrawApi('api_1101'),
        state: async () => {
          const row = await (await import('../apiConnectorMock')).getApi('api_1101')
          return { name: row.name, status: { PUBLISHED: 'PUBLISHED', PENDING_REVIEW: 'REVIEWING' }[row.status] || 'UNPUBLISHED', revoked: row.revoked }
        }
      },
      BIZ_SYSTEM: {
        refId: 'biz_2101', auditModule: '业务系统',
        setup: async () => { (await import('../bizSystemMock')).__resetBizSystemMock() },
        delist: async (opts) => (await import('../bizSystemMock')).deactivateBizSystem('biz_2101', opts),
        withdraw: async () => (await import('../bizSystemMock')).withdrawBizSystem('biz_2101'),
        state: async () => {
          const row = await (await import('../bizSystemMock')).getBizSystem('biz_2101')
          return { name: row.name, status: { PUBLISHED: 'PUBLISHED', PENDING_REVIEW: 'REVIEWING' }[row.status] || 'UNPUBLISHED', revoked: row.revoked }
        }
      },
      EXPERT: {
        refId: 201, auditModule: '专家',
        setup: async () => { (await import('../domainExpertMock')).__resetExpertMock() },
        delist: async (opts) => (await import('../domainExpertMock')).unpublishExpert(201, opts),
        withdraw: async () => (await import('../domainExpertMock')).withdrawExpert(201),
        state: async () => {
          const row = await (await import('../domainExpertMock')).getExpert(201)
          return { name: row.name, status: row.status !== 'published' ? 'UNPUBLISHED' : row.pendingAction ? 'REVIEWING' : 'PUBLISHED', revoked: row.revoked }
        }
      },
      SKILL: {
        refId: 'sk_305', auditModule: '技能',
        setup: async () => {
          // 技能没有 reset 入口：把 sk_305 摆回「已发布、无在途、无回收标记」
          ;(await import('../unifiedSkillMock'))._reset('sk_305', { status: 'published', delisted: false, pendingAction: null, pendingRevokeReason: '', pendingRevokeBy: '', revoked: null })
        },
        delist: async (opts) => (await import('../unifiedSkillMock')).delistSkill('sk_305', opts),
        withdraw: async () => (await import('../unifiedSkillMock')).withdrawPublish('sk_305'),
        state: async () => {
          const raw = (await import('../unifiedSkillMock'))._getRaw('sk_305')
          return { name: raw.name, status: raw.status !== 'published' || raw.delisted ? 'UNPUBLISHED' : raw.pendingAction ? 'REVIEWING' : 'PUBLISHED', revoked: raw.revoked }
        }
      }
    }
    const TYPES = Object.keys(KINDS)
    const forceRevokeOps = async () => (await import('../accessAuditMock')).opsRecords.filter((r) => r.live && r.action === '强制回收')
    const stopOps = async () => (await import('../accessAuditMock')).opsRecords.filter((r) => r.live && r.action === '停用')
    // 模块态跨用例共享：通过用例会让对象留在「已回收」，而同文件的岗位发布用例引用了这些对象（发布前检查会因“引用了已回收对象”阻断），
    // 随机序下就会偶发红。每条用例结束都把五类对象与访问审计摆回起点，不把回收状态泄漏出去。
    afterEach(async () => {
      for (const k of Object.values(KINDS)) await k.setup()
      ;(await import('../accessAuditMock')).resetAccessAuditMock()
    })

    /** 摆好起点并提交强制回收停用，返回提交后的两张表待审行 */
    async function submitForced(type) {
      const k = KINDS[type]
      ;(await import('../accessAuditMock')).resetAccessAuditMock()
      await k.setup()
      expect((await k.state()).status).toBe('PUBLISHED') // 起点：已发布、无在途
      await k.delist({ forceRevoke: true, reason: REASON })
      return pendingRows(t, type, k.refId)
    }

    it.each(TYPES)('%s：提交强制回收停用 → 对象进入审核中（仍在对外提供）、无回收标记；审核中心与我的申请各有一行带回收原因；此时访问审计没有强制回收记录', async (type) => {
      const { review, application } = await submitForced(type)
      expect(review).toMatchObject({ requestAction: 'FORCE_REVOKE', forceRevokeReason: REASON }) // 申请类型单独是「强制回收」，不再是「停用」
      expect(application).toMatchObject({ applicationType: 'FORCE_REVOKE', forceRevokeReason: REASON })
      const st = await KINDS[type].state()
      expect(st.status).toBe('REVIEWING') // 审核通过前对象仍在对外提供，只是锁在审核中
      expect(st.revoked).toBeFalsy()
      expect(await forceRevokeOps()).toHaveLength(0)
    })

    it.each(TYPES)('%s：审核通过 → 对象未发布且「已回收」带原因；两张表待审行消失、申请变已通过；访问审计恰有一条强制回收（无额外「停用」记录），客户端视图读到 forceRevoke', async (type) => {
      const k = KINDS[type]
      const { review, application } = await submitForced(type)
      await t.gov.approveReview(review.id)

      const st = await k.state()
      expect(st.status).toBe('UNPUBLISHED')
      expect(st.revoked).toMatchObject({ reason: REASON })
      const after = await pendingRows(t, type, k.refId)
      expect(after.review).toBeUndefined()
      expect(after.application).toBeUndefined()
      expect((await t.app.getMyApplication(application.id)).result).toBe('APPROVED')

      const ops = await forceRevokeOps()
      expect(ops).toHaveLength(1)
      expect(ops[0]).toMatchObject({ module: k.auditModule, action: '强制回收', target: st.name, detail: REASON })
      expect(await stopOps()).toHaveLength(0)
      const view = (await import('../accessAuditMock')).listClientFacingOps().filter((r) => r.kind === 'forceRevoke' && r.objectName === st.name) // 种子里另有「已回收」样例的审计
      expect(view).toHaveLength(1)
      expect(view[0]).toMatchObject({ kind: 'forceRevoke', objectType: k.auditModule, objectName: st.name, reason: REASON })
    })

    it.each(TYPES)('%s：审核驳回 → 对象仍已发布、无回收标记；申请变已驳回；访问审计没有强制回收记录', async (type) => {
      const k = KINDS[type]
      const { review, application } = await submitForced(type)
      await t.gov.rejectReview(review.id, '暂不回收')

      const st = await k.state()
      expect(st.status).toBe('PUBLISHED')
      expect(st.revoked).toBeFalsy()
      expect((await pendingRows(t, type, k.refId)).review).toBeUndefined()
      expect((await t.app.getMyApplication(application.id))).toMatchObject({ result: 'REJECTED', rejectReason: '暂不回收' })
      expect(await forceRevokeOps()).toHaveLength(0)
    })

    it.each(TYPES)('%s：撤回 → 对象仍已发布、无回收标记；审核中心摘行、我的申请置已撤回；访问审计没有强制回收记录', async (type) => {
      const k = KINDS[type]
      const { application } = await submitForced(type)
      await k.withdraw()

      const st = await k.state()
      expect(st.status).toBe('PUBLISHED')
      expect(st.revoked).toBeFalsy()
      const after = await pendingRows(t, type, k.refId)
      expect(after.review).toBeUndefined()
      expect(after.application).toBeUndefined()
      expect((await t.app.getMyApplication(application.id)).result).toBe('WITHDRAWN')
      expect(await forceRevokeOps()).toHaveLength(0)
    })
  })
})
