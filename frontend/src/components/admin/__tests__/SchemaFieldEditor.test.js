// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * N10：入参/出参「字段行编辑器」支持任意层级嵌套。
 * 验证：
 *  - 顶层「添加字段」emit 新行；
 *  - 类型切「对象 object」→ 展开缩进子字段区（递归本组件），并给该行补空 children；
 *  - 子字段区「添加子字段」→ emit 的行携带 children；
 *  - 切离 object 时移除 children，不残留脏数据。
 */

// EP 存根：把类型下拉暴露成可直接设值的 select，按钮按文案可点。
const stubs = {
  'el-input': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<input class="el-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  'el-select': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    // 暴露 data-role=type-select + change 事件供测试直接设值
    template:
      '<select class="el-select" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>'
  },
  'el-option': {
    props: ['label', 'value'],
    template: '<option :value="value">{{ label }}</option>'
  },
  'el-checkbox': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<input type="checkbox" class="el-checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />'
  },
  'el-button': {
    props: ['type', 'link'],
    emits: ['click'],
    template: '<button class="el-button" @click="$emit(\'click\')"><slot /></button>'
  },
  'el-icon': { template: '<i><slot /></i>' },
  Delete: { template: '<i />' },
  // 删除二次确认（PRD §5）存根：渲染 reference 插槽 + 一个可直接点的确认按钮
  'el-popconfirm': {
    props: ['title'],
    emits: ['confirm'],
    template:
      '<span class="el-popconfirm"><slot name="reference" /><button class="pc-confirm" @click="$emit(\'confirm\')" /></span>'
  }
}

let app, container
async function mountEditor(initialRows) {
  const { default: Editor } = await import('@/components/admin/SchemaFieldEditor.vue')
  container = document.createElement('div')
  document.body.appendChild(container)
  const rows = ref(initialRows)
  app = createApp({
    render: () =>
      h(Editor, {
        rows: rows.value,
        'onUpdate:rows': (next) => {
          rows.value = next
        }
      })
  })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.mount(container)
  await nextTick()
  return { container, getRows: () => rows.value, setRows: (r) => (rows.value = r) }
}

function findBtn(el, text) {
  return [...el.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)
}
// 剥离仅前端用的 _uid（稳定 key），只对业务字段做等值断言；同时校验 _uid 已分配（数字）。
function stripUid(rows) {
  return (rows || []).map((r) => {
    expect(typeof r._uid).toBe('number')
    // eslint-disable-next-line no-unused-vars
    const { _uid, children, ...rest } = r
    return children ? { ...rest, children: stripUid(children) } : rest
  })
}

beforeEach(() => {})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('N10 · SchemaFieldEditor 多级嵌套', () => {
  it('顶层「添加字段」emit 新的空字符串行（含稳定 _uid）', async () => {
    const { container, getRows } = await mountEditor([])
    findBtn(container, '+ 添加字段').click()
    await nextTick()
    expect(stripUid(getRows())).toEqual([
      { name: '', type: 'string', required: false, description: '' }
    ])
  })

  it('类型切 object → 补空 children 并展开缩进子字段区', async () => {
    const { container, getRows } = await mountEditor([
      { name: 'user', type: 'string', required: false, description: '' }
    ])
    const typeSelect = container.querySelector('.el-select')
    typeSelect.value = 'object'
    typeSelect.dispatchEvent(new Event('change'))
    await nextTick()
    expect(getRows()[0].type).toBe('object')
    expect(getRows()[0].children).toEqual([])
    // 顶层行仍带稳定 _uid
    expect(typeof getRows()[0]._uid).toBe('number')
    // 展开了子字段区（左强调条容器）
    expect(container.querySelector('.sfe-children')).toBeTruthy()
    // 子字段区有「添加子字段」按钮
    expect(findBtn(container, '+ 添加子字段')).toBeTruthy()
  })

  it('子字段区添加子字段 → emit 的行携带 children', async () => {
    const { container, getRows } = await mountEditor([
      { name: 'user', type: 'object', required: false, description: '', children: [] }
    ])
    findBtn(container, '+ 添加子字段').click()
    await nextTick()
    expect(stripUid(getRows())[0].children).toEqual([
      { name: '', type: 'string', required: false, description: '' }
    ])
  })

  it('object 切回标量类型 → 移除 children，不残留脏数据', async () => {
    const { container, getRows } = await mountEditor([
      {
        name: 'user',
        type: 'object',
        required: false,
        description: '',
        children: [{ name: 'id', type: 'number', required: false, description: '' }]
      }
    ])
    const typeSelect = container.querySelector('.el-select')
    typeSelect.value = 'string'
    typeSelect.dispatchEvent(new Event('change'))
    await nextTick()
    expect(getRows()[0].type).toBe('string')
    expect('children' in getRows()[0]).toBe(false)
    // 子字段区随之消失
    expect(container.querySelector('.sfe-children')).toBeNull()
  })

  it('inbound rows 缺 _uid → 就地补齐并回写父级（含 object 子字段递归补）', async () => {
    const { getRows } = await mountEditor([
      { name: 'a', type: 'string', required: false, description: '' },
      {
        name: 'b',
        type: 'object',
        required: false,
        description: '',
        children: [{ name: 'c', type: 'number', required: false, description: '' }]
      }
    ])
    await nextTick()
    const rows = getRows()
    expect(typeof rows[0]._uid).toBe('number')
    expect(typeof rows[1]._uid).toBe('number')
    expect(typeof rows[1].children[0]._uid).toBe('number')
    // 顶层两行 _uid 各不相同（稳定唯一 key）
    expect(rows[0]._uid).not.toBe(rows[1]._uid)
  })

  it('删中间行 → 剩余行 _uid 不变（键稳定，删行不串位）', async () => {
    const { container, getRows } = await mountEditor([
      { name: 'a', type: 'string', required: false, description: '' },
      { name: 'b', type: 'string', required: false, description: '' },
      { name: 'c', type: 'string', required: false, description: '' }
    ])
    await nextTick()
    const before = getRows().map((r) => r._uid)
    // 删中间行（第 2 行 b）：删除按钮包在 popconfirm 里，直接触发确认（二次确认见 PRD §5）
    const rowEls = container.querySelectorAll('.sfe-row')
    rowEls[1].querySelector('.pc-confirm').click()
    await nextTick()
    const after = getRows()
    expect(after.map((r) => r.name)).toEqual(['a', 'c'])
    // 保留行 a、c 的 _uid 与删前一致（未因索引复用而串位）
    expect(after[0]._uid).toBe(before[0])
    expect(after[1]._uid).toBe(before[2])
  })
})
