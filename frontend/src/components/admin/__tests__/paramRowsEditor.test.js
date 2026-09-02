// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'

/**
 * ParamRowsEditor.vue 单测 —— 公共参数行编辑器（2026-08-31 B.3 抽象）。
 * MCP stdio Env（无位置列）与 API KEY 鉴权（带位置列）共用；本文件验行渲染、
 * 增删行事件、客户端填写互斥联动、占位提示、行级提示与 clientFillHint 展示。
 * Element 组件按仓内范式桩化（同 drawerEditor.test.js）。
 */

const ParamRowsEditor = (await import('@/components/admin/ParamRowsEditor.vue')).default

const elInput = {
  name: 'el-input',
  props: { modelValue: String, disabled: Boolean, placeholder: String, maxlength: [String, Number] },
  emits: ['update:modelValue', 'input'],
  template:
    '<input class="el-input" :value="modelValue" :disabled="disabled" :placeholder="placeholder"' +
    ' @input="$emit(\'update:modelValue\', $event.target.value); $emit(\'input\', $event.target.value)" />'
}
const elSelect = {
  name: 'el-select',
  props: { modelValue: String },
  emits: ['update:modelValue', 'change'],
  template: '<select class="el-select" :value="modelValue"' +
    ' @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\', $event.target.value)"><slot /></select>'
}
const elOption = {
  name: 'el-option',
  props: { value: String, label: String, disabled: Boolean },
  template: '<option :value="value" :disabled="disabled">{{ label }}</option>'
}
const elCheckbox = {
  name: 'el-checkbox',
  props: { modelValue: Boolean },
  emits: ['update:modelValue', 'change'],
  template:
    '<input class="el-checkbox" type="checkbox" :checked="modelValue"' +
    ' @change="$emit(\'update:modelValue\', $event.target.checked); $emit(\'change\', $event.target.checked)" />'
}
const elButton = {
  name: 'el-button',
  props: { disabled: Boolean },
  emits: ['click'],
  template: '<button class="el-button" :disabled="disabled" @click="!disabled && $emit(\'click\')"><slot /></button>'
}

let app, container
const emitted = { 'update:rows': [], interact: 0 }
function mountEditor(props = {}) {
  emitted['update:rows'] = []
  emitted.interact = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    setup() {
      return () =>
        h(ParamRowsEditor, {
          ...props,
          'onUpdate:rows': (rows) => emitted['update:rows'].push(rows),
          onInteract: () => emitted.interact++
        })
    }
  })
  app.component('el-input', elInput)
  app.component('el-select', elSelect)
  app.component('el-option', elOption)
  app.component('el-checkbox', elCheckbox)
  app.component('el-button', elButton)
  app.mount(container)
  return container
}
afterEach(() => {
  if (app) app.unmount()
  if (container) container.remove()
})

const row = (over = {}) => ({ key: '', description: '', clientFill: false, value: '', configured: false, ...over })

describe('ParamRowsEditor', () => {
  it('默认（MCP Env 形态）：无位置列，表头四列，行随 rows 渲染', () => {
    const el = mountEditor({ rows: [row({ key: 'API_KEY', configured: true })] })
    expect(el.querySelectorAll('.pr-row:not(.pr-row-head)').length).toBe(1)
    expect(el.querySelector('.pr-row-head').textContent).toContain('客户端填写')
    expect(el.querySelector('.pr-in-select')).toBeNull()
  })

  it('showIn（API 鉴权形态）：渲染位置下拉，表头含「位置」', () => {
    const el = mountEditor({
      rows: [row({ in: 'HEADER', key: 'appid' })],
      showIn: true,
      inOptions: [
        { value: 'HEADER', label: 'Header' },
        { value: 'QUERY', label: 'Query' }
      ]
    })
    expect(el.querySelector('.pr-in-select')).not.toBeNull()
    expect(el.querySelector('.pr-row-head').textContent).toContain('位置')
  })

  it('添加行：emit update:rows 新数组 + interact；showIn 时新行预置首个位置', () => {
    const el = mountEditor({ rows: [], showIn: true, inOptions: [{ value: 'HEADER', label: 'Header' }] })
    el.querySelector('.pr-add button').click()
    expect(emitted['update:rows'][0]).toHaveLength(1)
    expect(emitted['update:rows'][0][0].in).toBe('HEADER')
    expect(emitted.interact).toBe(1)
  })

  it('删除行：emit update:rows 去掉该行', () => {
    const el = mountEditor({ rows: [row({ key: 'A' }), row({ key: 'B' })] })
    el.querySelector('.pr-row:not(.pr-row-head) .el-button').click()
    expect(emitted['update:rows'][0].map((r) => r.key)).toEqual(['B'])
  })

  it('勾选客户端填写 → 平台值清空并禁用（互斥联动）', async () => {
    const r = reactive(row({ key: 'K', value: 'secret' }))
    const el = mountEditor({ rows: [r] })
    const cb = el.querySelector('.pr-cf input[type="checkbox"]')
    cb.checked = true
    cb.dispatchEvent(new Event('change'))
    await nextTick()
    expect(r.clientFill).toBe(true)
    expect(r.value).toBe('')
    const inputs = el.querySelectorAll('.pr-row:not(.pr-row-head) input.el-input')
    expect(inputs[2].disabled).toBe(true) // key/desc/value 第三个
    expect(emitted.interact).toBeGreaterThan(0)
  })

  it('平台值占位：已配置=留空保留；未配置=必填；客户端填写=由客户端填写', () => {
    const el = mountEditor({
      rows: [row({ key: 'A', configured: true }), row({ key: 'B' }), row({ key: 'C', clientFill: true })]
    })
    const valueInputOf = (i) =>
      el.querySelectorAll('.pr-row:not(.pr-row-head)')[i].querySelectorAll('input.el-input')[2]
    expect(valueInputOf(0).placeholder).toContain('保留')
    expect(valueInputOf(1).placeholder).toBe('必填')
    expect(valueInputOf(2).placeholder).toContain('客户端')
  })

  it('行级提示 rowNotice：warn 分类渲染', () => {
    const el = mountEditor({
      rows: [row({ in: 'QUERY', key: 'k', value: 'v' })],
      showIn: true,
      inOptions: [{ value: 'QUERY', label: 'Query' }],
      rowNotice: (r) => (r.in === 'QUERY' ? { type: 'warn', text: '日志泄漏风险' } : null)
    })
    const notice = el.querySelector('.pr-row-notice')
    expect(notice).not.toBeNull()
    expect(notice.className).toContain('is-warn')
    expect(notice.textContent).toContain('日志泄漏风险')
  })

  it('clientFillHint 仅在存在客户端填写行时展示', () => {
    const none = mountEditor({ clientFillHint: '值由客户端收集', rows: [row({ key: 'A', value: 'v' })] })
    expect(none.querySelector('.pr-cf-hint')).toBeNull()
    app.unmount()
    container.remove()
    const has = mountEditor({ clientFillHint: '值由客户端收集', rows: [row({ key: 'A', clientFill: true })] })
    expect(has.querySelector('.pr-cf-hint').textContent).toContain('客户端收集')
  })
})
