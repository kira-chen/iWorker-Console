// @vitest-environment jsdom
// （治理 mock → request.js → router 链路触达 window，故用 jsdom）
import { describe, it, expect, beforeEach } from 'vitest'
import { listReviews, resetReviewsMock } from '../reviewsMock'
import { listMyApplications, resetMyApplicationsMock } from '../myApplicationsMock'
import { getPosition, __resetPositionMock } from '../positionMock'
import { getExpert } from '../domainExpertMock'

/**
 * 治理域种子「refId ↔ 行名」一致性护栏（2026-09-09 PRD 复核·G2 顺修）。
 *
 * 【修的是什么】审核中心与我的申请的行数据自带 name/objectName，但点【查看】时是拿 refId
 * 去业务模块实时取实体渲染只读详情。改造前有 6 行的 name 与其 refId 所指实体**不同名**——
 * 列表写「合同审阅专员」，点开抽屉却是「财务审核岗」。这些名只出自已退役的交互原型 html，
 * md 无依据；按 Q10 既定拍板（原型名与业务模块种子冲突时以业务模块为准）已对齐到实体本体。
 *
 * 【为什么加这个护栏】name 与 refId 分别写在两处（行字面量 + REF 映射表），
 * 改一处漏一处不会有任何报错，只会在点【查看】时静默错配。此处把「三方同名」钉成断言。
 */
describe('治理种子 refId 借名护栏：审核中心 / 我的申请 ↔ 业务模块三方同名', () => {
  beforeEach(() => {
    __resetPositionMock()
    resetReviewsMock()
    resetMyApplicationsMock()
  })

  it('审核中心：岗位行（id 5）名与 refId 所指岗位实体同名', async () => {
    const { list } = await listReviews()
    const row = list.find((r) => r.id === 5)
    expect(row.type).toBe('POSITION')
    const entity = await getPosition(row.refId)
    expect(row.name).toBe(entity.name)
  })

  it('审核中心：专家行（id 6）名与 refId 所指专家实体同名', async () => {
    const { list } = await listReviews()
    const row = list.find((r) => r.id === 6)
    expect(row.type).toBe('EXPERT')
    const entity = await getExpert(row.refId)
    expect(row.name).toBe(entity.name)
  })

  it('我的申请：专家行 502 / 510 的 objectName 与 refId 所指专家实体同名', async () => {
    const { list } = await listMyApplications({ businessType: 'EXPERT' })
    expect(list.map((r) => r.id).sort()).toEqual([502, 510])
    for (const row of list) {
      const entity = await getExpert(row.refId)
      expect(row.objectName).toBe(entity.name)
    }
  })

  it('我的申请：岗位行 503 的 objectName 与 refId 所指岗位实体同名', async () => {
    const { list } = await listMyApplications({ businessType: 'POSITION' })
    const row = list.find((r) => r.id === 503)
    const entity = await getPosition(row.refId)
    expect(row.objectName).toBe(entity.name)
  })

  it('同一 MCP 在两侧指向同一实体：审核中心 id 8 与我的申请 505 的 refId 一致', async () => {
    const { list: reviews } = await listReviews()
    const { list: apps } = await listMyApplications({ businessType: 'MCP' })
    expect(reviews.find((r) => r.id === 8).refId).toBe('knowledge_hub')
    expect(apps.find((r) => r.id === 505).refId).toBe('knowledge_hub')
  })
})
