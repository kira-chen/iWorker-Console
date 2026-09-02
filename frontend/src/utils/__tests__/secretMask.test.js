import { describe, it, expect } from 'vitest'
import { maskSecret } from '@/utils/secretMask'

describe('maskSecret（全站密钥首尾掩码，模型页 2026-08-22 口径推广）', () => {
  it('长度 > 8：露前 3 后 3，中间星号数=被遮长度', () => {
    expect(maskSecret('sk-abcdef0ab')).toBe('sk-******0ab')
    expect(maskSecret('fin-live-9f27c1d8')).toBe('fin***********1d8')
  })
  it('长度 ≤ 8：露前 2 后 2', () => {
    expect(maskSecret('abcdefgh')).toBe('ab****gh')
    expect(maskSecret('abcde')).toBe('ab*de')
  })
  it('长度 ≤ 4：全遮（露前后会整串暴露）', () => {
    expect(maskSecret('abcd')).toBe('****')
    expect(maskSecret('ab')).toBe('**')
  })
  it('空值/非串兜底', () => {
    expect(maskSecret('')).toBe('')
    expect(maskSecret(null)).toBe('')
    expect(maskSecret(undefined)).toBe('')
  })
})
