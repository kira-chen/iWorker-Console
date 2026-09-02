import { describe, it, expect } from 'vitest'
import {
  estimateTokens,
  formatTokenEstimate,
  routeDescHint,
  routeTriggersHint,
  ROUTE_DESC_SOFT_CHARS,
  ROUTE_TRIGGERS_VISIBLE
} from '@/utils/tokenEstimate'

describe('estimateTokens（数量级粗估）', () => {
  it('空 → 0', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens(null)).toBe(0)
  })

  it('纯中文 ≈ 字数', () => {
    expect(estimateTokens('你好世界')).toBe(4) // 4 CJK
    expect(estimateTokens('技能')).toBe(2)
  })

  it('纯英文按 ~4 字符/token', () => {
    // 'hello world' = 11 字符 → ceil(11/4)=3
    expect(estimateTokens('hello world')).toBe(3)
  })

  it('中英混合 = CJK 字数 + 非 CJK/4', () => {
    // '技能ABCD' = 2 CJK + 4 other → 2 + ceil(4/4)=1 → 3
    expect(estimateTokens('技能ABCD')).toBe(3)
  })

  it('emoji / surrogate 不劈裂（按码点计 1 个非 CJK 字符）', () => {
    expect(estimateTokens('🔧')).toBe(1) // 1 码点 → ceil(1/4)=1
  })

  it('长中文文档量级合理（8000 字 ≈ 8000 token 级）', () => {
    const big = '事'.repeat(8000)
    expect(estimateTokens(big)).toBe(8000)
  })
})

describe('formatTokenEstimate', () => {
  it('千以下显示整数', () => {
    expect(formatTokenEstimate(800)).toBe('约 800 tokens')
  })
  it('千以上显示 k', () => {
    expect(formatTokenEstimate(1234)).toBe('约 1.2k tokens')
    expect(formatTokenEstimate(8000)).toBe('约 8.0k tokens')
  })
})

describe('routeDescHint / routeTriggersHint（路由体量第二量纲）', () => {
  it('description 不超阈值 → 空', () => {
    expect(routeDescHint('短描述')).toBe('')
    expect(routeDescHint('x'.repeat(ROUTE_DESC_SOFT_CHARS))).toBe('')
  })
  it('description 超阈值 → 提示截断', () => {
    const hint = routeDescHint('x'.repeat(ROUTE_DESC_SOFT_CHARS + 1))
    expect(hint).toMatch(new RegExp(`${ROUTE_DESC_SOFT_CHARS}`))
    expect(hint).toMatch(/前/)
  })
  it('triggers 不超阈值 → 空', () => {
    expect(routeTriggersHint(['a', 'b'])).toBe('')
    expect(routeTriggersHint(Array(ROUTE_TRIGGERS_VISIBLE).fill('t'))).toBe('')
  })
  it('triggers 超阈值 → 提示靠后看不到', () => {
    const hint = routeTriggersHint(Array(ROUTE_TRIGGERS_VISIBLE + 1).fill('t'))
    expect(hint).toMatch(new RegExp(`${ROUTE_TRIGGERS_VISIBLE}`))
  })
})
