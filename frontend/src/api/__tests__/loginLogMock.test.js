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

  it('分页切片', async () => {
    const { list, total } = await listLoginLogs({ page: 2, size: 10 })
    expect(total).toBe(11)
    expect(list).toHaveLength(1)
  })
})
