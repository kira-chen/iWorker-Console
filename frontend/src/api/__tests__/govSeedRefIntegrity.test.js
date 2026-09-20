// @vitest-environment jsdom
// （治理 mock → request.js → router 链路触达 window，故用 jsdom）
import { describe, it, expect, beforeEach } from 'vitest'
import { listReviews, resetReviewsMock } from '../reviewsMock'
import { listMyApplications, resetMyApplicationsMock } from '../myApplicationsMock'
import { getPosition, __resetPositionMock } from '../positionMock'
import { getExpert, __resetExpertMock } from '../domainExpertMock'
import { getSkillDetail, _getRaw as getSkillRaw } from '../unifiedSkillMock'
import { get as getKnowledgeBase } from '../knowledgeBaseMock'
import { getMcp, getMcpServicePublishStatus } from '../mcpConnectorMock'
import { getApi } from '../apiConnectorMock'
import { getBizSystem } from '../bizSystemMock'
import { getModel } from '../adminModelMock'
import { getVersion, resetVersionMock } from '../versionMock'
import { isDelistAction } from '../reviewEnroll'

/**
 * 治理域种子「三方一致」护栏（2026-09-09 PRD 复核·G2 顺修 → 2026-09-12 T44 扩到全部行 → 2026-09-18 R1 升级）。
 *
 * 【R1 升级前只钉「同名」】审核中心 / 我的申请的行数据自带 name，点【查看】却拿 refId 去业务模块取实体渲染，
 * 名字对不上就静默错配——所以原护栏钉的是「行名 = 实体名」。
 *
 * 【R1 起同时钉「同事」】09-18 逻辑审查发现：9 条审核种子里 6 条的申请类型 / 版本与业务对象的在途事项不一致
 * （已发布对象挂着「首发待审」、待审发布被记成停用……），审核通过时把停用当发布落地、造出重复版本历史。
 * 于是本护栏加三条断言：
 *   1. 每条**待审**审核行 → 业务对象必须有在途事项，且方向（发布 / 停用）同向；
 *   2. 每条**待审**申请行 → 审核中心必须有同 type + refId + 申请类型 的待审行（两张表同一笔）；
 *   3. 反过来每条待审审核行 → 我的申请也必须有对应待审行。
 * 新增种子行忘记接线、或只改一侧，这里立刻红。
 */

const GETTER = {
  POSITION: getPosition,
  EXPERT: getExpert,
  SKILL: getSkillDetail,
  KNOWLEDGE_BASE: getKnowledgeBase,
  MCP: getMcp,
  API: getApi,
  BIZ_SYSTEM: getBizSystem,
  MODEL: getModel,
  VERSION: getVersion // 版本管理（2026-09-20）：getVersion 返回带 name（终端 + 版本号）与统一 pendingAction 的版本行
}

/** 各模块「在途事项」的读法不同：统一取成 null | 'PUBLISH' | 'DELIST' */
async function pendingOf(kind, refId) {
  if (kind === 'SKILL') {
    const raw = getSkillRaw(refId)
    return raw?.pendingAction ? (raw.pendingAction === 'stop' ? 'DELIST' : 'PUBLISH') : null
  }
  if (kind === 'MCP') {
    const t = (await getMcpServicePublishStatus(refId)).targets[0]
    return t.aggregateStatus === 'PENDING_REVIEW' ? t.pendingAction || 'PUBLISH' : null
  }
  const entity = await GETTER[kind](refId)
  const pa = entity?.pendingAction
  if (!pa) return null
  return isDelistAction(pa) ? 'DELIST' : 'PUBLISH'
}

// 审核中心行的业务类型归一化（与 UnifiedReview.vue kindOf 同口径：TOOL 按 subType 拆 MCP / API）
function reviewKind(row) {
  if (row.type === 'TOOL') return row.subType === 'MCP' ? 'MCP' : 'API'
  return row.type
}

describe('治理种子三方一致护栏：审核中心 / 我的申请 ↔ 业务模块（同名 + 同事）', () => {
  beforeEach(() => {
    __resetPositionMock()
    __resetExpertMock()
    resetVersionMock()
    resetReviewsMock()
    resetMyApplicationsMock()
  })

  it('审核中心：全部待审行（13 条）的 name 与 refId 所指实体同名，且对象在途事项与申请类型同向', async () => {
    const { list, total } = await listReviews({ size: 50 })
    expect(total).toBe(13)
    const problems = []
    for (const row of list) {
      const kind = reviewKind(row)
      expect(GETTER[kind], `审核行 id ${row.id} 的业务类型 ${kind} 没有对应 getter`).toBeTypeOf('function')
      const entity = await GETTER[kind](row.refId)
      if (entity?.name !== row.name) problems.push(`id ${row.id}（${kind} ${row.refId}）：行名「${row.name}」≠ 实体名「${entity?.name}」`)
      const pending = await pendingOf(kind, row.refId)
      if (!pending) problems.push(`id ${row.id}（${kind} ${row.refId}）：对象没有在途事项，审核行悬空`)
      else if ((pending === 'DELIST') !== isDelistAction(row.requestAction)) problems.push(`id ${row.id}（${kind} ${row.refId}）：审核行 ${row.requestAction} 与对象在途 ${pending} 不同向`)
    }
    expect(problems).toEqual([])
    // 九类业务（含 2026-09-20 新增的版本管理）在种子里都至少出现一次，护栏不留空档
    expect(new Set(list.map(reviewKind))).toEqual(new Set(Object.keys(GETTER)))
  })

  it('我的申请：对象仍在的行 objectName 与实体同名；每条待审申请行在审核中心有同 type+refId+申请类型 的待审行', async () => {
    const { list } = await listMyApplications({ size: 50 })
    const reviews = (await listReviews({ size: 50 })).list
    const problems = []
    for (const row of list) {
      if (row.objectDeleted) continue // md §四 L47：对象已删除样例，只留行不查实体
      const entity = await GETTER[row.businessType](row.refId)
      if (entity?.name !== row.objectName) problems.push(`id ${row.id}（${row.businessType} ${row.refId}）：行名「${row.objectName}」≠ 实体名「${entity?.name}」`)
      if (row.result !== 'PENDING') continue
      const twin = reviews.find(
        (r) => reviewKind(r) === row.businessType && String(r.refId) === String(row.refId) && r.requestAction === row.applicationType
      )
      if (!twin) problems.push(`id ${row.id}（${row.businessType} ${row.refId} ${row.applicationType}）：审核中心没有同一笔待审行`)
      else if (twin.version !== row.version) problems.push(`id ${row.id}：申请版本「${row.version}」≠ 审核行版本「${twin.version}」`)
    }
    expect(problems).toEqual([])
    expect(new Set(list.map((r) => r.businessType))).toEqual(new Set(Object.keys(GETTER)))
  })

  it('反向：每条待审审核行在我的申请里都有同一笔待审行（两张表一笔不多一笔不少）', async () => {
    const reviews = (await listReviews({ size: 50 })).list
    const apps = (await listMyApplications({ result: 'PENDING', size: 50 })).list
    const missing = reviews.filter(
      (r) => !apps.some((a) => a.businessType === reviewKind(r) && String(a.refId) === String(r.refId) && a.applicationType === r.requestAction)
    )
    expect(missing.map((r) => `${r.id} ${reviewKind(r)} ${r.refId}`)).toEqual([])
    expect(apps.length).toBe(reviews.length)
  })
})
