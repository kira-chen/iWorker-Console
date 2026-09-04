// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, provide, inject } from 'vue'

/**
 * 岗位「业务系统」页签面板单测（2026-09-04 PRD-20260903 对齐新增，md 三.8）：
 * 仅列已发布且被引用的行 / Picker 排除已引用 / 确认引用回吐 ids + toast /
 * 移除引用二次确认后回吐 / 只读态隐藏添加与移除。
 */

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('@element-plus/icons-vue', () => ({ Search: {} }))

const ElMessage = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() })
const ElMessageBox = { confirm: vi.fn(), alert: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage, ElMessageBox }))

// 连接器业务系统行（bizSystemMock 形状）：已发布 ×2 + 未发布 ×1
const BIZ_ROWS = [
  { id: 'biz_1', name: '客户管理系统 CRM', description: '管理客户资料', icon: '◎', status: 'PUBLISHED' },
  { id: 'biz_2', name: '人力资源系统', description: '员工管理', icon: '▦', status: 'PUBLISHED' },
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
  push.mockReset()
  listBizSystems.mockReset().mockResolvedValue({ list: BIZ_ROWS, total: BIZ_ROWS.length })
  ElMessageBox.confirm.mockReset().mockResolvedValue()
  ElMessage.success.mockReset(); ElMessage.warning.mockReset()
})
afterEach(() => { app?.unmount(); container?.remove() })

const btnByText = (root, text) => [...root.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)

describe('PositionBizSystemsPane · 业务系统页签（md 三.8）', () => {
  it('仅展示已发布且被当前岗位引用的业务系统行', async () => {
    const { container: c } = await mount()
    const rows = [...c.querySelectorAll('.el-row')]
    expect(rows.length).toBe(1)
    expect(rows[0].textContent).toContain('客户管理系统 CRM')
    expect(c.textContent).not.toContain('合同管理系统') // 未发布不出现在任何列表
  })

  it('Picker 仅列出已发布且未被引用的系统；确认引用回吐 ids + toast「业务系统已引用」', async () => {
    const { container: c, emitted } = await mount()
    btnByText(c, '添加业务系统').click()
    await nextTick()
    const dialog = c.querySelector('.el-dialog')
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

  it('移除引用：二次确认后回吐移除后的 ids', async () => {
    const { container: c, emitted } = await mount()
    btnByText(c, '移除').click()
    await Promise.resolve(); await Promise.resolve(); await nextTick()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '移除后本岗位不再引用「客户管理系统 CRM」，业务系统本身不会被删除。确认移除？',
      '移除业务系统引用',
      expect.objectContaining({ confirmButtonText: '移除' })
    )
    expect(emitted[0]).toEqual([])
  })

  it('点系统名称 → 跳连接器业务系统详情（AdminConnector?tab=bizsystem&view=<id>）', async () => {
    const { container: c } = await mount()
    btnByText(c, '客户管理系统 CRM').click()
    await nextTick()
    expect(push).toHaveBeenCalledWith({ name: 'AdminConnector', query: { tab: 'bizsystem', view: 'biz_1' } })
  })

  it('只读态：隐藏【添加业务系统】与移除操作', async () => {
    const { container: c } = await mount({ readonly: true })
    expect(btnByText(c, '添加业务系统')).toBeUndefined()
    expect(btnByText(c, '移除')).toBeUndefined()
  })
})
