// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, h, ref, nextTick } from 'vue'
import ClaimNotesEditor from '@/components/position/ClaimNotesEditor.vue'

/**
 * 岗位认领说明编辑器单测（2026-09-04 PRD-20260903 对齐，md 三.2.3；
 * 2026-09-04 卡片化返工同步更新：新增入口移宿主卡片头（defineExpose startAdd / editing / atLimit），
 * 列表行改行内输入框就地编辑并实时回吐，空态/hint 文案照原型排版）。
 * 覆盖：空态文案 / 行内编辑回吐 / 新增-保存-取消流转 / 保存 toast / 删除回吐 /
 * 6 条上限 atLimit / 只读态无操作入口。
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
  const editorRef = ref(null)
  app = createApp({
    setup() {
      return () =>
        h(ClaimNotesEditor, { ref: editorRef, modelValue, readonly, 'onUpdate:modelValue': (v) => emitted.push(v) })
    }
  })
  for (const [name, comp] of Object.entries(stubs)) app.component(name, comp)
  app.mount(container)
  return { container, emitted, editorRef }
}
afterEach(() => {
  app?.unmount()
  container?.remove()
  ElMessage.success.mockClear()
  ElMessage.warning.mockClear()
})

const btnByText = (root, text) => [...root.querySelectorAll('.stub-btn')].find((b) => b.textContent.trim() === text)

describe('ClaimNotesEditor · 岗位认领说明（md 三.2.3 · 卡片化返工态）', () => {
  it('空态文案照原型排版；列表态渲染序号圆点 + 行内输入框 + 删除 + 底部 hint', () => {
    const empty = mount([])
    expect(empty.container.textContent).toContain('还没有岗位认领说明，点击"新增一条"添加')
    app.unmount(); container.remove()
    const { container: c } = mount(['第一条', '第二条'])
    expect(c.querySelectorAll('.cn-item').length).toBe(2)
    expect(c.querySelectorAll('.cn-index').length).toBe(2)
    // 行内就地编辑输入框（照原型 pclaim-inline-input）：值即当条文本
    const values = [...c.querySelectorAll('.cn-item .stub-input')].map((i) => i.value)
    expect(values).toEqual(['第一条', '第二条'])
    expect(btnByText(c, '删除')).toBeTruthy()
    // hint 照原型置底：「每条最多 100 个字符」
    expect(c.querySelector('.cn-hint')?.textContent).toContain('每条最多 100 个字符')
  })

  it('行内编辑某条 → 实时回吐替换后的数组', async () => {
    const { container: c, emitted } = mount(['a', 'b'])
    const inputs = [...c.querySelectorAll('.cn-item .stub-input')]
    inputs[1].value = 'b改'
    inputs[1].dispatchEvent(new Event('input'))
    await nextTick()
    expect(emitted[0]).toEqual(['a', 'b改'])
  })

  it('startAdd（宿主卡片头「＋ 新增一条」直调）→ 输入 → 保存：回吐追加后的数组 + toast；输入 100 字上限', async () => {
    const { container: c, emitted, editorRef } = mount(['已有'])
    editorRef.value.startAdd()
    await nextTick()
    const input = c.querySelector('.cn-form .stub-input')
    expect(input).toBeTruthy()
    expect(input.getAttribute('maxlength')).toBe('100')
    input.value = '新说明'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    btnByText(c, '保存').click()
    await nextTick()
    expect(emitted.at(-1)).toEqual(['已有', '新说明'])
    expect(ElMessage.success).toHaveBeenCalledWith('岗位认领说明已保存')
  })

  it('保存空内容被拦（toast 提示，不回吐）；取消收起草稿行', async () => {
    const { container: c, emitted, editorRef } = mount([])
    editorRef.value.startAdd()
    await nextTick()
    btnByText(c, '保存').click()
    await nextTick()
    expect(emitted.length).toBe(0)
    expect(ElMessage.warning).toHaveBeenCalledWith('请输入岗位认领说明')
    btnByText(c, '取消').click()
    await nextTick()
    expect(c.querySelector('.cn-form')).toBeNull()
  })

  it('删除某条 → 回吐移除后的数组', async () => {
    const { container: c, emitted } = mount(['a', 'b', 'c'])
    const dels = [...c.querySelectorAll('.stub-btn')].filter((b) => b.textContent.trim() === '删除')
    dels[1].click()
    await nextTick()
    expect(emitted[0]).toEqual(['a', 'c'])
  })

  it('满 6 条 atLimit=true 且 startAdd 不展开；只读态无输入框/删除入口且 startAdd 不生效', async () => {
    const full = mount(['1', '2', '3', '4', '5', '6'])
    expect(full.editorRef.value.atLimit).toBe(true)
    full.editorRef.value.startAdd()
    await nextTick()
    expect(full.editorRef.value.editing).toBe(false)
    expect(full.container.querySelector('.cn-form')).toBeNull()
    app.unmount(); container.remove()
    const ro = mount(['一条'], true)
    expect(ro.container.querySelector('.cn-item .stub-input')).toBeNull()
    expect(ro.container.querySelector('.cn-text')?.textContent).toBe('一条')
    expect(btnByText(ro.container, '删除')).toBeUndefined()
    ro.editorRef.value.startAdd()
    await nextTick()
    expect(ro.container.querySelector('.cn-form')).toBeNull()
  })
})
