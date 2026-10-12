// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * DeactivateDialog.vue（停用确认弹窗，「强制回收」并入停用的勾选项）单测。
 * 对齐 PRD 各模块「强制回收（停用时勾选）」：
 * - 默认是普通停用：标题「停用{类型}」、各页自己的提示正文、确认按钮文案由调用方给（【继续停用】/【提交停用审核】）；
 * - 勾选「强制回收」→ 标题「强制回收{类型}」、影响范围、红色警示、必填回收原因（≤500 字）、红色【提交强制回收审核】；
 * - 取消勾选恢复普通样式并清空已填原因；强制回收与普通停用同走审核，**无二次确认**（确认即上抛 confirm）；
 * - 技能被引用时普通停用被拦截（blockedMessage）：未勾选禁用确认，勾选强制回收后放行；
 * - 回收原因为空 / 超长就地提示、聚焦输入框、不上抛；重开弹窗回到默认的普通停用。
 */
const Dialog = (await import('@/components/admin/DeactivateDialog.vue')).default

const elDialog = {
  props: ['modelValue', 'title', 'width'],
  emits: ['update:modelValue'],
  template: '<div class="el-dialog" v-if="modelValue" :data-title="title"><slot /><div class="dlg-footer"><slot name="footer" /></div></div>'
}
const focus = vi.fn()
const elInput = {
  props: ['modelValue', 'placeholder', 'maxlength', 'type', 'rows', 'showWordLimit'],
  emits: ['update:modelValue', 'input'],
  methods: { focus },
  template:
    '<textarea class="el-input" :placeholder="placeholder" :maxlength="maxlength" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value); $emit(\'input\', $event.target.value)" />'
}
const elCheckbox = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<label class="el-checkbox"><input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" /><slot /></label>'
}
const elButton = {
  props: { disabled: Boolean, loading: Boolean, type: String },
  emits: ['click'],
  template: '<button class="el-button" :data-type="type" :disabled="disabled" :data-loading="loading" @click="$emit(\'click\')"><slot /></button>'
}

let app, container
const onConfirm = vi.fn()
const visible = ref(true)
async function mount(extra = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    setup() {
      return () =>
        h(Dialog, {
          modelValue: visible.value,
          'onUpdate:modelValue': (v) => (visible.value = v),
          onConfirm,
          typeLabel: 'MCP 服务',
          name: '报销 MCP',
          plainMessage: '停用后技能仍可执行，但运行效果可能受限或出现报错。',
          ...extra
        })
    }
  })
  app.component('el-dialog', elDialog)
  app.component('el-input', elInput)
  app.component('el-checkbox', elCheckbox)
  app.component('el-button', elButton)
  app.mount(container)
  await nextTick()
  await nextTick()
}
const title = () => container.querySelector('.el-dialog').dataset.title
const confirmBtn = () => container.querySelector('[data-test="dd-confirm"]')
const textarea = () => container.querySelector('.el-input')
const check = async (on) => {
  const box = container.querySelector('[data-test="dd-force-check"] input')
  box.checked = on
  box.dispatchEvent(new Event('change'))
  await nextTick()
}
const typeReason = async (v) => {
  textarea().value = v
  textarea().dispatchEvent(new Event('input'))
  await nextTick()
}

