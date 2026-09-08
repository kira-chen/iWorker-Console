// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

/**
 * UserSkillRejectDialog.vue 单测（2026-09-08 PRD-20260908 对齐 · md §6.2 驳回弹窗）。
 * 验：标题「驳回审核」、说明文、占位「请输入驳回原因（必填）」、500 字上限；空值 → toast「请填写驳回原因」+ 标红 + 聚焦、不上抛；
 * 有值 → confirm(trim 后原因)；确认键「确认驳回」。
 */

const ElMessage = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() })
vi.mock('element-plus', () => ({ ElMessage }))

const Dialog = (await import('@/components/admin/UserSkillRejectDialog.vue')).default

const elDialog = {
  props: ['modelValue', 'title'],
  emits: ['update:modelValue'],
  template: '<div class="el-dialog" v-if="modelValue" :data-title="title"><slot /><div class="dlg-footer"><slot name="footer" /></div></div>'
}
const focus = vi.fn()
const elInput = {
  props: ['modelValue', 'placeholder', 'maxlength'],
  emits: ['update:modelValue', 'input'],
  methods: { focus },
  template:
    '<textarea class="el-input" :placeholder="placeholder" :maxlength="maxlength" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value); $emit(\'input\', $event.target.value)" />'
}
const elButton = {
  props: { disabled: Boolean, loading: Boolean, type: String },
  emits: ['click'],
  template: '<button class="el-button" :data-type="type" @click="$emit(\'click\')"><slot /></button>'
}

let app, container
const onConfirm = vi.fn()
const onVisible = vi.fn()
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    setup() {
      return () => h(Dialog, { modelValue: true, 'onUpdate:modelValue': onVisible, onConfirm })
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

beforeEach(() => {
  onConfirm.mockReset()
  onVisible.mockReset()
  focus.mockReset()
  ElMessage.warning.mockReset()
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('UserSkillRejectDialog（2026-09-08 PRD-20260908 对齐）', () => {
  it('标题 / 说明文 / 占位 / 500 字上限 / 按钮文案', async () => {
    await mount()
    expect(container.querySelector('.el-dialog').dataset.title).toBe('驳回审核')
    expect(container.querySelector('.usrd-hint').textContent).toBe('请填写驳回原因，驳回后提交人将收到通知并需修改后重新提交。')
    const ta = container.querySelector('.el-input')
    expect(ta.placeholder).toBe('请输入驳回原因（必填）')
    expect(ta.getAttribute('maxlength')).toBe('500')
    expect([...container.querySelectorAll('.dlg-footer .el-button')].map((b) => b.textContent.trim())).toEqual(['取消', '确认驳回'])
  })

  it('空值：toast「请填写驳回原因」+ 标红 + 聚焦，不上抛 confirm', async () => {
    await mount()
    btn('确认驳回').click()
    await nextTick()
    expect(ElMessage.warning).toHaveBeenCalledWith('请填写驳回原因')
    expect(focus).toHaveBeenCalled()
    expect(container.querySelector('.el-input').className).toContain('is-invalid')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('有值：confirm(trim 后原因)；输入后清红', async () => {
    await mount()
    btn('确认驳回').click()
    await nextTick()
    const ta = container.querySelector('.el-input')
    ta.value = '  权限范围过大  '
    ta.dispatchEvent(new Event('input'))
    await nextTick()
    expect(ta.className).not.toContain('is-invalid')
    btn('确认驳回').click()
    await nextTick()
    expect(onConfirm).toHaveBeenCalledWith('权限范围过大')
  })

  it('【取消】关闭', async () => {
    await mount()
    btn('取消').click()
    await nextTick()
    expect(onVisible).toHaveBeenCalledWith(false)
  })
})
