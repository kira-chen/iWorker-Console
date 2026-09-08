// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, provide, inject, nextTick } from 'vue'

/**
 * AdminRoles.vue（角色与权限列表）—— 2026-09-08 原型复刻批次 2A（G#10/#12）回归：
 *  - 列宽照原型 colgroup 185 / 110 / auto / 165 / 135，用户数量左对齐（无 align=center），角色名 .rl-name 600；
 *  - 删除分流走统一确认框：有绑定 → alertDialog「无法删除角色」（文案照 md §3.3）；无绑定 → confirmDialog danger【删除】→ toast「角色已删除」。
 */
vi.mock('@element-plus/icons-vue', () => ({ Search: {} }))
const listRoles = vi.fn()
const getPermissionTree = vi.fn()
const deleteRole = vi.fn()
vi.mock('@/api/adminUser', () => ({
  listRoles: (...a) => listRoles(...a),
  getPermissionTree: (...a) => getPermissionTree(...a),
  deleteRole: (...a) => deleteRole(...a)
}))
const ElMessage = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() })
vi.mock('element-plus', () => ({ ElMessage, ElMessageBox: { confirm: vi.fn(), alert: vi.fn() } }))
const confirmDialog = vi.fn()
const alertDialog = vi.fn()
vi.mock('@/composables/useConfirm', () => ({ confirmDialog: (...a) => confirmDialog(...a), alertDialog: (...a) => alertDialog(...a) }))
vi.mock('@/components/PageHeader.vue', () => ({ default: { template: '<div class="page-header" />' } }))
vi.mock('@/components/admin/ListStates.vue', () => ({ default: { template: '<div class="list-states"><slot /></div>' } }))
vi.mock('@/components/admin/ListPagination.vue', () => ({ default: { template: '<div class="list-pager" />' } }))
vi.mock('@/components/admin/RoleEditor.vue', () => ({ default: { template: '<div class="role-editor" />' } }))

const AdminRoles = (await import('@/views/admin/AdminRoles.vue')).default

const ROW_KEY = Symbol('row')
const tableStub = {
  name: 'el-table',
  props: { data: { type: Array, default: () => [] } },
  setup(props, { slots }) {
    return () => h('div', { class: 'el-table' }, [
      h('div', { class: 'el-head' }, slots.default?.()),
      ...props.data.map((row, i) => h(RowCells, { row, colSlot: slots.default, key: i }))
    ])
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
  props: { label: { type: String, default: '' }, width: { default: undefined }, minWidth: { default: undefined }, align: { type: String, default: '' } },
  setup(props, { slots }) {
    const row = inject(ROW_KEY, null)
    return () =>
      h('div', { class: 'el-table-column', 'data-label': props.label, 'data-width': props.width, 'data-min': props.minWidth, 'data-align': props.align }, [
        row ? slots.default?.({ row }) : null
      ])
  }
}
const passthrough = (tag) => ({ name: tag, template: `<div class="${tag}"><slot /></div>` })
const elButton = { props: ['disabled'], emits: ['click'], template: '<button class="el-button" @click="$emit(\'click\')"><slot /></button>' }

const ROWS = [
  { id: 301, name: '系统管理员', modules: ['岗位'], userCount: 2, updatedAt: '2026-08-24T15:02:00+08:00' },
  { id: 305, name: '审计观察员', modules: [], userCount: 0, updatedAt: '2026-08-20T14:08:00+08:00' }
]

let app, container
const flush = async () => { for (let i = 0; i < 4; i++) { await Promise.resolve(); await nextTick() } }
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(AdminRoles)
  for (const t of ['el-input', 'el-icon']) app.component(t, passthrough(t))
  app.component('el-table', tableStub)
  app.component('el-table-column', tableColStub)
  app.component('el-button', elButton)
  app.directive('loading', {})
  app.mount(container)
  await flush()
  return container
}
const inst = () => app._instance

beforeEach(() => {
  listRoles.mockReset().mockResolvedValue({ list: ROWS, total: ROWS.length })
  getPermissionTree.mockReset().mockResolvedValue([{ scope: '管理端', groups: [{ name: '02 岗位', pages: ['岗位'] }] }])
  deleteRole.mockReset().mockResolvedValue({})
  confirmDialog.mockReset().mockResolvedValue(true)
  alertDialog.mockReset().mockResolvedValue()
  ElMessage.success.mockReset()
})
afterEach(() => { app?.unmount(); container?.remove() })

describe('AdminRoles · 列宽与对齐（原型 L315 colgroup）', () => {
  it('角色名称 185 / 用户数量 110 左对齐 / 页面权限 min 360 / 时间 165；角色名 .rl-name', async () => {
    await mount()
    const cols = [...container.querySelectorAll('.el-head .el-table-column')]
    const byLabel = (l) => cols.find((c) => c.dataset.label === l)
    expect(byLabel('角色名称').dataset.width).toBe('185')
    expect(byLabel('用户数量').dataset.width).toBe('110')
    expect(byLabel('用户数量').dataset.align).toBe('')
    expect(byLabel('页面权限').dataset.min).toBe('360')
    expect(byLabel('最近更新时间').dataset.width).toBe('165')
    expect(container.querySelector('.el-row .rl-name').textContent).toBe('系统管理员')
  })
})

describe('AdminRoles · 删除分流（md §3.3 文案，统一确认框）', () => {
  it('有绑定用户 → alertDialog「无法删除角色」，不删', async () => {
    await mount()
    await inst().setupState.remove(ROWS[0])
    expect(alertDialog).toHaveBeenCalledWith(
      '角色「系统管理员」仍绑定 2 个用户。请先在用户页完成角色改绑。',
      '无法删除角色',
      { confirmText: '知道了' }
    )
    expect(confirmDialog).not.toHaveBeenCalled()
    expect(deleteRole).not.toHaveBeenCalled()
  })

  it('无绑定 → confirmDialog danger【删除】→ deleteRole + toast「角色已删除」；取消不删', async () => {
    await mount()
    await inst().setupState.remove(ROWS[1])
    expect(confirmDialog).toHaveBeenCalledWith(
      '删除后角色「审计观察员」及其页面权限将不可恢复。确认删除？',
      '删除角色',
      { confirmText: '删除', danger: true }
    )
    expect(deleteRole).toHaveBeenCalledWith(305)
    expect(ElMessage.success).toHaveBeenCalledWith('角色已删除')
    confirmDialog.mockResolvedValue(false)
    await inst().setupState.remove(ROWS[1])
    expect(deleteRole).toHaveBeenCalledTimes(1)
  })
})
