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
  // type / showPassword：2026-09-09 批次 3A · A4 的 secretValue 密码态由此透出供断言
  props: {
    modelValue: String,
    disabled: Boolean,
    placeholder: String,
    maxlength: [String, Number],
    type: { type: String, default: 'text' },
    showPassword: Boolean
  },
  emits: ['update:modelValue', 'input'],
  template:
    '<input class="el-input" :value="modelValue" :disabled="disabled" :placeholder="placeholder"' +
    ' :type="type" :data-show-password="showPassword ? \'1\' : \'0\'"' +
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
  // disabled：2026-09-09 · A11 待删除行把勾选框一并禁用，由此透出供断言
  props: { modelValue: Boolean, disabled: Boolean },
  emits: ['update:modelValue', 'change'],
  // 带默认插槽：clientFillLabel（原型 label.mcp-env-client 的「客户端填写」四字）走这里
  template:
    '<label class="el-checkbox-wrap"><input class="el-checkbox" type="checkbox" :checked="modelValue"' +
    ' :disabled="disabled"' +
    ' @change="$emit(\'update:modelValue\', $event.target.checked); $emit(\'change\', $event.target.checked)" />' +
    '<slot /></label>'
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

  /* ===== 2026-09-09 原型复刻批次 3A（M5 MCP Env 形态 / A4 API 鉴权形态） ===== */

  it('新增 prop 全部默认关闭：既有消费方形态不变（无空态、表头随行、添加在表底、无行卡片）', () => {
    const el = mountEditor({ rows: [] })
    expect(el.querySelector('.pr-empty')).toBeNull()
    expect(el.querySelector('.pr-row-head')).toBeNull()
    expect(el.querySelector('.pr-add button')).not.toBeNull()
    expect(el.querySelector('.pr-row.is-card')).toBeNull()
  })

  it('M5 MCP Env 形态：表头恒显 + 第三列「填写方式」+ 空态「暂无环境变量」+ 行卡片 + 添加不在表底', () => {
    const el = mountEditor({
      rows: [],
      keyHeader: '变量名',
      clientFillHeader: '填写方式',
      alwaysHead: true,
      cardRows: true,
      addPosition: 'header',
      emptyText: '暂无环境变量'
    })
    const head = el.querySelector('.pr-row-head')
    expect(head).not.toBeNull() // 无行也显表头（原型 .mcp-env-head）
    expect(head.textContent).toContain('变量名')
    expect(head.textContent).toContain('填写方式')
    expect(el.querySelector('.pr-empty').textContent).toContain('暂无环境变量')
    // 添加按钮交给宿主摆到 .mcp-env-title 右侧，组件自己不再在表底渲染
    expect(el.querySelector('.pr-add')).toBeNull()
  })

  it('M5 行卡片 + clientFillLabel：勾选框旁带「客户端填写」四字（原型 label.mcp-env-client）', () => {
    const el = mountEditor({
      rows: [row({ key: 'API_KEY' })],
      cardRows: true,
      clientFillLabel: '客户端填写'
    })
    const dataRow = el.querySelector('.pr-row:not(.pr-row-head)')
    expect(dataRow.classList.contains('is-card')).toBe(true)
    expect(el.querySelector('.pr-cf').textContent).toContain('客户端填写')
  })

  it('A4 API 鉴权形态：参数值密码态 + 客户端填写说明常显（不必先勾选）', () => {
    const el = mountEditor({
      rows: [row({ key: 'X-Api-Key', value: '' })],
      showIn: true,
      inOptions: [{ value: 'HEADER', label: 'Header' }],
      secretValue: true,
      clientFillHint: '客户端填写参数由客户端收集，平台不存值',
      clientFillHintAlways: true
    })
    // 没有任何客户端填写行，说明仍在（原型 .api-auth-add-note 常显）
    expect(el.querySelector('.pr-cf-hint').textContent).toContain('平台不存值')
    const valueInput = el.querySelectorAll('.pr-row:not(.pr-row-head) input.el-input')[2]
    expect(valueInput.getAttribute('type')).toBe('password')
  })

  it('A4 密码态遇「客户端填写」行回落明文（值本就由客户端收集、框已禁用，不必再打码）', () => {
    const el = mountEditor({ rows: [row({ key: 'k', clientFill: true })], secretValue: true })
    const valueInput = el.querySelectorAll('.pr-row:not(.pr-row-head) input.el-input')[2]
    expect(valueInput.getAttribute('type')).toBe('text')
    expect(valueInput.disabled).toBe(true)
  })

  /**
   * 2026-09-09 PRD 复核轮 · G4/A11（Q137「先采纳A（保留 改值+待删除+撤销）」）。
   * md prd-连接器-MCP.md §三.4.2 L283-286：已配置名称提供【改值】【删除】，删后显示「待删除」
   * 并提供【撤销】，未修改的内容保存后继续保留原值。
   * 隔离要求（清单第三节 G4 冲突①）：threeStep 不传时 API KEY 鉴权侧行为必须逐字不变。
   */
  describe('A11 三步式改值 / 删除（threeStep）', () => {
    const managed = (over = {}) => row({ key: 'API_KEY', configured: true, ...over })

    it('已配置行：平台值列不给输入框，只显示「已配置（不回显）」+【改值】', () => {
      const el = mountEditor({ rows: [managed()], threeStep: true })
      const dataRow = el.querySelector('.pr-row:not(.pr-row-head)')
      // 名称/描述两个输入框仍在，但没有第三个（平台值）输入框
      expect(dataRow.querySelectorAll('input.el-input').length).toBe(2)
      expect(dataRow.querySelector('.pr-configured').textContent).toContain('已配置（不回显）')
      expect(dataRow.textContent).toContain('改值')
    })

    it('点【改值】：就地展开输入框填新值，并给出【取消改值】', async () => {
      const r = reactive(managed())
      const el = mountEditor({ rows: [r], threeStep: true })
      const editBtn = [...el.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '改值')
      editBtn.click()
      await nextTick()
      expect(r.editingValue).toBe(true)
      const dataRow = el.querySelector('.pr-row:not(.pr-row-head)')
      expect(dataRow.querySelectorAll('input.el-input').length).toBe(3)
      expect(dataRow.textContent).toContain('取消改值')
    })

    it('【取消改值】：收起输入框并丢弃本次填的新值（回到「未修改」）', async () => {
      const r = reactive(managed({ editingValue: true, value: '半路填的' }))
      const el = mountEditor({ rows: [r], threeStep: true })
      const cancel = [...el.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '取消改值')
      cancel.click()
      await nextTick()
      expect(r.editingValue).toBe(false)
      expect(r.value).toBe('')
    })

    it('点【删除】：不出数组，置 pendingDelete、行标「待删除」并给【撤销】', async () => {
      const r = reactive(managed())
      const el = mountEditor({ rows: [r], threeStep: true })
      const del = [...el.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '删除')
      del.click()
      await nextTick()
      expect(r.pendingDelete).toBe(true)
      expect(emitted['update:rows']).toHaveLength(0) // 行仍在数组里
      const dataRow = el.querySelector('.pr-row:not(.pr-row-head)')
      expect(dataRow.classList.contains('is-pending-delete')).toBe(true)
      expect(dataRow.querySelector('.pr-pending-tag').textContent).toContain('待删除')
      expect(dataRow.textContent).toContain('撤销')
      expect(dataRow.textContent).not.toContain('改值')
    })

    it('点【撤销】：清 pendingDelete，行恢复原样', async () => {
      const r = reactive(managed({ pendingDelete: true }))
      const el = mountEditor({ rows: [r], threeStep: true })
      const undo = [...el.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '撤销')
      undo.click()
      await nextTick()
      expect(r.pendingDelete).toBe(false)
      expect(el.querySelector('.pr-pending-tag')).toBeNull()
    })

    it('新增行（configured=false）不走三步式：直接填值、直接移出数组', () => {
      const el = mountEditor({ rows: [row({ key: 'NEW' })], threeStep: true })
      const dataRow = el.querySelector('.pr-row:not(.pr-row-head)')
      expect(dataRow.querySelectorAll('input.el-input').length).toBe(3) // 平台值输入框直接在
      expect(dataRow.textContent).not.toContain('改值')
      ;[...el.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '删除').click()
      expect(emitted['update:rows'][0]).toEqual([]) // 直接从数组移除
    })

    it('隔离：不传 threeStep（API KEY 鉴权侧）时已配置行行为不变——平台值仍可直接编辑、删除即移除', () => {
      const el = mountEditor({ rows: [managed()] })
      const dataRow = el.querySelector('.pr-row:not(.pr-row-head)')
      expect(dataRow.querySelectorAll('input.el-input').length).toBe(3)
      expect(dataRow.textContent).not.toContain('改值')
      expect(dataRow.querySelector('.pr-configured')).toBeNull()
      ;[...el.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '删除').click()
      expect(emitted['update:rows'][0]).toEqual([])
    })

    it('待删除行：描述与「客户端填写」一并禁用（这行已经准备消失了）', () => {
      const el = mountEditor({ rows: [managed({ pendingDelete: true })], threeStep: true })
      const dataRow = el.querySelector('.pr-row:not(.pr-row-head)')
      const descInput = dataRow.querySelectorAll('input.el-input')[1]
      expect(descInput.disabled).toBe(true)
      expect(dataRow.querySelector('.pr-cf input[type="checkbox"]').disabled).toBe(true)
    })
  })
})
