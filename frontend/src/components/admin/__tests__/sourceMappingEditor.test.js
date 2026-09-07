// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h, ref, nextTick } from 'vue'

/**
 * SourceMappingEditor / SourceMapParamRows 单测（2026-09-07 PRD-20260904 数据源新口径对齐）。
 * 覆盖 md §六.2 / §六.3（MCP §七.4 / §七.5 同构）：
 * - 请求映射预设 query / topK 行：参数名与类型固定展示、必填与映射不可改、无删除入口（固定参数不可删除）；
 * - 响应映射预设 content / source / score 行：不可删除、变量类型可改；
 * - 【添加参数】/【添加字段】新增自定义行（自定义行带删除）；
 * - protocol 切换 API / MCP 文案。
 * Element 组件按仓内范式桩化（同 paramRowsEditor.test.js）。
 */

const SourceMappingEditor = (await import('@/components/admin/SourceMappingEditor.vue')).default
const { mkRequestMapRows, mkResponseMapRows } = await import('@/utils/knowledgeBaseMeta')

const stubs = {
  'el-input': {
    props: { modelValue: String, disabled: Boolean, placeholder: String, maxlength: [String, Number] },
    emits: ['update:modelValue', 'input'],
    template:
      '<input class="el-input" :value="modelValue" :disabled="disabled" :placeholder="placeholder"' +
      ' @input="$emit(\'update:modelValue\', $event.target.value); $emit(\'input\', $event.target.value)" />'
  },
  'el-select': {
    props: { modelValue: String, disabled: Boolean },
    emits: ['update:modelValue', 'change'],
    template:
      '<select class="el-select" :value="modelValue" :disabled="disabled"' +
      ' @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\', $event.target.value)"><slot /></select>'
  },
  'el-option': {
    props: { value: String, label: String },
    template: '<option :value="value">{{ label }}</option>'
  },
  'el-checkbox': {
    props: { modelValue: Boolean, disabled: Boolean, title: String },
    emits: ['update:modelValue', 'change'],
    template:
      '<input class="el-checkbox" type="checkbox" :checked="modelValue" :disabled="disabled"' +
      ' @change="$emit(\'update:modelValue\', $event.target.checked); $emit(\'change\', $event.target.checked)" />'
  },
  'el-button': {
    props: { disabled: Boolean },
    emits: ['click'],
    template: '<button class="el-button" :disabled="disabled" @click="!disabled && $emit(\'click\')"><slot /></button>'
  }
}

let app, container, requestRows, responseRows
async function mountEditor(props = {}) {
  requestRows = ref(mkRequestMapRows())
  responseRows = ref(mkResponseMapRows())
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    setup() {
      return () =>
        h(SourceMappingEditor, {
          protocol: 'API',
          requestRows: requestRows.value,
          responseRows: responseRows.value,
          'onUpdate:requestRows': (v) => (requestRows.value = v),
          'onUpdate:responseRows': (v) => (responseRows.value = v),
          ...props
        })
    }
  })
  for (const [name, comp] of Object.entries(stubs)) app.component(name, comp)
  app.mount(container)
  await nextTick()
  return container
}
afterEach(() => {
  app?.unmount()
  container?.remove()
})
const cards = () => [...container.querySelectorAll('.sme-card')]
const btnByText = (root, text) => [...root.querySelectorAll('.el-button')].find((b) => b.textContent.includes(text))

describe('SourceMappingEditor（2026-09-07 PRD-20260904 数据源新口径对齐）', () => {
  it('请求映射预设 query/topK：参数名固定、无删除入口；必填与映射客户端字段不可改', async () => {
    await mountEditor()
    const reqCard = cards()[0]
    const fixed = [...reqCard.querySelectorAll('.smp-fixed-name')].map((el) => el.textContent)
    expect(fixed).toEqual(['query', 'topK'])
    // 固定参数不可删除（md §六.2）：预设行无删除按钮
    expect(btnByText(reqCard, '删除')).toBeUndefined()
    // 必填勾选与映射客户端字段禁用（固定映射）
    const rowChecks = [...reqCard.querySelectorAll('.el-checkbox')]
    expect(rowChecks.every((c) => c.disabled)).toBe(true)
    expect(rowChecks[0].checked).toBe(true) // query 固定必填
    expect(rowChecks[1].checked).toBe(false) // topK 固定选填
    const clientSelects = [...reqCard.querySelectorAll('.smp-client')]
    expect(clientSelects.every((s) => s.disabled)).toBe(true)
  })

  it('【添加参数】新增自定义行（带删除入口），删除后回到只剩预设行', async () => {
    await mountEditor()
    const reqCard = () => cards()[0]
    btnByText(reqCard(), '＋ 添加参数').click()
    await nextTick()
    expect(requestRows.value.length).toBe(3)
    expect(requestRows.value[2].preset).toBe(false)
    const del = btnByText(reqCard(), '删除')
    expect(del).toBeTruthy()
    del.click()
    await nextTick()
    expect(requestRows.value.length).toBe(2)
    expect(requestRows.value.every((r) => r.preset)).toBe(true)
  })

  it('响应映射预设 content/source/score：不可删除，变量类型可改（md §六.3）', async () => {
    await mountEditor()
    const respCard = cards()[1]
    const fixed = [...respCard.querySelectorAll('.sme-fixed-name')].map((el) => el.textContent)
    expect(fixed).toEqual(['content', 'source', 'score'])
    expect(btnByText(respCard, '删除')).toBeUndefined()
    // 类型下拉未禁用 → 可改
    const typeSelects = [...respCard.querySelectorAll('.sme-type')]
    expect(typeSelects.length).toBe(3)
    expect(typeSelects.every((s) => !s.disabled)).toBe(true)
    // 【添加字段】新增自定义行带删除
    btnByText(respCard, '＋ 添加字段').click()
    await nextTick()
    expect(responseRows.value.length).toBe(4)
    expect(btnByText(cards()[1], '删除')).toBeTruthy()
  })

  it('protocol=MCP 时文案切换（MCP 工具入参 / MCP 原始字段）', async () => {
    await mountEditor({ protocol: 'MCP' })
    expect(container.textContent).toContain('MCP 工具入参 ← 客户端字段映射')
    expect(container.textContent).toContain('仅返回列表中配置的下游 MCP 原始字段')
    expect(container.textContent).toContain('MCP 参数名')
  })
})
