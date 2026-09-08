// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, provide, inject } from 'vue'

/**
 * 岗位「业务系统」页签面板单测（md §8；2026-09-08 PRD-20260908 对齐重写：布局 / 控件名 / 文案照原型 L4330–4372）：
 * 列 业务系统(图标+名称+描述)/登录地址/业务页/最近更新时间/操作 仅【查看】/ 仅列已发布且被引用的行 /
 * 【＋ 新业务系统】→「引用业务系统」弹窗排除已引用、【确认引用】回吐 ids + toast /
 * 【查看】只读打开业务系统抽屉 / 不再有移除与名称跳转 / 只读态隐藏【＋ 新业务系统】。
 */

vi.mock('@element-plus/icons-vue', () => ({ Search: {} }))
// 只读查看抽屉桩（真组件 import 链触达 request → router）：记录 visible / bizId / readonly
vi.mock('@/components/admin/BizSystemEditor.vue', () => ({
  default: {
    name: 'BizSystemEditor',
    props: { visible: Boolean, bizId: [String, Number], readonly: Boolean },
    template: '<div class="biz-viewer" :data-visible="String(visible)" :data-id="bizId" :data-readonly="String(readonly)" />'
  }
}))

const ElMessage = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() })
const ElMessageBox = { confirm: vi.fn(), alert: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage, ElMessageBox }))

// 连接器业务系统行（bizSystemMock 形状）：已发布 ×2 + 未发布 ×1
const BIZ_ROWS = [
  { id: 'biz_1', name: '客户管理系统 CRM', description: '管理客户资料', icon: '◎', status: 'PUBLISHED', loginUrl: 'https://crm.example.com/login', bizPages: [{ url: 'a' }, { url: 'b' }], updatedAt: '2026-08-24T15:40:00+08:00' },
  { id: 'biz_2', name: '人力资源系统', description: '员工管理', icon: '▦', status: 'PUBLISHED', loginUrl: 'https://hr.example.com/login', bizPages: [], updatedAt: '2026-08-24T11:32:00+08:00' },
  { id: 'biz_3', name: '合同管理系统', description: '合同起草', icon: '↗', status: 'NOT_PUBLISHED' }
]
const listBizSystems = vi.fn()
vi.mock('@/api/admin', () => ({ listBizSystems: (...a) => listBizSystems(...a) }))

const PositionBizSystemsPane = (await import('@/components/position/PositionBizSystemsPane.vue')).default

/* el-table 行级桩（同 adminPositionsOps.test 范式） */
const ROW_KEY = Symbol('row')
const tableStub = {
  name: 'el-table',
  props: { data: { type: Array, default: () => [] }, emptyText: { type: String, default: '' } },
  setup(props, { slots }) {
    return () =>
      h('div', { class: 'el-table', 'data-empty-text': props.emptyText },
        props.data.length
          ? props.data.map((row, i) => h(RowCells, { row, colSlot: slots.default, key: i }))
          : [h('div', { class: 'el-table-empty' }, props.emptyText)])
  }
}
const RowCells = {
  props: { row: { type: Object, required: true }, colSlot: { type: Function, required: true } },
  setup(props) {
    provide(ROW_KEY, props.row)
    return () => h('div', { class: 'el-row' }, props.colSlot?.())
  }
}
const tableColStub = {
  name: 'el-table-column',
  props: { label: { type: String, default: '' } },
  setup(props, { slots }) {
    const row = inject(ROW_KEY, null)
    return () => h('div', { class: 'el-table-column' }, [row ? slots.default?.({ row }) : null])
  }
}
const passthrough = (tag) => ({ name: tag, template: `<div class="${tag}"><slot /></div>` })
const dialogStub = { name: 'el-dialog', props: ['modelValue'], template: '<div v-if="modelValue" class="el-dialog"><slot /><slot name="footer" /></div>' }
const btnStub = { props: ['disabled'], emits: ['click'], template: '<button class="el-button" :disabled="disabled" @click="!disabled && $emit(\'click\')"><slot /></button>' }

