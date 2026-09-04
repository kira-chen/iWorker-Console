// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import ClaimNotesEditor from '@/components/position/ClaimNotesEditor.vue'

/**
 * 岗位认领说明编辑器单测（2026-09-04 PRD-20260903 对齐新增，md 三.2.3）：
 * 空态文案 / 新增-保存-取消流转 / 保存 toast / 删除回吐 / 6 条上限隐藏新增 / 只读态无操作入口。
 */

const ElMessage = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() })
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: (...a) => ElMessage.success(...a), error: (...a) => ElMessage.error(...a), warning: (...a) => ElMessage.warning(...a) })
}))

const stubs = {
  'el-input': {
    props: ['modelValue', 'placeholder', 'maxlength'],
    emits: ['update:modelValue'],
    template:
      '<input class="stub-input" :value="modelValue" :maxlength="maxlength" :placeholder="placeholder" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  'el-button': {
    props: ['disabled'],
    emits: ['click'],
    template: '<button class="stub-btn" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
  }
}

let app, container
function mount(modelValue, readonly = false) {
  container = document.createElement('div')
  document.body.appendChild(container)
  const emitted = []
  app = createApp({
    render: () => h(ClaimNotesEditor, { modelValue, readonly, 'onUpdate:modelValue': (v) => emitted.push(v) })
  })
  for (const [name, comp] of Object.entries(stubs)) app.component(name, comp)
  app.mount(container)
  return { container, emitted }
}
afterEach(() => {
  app?.unmount()
  container?.remove()
  ElMessage.success.mockClear()
  ElMessage.warning.mockClear()
})

const btnByText = (root, text) => [...root.querySelectorAll('.stub-btn')].find((b) => b.textContent.trim() === text)

describe('ClaimNotesEditor · 岗位认领说明（md 三.2.3）', () => {
  it('空态文案照 md；列表态渲染序号 + 文本 + 删除', () => {
    const empty = mount([])
    expect(empty.container.textContent).toContain('还没有岗位认领说明，点击"新增"添加一条')
    app.unmount(); container.remove()
    const { container: c } = mount(['第一条', '第二条'])
    expect(c.querySelectorAll('.cn-item').length).toBe(2)
    expect(c.textContent).toContain('第一条')
    expect(btnByText(c, '删除')).toBeTruthy()
  })

  it('新增 → 输入 → 保存：回吐追加后的数组 + toast「岗位认领说明已保存」；输入 100 字上限', async () => {
    const { container: c, emitted } = mount(['已有'])
    btnByText(c, '新增').click()
    await nextTick()
    const input = c.querySelector('.stub-input')
    expect(input).toBeTruthy()
    expect(input.getAttribute('maxlength')).toBe('100')
    input.value = '新说明'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    btnByText(c, '保存').click()
    await nextTick()
    expect(emitted[0]).toEqual(['已有', '新说明'])
    expect(ElMessage.success).toHaveBeenCalledWith('岗位认领说明已保存')
  })

  it('保存空内容被拦（toast 提示，不回吐）；取消收起输入框', async () => {
    const { container: c, emitted } = mount([])
    btnByText(c, '新增').click()
    await nextTick()
    btnByText(c, '保存').click()
    await nextTick()
    expect(emitted.length).toBe(0)
    expect(ElMessage.warning).toHaveBeenCalledWith('请输入岗位认领说明')
    btnByText(c, '取消').click()
    await nextTick()
    expect(c.querySelector('.stub-input')).toBeNull()
  })

  it('删除某条 → 回吐移除后的数组', async () => {
    const { container: c, emitted } = mount(['a', 'b', 'c'])
    const dels = [...c.querySelectorAll('.stub-btn')].filter((b) => b.textContent.trim() === '删除')
    dels[1].click()
    await nextTick()
    expect(emitted[0]).toEqual(['a', 'c'])
  })

  it('满 6 条隐藏【新增】；只读态无新增/删除入口', () => {
    const full = mount(['1', '2', '3', '4', '5', '6'])
    expect(btnByText(full.container, '新增')).toBeUndefined()
    app.unmount(); container.remove()
    const ro = mount(['一条'], true)
    expect(btnByText(ro.container, '新增')).toBeUndefined()
    expect(btnByText(ro.container, '删除')).toBeUndefined()
  })
})
