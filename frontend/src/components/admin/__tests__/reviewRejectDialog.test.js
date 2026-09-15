// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * ReviewRejectDialog.vue（审核中心 · 驳回弹窗）单测（2026-09-12 测试审计 T56 新建；桩法同 userSkillRejectDialog.test）。
 *
 * 对齐 md `prd.审核中心.md` §5.1：点【驳回】打开「驳回审核」弹窗；驳回原因必填、最多 500 字；
 * 为空时阻止提交并提示「请输入驳回原因」（就地提示 + 聚焦输入框，弹窗不关）；确认经 confirm 上抛 trim 后原因，
 * 请求成败由调用方处理。另验：title 可覆盖（岗位申请审批复用为「驳回岗位申请」）、重开清空上次输入与报错、submitting 转圈。
 */

const Dialog = (await import('@/components/admin/ReviewRejectDialog.vue')).default

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
const elButton = {
  props: { disabled: Boolean, loading: Boolean, type: String },
  emits: ['click'],
  template: '<button class="el-button" :data-type="type" :data-loading="loading" @click="$emit(\'click\')"><slot /></button>'
}

let app, container
const onConfirm = vi.fn()
const onVisible = vi.fn()
const visible = ref(true)
async function mount(extra = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    setup() {
      return () => h(Dialog, { modelValue: visible.value, 'onUpdate:modelValue': onVisible, onConfirm, ...extra })
    }
  })
  app.component('el-dialog', elDialog)
  app.component('el-input', elInput)
  app.component('el-button', elButton)
  app.mount(container)
  await nextTick()
  await nextTick()
  return container
}
const btn = (t) => [...container.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === t)
const textarea = () => container.querySelector('.el-input')
const typeReason = async (v) => {
  textarea().value = v
  textarea().dispatchEvent(new Event('input'))
  await nextTick()
}

beforeEach(() => {
  visible.value = true
  onConfirm.mockReset()
  onVisible.mockReset()
  focus.mockReset()
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('ReviewRejectDialog（md 审核中心 §5.1 驳回弹窗）', () => {
  it('默认标题「驳回审核」、必填标记「* 驳回原因」、textarea 占位「请输入明确的驳回原因」与 500 字上限、底部【取消】【确认驳回】', async () => {
    await mount()
    expect(container.querySelector('.el-dialog').dataset.title).toBe('驳回审核')
    expect(container.querySelector('.rrd-label').textContent.replace(/\s+/g, ' ').trim()).toBe('* 驳回原因')
    expect(container.querySelector('.rrd-required').textContent).toBe('*')
    expect(textarea().placeholder).toBe('请输入明确的驳回原因')
    expect(textarea().getAttribute('maxlength')).toBe('500')
    expect([...container.querySelectorAll('.dlg-footer .el-button')].map((b) => b.textContent.trim())).toEqual(['取消', '确认驳回'])
    expect(btn('确认驳回').dataset.type).toBe('primary')
    expect(container.querySelector('.rrd-error')).toBeNull()
  })

  it('原因为空 / 纯空白 → 就地提示「请输入驳回原因」+ 聚焦输入框，不上抛 confirm、弹窗不关（md §5.1 L70）', async () => {
    await mount()
    btn('确认驳回').click()
    await nextTick()
    expect(container.querySelector('.rrd-error').textContent).toBe('请输入驳回原因')
    expect(focus).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onVisible).not.toHaveBeenCalled()
    await typeReason('   ')
    btn('确认驳回').click()
    await nextTick()
    expect(container.querySelector('.rrd-error').textContent).toBe('请输入驳回原因')
    expect(focus).toHaveBeenCalledTimes(2)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('输入后报错消失；确认上抛 trim 后的原因，不自行关弹窗（成败由调用方处理）', async () => {
    await mount()
    btn('确认驳回').click()
    await nextTick()
    await typeReason('  描述不完整，请补充  ')
    expect(container.querySelector('.rrd-error')).toBeNull()
    btn('确认驳回').click()
    await nextTick()
    expect(onConfirm).toHaveBeenCalledWith('描述不完整，请补充')
    expect(onVisible).not.toHaveBeenCalledWith(false)
  })

  it('关闭后重开 → 上次输入与报错被清空', async () => {
    await mount()
    await typeReason('   ') // 留下一段空白输入并触发报错
    btn('确认驳回').click()
    await nextTick()
    expect(textarea().value).toBe('   ')
    expect(container.querySelector('.rrd-error').textContent).toBe('请输入驳回原因')
    visible.value = false
    await nextTick()
    expect(container.querySelector('.el-dialog')).toBeNull()
    visible.value = true
    await nextTick()
    await nextTick()
    expect(textarea().value).toBe('')
    expect(container.querySelector('.rrd-error')).toBeNull()
    // 直接点确认仍拦空值
    btn('确认驳回').click()
    await nextTick()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('【取消】→ 上抛 update:modelValue=false；submitting=true 时确认键转圈', async () => {
    await mount({ submitting: true })
    expect(btn('确认驳回').dataset.loading).toBe('true')
    btn('取消').click()
    await nextTick()
    expect(onVisible).toHaveBeenCalledWith(false)
  })

  it('title 可覆盖（岗位申请审批复用为「驳回岗位申请」）', async () => {
    await mount({ title: '驳回岗位申请' })
    expect(container.querySelector('.el-dialog').dataset.title).toBe('驳回岗位申请')
  })
})
