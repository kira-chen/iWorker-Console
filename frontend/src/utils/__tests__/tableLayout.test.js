import { describe, it, expect } from 'vitest'
import { opsWidth } from '../tableLayout'

/**
 * utils/tableLayout.js · opsWidth 操作列宽度分挡 —— 2026-10-08 对齐 tableLayout.js 头注「操作列：按钮数分挡定宽」
 * 与 OPS_W 挡位注释（/test-audit 共享层补缺口）。
 *
 * 覆盖点：按钮数 → 挡位宽度的夹取规则。挡位只有 2/3/4/5 四挡：不足 2 个按钮按 2 挡、超过 5 个按 5 挡、
 * 传非数字按 2 挡兜底。期望值写字面量（124/176/244/280），不回读 OPS_W——挡位被误改时这里要能红。
 */
describe('opsWidth 操作列宽度分挡', () => {
  it('0 个按钮 → 按最小挡 124px（不会返回 undefined 让列宽失效）', () => {
    expect(opsWidth(0)).toBe(124)
  })

  it('1 个按钮 → 与 2 个同挡 124px', () => {
    expect(opsWidth(1)).toBe(124)
  })

  it('2 个按钮 → 124px', () => {
    expect(opsWidth(2)).toBe(124)
  })

  it('3 个按钮 → 176px', () => {
    expect(opsWidth(3)).toBe(176)
  })

  it('4 个按钮 → 244px（技能页「查看/编辑/停用/版本管理」整组放得下）', () => {
    expect(opsWidth(4)).toBe(244)
  })

  it('5 个按钮 → 最大挡 280px', () => {
    expect(opsWidth(5)).toBe(280)
  })

  it('6 个按钮 → 封顶在最大挡 280px', () => {
    expect(opsWidth(6)).toBe(280)
  })

  it('传非数字（如 "abc" / undefined）→ 兜底按 2 挡 124px', () => {
    expect(opsWidth('abc')).toBe(124)
    expect(opsWidth(undefined)).toBe(124)
  })

  it('传数字字符串 "3" → 按 3 挡 176px', () => {
    expect(opsWidth('3')).toBe(176)
  })
})
