import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ElMessageBox } from 'element-plus'
import { confirmDialog, alertDialog, useConfirm } from '@/composables/useConfirm'

/**
 * useConfirm（管理后台确认弹窗统一封装）契约——2026-09-12 审计 T57 新建（此前零单测）。
 *
 * 出处：docs/PRD-review/2026-09-08.md 负责人拍板「新增 useConfirm（440 无图标，danger 保留红档）接岗位列表/岗位管理」；
 * 各页面单测 mock 的是 ElMessageBox.confirm/alert 本身，这里补的是封装层自己的三件事：
 *  1. danger / warning 落到确认键 class（删除红档、停用橙档），公共项 customClass=admin-confirm、无 ×；
 *  2. alertDialog 默认确认文案「知道了」（领用护栏等单键提示；岗位 md「知道了」逐字）；
 *  3. 用户取消（ElMessageBox reject）→ resolve false，不向调用方抛错；确认 → true。
 */

vi.mock('element-plus', () => ({
  ElMessageBox: { confirm: vi.fn(), alert: vi.fn() }
}))

beforeEach(() => {
  vi.clearAllMocks()
  ElMessageBox.confirm.mockResolvedValue('confirm')
  ElMessageBox.alert.mockResolvedValue('confirm')
})

describe('useConfirm · 统一确认弹窗封装', () => {
  it('danger → 确认键 el-button--danger；warning → el-button--warning；默认无档；公共项 admin-confirm / 无 × / 取消·确定', async () => {
    expect(await confirmDialog('删除后不可用，确认删除？', '删除岗位', { confirmText: '删除', danger: true })).toBe(true)
    let [msg, title, opts] = ElMessageBox.confirm.mock.calls[0]
    expect(msg).toBe('删除后不可用，确认删除？')
    expect(title).toBe('删除岗位')
    expect(opts).toMatchObject({
      customClass: 'admin-confirm',
      showClose: false,
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })

    await confirmDialog('确认停用？', '停用', { warning: true })
    ;[, , opts] = ElMessageBox.confirm.mock.calls[1]
    expect(opts.confirmButtonClass).toBe('el-button--warning')
    expect(opts.confirmButtonText).toBe('确定')

    await confirmDialog('普通确认', '提示', { extra: { distinguishCancelAndClose: true } })
    ;[, , opts] = ElMessageBox.confirm.mock.calls[2]
    expect(opts.confirmButtonClass, '不传 danger/warning 不加档').toBeUndefined()
    expect(opts.distinguishCancelAndClose, 'extra 透传').toBe(true)
  })

  it('alertDialog 默认确认文案「知道了」、可覆盖；resolve 后不抛', async () => {
    await alertDialog('该岗位已被 3 个用户领用，需先解除领用后再删除', '删除岗位')
    let [msg, title, opts] = ElMessageBox.alert.mock.calls[0]
    expect(msg).toBe('该岗位已被 3 个用户领用，需先解除领用后再删除')
    expect(title).toBe('删除岗位')
    expect(opts.confirmButtonText).toBe('知道了')
    expect(opts.customClass).toBe('admin-confirm')

    await alertDialog('x', 'y', { confirmText: '好的' })
    ;[, , opts] = ElMessageBox.alert.mock.calls[1]
    expect(opts.confirmButtonText).toBe('好的')

    ElMessageBox.alert.mockRejectedValueOnce('close')
    await expect(alertDialog('x', 'y')).resolves.toBeUndefined()
  })

  it('用户取消 / 关闭（ElMessageBox reject）→ confirmDialog resolve false，不抛；useConfirm() 返回同两方法', async () => {
    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    expect(await confirmDialog('确认？', '提示')).toBe(false)

    const c = useConfirm()
    expect(c.confirmDialog).toBe(confirmDialog)
    expect(c.alertDialog).toBe(alertDialog)
    ElMessageBox.confirm.mockRejectedValueOnce('close')
    expect(await c.confirmDialog('确认？', '提示')).toBe(false)
    expect(await c.confirmDialog('确认？', '提示')).toBe(true)
  })
})
