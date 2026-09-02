import { describe, it, expect, beforeEach } from 'vitest'
import {
  listMyApplications,
  getMyApplication,
  withdrawMyApplication,
  resubmitMyApplication,
  resetMyApplicationsMock
} from '../myApplicationsMock'

/**
 * 我的申请 mock 层（2026-09-01 PRD 对齐新增模块）回归保护：
 * 种子 = 交互原型 v2 的 10 条申请（7 类业务 × 4 种结果，含一条 OTHER）；
 * 撤回 → WITHDRAWN；重新提交 → PENDING + 刷新申请时间 + 清空审核人/审核时间/驳回原因。
 */
describe('myApplicationsMock · 我的申请内存 mock', () => {
  beforeEach(() => resetMyApplicationsMock())

  it('默认列表：10 条，按 submittedAt desc', async () => {
    const { list, total } = await listMyApplications()
    expect(total).toBe(10)
    expect(list[0].id).toBe(501) // 2026-08-28 10:30 最新
    const times = list.map((r) => r.submittedAt)
    expect(times).toEqual([...times].sort().reverse())
  })

  it('筛选：businessType / applicationType / result 组合', async () => {
    const expert = await listMyApplications({ businessType: 'EXPERT' })
    expect(expert.list.map((r) => r.id)).toEqual([502, 510])
    const delist = await listMyApplications({ applicationType: 'DELIST' })
    expect(delist.list.map((r) => r.id)).toEqual([505, 510])
    const rejected = await listMyApplications({ result: 'REJECTED' })
    expect(rejected.list.map((r) => r.id)).toEqual([503, 507])
  })

  it('keyword 过滤域 = 申请对象名称/描述', async () => {
    const { list } = await listMyApplications({ keyword: '报销单' })
    expect(list.map((r) => r.id)).toEqual([509])
  })

  it('含 OTHER 类型行（用户技能审核规则）供「无业务页可跳」toast 分支演示', async () => {
    const row = await getMyApplication(508)
    expect(row.businessType).toBe('OTHER')
  })

  it('撤回：result → WITHDRAWN，审核人置「—」', async () => {
    const row = await withdrawMyApplication(501)
    expect(row.result).toBe('WITHDRAWN')
    expect(row.reviewer).toBe('—')
  })

  it('重新提交：result → PENDING，刷新申请时间，清空审核人/审核时间/驳回原因', async () => {
    const before = await getMyApplication(503)
    expect(before.result).toBe('REJECTED')
    const row = await resubmitMyApplication(503)
    expect(row.result).toBe('PENDING')
    expect(row.submittedAt).not.toBe(before.submittedAt)
    expect(row.reviewer).toBe('')
    expect(row.reviewedAt).toBe('')
    expect(row.rejectReason).toBe('')
  })

  it('不存在的 id 抛 404', async () => {
    await expect(getMyApplication(999)).rejects.toMatchObject({ code: 404 })
  })
})
