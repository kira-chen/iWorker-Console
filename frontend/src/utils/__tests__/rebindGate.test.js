import { describe, it, expect } from 'vitest'
import { canConfirmRebind } from '@/utils/rebindGate'

// 强确认弹窗「确认按钮点亮」门槛：必须勾选 acknowledged 才点亮，且各阻断态正确置灰。
const ready = {
  loading: false,
  error: false,
  sameAsCurrent: false,
  acknowledged: true,
  submitting: false
}

describe('canConfirmRebind · 强确认勾选门槛', () => {
  it('就绪且已勾选 → 点亮', () => {
    expect(canConfirmRebind(ready)).toBe(true)
  })

  it('未勾选 → 置灰（核心门槛：勾选才点亮）', () => {
    expect(canConfirmRebind({ ...ready, acknowledged: false })).toBe(false)
  })

  it('loading 中 → 置灰', () => {
    expect(canConfirmRebind({ ...ready, loading: true })).toBe(false)
  })

  it('error 态 → 置灰', () => {
    expect(canConfirmRebind({ ...ready, error: true })).toBe(false)
  })

  it('选回当前专家（sameAsCurrent）→ 置灰', () => {
    expect(canConfirmRebind({ ...ready, sameAsCurrent: true })).toBe(false)
  })

  it('提交中 → 置灰（防重复提交）', () => {
    expect(canConfirmRebind({ ...ready, submitting: true })).toBe(false)
  })

  it('acknowledged 非严格 true（如 undefined）不点亮', () => {
    expect(canConfirmRebind({ ...ready, acknowledged: undefined })).toBe(false)
  })
})
