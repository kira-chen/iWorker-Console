import { describe, it, expect } from 'vitest'

/**
 * utils/docMeta.js 单测：该模块现已缩成 fmtSize（文件大小）/ fmtTime（分钟级时间，转自 datetime.fmtMinute）/
 * fmtRelative（相对时间）三个格式化函数，下面三个 describe 各守一个。
 */
const { fmtSize, fmtTime, fmtRelative } = await import('@/utils/docMeta')

/**
 * 2026-09-12 测试审计补缺口（F7）：fmtRelative 边界零用例。
 * 该函数被模型页「最近验证时间」与 SaveStatusIndicator 共用（全站单一实现），
 * 阈值一旦漂移，「4 秒前」「1 分钟前」之类文案会同时改变，故逐个边界钉死。
 */
describe('fmtRelative（相对时间边界：刚刚 / 秒 / 分钟 / 小时 / 天）', () => {
  const NOW = Date.parse('2026-09-12T10:00:00Z')
  const ago = (sec) => new Date(NOW - sec * 1000).toISOString()

  it('不足 5 秒 → 「刚刚」；满 5 秒 → 「5 秒前」', () => {
    expect(fmtRelative(ago(0), NOW)).toBe('刚刚')
    expect(fmtRelative(ago(4), NOW)).toBe('刚刚')
    expect(fmtRelative(ago(5), NOW)).toBe('5 秒前')
  })
  it('59 秒 → 「59 秒前」；满 60 秒 → 「1 分钟前」', () => {
    expect(fmtRelative(ago(59), NOW)).toBe('59 秒前')
    expect(fmtRelative(ago(60), NOW)).toBe('1 分钟前')
  })
  it('3599 秒 → 「59 分钟前」；满 3600 秒 → 「1 小时前」', () => {
    expect(fmtRelative(ago(3599), NOW)).toBe('59 分钟前')
    expect(fmtRelative(ago(3600), NOW)).toBe('1 小时前')
  })
  it('86399 秒 → 「23 小时前」；满 86400 秒 → 「1 天前」', () => {
    expect(fmtRelative(ago(86399), NOW)).toBe('23 小时前')
    expect(fmtRelative(ago(86400), NOW)).toBe('1 天前')
  })
  it('空值 / 非法时间串 → 空串（不抛错、不显 NaN）', () => {
    expect(fmtRelative('', NOW)).toBe('')
    expect(fmtRelative(null, NOW)).toBe('')
    expect(fmtRelative(undefined, NOW)).toBe('')
    expect(fmtRelative('not-a-date', NOW)).toBe('')
  })
  it('未来时间（时钟漂移）→ 夹到 0 显「刚刚」，不出现负数', () => {
    expect(fmtRelative(new Date(NOW + 60_000).toISOString(), NOW)).toBe('刚刚')
  })
  it('接受 Date 与时间戳入参（与 ISO 串同结果）', () => {
    expect(fmtRelative(new Date(NOW - 120_000), NOW)).toBe('2 分钟前')
    expect(fmtRelative(NOW - 120_000, NOW)).toBe('2 分钟前')
  })
})
describe('fmtSize', () => {
  it('null / undefined → "-"', () => {
    expect(fmtSize(null)).toBe('-')
    expect(fmtSize(undefined)).toBe('-')
  })
  it('小于 1KB → B（整数）', () => {
    expect(fmtSize(0)).toBe('0 B')
    expect(fmtSize(512)).toBe('512 B')
    expect(fmtSize(1023)).toBe('1023 B')
  })
  it('KB 级别保留一位小数', () => {
    expect(fmtSize(1536)).toBe('1.5 KB')
  })
  it('整 KB 也保留一位（i===0 的 KB 档且 <100 → 保留一位）', () => {
    expect(fmtSize(2048)).toBe('2.0 KB')
  })
  it('>=100 单位取整', () => {
    expect(fmtSize(150 * 1024)).toBe('150 KB')
  })
  it('MB / GB 进位', () => {
    expect(fmtSize(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(fmtSize(3 * 1024 * 1024 * 1024)).toBe('3.0 GB')
  })
})
describe('fmtTime', () => {
  it('空 → 空串', () => {
    expect(fmtTime('')).toBe('')
    expect(fmtTime(null)).toBe('')
  })
  it('非法时间串 → 原样返回', () => {
    expect(fmtTime('not-a-date')).toBe('not-a-date')
  })
  it('合法 ISO → YYYY-MM-DD HH:mm（按本地时区，故校验格式而非具体值）', () => {
    const out = fmtTime('2026-06-11T08:05:00Z')
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})
