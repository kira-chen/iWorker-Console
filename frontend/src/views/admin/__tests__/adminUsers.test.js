// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, provide, inject, nextTick } from 'vue'

/**
 * AdminUsers.vue（用户列表页）—— 2026-09-08 原型复刻批次 2A（G#1/#3/#4/#7）回归：
 *  - 工具栏：搜索占位「搜索用户名、显示名或邮箱」+【查询】（回第 1 页）+【＋ 新建用户】；
 *  - 两种空态：无筛选「还没有用户 · 点「＋ 新建用户」创建第一个」（md）/ 有筛选「没有符合条件的用户」（原型）；
 *  - 表格：用户名 .users-name 加粗、角色灰标签（StatusTag type=info）、状态「圆点 + 文字」.users-status；
 *  - 列头排序 → 回第 1 页（list.search）；
 *  - 删除 / 重置密码走统一 confirmDialog（440 无图标），删除文案照 md §二.2.6、toast「用户已删除」。
 */
vi.mock('@element-plus/icons-vue', () => ({ Plus: {}, Search: {}, ArrowDown: {} }))
const listUsers = vi.fn()
const deleteUser = vi.fn()
const resetUserPassword = vi.fn()
const listRoles = vi.fn()
vi.mock('@/api/adminUser', () => ({
  listUsers: (...a) => listUsers(...a),
  deleteUser: (...a) => deleteUser(...a),
  resetUserPassword: (...a) => resetUserPassword(...a),
  listRoles: (...a) => listRoles(...a)
}))
const ElMessage = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() })
vi.mock('element-plus', () => ({ ElMessage, ElMessageBox: { confirm: vi.fn(), alert: vi.fn() } }))
const confirmDialog = vi.fn()
vi.mock('@/composables/useConfirm', () => ({ confirmDialog: (...a) => confirmDialog(...a), alertDialog: vi.fn() }))
vi.mock('@/assets/connector.css', () => ({}))
vi.mock('@/components/PageHeader.vue', () => ({ default: { template: '<div class="page-header" />' } }))
vi.mock('@/components/StatusTag.vue', () => ({ default: { props: ['type'], template: '<span class="status-tag" :data-type="type"><slot /></span>' } }))
vi.mock('@/components/admin/ListStates.vue', () => ({
  default: { props: ['empty', 'emptyText'], template: '<div class="list-states" :data-empty="empty" :data-empty-text="emptyText"><slot /></div>' }
}))
vi.mock('@/components/admin/ListPagination.vue', () => ({ default: { template: '<div class="list-pager" />' } }))
vi.mock('@/components/admin/UserEditor.vue', () => ({ default: { template: '<div class="user-editor" />' } }))
vi.mock('@/components/admin/UserRoleDialog.vue', () => ({ default: { template: '<div class="user-role-dialog" />' } }))

const AdminUsers = (await import('@/views/admin/AdminUsers.vue')).default

const ROW_KEY = Symbol('row')
const tableStub = {
  name: 'el-table',
  props: { data: { type: Array, default: () => [] } },
  emits: ['sort-change'],
  setup(props, { slots, emit, expose }) {
    expose({ sort: (o) => emit('sort-change', o) })
    return () =>
      h('div', { class: 'el-table' }, props.data.map((row, i) => h(RowCells, { row, colSlot: slots.default, key: i })))
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
  props: { label: { type: String, default: '' }, prop: { type: String, default: '' } },
  setup(props, { slots }) {
    const row = inject(ROW_KEY, null)
    return () => h('div', { class: 'el-table-column', 'data-label': props.label }, [row ? (slots.default ? slots.default({ row }) : row[props.prop]) : null])
  }
}
const passthrough = (tag) => ({ name: tag, template: `<div class="${tag}"><slot /></div>` })
const elInput = {
  name: 'el-input',
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue'],
  template: '<input class="el-input" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
}
const elButton = { props: ['disabled'], emits: ['click'], template: '<button class="el-button" @click="$emit(\'click\')"><slot /></button>' }
const elDropdown = {
  name: 'el-dropdown',
  emits: ['command'],
  template: '<div class="el-dropdown"><slot /><div class="dd"><slot name="dropdown" /></div></div>',
  provide() { return { cmd: (c) => this.$emit('command', c) } }
}
const elDropdownItem = { name: 'el-dropdown-item', props: ['command'], inject: ['cmd'], template: '<button class="dd-item" @click="cmd(command)"><slot /></button>' }

const ROWS = [
  { id: 1, username: 'chenyu', displayName: '陈宇', email: 'c@x.com', roles: ['普通用户', 'FDE 工程师'], status: 'active', lastLogin: '2026-08-23T17:46:00+08:00' },
  { id: 2, username: 'zhouming', displayName: '周明', email: '', roles: ['普通用户'], status: 'disabled', lastLogin: null }
]

let app, container
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(AdminUsers)
  for (const t of ['el-select', 'el-option', 'el-icon', 'el-dropdown-menu']) app.component(t, passthrough(t))
  app.component('el-input', elInput)
  app.component('el-table', tableStub)
  app.component('el-table-column', tableColStub)
  app.component('el-button', elButton)
  app.component('el-dropdown', elDropdown)
  app.component('el-dropdown-item', elDropdownItem)
  app.directive('loading', {})
  app.mount(container)
  await flush()
  return container
}
const flush = async () => { for (let i = 0; i < 4; i++) { await Promise.resolve(); await nextTick() } }
const inst = () => app._instance
const rowByName = (name) => [...container.querySelectorAll('.el-row')].find((r) => r.textContent.includes(name))
const toolbarBtn = (text) => [...container.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)

