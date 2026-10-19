import { describe, it, expect } from 'vitest'
import { dateDaysAgo, daysAgo } from '../seedDate'

// 演示种子的「相对今天」日期（2026-10-10 测试审计 J27）：n 天前按日历日回退，不按 24h 毫秒数算。
describe('seedDate · 相对今天的种子日期', () => {
  const NOW = new Date(2026, 9, 10, 15, 30) // 2026-10-10 15:30 本地

  it('dateDaysAgo：n 天前的日期；0 = 今天；跨月跨年按日历回退', () => {
    expect(dateDaysAgo(0, NOW)).toBe('2026-10-10')
    expect(dateDaysAgo(43, NOW)).toBe('2026-08-28')
    expect(dateDaysAgo(10, new Date(2027, 0, 5))).toBe('2026-12-26')
  })

  it('daysAgo：日期 + 钟点原样拼接（分钟或秒级都支持）', () => {
    expect(daysAgo(2, '14:30', NOW)).toBe('2026-10-08 14:30')
    expect(daysAgo(44, '16:08:00', NOW)).toBe('2026-08-27 16:08:00')
  })

  it('默认以当前时刻为「今天」：daysAgo(0) 以今天日期开头', () => {
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    expect(daysAgo(0, '08:00')).toMatch(new RegExp(`^${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 08:00$`))
  })
})
