// @vitest-environment jsdom
// （治理 mock → request.js → router 链路触达 window，故用 jsdom）
import { describe, it, expect, beforeEach } from 'vitest'
import { listReviews, resetReviewsMock } from '../reviewsMock'
import { listMyApplications, resetMyApplicationsMock } from '../myApplicationsMock'
import { getPosition, __resetPositionMock } from '../positionMock'
import { getExpert } from '../domainExpertMock'
import { getSkillDetail } from '../unifiedSkillMock'
import { get as getKnowledgeBase } from '../knowledgeBaseMock'
import { getMcp } from '../mcpConnectorMock'
import { getApi } from '../apiConnectorMock'
import { getBizSystem } from '../bizSystemMock'
import { getModel } from '../adminModelMock'

/**
 * 治理域种子「refId ↔ 行名」一致性护栏（2026-09-09 PRD 复核·G2 顺修；2026-09-12 测试审计 T44 扩到全部行）。
 *
 * 【修的是什么】审核中心与我的申请的行数据自带 name/objectName，但点【查看】时是拿 refId
 * 去业务模块实时取实体渲染只读详情。改造前有 6 行的 name 与其 refId 所指实体**不同名**——
 * 列表写「合同审阅专员」，点开抽屉却是「财务审核岗」。这些名只出自已退役的交互原型 html，
 * md 无依据；按 Q10 既定拍板（原型名与业务模块种子冲突时以业务模块为准）已对齐到实体本体。
 *
 * 【为什么加这个护栏】name 与 refId 分别写在两处（行字面量 + REF 映射表），
 * 改一处漏一处不会有任何报错，只会在点【查看】时静默错配。此处把「三方同名」钉成断言。
 *
 * 【T44 扩面】原只钉 5 行（岗位 / 专家）；改为遍历审核中心全部待审行 + 我的申请全部行，
 * 按业务类型查 getter 表取实体（审核中心 TOOL 按 subType 拆 MCP / API），逐行断 name ↔ 实体名。
 * 新增种子行忘记接 refId、或改名漏改一侧，这里立刻红。
 */

// 业务类型 → 取实体函数（各业务模块 mock 的单条 getter；返回对象均带 name）
const GETTER = {
  POSITION: getPosition,
  EXPERT: getExpert,
  SKILL: getSkillDetail,
  KNOWLEDGE_BASE: getKnowledgeBase,
  MCP: getMcp,
  API: getApi,
  BIZ_SYSTEM: getBizSystem,
  MODEL: getModel
}

// 审核中心行的业务类型归一化（与 UnifiedReview.vue kindOf 同口径：TOOL 按 subType 拆 MCP / API）
function reviewKind(row) {
  if (row.type === 'TOOL') return row.subType === 'MCP' ? 'MCP' : 'API'
  return row.type
}

describe('治理种子 refId 借名护栏：审核中心 / 我的申请 ↔ 业务模块三方同名', () => {
  beforeEach(() => {
    __resetPositionMock()
    resetReviewsMock()
    resetMyApplicationsMock()
  })

  it('审核中心：全部待审行（9 条）的 name 都与 refId 所指业务实体同名（八类业务各有 getter）', async () => {
    const { list, total } = await listReviews({ size: 50 })
    expect(total).toBe(9)
    const mismatches = []
    for (const row of list) {
      const kind = reviewKind(row)
      const getter = GETTER[kind]
      expect(getter, `审核行 id ${row.id} 的业务类型 ${kind} 没有对应 getter`).toBeTypeOf('function')
      const entity = await getter(row.refId)
      if (entity?.name !== row.name) mismatches.push(`id ${row.id}（${kind} ${row.refId}）：行名「${row.name}」≠ 实体名「${entity?.name}」`)
    }
    expect(mismatches).toEqual([])
    // 八类业务在种子里都至少出现一次，护栏不留空档
    expect(new Set(list.map(reviewKind))).toEqual(new Set(Object.keys(GETTER)))
  })

  it('我的申请：全部行（11 条，含对象已删除样例 510）的 objectName 都与 refId 所指业务实体同名', async () => {
    const { list, total } = await listMyApplications({ size: 50 })
    expect(total).toBe(11)
    const mismatches = []
    for (const row of list) {
      const getter = GETTER[row.businessType]
      expect(getter, `申请行 id ${row.id} 的业务类型 ${row.businessType} 没有对应 getter`).toBeTypeOf('function')
      const entity = await getter(row.refId)
      if (entity?.name !== row.objectName) mismatches.push(`id ${row.id}（${row.businessType} ${row.refId}）：行名「${row.objectName}」≠ 实体名「${entity?.name}」`)
    }
    expect(mismatches).toEqual([])
    expect(new Set(list.map((r) => r.businessType))).toEqual(new Set(Object.keys(GETTER)))
  })

  it('同一对象在两侧指向同一实体：审核中心 id 8 与我的申请 505 的 MCP refId 一致（knowledge_hub）', async () => {
    const { list: reviews } = await listReviews()
    const { list: apps } = await listMyApplications({ businessType: 'MCP' })
    expect(reviews.find((r) => r.id === 8).refId).toBe('knowledge_hub')
    expect(apps.find((r) => r.id === 505).refId).toBe('knowledge_hub')
  })
})
