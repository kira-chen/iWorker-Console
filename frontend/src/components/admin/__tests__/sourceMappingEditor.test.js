// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h, ref, nextTick } from 'vue'

/**
 * SourceMappingEditor / SourceMapParamRows 单测——知识库 API 数据源的请求参数映射 / 响应字段映射。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/知识库/prd.知识库.md §六.2 L301-321 / §六.3 L323-337（2026-09-12 测试审计 T31 头注更新；
 * 映射仅 API 数据源持有，md §七 无 MCP 映射）：
 * - 请求映射预设 query / topK 行：参数名与类型固定展示、必填与映射不可改、固定参数不可删除（L313）；
 * - 【添加参数】新增自定义行（带 × 删除）（L314）；
 * - object / array 展开子字段区：子层列（子字段名 / 类型 / 默认值 / 删除）、「object / array 可继续嵌套」提示、
 *   【添加下一级子字段】、递归多层（L315-317）；删父级级联删后代（L320）；切基础类型收起并暂存草稿、切回恢复（L321）；
 * - 响应映射预设 content / source / score 行：不可删除、变量类型可改；【添加字段】新增自定义行（L331-332）。
 * 已知差异不在此断言：新建示例组缺 md L318 的 enabled(boolean) 子字段（审计 K37）。
 * Element 组件按仓内范式桩化（同 paramRowsEditor.test.js）。
 */

