// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { createApp } from 'vue'
import { ElDialog, ElDrawer, ElMessageBox } from 'element-plus'
import { disableDialogEsc } from '@/utils/disableDialogEsc'

// 拦截 MessageBox 真实弹出：在 disableDialogEsc 包装前替换底层实现，
// 断言包装层注入的最终 options（wrapper 会以 original 身份调用这些 mock）。
const spies = {
  alert: vi.fn(() => Promise.resolve()),
  confirm: vi.fn(() => Promise.resolve()),
  prompt: vi.fn(() => Promise.resolve()),
}
for (const k of Object.keys(spies)) ElMessageBox[k] = spies[k]
disableDialogEsc()

describe('disableDialogEsc · 全局弹窗不响应 Esc（输入法候选态 Esc 误关防护）', () => {
  it('ElDialog / ElDrawer 的 closeOnPressEscape 默认值改为 false', () => {
    expect(ElDialog.props.closeOnPressEscape.default).toBe(false)
    expect(ElDrawer.props.closeOnPressEscape.default).toBe(false)
  })

  it('挂载 el-dialog 时 Vue 实际解析到的 prop 为 false', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const app = createApp(ElDialog, { modelValue: false })
    const vm = app.mount(container)
    expect(vm.$props.closeOnPressEscape).toBe(false)
    app.unmount()
    container.remove()
  })

  it('ElMessageBox.confirm(message, title, options) → 注入 closeOnPressEscape: false', async () => {
    await ElMessageBox.confirm('确认删除？', '提示', { type: 'warning' })
    const [, , options] = spies.confirm.mock.calls.at(-1)
    expect(options).toMatchObject({ closeOnPressEscape: false, type: 'warning' })
  })

  it('ElMessageBox.prompt(message, options) 对象作第二参 → 同样注入', async () => {
    await ElMessageBox.prompt('输入名称', { inputValue: 'x' })
    const [, title] = spies.prompt.mock.calls.at(-1)
    expect(title).toMatchObject({ closeOnPressEscape: false, inputValue: 'x' })
  })

  it('调用方显式传 closeOnPressEscape 时以调用方为准', async () => {
    await ElMessageBox.alert('已完成', '提示', { closeOnPressEscape: true })
    const [, , options] = spies.alert.mock.calls.at(-1)
    expect(options.closeOnPressEscape).toBe(true)
  })

  it('重复调用幂等：不会二次包装 MessageBox', () => {
    const before = ElMessageBox.confirm
    disableDialogEsc()
    expect(ElMessageBox.confirm).toBe(before)
  })
})
