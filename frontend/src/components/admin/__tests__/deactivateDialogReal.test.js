// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import ElementPlus from 'element-plus'

/**
 * DeactivateDialog.vue 真实 Element Plus 冒烟（deactivateDialog.test.js 用桩组件，这里验证真 el-dialog / el-checkbox / el-input
 * 下「勾选强制回收」确实能让弹窗切换样式、出现回收原因输入框，并且确认按钮变成红色【提交强制回收审核】）。
 *
 * 覆盖范围划分：本文件只验“真组件下才可能出问题”的路径——勾选切换样式、必填校验、取消勾选后清空再勾选、
 * 被引用拦截（blockedMessage）下勾选放行。其余路径仍只在桩用例 deactivateDialog.test.js 验证：
 * 超 500 字提示、纯空白原因、原因 trim、无引用时不出“已被引用”句、重开弹窗回默认态、聚焦输入框、submitting 转圈等。
 */
const Dialog = (await import('@/components/admin/DeactivateDialog.vue')).default

let app, host
const onConfirm = vi.fn()
async function mount(extraProps = {}) {
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
        confirmText: '提交停用审核',
        ...extraProps
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

  it('勾选 → 填原因 → 取消勾选 → 再勾选：回收原因框为空；不填再提交仍提示必填且不上抛（取消勾选清空已填内容）', async () => {
    onConfirm.mockReset()
    await mount()
    const check = () => document.querySelector('[data-test="dd-force-check"] input')
    check().click()
    for (let i = 0; i < 3; i++) await nextTick()
    const ta = document.querySelector('textarea')
    ta.value = '存在安全风险'
    ta.dispatchEvent(new Event('input'))
    await nextTick()

    check().click() // 取消勾选 → 恢复普通停用，原因清空
    for (let i = 0; i < 3; i++) await nextTick()
    expect(document.querySelector('textarea')).toBeNull()
    expect(document.body.textContent).toContain('停用技能')

    check().click() // 再次勾选
    for (let i = 0; i < 3; i++) await nextTick()
    expect(document.querySelector('textarea').value).toBe('')
    document.querySelector('[data-test="dd-confirm"]').click()
    await nextTick()
    expect(document.querySelector('[data-test="dd-error"]').textContent).toBe('请输入回收原因')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('被引用拦截（blockedMessage）：未勾选时展示拦截文案、确认按钮禁用；勾选强制回收后按钮可点，填原因提交上抛 forceRevoke', async () => {
    onConfirm.mockReset()
    await mount({ blockedMessage: '该技能被 2 个岗位引用，无法停用' })
    const confirm = () => document.querySelector('[data-test="dd-confirm"]')
    expect(document.querySelector('[data-test="dd-blocked"]').textContent).toBe('该技能被 2 个岗位引用，无法停用')
    expect(confirm().disabled).toBe(true)

    document.querySelector('[data-test="dd-force-check"] input').click()
    for (let i = 0; i < 3; i++) await nextTick()
    expect(document.querySelector('[data-test="dd-blocked"]')).toBeNull()
    expect(confirm().disabled).toBe(false)
    const ta = document.querySelector('textarea')
    ta.value = '合规要求下线'
    ta.dispatchEvent(new Event('input'))
    await nextTick()
    confirm().click()
    await nextTick()
    expect(onConfirm).toHaveBeenCalledWith({ forceRevoke: true, reason: '合规要求下线' })
  })
})
