import { describe, it, expect } from 'vitest'
import { connTypeLabel, credStateLabel, credStateTagType, credActionLabel, isHosted } from '@/utils/bizSystemMeta'

/**
 * utils/bizSystemMeta.js 单测：连接方式文案 + 员工端登录态三态文案 / 标签色 / 主操作。
 * 2026-09-12 测试审计：原本文件里 19 条 validateBizSystemForm 用例测的是 utils/defValidate，已搬入 defValidate.test.js（T36）；
 * 「CRED_STATE 常量等于自身」同义反复已删（T8）。
 */

describe('connTypeLabel', () => {
  it('已知映射', () => {
    expect(connTypeLabel('login_session')).toBe('登录态托管')
  })
  it('未知 / 空 回退', () => {
    expect(connTypeLabel('foo')).toBe('foo')
    expect(connTypeLabel('')).toBe('登录态托管')
    expect(connTypeLabel(null)).toBe('登录态托管')
  })
})

describe('登录态三态文案 / 颜色 / 操作', () => {
  it('文案', () => {
    expect(credStateLabel('VALID')).toBe('已连接')
    expect(credStateLabel('EXPIRED')).toBe('已过期，请重新登录')
    expect(credStateLabel('NOT_HOSTED')).toBe('未连接')
    expect(credStateLabel('什么鬼')).toBe('未连接')
  })
  it('标签色', () => {
    expect(credStateTagType('VALID')).toBe('success')
    expect(credStateTagType('EXPIRED')).toBe('warning')
    expect(credStateTagType('NOT_HOSTED')).toBe('info')
  })
  it('主操作文案', () => {
    expect(credActionLabel('NOT_HOSTED')).toBe('连接')
    expect(credActionLabel('EXPIRED')).toBe('重新登录')
    expect(credActionLabel('VALID')).toBe('重新登录')
  })
  it('isHosted：仅 VALID/EXPIRED', () => {
    expect(isHosted('VALID')).toBe(true)
    expect(isHosted('EXPIRED')).toBe(true)
    expect(isHosted('NOT_HOSTED')).toBe(false)
  })
})