const SourceMappingEditor = (await import('@/components/admin/SourceMappingEditor.vue')).default
const { mkRequestMapRows, mkRequestMapExampleRows, mkResponseMapRows } = await import('@/utils/knowledgeBaseMeta')

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
async function mountEditor(props = {}, initialRequestRows = mkRequestMapRows()) {
  requestRows = ref(initialRequestRows)
  responseRows = ref(mkResponseMapRows())
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    setup() {
      return () =>
        h(SourceMappingEditor, {
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
const btnsByText = (root, text) => [...root.querySelectorAll('.el-button')].filter((b) => b.textContent.includes(text))
const setSelect = async (sel, value) => {
  sel.value = value
  sel.dispatchEvent(new Event('change'))
  await nextTick()
}

describe('SourceMappingEditor（2026-09-08 PRD-20260908 对齐）', () => {
  it('请求映射预设 query/topK：参数名固定、无删除入口；必填与映射客户端字段不可改（md §六.2 L313）', async () => {
    await mountEditor()
    const reqCard = cards()[0]
    const fixed = [...reqCard.querySelectorAll('.smp-fixed-name')].map((el) => el.textContent)
    expect(fixed).toEqual(['query', 'topK'])
    // 固定参数不可删除（md §六.2 L313）：预设行无 × 删除按钮
    expect(reqCard.querySelector('.smp-x')).toBeNull()
    // 必填勾选与映射客户端字段禁用（固定映射）
    const rowChecks = [...reqCard.querySelectorAll('.el-checkbox')]
    expect(rowChecks.every((c) => c.disabled)).toBe(true)
    expect(rowChecks[0].checked).toBe(true) // query 固定必填
    expect(rowChecks[1].checked).toBe(false) // topK 固定选填
    const clientSelects = [...reqCard.querySelectorAll('.smp-client')]
    expect(clientSelects.every((s) => s.disabled)).toBe(true)
    // 顶层表头：md §六.2 L305-311 五列（API 参数名 / 类型 / 必填 / 映射客户端字段 / 默认值）+ 操作列
    expect([...reqCard.querySelector('.smp-head').children].map((el) => el.textContent.trim())).toEqual([
      'API 参数名',
      '类型',
      '必填',
      '映射客户端字段',
      '默认值',
      ''
    ])
    expect(reqCard.textContent).toContain('object / array 字段可逐级展开添加子字段，子字段仍可继续嵌套；必填参数可配置系统默认值。')
  })

  it('【添加参数】新增自定义行（带 × 删除），删除后回到只剩预设行（md §六.2 L314）', async () => {
    await mountEditor()
    const reqCard = () => cards()[0]
    const addBtn = btnByText(reqCard(), '＋ 添加参数')
    addBtn.click()
    await nextTick()
    expect(requestRows.value.length).toBe(3)
    expect(requestRows.value[2].preset).toBe(false)
    const del = reqCard().querySelector('.smp-x')
    expect(del).toBeTruthy()
    del.click()
    await nextTick()
    expect(requestRows.value.length).toBe(2)
    expect(requestRows.value.every((r) => r.preset)).toBe(true)
  })

  it('object/array 展开子字段区：子层 4 列 + 层级提示 + 「＋ 添加下一级子字段」；递归三层（md §六.2）', async () => {
    await mountEditor()
    const reqCard = () => cards()[0]
    btnByText(reqCard(), '＋ 添加参数').click()
    await nextTick()
    // 顶层自定义行类型切 object → 展开子区、类型下拉带强调态
    const typeSel = reqCard().querySelector('.smp-type')
    await setSelect(typeSel, 'object')
    expect(requestRows.value[2].type).toBe('object')
    const sub = reqCard().querySelector('.smp-sub')
    expect(sub).toBeTruthy()
    expect(reqCard().querySelector('.smp-type.is-expanded')).toBeTruthy()
    expect(sub.textContent).toContain('下一级子字段')
    expect(sub.textContent).toContain('object / array 可继续嵌套')
    // 子层表头 4 列：子字段名 / 类型 / 默认值 / 删
    expect([...sub.querySelector('.smp-head').children].map((el) => el.textContent.trim())).toEqual(['子字段名', '类型', '默认值', ''])
    // 添加下一级子字段 → 子行无必填 / 映射列
    btnByText(sub, '＋ 添加下一级子字段').click()
    await nextTick()
    expect(requestRows.value[2].children.length).toBe(1)
    const subRow = reqCard().querySelector('.smp-sub .smp-row')
    expect(subRow.querySelector('.el-checkbox')).toBeNull()
    expect(subRow.querySelector('.smp-client')).toBeNull()
    expect(subRow.querySelector('.smp-x')).toBeTruthy()
    // 子字段再选 array → 第二级子区；再加一行 → 第三级可继续
    await setSelect(subRow.querySelector('.smp-type'), 'array')
    const sub2 = reqCard().querySelector('.smp-sub .smp-sub')
    expect(sub2).toBeTruthy()
    btnByText(sub2, '＋ 添加下一级子字段').click()
    await nextTick()
    expect(requestRows.value[2].children[0].children.length).toBe(1)
    await setSelect(reqCard().querySelector('.smp-sub .smp-sub .smp-type'), 'object')
    expect(reqCard().querySelector('.smp-sub .smp-sub .smp-sub')).toBeTruthy()
    expect(btnsByText(reqCard(), '＋ 添加下一级子字段').length).toBe(3)
  })

  it('新建示例组 filters→rules→field/value 渲染三级，filters 下与 rules 同级另有 enabled(boolean)（md §六.2 L316，K37）；删父级级联删后代；切基础类型收起并暂存、切回恢复', async () => {
    await mountEditor({}, [...mkRequestMapRows(), ...mkRequestMapExampleRows()])
    const reqCard = () => cards()[0]
    const names = [...reqCard().querySelectorAll('.smp-name')].map((el) => el.value)
    expect(names).toEqual(['filters', 'rules', 'field', 'value', 'enabled'])
    expect(reqCard().querySelectorAll('.smp-sub').length).toBe(2) // filters 子区 + rules 子区
    // enabled 与 rules 同级（都是 filters 的直接子字段）、类型 boolean、无子区
    expect(requestRows.value[2].children.map((c) => [c.name, c.type])).toEqual([['rules', 'array'], ['enabled', 'boolean']])
    // 示例组非预设、可删（md：示例字段不属于平台强制参数）
    expect(requestRows.value[2].preset).toBe(false)
    // filters 切 string → 子区收起但 children 草稿保留
    const filtersType = reqCard().querySelector('.smp-type')
    await setSelect(filtersType, 'string')
    expect(reqCard().querySelector('.smp-sub')).toBeNull()
    expect(reqCard().querySelector('.smp-type.is-expanded')).toBeNull()
    expect(requestRows.value[2].children.length).toBe(2)
    // 切回 object → 恢复
    await setSelect(reqCard().querySelector('.smp-type'), 'object')
    expect(reqCard().querySelectorAll('.smp-sub').length).toBe(2)
    expect([...reqCard().querySelectorAll('.smp-name')].map((el) => el.value)).toEqual(['filters', 'rules', 'field', 'value', 'enabled'])
    // 删 filters → 后代一并消失，只剩预设行
    reqCard().querySelector('.smp-x').click()
    await nextTick()
    expect(requestRows.value.length).toBe(2)
    expect(reqCard().querySelector('.smp-sub')).toBeNull()
  })

  it('响应映射预设 content/source/score：不可删除，变量类型可改（md §六.3）', async () => {
    await mountEditor()
    const respCard = cards()[1]
    const fixed = [...respCard.querySelectorAll('.sme-fixed-name')].map((el) => el.textContent)
    expect(fixed).toEqual(['content', 'source', 'score'])
    expect(respCard.querySelector('.sme-x')).toBeNull()
    // 类型下拉未禁用 → 可改
    const typeSelects = [...respCard.querySelectorAll('.sme-type')]
    expect(typeSelects.length).toBe(3)
    expect(typeSelects.every((s) => !s.disabled)).toBe(true)
    // 【添加字段】新增自定义行带 × 删除
    btnByText(respCard, '＋ 添加字段').click()
    await nextTick()
    expect(responseRows.value.length).toBe(4)
    expect(cards()[1].querySelector('.sme-x')).toBeTruthy()
    // 副注为 API 专用文案（MCP 分支已退役）
    expect(respCard.textContent).toContain('仅返回列表中配置的下游 API 原始字段')
    expect(container.textContent).not.toContain('MCP')
  })
})
