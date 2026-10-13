import { describe, it, expect } from 'vitest'

/**
 * utils/forceRevoke.js 单测。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/ 下各模块「强制回收（停用时勾选）」小节：
 * - 回收原因必填、≤500 字（空 / 纯空白提示「请输入回收原因」，超长提示「回收原因最多 500 字」）；
 * - 回收信息（审核通过时落到对象 revoked 字段）与「已回收」悬停文案。
 * 弹窗交互见 components/admin/__tests__/deactivateDialog.test.js。
 */
const { validateRevokeReason, makeRevokedInfo, revokedTip, FORCE_REVOKE_REASON_MAX } = await import('@/utils/forceRevoke')
const { currentDemoUsername } = await import('@/utils/demoIdentity')

describe('validateRevokeReason · 回收原因校验', () => {
  it('空 / 纯空白 / undefined → 「请输入回收原因」', () => {
    expect(validateRevokeReason('')).toBe('请输入回收原因')
    expect(validateRevokeReason('   ')).toBe('请输入回收原因')
    expect(validateRevokeReason(undefined)).toBe('请输入回收原因')
  })

  it('501 字 → 「回收原因最多 500 字」；500 字与正常文本通过（返回空串）', () => {
    expect(FORCE_REVOKE_REASON_MAX).toBe(500)
    expect(validateRevokeReason('x'.repeat(501))).toBe('回收原因最多 500 字')
    expect(validateRevokeReason('x'.repeat(500))).toBe('')
    expect(validateRevokeReason('安全风险')).toBe('')
  })

  it('首尾空白不计入字数：500 字 + 前后空格仍通过', () => {
    expect(validateRevokeReason(`  ${'x'.repeat(500)}  `)).toBe('')
  })
})

describe('makeRevokedInfo / revokedTip', () => {
  it('回收信息 = 原因 + 当前时间（精确到分钟）+ 当前演示用户名', () => {
    const info = makeRevokedInfo('接口下线')
    expect(info).toEqual({ reason: '接口下线', at: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/), operator: currentDemoUsername() })
  })

  it('可显式指定操作人（审核通过时记提交申请的管理员，不是审核人）', () => {
    expect(makeRevokedInfo('接口下线', 'li.na').operator).toBe('li.na')
  })

  it('悬停文案：「回收原因：{原因}（{操作人} · {时间}）」；操作人缺失兜底「管理员」；无回收信息返回空串', () => {
    expect(revokedTip({ reason: '异常', at: '2026-10-09 10:00', operator: 'xiaomei' })).toBe('回收原因：异常（xiaomei · 2026-10-09 10:00）')
    expect(revokedTip({ reason: '异常', at: '2026-10-09 10:00' })).toBe('回收原因：异常（管理员 · 2026-10-09 10:00）')
    expect(revokedTip(null)).toBe('')
  })
})
