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
 * 种子 = 10 条原型申请（7 类业务 × 4 种结果；2026-09-08 决议第 8 项：不含 OTHER）
 *        + 1 条知识库申请（2026-09-09 PRD 复核·G3G6 · A6）；
 * 撤回 → WITHDRAWN；重新提交 → PENDING + 刷新申请时间 + 清空审核人/审核时间/驳回原因。
 */
describe('myApplicationsMock · 我的申请内存 mock', () => {
  beforeEach(() => resetMyApplicationsMock())

  it('默认列表：11 条（含知识库 A6 新增行），按 submittedAt desc', async () => {
    const { list, total } = await listMyApplications()
    expect(total).toBe(11)
    expect(list[0].id).toBe(511) // 2026-08-28 11:02 最新（A6 知识库行）
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

  // 2026-09-09 PRD 复核·G2：md `prd.我的申请.md` §四 L47「对应业务对象已被删除时…【查看】按钮置灰，
  // 列表行保留该条申请记录及其对象名称、业务类型、申请类型、申请版本、申请时间与审核结果」
  it('objectDeleted：默认 false；样例行 510 为 true，且行本身与六个信息字段照常保留', async () => {
    const { list, total } = await listMyApplications()
    expect(total).toBe(11) // 行未被剔除
    const deleted = list.find((r) => r.id === 510)
    expect(deleted.objectDeleted).toBe(true)
    // 六个信息字段仍在（md L47 明列）
    expect(deleted.objectName).toBe('法务审阅专家')
    expect(deleted.businessType).toBe('EXPERT')
    expect(deleted.applicationType).toBe('DELIST')
    expect(deleted.version).toBe('v1.3.0')
    expect(deleted.submittedAt).toBe('2026-08-24 10:18')
    expect(deleted.result).toBe('WITHDRAWN')
    // 其余行默认对象仍在
    expect(list.filter((r) => r.id !== 510).every((r) => r.objectDeleted === false)).toBe(true)
  })

  it('keyword 过滤域 = 申请对象名称/描述', async () => {
    const { list } = await listMyApplications({ keyword: '报销单' })
    expect(list.map((r) => r.id)).toEqual([509])
  })

  it('业务类型不含「其他」（2026-09-08 决议第 8 项）：种子 508 改为 SKILL 样例并接线 sk_304', async () => {
    const { list } = await listMyApplications({})
    expect(list.some((r) => r.businessType === 'OTHER')).toBe(false)
    const row = await getMyApplication(508)
    expect(row.businessType).toBe('SKILL')
    expect(row.refId).toBe('sk_304')
  })

  // 2026-09-09 PRD 复核·G3G6 · A6（Q265③；md `prd.我的申请.md` §二.2/§3.1 业务类型含知识库）
  it('A6 知识库：种子含 KNOWLEDGE_BASE 申请行 511，可按业务类型筛出，refId 指向 kb_3', async () => {
    const { list } = await listMyApplications({ businessType: 'KNOWLEDGE_BASE' })
    expect(list.map((r) => r.id)).toEqual([511])
    expect(list[0].refId).toBe('kb_3')
    expect(list[0].result).toBe('PENDING')
  })

  it('2026-09-08 原型复刻批次 2B（G-4）：POSITION 行 503 refId 接线岗位 mock 401 经营分析岗', async () => {
    const row = await getMyApplication(503)
    expect(row.businessType).toBe('POSITION')
    expect(row.refId).toBe(401)
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
