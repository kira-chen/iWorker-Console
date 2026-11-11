import { describe, it, expect } from 'vitest'
import { fmtChange, fmtCount, fmtLatency, fmtPct, fmtTokens, niceMax } from '../usageFormat'

/** 驾驶舱「使用情况」数值展示（PRD prd.驾驶舱.md 第五～七节）。 */

describe('usageFormat · Token 缩写', () => {
  it('≥ 100 万用 M、≥ 1 千用 K（各 1 位小数），其余原样', () => {
    expect(fmtTokens(54021199)).toBe('54.0M')
    expect(fmtTokens(1000000)).toBe('1.0M')
    expect(fmtTokens(233468)).toBe('233.5K')
    expect(fmtTokens(1000)).toBe('1.0K')
    expect(fmtTokens(999)).toBe('999')
    expect(fmtTokens(0)).toBe('0')
  })

  it('没有值显示「—」', () => {
    expect(fmtTokens(null)).toBe('—')
    expect(fmtTokens(undefined)).toBe('—')
  })
})

describe('usageFormat · 计数 / 百分比 / 耗时', () => {
  it('计数千分位，空值「—」', () => {
    expect(fmtCount(13275)).toBe('13,275')
    expect(fmtCount(0)).toBe('0')
    expect(fmtCount(null)).toBe('—')
  })

  it('百分比保留 1 位小数；null（没有可算的数据）显示「—」而不是 0.0%', () => {
    expect(fmtPct(12.2)).toBe('12.2%')
    expect(fmtPct(100)).toBe('100.0%')
    expect(fmtPct(0)).toBe('0.0%')
    expect(fmtPct(null)).toBe('—')
  })

  it('首响耗时「P50 / P95」，没有值显示「—」', () => {
    expect(fmtLatency(1.2, 4.8)).toBe('1.2s / 4.8s')
    expect(fmtLatency(1.4, 5)).toBe('1.4s / 5.0s') // 整数秒也保留 1 位小数，列对齐
    expect(fmtLatency(null, null)).toBe('—')
  })
})

describe('usageFormat · 较上一周期', () => {
  it('上升 ↑、下降 ↓、持平；用量类带 %，比率类带「个百分点」', () => {
    expect(fmtChange(5.2)).toBe('↑ 5.2%')
    expect(fmtChange(-3.1)).toBe('↓ 3.1%')
    expect(fmtChange(-0.2, ' 个百分点')).toBe('↓ 0.2 个百分点')
    expect(fmtChange(0)).toBe('持平')
  })

  it('上一周期没有数据（null）显示「—」', () => {
    expect(fmtChange(null)).toBe('—')
    expect(fmtChange(undefined, ' 个百分点')).toBe('—')
  })
})

describe('usageFormat · 趋势图纵轴上界', () => {
  it('向上取到 1 / 2 / 5 × 10^n，保证刻度好读', () => {
    expect(niceMax(132)).toBe(200)
    expect(niceMax(120)).toBe(200)
    expect(niceMax(97)).toBe(100)
    expect(niceMax(430)).toBe(500)
    expect(niceMax(560)).toBe(1000)
    expect(niceMax(1.7e6)).toBe(2e6)
  })

  it('全是 0（没有数据）时给 1，避免除零', () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(-3)).toBe(1)
  })
})