beforeEach(() => {
  listUsers.mockReset().mockResolvedValue({ list: ROWS, total: ROWS.length })
  listRoles.mockReset().mockResolvedValue([{ code: '普通用户', name: '普通用户' }, { code: 'FDE 工程师', name: 'FDE 工程师' }])
  deleteUser.mockReset().mockResolvedValue({})
  resetUserPassword.mockReset().mockResolvedValue({})
  confirmDialog.mockReset().mockResolvedValue(true)
  ElMessage.success.mockReset(); ElMessage.error.mockReset()
})
afterEach(() => { app?.unmount(); container?.remove() })

describe('AdminUsers · 工具栏与表格形态（原型 renderUsers L238）', () => {
  it('搜索占位 + 【查询】回第 1 页 + 【＋ 新建用户】', async () => {
    await mount()
    expect(container.querySelector('.el-input').placeholder).toBe('搜索用户名、显示名或邮箱')
    expect(toolbarBtn('＋ 新建用户')).toBeTruthy()
    inst().setupState.page = 3
    toolbarBtn('查询').click(); await flush()
    expect(inst().setupState.page).toBe(1)
    expect(listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }))
  })

  it('用户名加粗 .users-name；角色灰标签（info）；状态圆点 + 文字（停用带 is-disabled）；从未登录显「从未登录」', async () => {
    await mount()
    const r1 = rowByName('chenyu')
    expect(r1.querySelector('.users-name').textContent).toBe('chenyu')
    const tags = [...r1.querySelectorAll('.users-role-tags .status-tag')]
    expect(tags.map((t) => t.dataset.type)).toEqual(['info', 'info'])
    expect(tags.map((t) => t.textContent.trim())).toEqual(['普通用户', 'FDE 工程师'])
    expect(r1.querySelector('.users-status').textContent.trim()).toBe('启用')
    expect(r1.querySelector('.users-status').className).not.toContain('is-disabled')
    const r2 = rowByName('zhouming')
    expect(r2.querySelector('.users-status').className).toContain('is-disabled')
    expect(r2.textContent).toContain('从未登录')
  })

  it('列头排序切换 → 回第 1 页重查（原型 user-sort 置 userPage=1）', async () => {
    await mount()
    inst().setupState.page = 2
    // 直接调页面的 onSortChange（el-table stub 不模拟表头点击）
    inst().setupState.onSortChange({ prop: 'lastLogin', order: 'ascending' })
    await flush()
    expect(inst().setupState.page).toBe(1)
    expect(listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, sort: 'asc' }))
  })
})

describe('AdminUsers · 两种空态', () => {
  it('无筛选无数据 → md 引导文案；有筛选无结果 → 原型「没有符合条件的用户」', async () => {
    listUsers.mockResolvedValue({ list: [], total: 0 })
    await mount()
    const states = () => container.querySelector('.list-states')
    expect(states().dataset.emptyText).toBe('还没有用户 · 点「＋ 新建用户」创建第一个')
    inst().setupState.query.keyword = 'zzz'
    await flush()
    expect(states().dataset.emptyText).toBe('没有符合条件的用户')
    inst().setupState.query.keyword = ''
    inst().setupState.query.status = 'disabled'
    await flush()
    expect(states().dataset.emptyText).toBe('没有符合条件的用户')
  })
})

describe('AdminUsers · 删除 / 重置密码（统一确认框）', () => {
  it('删除：confirmDialog 文案照 md §二.2.6 + danger；确认 → deleteUser + toast「用户已删除」；取消不删', async () => {
    await mount()
    await inst().setupState.remove(ROWS[0])
    expect(confirmDialog).toHaveBeenCalledWith(
      '删除「陈宇」后，其角色、登录会话、个人文档、任务、记忆及凭证将被永久删除，且无法恢复。',
      '删除用户',
      { confirmText: '删除', danger: true }
    )
    expect(deleteUser).toHaveBeenCalledWith(1)
    expect(ElMessage.success).toHaveBeenCalledWith('用户已删除')
    confirmDialog.mockResolvedValue(false)
    await inst().setupState.remove(ROWS[1])
    expect(deleteUser).toHaveBeenCalledTimes(1)
  })

  it('重置密码：确认键「重置密码」→ resetUserPassword + toast', async () => {
    await mount()
    await inst().setupState.resetPassword(ROWS[1])
    expect(confirmDialog.mock.calls[0][1]).toBe('重置密码')
    expect(confirmDialog.mock.calls[0][2]).toEqual({ confirmText: '重置密码' })
    expect(resetUserPassword).toHaveBeenCalledWith(2)
    expect(ElMessage.success).toHaveBeenCalledWith('密码已重置为 wemate123')
  })
})