let app, container
async function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  const emitted = []
  app = createApp({
    render: () => h(PositionBizSystemsPane, { businessSystemIds: ['biz_1'], readonly: false, 'onUpdate:businessSystemIds': (v) => emitted.push(v), ...props })
  })
  app.component('el-table', tableStub)
  app.component('el-table-column', tableColStub)
  app.component('el-dialog', dialogStub)
  app.component('el-button', btnStub)
  for (const t of ['el-input', 'el-icon', 'el-tag']) app.component(t, passthrough(t))
  app.directive('loading', {})
  app.mount(container)
  await nextTick(); await Promise.resolve(); await Promise.resolve(); await nextTick()
  return { container, emitted }
}
beforeEach(() => {
  listBizSystems.mockReset().mockResolvedValue({ list: BIZ_ROWS, total: BIZ_ROWS.length })
  ElMessageBox.confirm.mockReset().mockResolvedValue()
  ElMessage.success.mockReset(); ElMessage.warning.mockReset()
})
afterEach(() => { app?.unmount(); container?.remove() })

const btnByText = (root, text) => [...root.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)

describe('PositionBizSystemsPane · 业务系统页签（md §8 · 2026-09-08 PRD-20260908 对齐）', () => {
  it('仅展示已发布且被当前岗位引用的行；列含 名称+描述 / 登录地址 / 业务页数 / 最近更新时间 / 仅【查看】', async () => {
    const { container: c } = await mount()
    const rows = [...c.querySelectorAll('.el-row')]
    expect(rows.length).toBe(1)
    expect(rows[0].textContent).toContain('客户管理系统 CRM')
    expect(rows[0].textContent).toContain('管理客户资料')
    expect(rows[0].textContent).toContain('https://crm.example.com/login')
    expect(rows[0].textContent).toContain('2') // 业务页数量
    expect(rows[0].textContent).toContain('2026-08-24')
    expect(c.textContent).not.toContain('合同管理系统') // 未发布不出现在任何列表
    // 区块头 / 表头文案照原型
    expect(c.textContent).toContain('该岗位已引用的业务系统')
    expect(btnByText(rows[0], '查看')).toBeTruthy()
    expect(btnByText(rows[0], '移除')).toBeUndefined() // md §8.2 不支持移除引用
  })

  it('【＋ 新业务系统】→「引用业务系统」弹窗仅列已发布且未被引用的系统；【确认引用】回吐 ids + toast「业务系统已引用」', async () => {
    const { container: c, emitted } = await mount()
    btnByText(c, '＋ 新业务系统').click()
    await nextTick()
    const dialog = c.querySelector('.el-dialog')
    expect(dialog.textContent).toContain('仅展示连接器中已发布、且当前岗位尚未引用的业务系统。')
    expect(dialog.textContent).toContain('人力资源系统')
    expect(dialog.textContent).not.toContain('客户管理系统 CRM') // 已引用不再列出
    expect(dialog.textContent).not.toContain('合同管理系统') // 未发布不列出
    // 未选直接确认 → 提示至少选 1 个
    btnByText(dialog, '确认引用').click()
    await nextTick()
    expect(ElMessage.warning).toHaveBeenCalledWith('请选择至少 1 个业务系统')
    // 勾选后确认 → 回吐追加 ids
    const cb = dialog.querySelector('input[type="checkbox"]')
    cb.dispatchEvent(new Event('change'))
    await nextTick()
    btnByText(dialog, '确认引用').click()
    await nextTick()
    expect(emitted[0]).toEqual(['biz_1', 'biz_2'])
    expect(ElMessage.success).toHaveBeenCalledWith('业务系统已引用')
  })

  it('【查看】→ 以只读打开业务系统抽屉（原型 openBizEditor(\'edit\', item, true)），名称不再跳转', async () => {
    const { container: c, emitted } = await mount()
    const viewer = c.querySelector('.biz-viewer')
    expect(viewer.getAttribute('data-visible')).toBe('false')
    expect(btnByText(c, '客户管理系统 CRM')).toBeUndefined() // 名称是文本不是按钮
    btnByText(c, '查看').click()
    await nextTick()
    expect(viewer.getAttribute('data-visible')).toBe('true')
    expect(viewer.getAttribute('data-id')).toBe('biz_1')
    expect(viewer.getAttribute('data-readonly')).toBe('true')
    expect(emitted.length).toBe(0) // 查看不改引用
  })

  it('只读态：隐藏【＋ 新业务系统】，【查看】仍可用', async () => {
    const { container: c } = await mount({ readonly: true })
    expect(btnByText(c, '＋ 新业务系统')).toBeUndefined()
    expect(btnByText(c, '查看')).toBeTruthy()
  })
})
