// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

/**
 * SchemaFieldEditor.vue 单测——API 请求参数 / 响应字段的「字段行编辑器」，任意层级嵌套。
 * 对齐 docs/PRD/数字员工管理端PRD/03能力/连接器/API/prd-API.md §三.5 L157-170（2026-09-12 测试审计 T31 头注更新）：
 *  - 【＋ 添加字段】新增一级字段（L161）；类型选「对象 / 数组」出【＋子字段】、切回非对象/数组清空子字段（L163）；
 *  - 子字段是同表缩进行（父行后紧跟），删除按 path 定位不串位；行 key 走稳定 _uid；
 *  - 未配置时「暂无字段，可不配置（留空表示不约束）」（L157）；删除前二次确认、删父字段连带全部子字段（L169）；
 *  - request 形态多「请求方法」「默认值」两列，字段类型默认「文本」（L162 / L165 / L167）；response 形态同样有「必填」列（L166）；
 *  - 列头 / 列序逐字照 L161「字段名、字段类型、请求方法、是否必填、默认值、字段说明」（2026-09-12 J15-4）；
 *  - 查看态（readonly）隐藏【＋ 添加字段】【＋子字段】与删除入口，字段层级仍完整展示（L170，2026-09-12 K38）。
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
  // 删除二次确认（md §三.5 L169）存根：渲染 reference 插槽 + 一个可直接点的确认按钮；title 露成 data-title 供断言确认文案
  'el-popconfirm': {
    props: ['title'],
    emits: ['confirm'],
    template:
      '<span class="el-popconfirm" :data-title="title"><slot name="reference" /><button class="pc-confirm" @click="$emit(\'confirm\')" /></span>'
  }
}

let app, container
async function mountEditor(initialRows, extraProps = {}) {
  const { default: Editor } = await import('@/components/admin/SchemaFieldEditor.vue')
  container = document.createElement('div')
  document.body.appendChild(container)
  const rows = ref(initialRows)
  app = createApp({
    render: () =>
      h(Editor, {
        ...extraProps,
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

afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('SchemaFieldEditor · 多级嵌套（md §三.5 L161-164）', () => {
  it('顶层「＋ 添加字段」emit 新的空字符串行（含稳定 _uid）', async () => {
    const { container, getRows } = await mountEditor([])
    findBtn(container, '＋ 添加字段').click()
    await nextTick()
    expect(stripUid(getRows())).toEqual([
      { name: '', type: 'string', required: false, description: '' }
    ])
  })

  it('类型切 object → 补空 children，行操作区出现【＋子字段】（A5 扁平形态）', async () => {
    const { container, getRows } = await mountEditor([
      { name: 'user', type: 'string', required: false, description: '' }
    ])
    // 标量行没有【＋子字段】
    expect(findBtn(container, '＋子字段')).toBeFalsy()
    const typeSelect = container.querySelector('.el-select')
    typeSelect.value = 'object'
    typeSelect.dispatchEvent(new Event('change'))
    await nextTick()
    expect(getRows()[0].type).toBe('object')
    expect(getRows()[0].children).toEqual([])
    // 顶层行仍带稳定 _uid
    expect(typeof getRows()[0]._uid).toBe('number')
    // 对象行的操作区多出【＋子字段】（原型 L899 `.api-schema-child`）
    expect(findBtn(container, '＋子字段')).toBeTruthy()
    // 不再有独立子字段块
    expect(container.querySelector('.sfe-children')).toBeNull()
  })

  it('行内【＋子字段】→ emit 的行携带 children，且子行以缩进行渲染在父行之后', async () => {
    const { container, getRows } = await mountEditor([
      { name: 'user', type: 'object', required: false, description: '', children: [] }
    ])
    findBtn(container, '＋子字段').click()
    await nextTick()
    expect(stripUid(getRows())[0].children).toEqual([
      { name: '', type: 'string', required: false, description: '' }
    ])
    // 同一张表里两行：父行 + 缩进子行（表头不计）
    const rowEls = container.querySelectorAll('.sfe-row')
    expect(rowEls.length).toBe(2)
    expect(rowEls[0].classList.contains('is-child')).toBe(false)
    expect(rowEls[1].classList.contains('is-child')).toBe(true)
  })

  it('object 切回标量类型 → 移除 children，子行与【＋子字段】一并消失', async () => {
    const { container, getRows } = await mountEditor([
      {
        name: 'user',
        type: 'object',
        required: false,
        description: '',
        children: [{ name: 'id', type: 'number', required: false, description: '' }]
      }
    ])
    // 切换前：父行 + 子行两行
    expect(container.querySelectorAll('.sfe-row').length).toBe(2)
    const typeSelect = container.querySelector('.el-select')
    typeSelect.value = 'string'
    typeSelect.dispatchEvent(new Event('change'))
    await nextTick()
    expect(getRows()[0].type).toBe('string')
    expect('children' in getRows()[0]).toBe(false)
    expect(container.querySelectorAll('.sfe-row').length).toBe(1)
    expect(findBtn(container, '＋子字段')).toBeFalsy()
  })

  it('删除子字段行 → 只删该子行，父行与兄弟子行不动（按 path 定位，不串位）', async () => {
    const { container, getRows } = await mountEditor([
      {
        name: 'user',
        type: 'object',
        required: false,
        description: '',
        children: [
          { name: 'id', type: 'number', required: false, description: '' },
          { name: 'nick', type: 'string', required: false, description: '' }
        ]
      }
    ])
    await nextTick()
    // 扁平后的三行：user / id / nick —— 删第二个子行 nick
    const rowEls = container.querySelectorAll('.sfe-row')
    expect(rowEls.length).toBe(3)
    rowEls[2].querySelector('.pc-confirm').click()
    await nextTick()
    const rows = getRows()
    expect(rows[0].name).toBe('user')
    expect(rows[0].children.map((c) => c.name)).toEqual(['id'])
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
    // 删中间行（第 2 行 b）：删除按钮包在 popconfirm 里，直接触发确认（二次确认见 md §三.5 L169）
    const rowEls = container.querySelectorAll('.sfe-row')
    rowEls[1].querySelector('.pc-confirm').click()
    await nextTick()
    const after = getRows()
    expect(after.map((r) => r.name)).toEqual(['a', 'c'])
    // 保留行 a、c 的 _uid 与删前一致（未因索引复用而串位）
    expect(after[0]._uid).toBe(before[0])
    expect(after[1]._uid).toBe(before[2])
  })

  /**
   * 响应字段的「是否必填」列（md §三.5 L166「勾选后表示运行时必须提供**或返回**该字段」——「返回」即响应侧；
   * 2026-09-09 PRD 复核轮 · A16/Q117 补出）。数据层本就恒带 required，改造前只是 response 形态把该列藏了。
   */
  describe('响应字段必填列（md §三.5 L166）', () => {
    it('response（默认形态）表头出「必填」，行内有必填复选框', async () => {
      const { container } = await mountEditor([
        { name: 'code', type: 'string', required: false, description: '' }
      ])
      expect(container.querySelector('.sfe-head').textContent).toContain('必填')
      expect(container.querySelector('.sfe-row .el-checkbox')).toBeTruthy()
    })

    it('勾选响应字段必填 → 回吐 required=true', async () => {
      const { container, getRows } = await mountEditor([
        { name: 'code', type: 'string', required: false, description: '' }
      ])
      const cb = container.querySelector('.sfe-row .el-checkbox')
      cb.checked = true
      cb.dispatchEvent(new Event('change'))
      await nextTick()
      expect(getRows()[0].required).toBe(true)
    })

    it('response 形态列头 / 列序「字段名、字段类型、是否必填、字段说明」（md L161 去掉 request 专属的「请求方法」「默认值」两列；J15-4）', async () => {
      const { container } = await mountEditor([
        { name: 'code', type: 'string', required: false, description: '' }
      ])
      const heads = [...container.querySelector('.sfe-head').children].map((c) => c.textContent.trim()).filter(Boolean)
      expect(heads).toEqual(['字段名', '字段类型', '是否必填', '字段说明'])
      // 行内控件顺序与列头一致：字段名输入 → 类型下拉 → 必填框 → 字段说明输入
      const row = container.querySelector('.sfe-row')
      expect([...row.children].map((c) => c.className.split(' ')[0])).toEqual(['el-input', 'el-select', 'el-checkbox', 'el-input', 'sfe-row-actions'])
      expect(row.querySelectorAll('input.el-input')[1].placeholder).toBe('字段说明')
    })
  })

  describe('查看态（md §三.5 L170，K38 2026-09-12）', () => {
    it('readonly：字段层级完整展示（父行 + 缩进子行），但不出【＋ 添加字段】【＋子字段】与删除按钮；表头无操作列', async () => {
      const { container } = await mountEditor(
        [{ name: 'user', type: 'object', required: true, description: '用户', children: [{ name: 'id', type: 'string', required: false, description: '' }] }],
        { readonly: true }
      )
      const rows = container.querySelectorAll('.sfe-row')
      expect(rows.length).toBe(2)
      expect(rows[1].classList.contains('is-child')).toBe(true)
      expect(findBtn(container, '＋ 添加字段')).toBeFalsy()
      expect(findBtn(container, '＋子字段')).toBeFalsy()
      expect(container.querySelector('.el-popconfirm')).toBeNull()
      expect(container.querySelector('.sfe-row-actions')).toBeNull()
      expect(container.querySelector('.sfe-head .col-op')).toBeNull()
      expect(container.querySelector('.sfe-head').classList.contains('is-readonly')).toBe(true)
      // 非只读对照：入口都在
      app.unmount(); container.remove()
      const rw = await mountEditor([{ name: 'user', type: 'object', required: true, description: '', children: [] }])
      expect(findBtn(rw.container, '＋ 添加字段')).toBeTruthy()
      expect(findBtn(rw.container, '＋子字段')).toBeTruthy()
      expect(rw.container.querySelector('.el-popconfirm')).toBeTruthy()
    })
  })
  /* ===== 2026-09-12 测试审计 T58（A28）：空态 / 删父级联确认 / request 形态列 ===== */

  describe('空态与删除确认（md §三.5 L157 / L169）', () => {
    it('没有任何字段行 → 「暂无字段，可不配置（留空表示不约束）」，表头不出，【＋ 添加字段】仍在', async () => {
      const { container } = await mountEditor([])
      expect(container.querySelector('.sfe-empty').textContent.trim()).toBe('暂无字段，可不配置（留空表示不约束）')
      expect(container.querySelector('.sfe-head')).toBeNull()
      expect(findBtn(container, '＋ 添加字段')).toBeTruthy()
      // 加一行后空态消失、表头出现
      findBtn(container, '＋ 添加字段').click()
      await nextTick()
      expect(container.querySelector('.sfe-empty')).toBeNull()
      expect(container.querySelector('.sfe-head')).toBeTruthy()
    })

    it('删父字段：确认文案「删除该字段将同时删除其全部子字段，确认删除？」，确认后父行与两个子行一并消失；无子字段行确认文案「确认删除该字段？」', async () => {
      const { container, getRows } = await mountEditor([
        {
          name: 'user',
          type: 'object',
          required: false,
          description: '',
          children: [
            { name: 'id', type: 'number', required: false, description: '' },
            { name: 'nick', type: 'string', required: false, description: '' }
          ]
        },
        { name: 'plain', type: 'string', required: false, description: '' }
      ])
      await nextTick()
      const rowEls = container.querySelectorAll('.sfe-row')
      expect(rowEls.length).toBe(4)
      expect(rowEls[0].querySelector('.el-popconfirm').dataset.title).toBe('删除该字段将同时删除其全部子字段，确认删除？')
      expect(rowEls[3].querySelector('.el-popconfirm').dataset.title).toBe('确认删除该字段？')
      rowEls[0].querySelector('.pc-confirm').click()
      await nextTick()
      expect(getRows().map((r) => r.name)).toEqual(['plain'])
      expect(container.querySelectorAll('.sfe-row').length).toBe(1)
      expect(container.textContent).not.toContain('nick')
    })
  })

  describe('request 形态（md §三.5 L162 / L165 / L167）', () => {
    it('表头列序「字段名、字段类型、请求方法、是否必填、默认值、字段说明」（md L161 逐字，J15-4）；新增行类型默认「文本」、请求方法默认 Query、默认值为空', async () => {
      const { container, getRows } = await mountEditor([], { variant: 'request' })
      findBtn(container, '＋ 添加字段').click()
      await nextTick()
      const heads = [...container.querySelector('.sfe-head').children].map((c) => c.textContent.trim()).filter(Boolean)
      expect(heads).toEqual(['字段名', '字段类型', '请求方法', '是否必填', '默认值', '字段说明'])
      const row = getRows()[0]
      expect(row.type).toBe('string')
      expect(row.in).toBe('QUERY')
      expect(row.defaultValue).toBe('')
      // 行内类型下拉选中项显示为「文本 string」；请求方法下拉选中 Query
      const selects = container.querySelectorAll('.sfe-row select.el-select')
      expect(selects[0].selectedOptions[0].textContent).toBe('文本 string')
      expect(selects[1].value).toBe('QUERY')
      expect([...selects[1].options].map((o) => o.textContent)).toEqual(['Query', 'Header', 'Body', 'Path'])
      // 默认值输入框在（占位「默认值（可选）」）
      expect(container.querySelector('.sfe-row input[placeholder="默认值（可选）"]')).toBeTruthy()
    })

    it('改请求方法为 Body、填默认值 → 回吐 in=BODY / defaultValue；子字段行同样带请求方法列', async () => {
      const { container, getRows } = await mountEditor(
        [{ name: 'p', type: 'object', required: false, description: '', in: 'QUERY', defaultValue: '', children: [] }],
        { variant: 'request' }
      )
      const inSel = container.querySelectorAll('.sfe-row select.el-select')[1]
      inSel.value = 'BODY'
      inSel.dispatchEvent(new Event('change'))
      await nextTick()
      expect(getRows()[0].in).toBe('BODY')
      const dv = container.querySelector('.sfe-row input[placeholder="默认值（可选）"]')
      dv.value = '{}'
      dv.dispatchEvent(new Event('input'))
      await nextTick()
      expect(getRows()[0].defaultValue).toBe('{}')
      findBtn(container, '＋子字段').click()
      await nextTick()
      const childRow = container.querySelectorAll('.sfe-row')[1]
      expect(childRow.classList.contains('is-child')).toBe(true)
      expect(childRow.querySelectorAll('select.el-select').length).toBe(2)
      expect(getRows()[0].children[0].in).toBe('QUERY')
    })
  })
})
