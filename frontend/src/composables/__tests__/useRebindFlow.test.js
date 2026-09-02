import { describe, it, expect, beforeEach, vi } from 'vitest'

// useRebindFlow：验证 start(拦截/拉preview) → confirm(rebind+成功提示) → 错误自处理。
// 切断真实 store 与 element-plus。

const elSuccess = vi.fn()
const elError = vi.fn()
const elInfo = vi.fn()
const elWarning = vi.fn()
vi.mock('element-plus', () => ({
  ElMessage: { success: elSuccess, error: elError, info: elInfo, warning: elWarning }
}))

// 组合式函数 import 真实 @/api/rebind（用其 rebindErrorMessage），其链路含
// request→router→createWebHistory 需 window：mock request 的 axios 实例切断。
vi.mock('@/api/request', () => ({ default: { get: vi.fn(), post: vi.fn() } }))

const previewRebind = vi.fn()
const rebind = vi.fn()
const positionStore = { previewRebind, rebind }
vi.mock('@/stores/userPosition', () => ({ useUserPositionStore: () => positionStore }))

// userStore.userInfo 可变，供「选回当前 / 无绑定」分支用
const userStore = { userInfo: { boundPositionId: 1 } }
vi.mock('@/stores/user', () => ({ useUserStore: () => userStore }))

const { useRebindFlow } = await import('@/composables/useRebindFlow')

describe('useRebindFlow', () => {
  beforeEach(() => {
    previewRebind.mockReset()
    rebind.mockReset()
    elSuccess.mockClear()
    elError.mockClear()
    elInfo.mockClear()
    elWarning.mockClear()
    userStore.userInfo = { boundPositionId: 1 }
  })

  it('start：选回当前专家 → 本地拦截，不弹强确认、不调 preview', async () => {
    const flow = useRebindFlow()
    await flow.start(1) // 1 即当前绑定
    expect(previewRebind).not.toHaveBeenCalled()
    expect(flow.visible.value).toBe(false)
    expect(elInfo).toHaveBeenCalledOnce()
  })

  it('start：无当前绑定 → 拦截提示，不进换绑流程', async () => {
    userStore.userInfo = {}
    const flow = useRebindFlow()
    await flow.start(2)
    expect(previewRebind).not.toHaveBeenCalled()
    expect(flow.visible.value).toBe(false)
    expect(elWarning).toHaveBeenCalledOnce()
  })

  it('start：选非当前专家 → 开弹窗并拉 preview', async () => {
    previewRebind.mockResolvedValue({ targetExpert: { name: '小图' }, willClear: {} })
    const flow = useRebindFlow()
    await flow.start(2)
    expect(previewRebind).toHaveBeenCalledWith(2)
    expect(flow.visible.value).toBe(true)
    expect(flow.preview.value.targetExpert.name).toBe('小图')
    expect(flow.error.value).toBe(false)
  })

  it('start：preview 拉取失败 → error 态，弹窗仍开（供重试）', async () => {
    previewRebind.mockRejectedValue(new Error('boom'))
    const flow = useRebindFlow()
    await flow.start(2)
    expect(flow.error.value).toBe(true)
    expect(flow.preview.value).toBeNull()
    expect(flow.visible.value).toBe(true)
  })

  it('confirm：成功 → 调 rebind、关弹窗、成功提示、回调 onSuccess', async () => {
    previewRebind.mockResolvedValue({ targetExpert: { name: '小图' }, willClear: {} })
    rebind.mockResolvedValue({ changed: true, newPositionId: 2 })
    const onSuccess = vi.fn()
    const flow = useRebindFlow({ onSuccess })
    await flow.start(2)
    await flow.confirm()
    // 透传 preview.targetExpert 给 store 兜底新岗位展示信息（CR 严重 1）
    expect(rebind).toHaveBeenCalledWith(2, { name: '小图' })
    expect(flow.visible.value).toBe(false)
    expect(elSuccess).toHaveBeenCalledOnce()
    expect(onSuccess).toHaveBeenCalledWith({ changed: true, newPositionId: 2 })
    expect(flow.submitting.value).toBe(false)
  })

  it('confirm：404 → 友好提示「该专家已不可用」并关闭流程', async () => {
    previewRebind.mockResolvedValue({ targetExpert: { name: '小图' }, willClear: {} })
    rebind.mockRejectedValue({ code: 404 })
    const flow = useRebindFlow()
    await flow.start(2)
    await flow.confirm()
    expect(elError).toHaveBeenCalledWith('该专家已不可用，请重新选择。')
    expect(flow.visible.value).toBe(false)
    expect(flow.submitting.value).toBe(false)
  })

  it('confirm：网络失败 → PRD §6.2 兜底文案，弹窗不关（可重试）', async () => {
    previewRebind.mockResolvedValue({ targetExpert: { name: '小图' }, willClear: {} })
    rebind.mockRejectedValue({}) // 无 code
    const flow = useRebindFlow()
    await flow.start(2)
    await flow.confirm()
    expect(elError).toHaveBeenCalledWith(
      expect.stringContaining('更换未完成')
    )
    // 非 404：保留弹窗供重试
    expect(flow.visible.value).toBe(true)
  })

  it('confirm：提交中再次 confirm 直接返回（防重复提交）', async () => {
    previewRebind.mockResolvedValue({ targetExpert: { name: '小图' }, willClear: {} })
    let resolveRebind
    rebind.mockReturnValue(new Promise((r) => { resolveRebind = r }))
    const flow = useRebindFlow()
    await flow.start(2)
    flow.confirm() // 不 await，submitting=true
    await flow.confirm() // 应被 submitting 拦截
    expect(rebind).toHaveBeenCalledTimes(1)
    resolveRebind({ changed: true, newPositionId: 2 })
  })

  it('isCurrentBound：与登录态 boundPositionId 比较（数字/字符串兼容）', () => {
    const flow = useRebindFlow()
    expect(flow.isCurrentBound(1)).toBe(true)
    expect(flow.isCurrentBound('1')).toBe(true)
    expect(flow.isCurrentBound(2)).toBe(false)
  })
})
