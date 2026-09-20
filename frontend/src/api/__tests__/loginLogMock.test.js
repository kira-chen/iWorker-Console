import { describe, it, expect } from 'vitest'
import { listLoginLogs } from '../loginLogMock'

// 2026-09-12 对齐 md `prd.访问审计.md` §三.1（默认登录时间倒序）/ §四（多终端多条记录、终端仅 Windows/Mac、
// 按登出时间排序在线记录排末尾）；种子 11 条。
describe('loginLogMock —— 访问审计（md §三 / §四；同一账号多终端 11 条种子）', () => {
  it('默认按登录时间倒序，总数 11，终端仅 Windows/Mac', async () => {
    const { list, total } = await listLoginLogs()
    expect(total).toBe(11)
    expect(list[0].loginAt).toBe('2026-08-28 10:21')
    expect(new Set(list.map((r) => r.terminal))).toEqual(new Set(['Windows', 'Mac']))
  })

  it('用户名模糊搜索 + 在线状态筛选可组合', async () => {
    const { list } = await listLoginLogs({ keyword: 'zhang', status: 'OFFLINE' })
    expect(list.every((r) => r.username.includes('zhang') && r.status === 'OFFLINE')).toBe(true)
    expect(list).toHaveLength(2)
  })

  /**
   * 2026-09-09 PRD 复核批次 0（G7）：md `prd.访问审计.md` §四
   * 「按登出时间排序时，在线记录（无登出时间）统一排在列表末尾」——**不分升降序**。
   * 旧实现把空串一并丢进 localeCompare：desc 下碰巧排最后，asc 下排到最前（原用例锁的正是该错误行为）。
   */
  it('登出时间排序：在线记录（无登出时间）升降序均排列表末尾（md §四）', async () => {
    const online = 4 // 种子中 status=ONLINE、logoutAt 为空的记录数

    const asc = await listLoginLogs({ sortField: 'logoutAt', sortDir: 'asc', size: 20 })
    expect(asc.list[0].logoutAt).not.toBe('') // 不再排到最前
    expect(asc.list.slice(-online).every((r) => r.logoutAt === '')).toBe(true)
    expect(asc.list.slice(0, -online).every((r) => r.logoutAt !== '')).toBe(true)

    const desc = await listLoginLogs({ sortField: 'logoutAt', sortDir: 'desc', size: 20 })
    expect(desc.list.slice(-online).every((r) => r.logoutAt === '')).toBe(true)

    // 有登出时间的记录之间，升降序仍正常反转
    const ascFilled = asc.list.slice(0, -online).map((r) => r.logoutAt)
    const descFilled = desc.list.slice(0, -online).map((r) => r.logoutAt)
    expect(descFilled).toEqual([...ascFilled].reverse())
  })

  // 待办 yuepu#12③：日期范围必须在分页之前过滤——否则页面只能过滤当前页，出现「第 1 页空表、total 仍是全量」。
  it('登录日期范围（dateFrom / dateTo，含首尾）在分页之前过滤：total 随范围变化，翻页取的是过滤后的结果', async () => {
    // 种子按登录日期：08-28 共 6 条（含 07:30 / 08:12 / 08:48 / 09:16 / 10:03 / 10:21），08-27 共 4 条，08-26 共 1 条
    const day28 = await listLoginLogs({ dateFrom: '2026-08-28', dateTo: '2026-08-28' })
    expect(day28.total).toBe(6)
    expect(day28.list.every((r) => r.loginAt.startsWith('2026-08-28'))).toBe(true)

    const from27 = await listLoginLogs({ dateFrom: '2026-08-27' })
    expect(from27.total).toBe(10) // 只给起点：08-27 及以后，排除 08-26 那条

    const upTo26 = await listLoginLogs({ dateTo: '2026-08-26' })
    expect(upTo26.total).toBe(1) // 只给终点：08-26 及以前

    // 过滤后只剩 6 条，每页 5 条：第 2 页应只有 1 条，且仍是范围内的记录（而不是全量的第 6~10 条）
    const p2 = await listLoginLogs({ dateFrom: '2026-08-28', dateTo: '2026-08-28', page: 2, size: 5 })
    expect(p2.total).toBe(6)
    expect(p2.list).toHaveLength(1)
    expect(p2.list[0].loginAt.startsWith('2026-08-28')).toBe(true)

    const none = await listLoginLogs({ dateFrom: '2027-01-01' })
    expect(none).toEqual({ list: [], total: 0 })
  })

  it('分页切片', async () => {
    const { list, total } = await listLoginLogs({ page: 2, size: 10 })
    expect(total).toBe(11)
    expect(list).toHaveLength(1)
  })
})