beforeEach(() => {
  visible.value = true
  onConfirm.mockReset()
  focus.mockReset()
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('DeactivateDialog · 默认是普通停用', () => {
  it('标题「停用{类型}」、展示各页给的提示正文、确认按钮用调用方文案、未勾选强制回收、不出现回收原因输入框', async () => {
    await mount({ confirmText: '继续停用' })
    expect(title()).toBe('停用MCP 服务')
    expect(container.querySelector('[data-test="dd-plain"]').textContent).toContain('停用后技能仍可执行')
    expect(confirmBtn().textContent.trim()).toBe('继续停用')
    expect(confirmBtn().dataset.type).toBe('primary')
    expect(container.querySelector('[data-test="dd-force-check"] input').checked).toBe(false)
    expect(textarea()).toBeNull()
  })

  it('点确认 → 上抛 { forceRevoke: false, reason: "" }（普通停用，不带回收原因）', async () => {
    await mount()
    confirmBtn().click()
    await nextTick()
    expect(onConfirm).toHaveBeenCalledWith({ forceRevoke: false, reason: '' })
  })
})

describe('DeactivateDialog · 勾选「强制回收」', () => {
  it('弹窗换危险样式：标题「强制回收{类型}」、红色警示写明“审核通过后生效、不可撤销、审核通过前仍可用”、必填回收原因（占位 + 500 字上限）、红色【提交强制回收审核】', async () => {
    await mount({ refCount: 3, refText: '岗位 / 技能' })
    await check(true)
    expect(title()).toBe('强制回收MCP 服务')
    expect(container.querySelector('[data-test="dd-plain"]')).toBeNull()
    const text = container.querySelector('.el-dialog').textContent
    expect(text).toContain('已被 3 个岗位 / 技能引用')
    const danger = container.querySelector('[data-test="dd-danger"]').textContent
    expect(danger).toContain('经审核通过后生效')
    expect(danger).toContain('不可撤销')
    expect(danger).toContain('审核通过前仍可正常使用')
    expect(textarea().placeholder).toBe('请输入回收原因，将展示给受影响的员工')
    expect(textarea().getAttribute('maxlength')).toBe('500')
    expect(confirmBtn().textContent.trim()).toBe('提交强制回收审核')
    expect(confirmBtn().dataset.type).toBe('danger')
  })

  it('无引用时不出“已被 N 个…引用”这句', async () => {
    await mount({ refCount: 0 })
    await check(true)
    expect(container.querySelector('.el-dialog').textContent).not.toContain('引用关系保留')
  })

  it('回收原因为空 / 纯空白 → 就地提示「请输入回收原因」、聚焦输入框、不上抛', async () => {
    await mount()
    await check(true)
    confirmBtn().click()
    await nextTick()
    expect(container.querySelector('[data-test="dd-error"]').textContent).toBe('请输入回收原因')
    expect(focus).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    await typeReason('   ')
    confirmBtn().click()
    await nextTick()
    expect(container.querySelector('[data-test="dd-error"]').textContent).toBe('请输入回收原因')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('回收原因超过 500 字 → 提示「回收原因最多 500 字」、不上抛', async () => {
    await mount()
    await check(true)
    await typeReason('x'.repeat(501))
    confirmBtn().click()
    await nextTick()
    expect(container.querySelector('[data-test="dd-error"]').textContent).toBe('回收原因最多 500 字')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('填好原因后确认 → 直接上抛 { forceRevoke: true, reason: trim 后原因 }，没有二次确认', async () => {
    await mount()
    await check(true)
    await typeReason('  存在安全风险  ')
    confirmBtn().click()
    await nextTick()
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith({ forceRevoke: true, reason: '存在安全风险' })
  })

  it('取消勾选 → 恢复普通停用样式并清空已填原因；再次勾选原因框为空', async () => {
    await mount()
    await check(true)
    await typeReason('先写一半')
    await check(false)
    expect(title()).toBe('停用MCP 服务')
    expect(textarea()).toBeNull()
    await check(true)
    expect(textarea().value).toBe('')
  })

  it('重开弹窗回到默认的普通停用（上次勾选与原因不残留）', async () => {
    await mount()
    await check(true)
    await typeReason('残留?')
    visible.value = false
    await nextTick()
    visible.value = true
    await nextTick()
    await nextTick()
    expect(title()).toBe('停用MCP 服务')
    expect(container.querySelector('[data-test="dd-force-check"] input').checked).toBe(false)
  })
})

describe('DeactivateDialog · 普通停用被拦截（技能被引用）', () => {
  const blockedMessage = '该技能被 2 个岗位/专家引用，需先解除引用后再停用'

  it('未勾选：展示拦截文案、确认按钮禁用、点击不上抛', async () => {
    await mount({ blockedMessage })
    expect(container.querySelector('[data-test="dd-blocked"]').textContent).toBe(blockedMessage)
    expect(confirmBtn().disabled).toBe(true)
    confirmBtn().click()
    await nextTick()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('勾选强制回收后不受拦截：确认可点，填原因后上抛 forceRevoke', async () => {
    await mount({ blockedMessage })
    await check(true)
    expect(container.querySelector('[data-test="dd-blocked"]')).toBeNull()
    expect(confirmBtn().disabled).toBe(false)
    await typeReason('能力异常')
    confirmBtn().click()
    await nextTick()
    expect(onConfirm).toHaveBeenCalledWith({ forceRevoke: true, reason: '能力异常' })
  })
})
