// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, ref, nextTick } from 'vue'
import CodeTextEditor from '@/components/position/CodeTextEditor.vue'

/**
 * CodeTextEditor 单测（F5a）：.json 失焦语法校验软提示「告知但不拦」。
 * - .json 失焦非法 JSON → 底部红字软提示 + emit json-error（非空）；
 * - .json 失焦合法/空 → 无红字 + emit json-error('')；
 * - .txt → 永不校验；
 * - 软提示不改 v-model（不阻断保存——保存由父级独立触发，组件只回吐内容）。
 */
let app, container

function mount(props) {
  container = document.createElement('div')
  document.body.appendChild(container)
  const events = { error: [], input: [] }
  app = createApp({
    render: () =>
      h(CodeTextEditor, {
        ...props,
        'onJson-error': (m) => events.error.push(m),
        'onUpdate:modelValue': (v) => events.input.push(v)
      })
  })
  // 存根 el-icon / el-skeleton 不需要（组件未用 EP 组件）
  app.mount(container)
  return { container, events }
}

afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('CodeTextEditor · .json 失焦软校验（F5a）', () => {
  it('.json 失焦非法 JSON → 红字软提示 + emit json-error 非空', async () => {
    const { container, events } = mount({ modelValue: '{ bad json', fileType: 'json' })
    const ta = container.querySelector('textarea')
    ta.dispatchEvent(new Event('blur'))
    await nextTick()
    expect(container.querySelector('.json-soft-error')).toBeTruthy()
    expect(events.error.at(-1)).toMatch(/JSON 语法错误/)
  })

  it('.json 失焦合法 JSON → 无红字 + emit json-error 空', async () => {
    const { container, events } = mount({ modelValue: '{"a":1}', fileType: 'json' })
    const ta = container.querySelector('textarea')
    ta.dispatchEvent(new Event('blur'))
    await nextTick()
    expect(container.querySelector('.json-soft-error')).toBeNull()
    expect(events.error.at(-1)).toBe('')
  })

  it('.json 空内容 → 视为合法（编辑中途允许空），无红字', async () => {
    const { container } = mount({ modelValue: '   ', fileType: 'json' })
    const ta = container.querySelector('textarea')
    ta.dispatchEvent(new Event('blur'))
    await nextTick()
    expect(container.querySelector('.json-soft-error')).toBeNull()
  })

  it('.txt 失焦 → 永不校验（即便内容像坏 JSON 也无红字）', async () => {
    const { container, events } = mount({ modelValue: '{ not json', fileType: 'txt' })
    const ta = container.querySelector('textarea')
    ta.dispatchEvent(new Event('blur'))
    await nextTick()
    expect(container.querySelector('.json-soft-error')).toBeNull()
    expect(events.error.length).toBe(0)
  })

  it('输入回吐 update:modelValue（内容受控），软提示不改内容', async () => {
    const { container, events } = mount({ modelValue: '', fileType: 'json' })
    const ta = container.querySelector('textarea')
    ta.value = '{"x":1}'
    ta.dispatchEvent(new Event('input'))
    await nextTick()
    expect(events.input.at(-1)).toBe('{"x":1}')
  })
})
