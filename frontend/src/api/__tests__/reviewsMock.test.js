import { describe, it, expect, beforeEach } from 'vitest'
import {
  listReviews,
  getReview,
  approveReview,
  rejectReview,
  resetReviewsMock
} from '../reviewsMock'

/**
 * 审核中心 mock 层（2026-09-01 PRD 对齐改造）回归保护：
 * 种子 = 交互原型 v2 的 8 条待审记录；列表只出待审核；
 * 业务类型七项筛选（MCP/API 由 TOOL+subType 拆分）；申请类型筛选；
 * submittedAt 排序默认 desc；通过（含停用申请）/驳回后移出待审列表。
 */
describe('reviewsMock · 审核中心内存 mock', () => {
  beforeEach(() => resetReviewsMock())

  it('默认列表：8 条全待审，按 submittedAt desc', async () => {
    const { list, total } = await listReviews()
    expect(total).toBe(8)
    expect(list.every((r) => r.status === 'PENDING_REVIEW')).toBe(true)
    const times = list.map((r) => r.submittedAt)
    expect(times).toEqual([...times].sort().reverse())
    expect(list[0].name).toBe('法务审阅专家') // 2026-08-28 10:18 最新
  })

  it('申请类型补丁：id 3/6=停用 v2.0.0，id 1/4/8=首次发布 —，其余=新版本发布 v1.2.0', async () => {
    const { list } = await listReviews()
    const byId = Object.fromEntries(list.map((r) => [r.id, r]))
    expect(byId[3].requestAction).toBe('DELIST')
    expect(byId[3].version).toBe('v2.0.0')
    expect(byId[1].requestAction).toBe('FIRST_PUBLISH')
    expect(byId[1].version).toBe('—')
    expect(byId[2].requestAction).toBe('VERSION_PUBLISH')
    expect(byId[2].version).toBe('v1.2.0')
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

  it('keyword 过滤域 = 名称/描述/提交人（搜提交人 zhangwei 命中技能行）', async () => {
    const { list } = await listReviews({ keyword: 'zhangwei' })
    expect(list.map((r) => r.id)).toEqual([7])
  })

  it('申请类型筛选 + 升序排序', async () => {
    const { list } = await listReviews({ requestAction: 'DELIST', sortDir: 'asc' })
    expect(list.map((r) => r.id)).toEqual([3, 6])
  })

  it('通过发布申请 → PUBLISHED 并移出待审列表', async () => {
    const row = await approveReview(1)
    expect(row.status).toBe('PUBLISHED')
    const { total } = await listReviews()
    expect(total).toBe(7)
  })

  it('通过停用申请 → DELISTED（原型：DELIST 通过即停用）', async () => {
    const row = await approveReview(3)
    expect(row.status).toBe('DELISTED')
  })

  it('驳回：原因必填，成功后 REJECTED 带 rejectReason', async () => {
    await expect(rejectReview(2, '   ')).rejects.toThrow('请输入驳回原因')
    const row = await rejectReview(2, '描述不完整')
    expect(row.status).toBe('REJECTED')
    expect(row.rejectReason).toBe('描述不完整')
    const { total } = await listReviews()
    expect(total).toBe(7)
  })

  it('getReview：按 id 取单条；不存在抛 404', async () => {
    const row = await getReview(5)
    expect(row.name).toBe('合同审阅专员')
    await expect(getReview(999)).rejects.toMatchObject({ code: 404 })
  })
})
