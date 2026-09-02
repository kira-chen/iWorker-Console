import { describe, it, expect, vi } from 'vitest'

// rebind.js 透传 import './request'（其链路含 router→createWebHistory 需 window）。
// 本用例只测纯函数 rebindErrorMessage，mock 掉 request 的 axios 实例即可。
vi.mock('@/api/request', () => ({ default: { get: vi.fn(), post: vi.fn() } }))

const { rebindErrorMessage, unbindErrorMessage } = await import('@/api/rebind')

// rebindErrorMessage 是纯函数：验证错误码 → 友好中文映射（不暴露技术细节）。
// 契约 §5 + PRD §6.2/§8.6。

describe('rebindErrorMessage · 错误码中文映射', () => {
  it('404：该专家已不可用，请重新选择', () => {
    expect(rebindErrorMessage({ code: 404 })).toBe('该专家已不可用，请重新选择。')
  })

  it('1000：操作过于频繁，请重试', () => {
    expect(rebindErrorMessage({ code: 1000 })).toBe('操作过于频繁，请重试。')
  })

  it('400：参数有误引导重选', () => {
    expect(rebindErrorMessage({ code: 400 })).toContain('参数有误')
  })

  it('401：交给拦截器统一登出，返回空让上层忽略', () => {
    expect(rebindErrorMessage({ code: 401 })).toBe('')
  })

  it('网络/超时（无 code）→ PRD §6.2 兜底「更换未完成，当前专家与个性化保持不变」', () => {
    expect(rebindErrorMessage({})).toContain('更换未完成')
    expect(rebindErrorMessage({ code: -1 })).toContain('更换未完成')
    expect(rebindErrorMessage(undefined)).toContain('更换未完成')
  })

  it('5000 及未知 code → 通用兜底，不暴露技术细节', () => {
    const msg = rebindErrorMessage({ code: 5000 })
    expect(msg).toContain('更换未完成')
    // 不应包含 code / 堆栈 / 表名等技术信息
    expect(msg).not.toMatch(/5000|error|exception/i)
  })
})

describe('unbindErrorMessage · 解绑错误码中文映射', () => {
  it('401：交给拦截器统一登出，返回空让上层忽略', () => {
    expect(unbindErrorMessage({ code: 401 })).toBe('')
  })

  it('5000：通用兜底「解绑未完成，当前专家与个性化保持不变」', () => {
    const msg = unbindErrorMessage({ code: 5000 })
    expect(msg).toContain('解绑未完成')
    expect(msg).not.toMatch(/5000|error|exception/i)
  })

  it('网络/超时（无 code）→ 兜底文案，不暴露技术细节', () => {
    expect(unbindErrorMessage({})).toContain('解绑未完成')
    expect(unbindErrorMessage(undefined)).toContain('解绑未完成')
    expect(unbindErrorMessage({ code: -1 })).toContain('解绑未完成')
  })
})
