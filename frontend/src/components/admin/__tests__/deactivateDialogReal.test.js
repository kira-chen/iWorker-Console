// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import ElementPlus from 'element-plus'

/**
 * DeactivateDialog.vue 真实 Element Plus 冒烟（deactivateDialog.test.js 用桩组件，这里验证真 el-dialog / el-checkbox / el-input
 * 下「勾选强制回收」确实能让弹窗切换样式、出现回收原因输入框，并且确认按钮变成红色【提交强制回收审核】）。
 */
const Dialog = (await import('@/components/admin/DeactivateDialog.vue')).default

let app, host
const onConfirm = vi.fn()
async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  const visible = ref(true)
  app = createApp({
    setup: () => () =>
      h(Dialog, {
        modelValue: visible.value,
        'onUpdate:modelValue': (v) => (visible.value = v),
        onConfirm,
        typeLabel: '技能',
        name: '财税合规助手',
        plainMessage: '停用「财税合规助手」需提交停用审核。审核通过前客户端仍可使用。',
        confirmText: '提交停用审核'
      })
  })
  app.use(ElementPlus)
  app.mount(host)
  for (let i = 0; i < 4; i++) await nextTick()
}
afterEach(() => {
  app?.unmount()
  host?.remove()
  document.body.innerHTML = ''
})

describe('DeactivateDialog · 真实 Element Plus', () => {
  it('默认普通停用；点击勾选框后切成强制回收样式，出现回收原因输入框与红色提交按钮', async () => {
    await mount()
    const text = () => document.body.textContent
    expect(text()).toContain('停用技能')
    expect(text()).toContain('审核通过前客户端仍可使用')
    expect(document.querySelector('textarea')).toBeNull()

    document.querySelector('[data-test="dd-force-check"] input').click()
    for (let i = 0; i < 3; i++) await nextTick()

    expect(text()).toContain('强制回收技能')
    expect(text()).toContain('经审核通过后生效')
    expect(document.querySelector('textarea')).not.toBeNull()
    const confirm = document.querySelector('[data-test="dd-confirm"]')
    expect(confirm.textContent.trim()).toBe('提交强制回收审核')
    expect(confirm.className).toContain('el-button--danger')
  })

  it('不填回收原因直接提交 → 就地提示且不上抛；填了再提交 → 上抛 forceRevoke', async () => {
    onConfirm.mockReset()
    await mount()
    document.querySelector('[data-test="dd-force-check"] input').click()
    for (let i = 0; i < 3; i++) await nextTick()
    document.querySelector('[data-test="dd-confirm"]').click()
    await nextTick()
    expect(document.querySelector('[data-test="dd-error"]').textContent).toBe('请输入回收原因')
    expect(onConfirm).not.toHaveBeenCalled()

    const ta = document.querySelector('textarea')
    ta.value = '存在安全风险'
    ta.dispatchEvent(new Event('input'))
    await nextTick()
    document.querySelector('[data-test="dd-confirm"]').click()
    await nextTick()
    expect(onConfirm).toHaveBeenCalledWith({ forceRevoke: true, reason: '存在安全风险' })
  })
})
