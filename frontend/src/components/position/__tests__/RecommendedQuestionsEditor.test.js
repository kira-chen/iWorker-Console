// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h } from 'vue'
import RecommendedQuestionsEditor from '@/components/position/RecommendedQuestionsEditor.vue'

/**
 * N4 推荐问题编辑器单测：固定 4 格、无增删、必填红星、30 字硬上限、未填红字标识、改动回吐固定 4 长度数组。
 */

// el-input 存根：渲染 input，透传 update:model-value 与 maxlength；el-icon 忽略。
const stubs = {
  'el-input': {
    props: ['modelValue', 'placeholder', 'maxlength'],
    emits: ['update:modelValue'],
    template:
      '<input class="stub-input" :value="modelValue" :maxlength="maxlength" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  }
}

let app, container
function mount(modelValue, showErrors = false) {
  container = document.createElement('div')
  document.body.appendChild(container)
  const emitted = []
  app = createApp({
    render: () =>
      h(RecommendedQuestionsEditor, {
        modelValue,
        showErrors,
        'onUpdate:modelValue': (v) => emitted.push(v)
      })
  })
  for (const [name, comp] of Object.entries(stubs)) app.component(name, comp)
  app.mount(container)
  return { container, emitted }
}
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('RecommendedQuestionsEditor · N4 固定 4 格', () => {
  it('恒渲染 4 个输入框（存量不足补空），无增删按钮', () => {
    const { container } = mount(['a', 'b'])
    expect(container.querySelectorAll('.stub-input').length).toBe(4)
    // 无"添加/删除"按钮（数量硬定为 4）
    expect(container.querySelectorAll('button').length).toBe(0)
  })

  it('改某格 → 回吐固定 4 长度数组，仅该格变化', () => {
    const { container, emitted } = mount(['a', 'b', 'c', 'd'])
    const inputs = container.querySelectorAll('.stub-input')
    inputs[1].value = 'B2'
    inputs[1].dispatchEvent(new Event('input'))
    expect(emitted.length).toBe(1)
    expect(emitted[0]).toEqual(['a', 'B2', 'c', 'd'])
    expect(emitted[0].length).toBe(4)
  })

  it('showErrors 时未填格出现"此格必填"红字', () => {
    const { container } = mount(['a', '', 'c', ''], true)
    const errs = [...container.querySelectorAll('.rq-err')].map((n) => n.textContent.trim())
    expect(errs.filter((t) => t === '此格必填').length).toBe(2)
  })

  it('每格带必填红星 + 30 字硬上限（maxlength）', () => {
    const { container } = mount(['a', 'b', 'c', 'd'])
    // 4 格逐格红星（必填视觉）
    expect(container.querySelectorAll('.rq-req').length).toBe(4)
    // maxlength=30 透传到输入框（超 30 由浏览器直接拦）
    const inputs = [...container.querySelectorAll('.stub-input')]
    expect(inputs.every((i) => i.getAttribute('maxlength') === '30')).toBe(true)
    // 旧「建议 20 字内」软提示已移除
    expect(container.querySelectorAll('.rq-soft').length).toBe(0)
  })
})
