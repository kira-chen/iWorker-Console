import { describe, it, expect } from 'vitest'
import {
  explainVerifyError,
  verifyPhaseOf,
  verifyPhaseText,
  verifyHealthStatus,
  PHASE_ONE_MS
} from '@/utils/modelVerify'

/**
 * utils/modelVerify 单测（交互设计-模型连通性验证 §5 / §2.3）。
 *
 * 重点守两条口径：
 *  1. 后端错误原文里的**技术分类前缀不得外泄**到用户可见文案；
 *  2. 未知分类不得渲染成空白或裸原文——必须有可读兜底。
 */

describe('explainVerifyError · 七类错误映射', () => {
  it('识别分类前缀并给出中文名 + 人话 + 怎么办', () => {
    const r = explainVerifyError('AUTH_FAILED: 鉴权失败（HTTP 401），请检查密钥')
    expect(r.label).toBe('鉴权失败')
    expect(r.brief).toContain('密钥被上游拒绝')
    expect(r.advice).toContain('API Key')
    // 原文保留供排障折叠区展示
    expect(r.raw).toContain('AUTH_FAILED')
  })

  it('展示用字段一律不含技术前缀（核心口径）', () => {
    const cases = [
      'CONFIG_INCOMPLETE: 凭据未配置完整（缺 api_key）',
      'AUTH_FAILED: 鉴权失败（HTTP 401）',
      'NOT_FOUND: 路径或模型不存在（HTTP 404）',
      'TIMEOUT: connect timeout',
      'UNREACHABLE: 目标地址不被允许',
      'UPSTREAM_ERROR: 上游限流（HTTP 429）',
      'PROTOCOL_ERROR: 响应非 OpenAI 协议格式'
    ]
    for (const raw of cases) {
      const r = explainVerifyError(raw)
      const shown = `${r.label}${r.brief}${r.advice}`
      expect(shown).not.toMatch(/[A-Z]{4,}_[A-Z]+/)
      expect(r.label.length).toBeGreaterThan(0)
    }
  })

  it('七类各自映射到不同的中文分类名', () => {
    const labels = [
      'CONFIG_INCOMPLETE: x',
      'AUTH_FAILED: x',
      'NOT_FOUND: x',
      'TIMEOUT: x',
      'UNREACHABLE: x',
      'UPSTREAM_ERROR: x',
      'PROTOCOL_ERROR: x'
    ].map((s) => explainVerifyError(s).label)
    expect(new Set(labels).size).toBe(7)
  })

  it('未知分类：用原文首句兜底，不返回空白', () => {
    const r = explainVerifyError('SOMETHING_NEW: 出了点没见过的问题。后面还有很多字')
    expect(r.label).toBe('验证失败')
    expect(r.brief).toBe('出了点没见过的问题')   // 按句读截断，不把整段塞进标签位
    expect(r.advice).toContain('原始错误')
  })

  it('无前缀的裸文本也能兜底', () => {
    const r = explainVerifyError('就是一句没有前缀的错误')
    expect(r.label).toBe('验证失败')
    expect(r.brief).toBe('就是一句没有前缀的错误')
  })

  it('空值返回 null（调用方据此不渲染错误块）', () => {
    expect(explainVerifyError(null)).toBeNull()
    expect(explainVerifyError('')).toBeNull()
    expect(explainVerifyError('   ')).toBeNull()
    expect(explainVerifyError(undefined)).toBeNull()
  })
})

describe('verifyPhaseOf · 阶段推断', () => {
  it('20 秒前为阶段一，之后为阶段二', () => {
    expect(verifyPhaseOf(0)).toBe(1)
    expect(verifyPhaseOf(PHASE_ONE_MS - 1)).toBe(1)
    expect(verifyPhaseOf(PHASE_ONE_MS)).toBe(2)
    expect(verifyPhaseOf(PHASE_ONE_MS + 15000)).toBe(2)
  })

  it('阶段文案与阶段对应', () => {
    expect(verifyPhaseText(1)).toContain('连接')
    expect(verifyPhaseText(2)).toContain('能力')
  })
})

describe('verifyHealthStatus · 复用 HealthTag 四态', () => {
  it('成功/失败/未验证分别映射', () => {
    expect(verifyHealthStatus('SUCCESS')).toBe('HEALTHY')
    expect(verifyHealthStatus('FAILED')).toBe('UNHEALTHY')
    expect(verifyHealthStatus('UNVERIFIED')).toBe('UNKNOWN')
    expect(verifyHealthStatus(null)).toBe('UNKNOWN')
  })
})
