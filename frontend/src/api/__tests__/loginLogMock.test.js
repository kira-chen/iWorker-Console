import { describe, it, expect } from 'vitest'
import { listLoginLogs } from '../loginLogMock'

describe('loginLogMock —— 访问审计（2026-09-01 PRD 对齐轮，原型多终端 11 条种子）', () => {
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

  it('登出时间排序：在线记录 logoutAt 为空按空串参与比较；升序时空串在前', async () => {
    const { list } = await listLoginLogs({ sortField: 'logoutAt', sortDir: 'asc' })
    expect(list[0].logoutAt).toBe('')
  })

  it('分页切片', async () => {
    const { list, total } = await listLoginLogs({ page: 2, size: 10 })
    expect(total).toBe(11)
    expect(list).toHaveLength(1)
  })
})
