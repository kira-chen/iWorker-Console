// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, render, nextTick } from 'vue'
import { makeElTableStubs } from './helpers/elTableStub'
import { COL, COL_NOWRAP } from '@/utils/tableLayout'

/**
 * AdminUsers.vue（用户列表页）—— 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/06组织/用户/prd-用户.md
 * §一（导航栏）/ §二（用户列表：列表展示、操作、分页）（历史出处：2026-09-08 原型复刻批次 2A G#1/#3/#4/#7）。
 *
 * 覆盖：
 *  - §一.1 工具栏：搜索占位「搜索用户名、显示名或邮箱」+【查询】（回第 1 页）+【＋ 新建用户】；
 *  - §一.2 输入搜索 300ms 防抖回第 1 页；角色 / 状态筛选切换立即重查回第 1 页；
 *  - §一.3 / §二.4 两种空态：无筛选「还没有用户 · 点「＋ 新建用户」创建第一个」/ 有筛选「没有符合条件的用户」；
 *  - §二.1 表格：用户名 .users-name 加粗、角色灰标签（StatusTag type=info）、状态「圆点 + 文字」、从未登录显「从未登录」、
 *    最近登录时间列头按钮切换升降序并回第 1 页（真实入口 .time-sort，箭头 ↓/↑）；
 *  - §二.2.1 / §二.2.4【更多】菜单：重置密码在上、删除用户在分隔线下危险样式 + title「删除前需二次确认」、
 *    点项进入确认流程、展开箭头 ▾/▴ 翻转、进行期间不可重复点击；
 *  - §二.2.5 / §二.2.6 重置密码 / 删除：统一 confirmDialog 文案（显示名为空用用户名）、成功 toast、失败文案。
 *
 * 全桩化（el-table / el-dropdown 等为本地桩），真实 Element Plus 挂载见 adminUsersSmoke.test.js。
 */
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

// 表格桩渲染 header 插槽：最近登录时间列的排序按钮（真实入口）才能被点到
const { tableStub, tableColStub } = makeElTableStubs({ renderHeader: true })
const passthrough = (tag) => ({ name: tag, template: `<div class="${tag}"><slot /></div>` })
const elInput = {
  name: 'el-input',
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue'],
  template: '<input class="el-input" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
}
// el-select 桩：原生 <select>，改值同时 emit update:modelValue + change（页面 @change="reload"）
const elSelect = {
  name: 'el-select',
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue', 'change'],
  template:
    '<select class="el-select" :data-placeholder="placeholder" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\', $event.target.value)"><slot /></select>'
}
const elOption = { name: 'el-option', props: ['label', 'value'], template: '<option :value="value">{{ label }}</option>' }
const elButton = { props: ['disabled'], emits: ['click'], template: '<button class="el-button" @click="$emit(\'click\')"><slot /></button>' }
// el-dropdown 桩：.dd-toggle 模拟菜单展开 / 收起（emit visible-change），菜单项透出 command/divided/title/disabled
const elDropdown = {
  name: 'el-dropdown',
  emits: ['command', 'visible-change'],
  data: () => ({ open: false }),
  template:
    '<div class="el-dropdown"><slot /><button class="dd-toggle" @click="open = !open; $emit(\'visible-change\', open)" /><div class="dd"><slot name="dropdown" /></div></div>',
  provide() {
    return { cmd: (c) => this.$emit('command', c) }
  }
}
const elDropdownItem = {
  name: 'el-dropdown-item',
  // divided 是无值布尔属性（<el-dropdown-item divided>），须声明 Boolean 才会被转成 true
  props: { command: String, divided: Boolean, title: String, disabled: Boolean },
  inject: ['cmd'],
  template: '<button class="dd-item" :data-divided="divided ? \'1\' : null" :title="title" :disabled="disabled" @click="cmd(command)"><slot /></button>'
}
// 「更多」箭头图标（main.js 全局注册 @element-plus/icons-vue；这里用可断言的桩）
const ArrowDown = { template: '<i class="ico-down" />' }
const ArrowUp = { template: '<i class="ico-up" />' }

const ROWS = [
  { id: 1, username: 'chenyu', displayName: '陈宇', email: 'c@x.com', roles: ['普通用户', 'FDE 工程师'], status: 'active', lastLogin: '2026-08-23T17:46:00+08:00' },
  { id: 2, username: 'zhouming', displayName: '周明', email: '', roles: ['普通用户'], status: 'disabled', lastLogin: null },
  // 显示名为空 → 确认文案用用户名（md §二.2.5 L95 / §二.2.6 L106）
  { id: 3, username: 'noname', displayName: '', email: '', roles: [], status: 'active', lastLogin: null }
]

let app, container
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(AdminUsers)
  for (const t of ['el-icon', 'el-dropdown-menu']) app.component(t, passthrough(t))
  app.component('el-input', elInput)
  app.component('el-select', elSelect)
  app.component('el-option', elOption)
  app.component('el-table', tableStub)
  app.component('el-table-column', tableColStub)
  app.component('el-button', elButton)
  app.component('el-dropdown', elDropdown)
  app.component('el-dropdown-item', elDropdownItem)
  app.component('ArrowDown', ArrowDown)
  app.component('ArrowUp', ArrowUp)
  app.component('Search', { template: '<i class="ico-search" />' })
  app.directive('loading', {})
  app.mount(container)
  await flush()
  return container
}
const flush = async () => { for (let i = 0; i < 4; i++) { await Promise.resolve(); await nextTick() } }
const inst = () => app._instance
const rowByName = (name) => [...container.querySelectorAll('.el-row')].find((r) => r.textContent.includes(name))
const toolbarBtn = (text) => [...container.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)
const menuItems = (row) => [...row.querySelectorAll('.dd-item')]
const menuItem = (row, text) => menuItems(row).find((b) => b.textContent.trim() === text)
/** 把 confirmDialog 收到的正文（字符串或 VNode）渲染成纯文本，断言用户可见文案 */
function confirmBodyText(call) {
  const body = call[0]
  if (typeof body === 'string') return body
  const host = document.createElement('div')
  render(body, host)
  const text = host.textContent
  render(null, host)
  return text
}

beforeEach(() => {
  listUsers.mockReset().mockResolvedValue({ list: ROWS, total: ROWS.length })
  listRoles.mockReset().mockResolvedValue([{ code: '普通用户', name: '普通用户' }, { code: 'FDE 工程师', name: 'FDE 工程师' }])
  deleteUser.mockReset().mockResolvedValue({})
  resetUserPassword.mockReset().mockResolvedValue({})
  confirmDialog.mockReset().mockResolvedValue(true)
  ElMessage.success.mockReset(); ElMessage.error.mockReset()
})
afterEach(() => { vi.useRealTimers(); app?.unmount(); container?.remove() })

describe('AdminUsers · 工具栏与表格形态（md §一.1 / §二.1）', () => {
  it('搜索占位「搜索用户名、显示名或邮箱」+【查询】回第 1 页 +【＋ 新建用户】（md §一.1 L11/L14/L15）', async () => {
    await mount()
    expect(container.querySelector('.el-input').placeholder).toBe('搜索用户名、显示名或邮箱')
    expect(toolbarBtn('＋ 新建用户')).toBeTruthy()
    inst().setupState.page = 3
    toolbarBtn('查询').click(); await flush()
    expect(inst().setupState.page).toBe(1)
    expect(listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }))
  })

  it('角色筛选默认「全部用户分类」、状态筛选默认「全部状态」，选项「启用 / 停用」（md §一.1 L12-13）', async () => {
    await mount()
    const selects = [...container.querySelectorAll('select.el-select')]
    expect(selects.map((s) => s.dataset.placeholder)).toEqual(['全部用户分类', '全部状态'])
    expect([...selects[1].options].map((o) => o.textContent)).toEqual(['启用', '停用'])
    // 角色选项 = listRoles 返回的角色名
    expect([...selects[0].options].map((o) => o.textContent)).toEqual(['普通用户', 'FDE 工程师'])
  })

  it('用户名加粗 .users-name；角色灰标签（info）；状态圆点 + 文字（停用带 is-disabled）；从未登录显「从未登录」（md §二.1 L44-49）', async () => {
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
    // 邮箱未填 / 无角色 → 「—」（md §二.1 L46-47）
    const r3 = rowByName('noname')
    expect(r3.querySelector('[data-label="邮箱"]').textContent.trim()).toBe('—')
    expect(r3.querySelector('[data-label="角色"] .users-muted').textContent).toBe('—')
  })

  it('点最近登录时间列头按钮 → 倒序↓ 切正序↑ 并回第 1 页重查；再点切回倒序（md §二.1 L49）', async () => {
    await mount()
    const sortBtn = () => container.querySelector('.el-head .time-sort')
    expect(sortBtn().textContent.replace(/\s+/g, '')).toBe('最近登录时间↓')
    expect(listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'desc' }))
    inst().setupState.page = 2
    sortBtn().click(); await flush()
    expect(inst().setupState.page).toBe(1)
    expect(listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, sort: 'asc' }))
    expect(sortBtn().querySelector('.time-sort-arrow').textContent).toBe('↑')
    sortBtn().click(); await flush()
    expect(listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, sort: 'desc' }))
    expect(sortBtn().querySelector('.time-sort-arrow').textContent).toBe('↓')
  })

  it('最近登录时间列宽取共享 COL.TIME 并挂 col-nowrap（审计 K16：不再硬编码 165，与全站时间列同源同值）', async () => {
    await mount()
    const timeCol = container.querySelector('.el-head .time-sort').closest('.el-table-column')
    expect(timeCol.dataset.width).toBe(String(COL.TIME))
    expect(timeCol.getAttribute('class-name')).toBe(COL_NOWRAP)
    expect(timeCol.getAttribute('label-class-name')).toBe(COL_NOWRAP)
  })
})

describe('AdminUsers · 搜索防抖与筛选联动（md §一.2 L20-21）', () => {
  it('输入搜索内容 → 300ms 后才自动刷新并回第 1 页；299ms 内不查', async () => {
    await mount()
    vi.useFakeTimers()
    listUsers.mockClear()
    inst().setupState.page = 3
    const input = container.querySelector('.el-input')
    input.value = 'zhou'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    vi.advanceTimersByTime(299)
    expect(listUsers).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await flush()
    expect(listUsers).toHaveBeenCalledTimes(1)
    expect(listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'zhou', page: 1 }))
    expect(inst().setupState.page).toBe(1)
  })

  it('连续输入只在停顿 300ms 后查一次（防抖合并）', async () => {
    await mount()
    vi.useFakeTimers()
    listUsers.mockClear()
    const input = container.querySelector('.el-input')
    for (const v of ['z', 'zh', 'zho']) {
      input.value = v
      input.dispatchEvent(new Event('input'))
      await nextTick()
      vi.advanceTimersByTime(200)
    }
    expect(listUsers).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    await flush()
    expect(listUsers).toHaveBeenCalledTimes(1)
    expect(listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'zho' }))
  })

  it('切换状态筛选 → 立即按当前条件重查并回第 1 页（不等防抖）', async () => {
    await mount()
    listUsers.mockClear()
    inst().setupState.page = 2
    const statusSelect = [...container.querySelectorAll('select.el-select')][1]
    statusSelect.value = 'disabled'
    statusSelect.dispatchEvent(new Event('change'))
    await flush()
    expect(listUsers).toHaveBeenCalledTimes(1)
    expect(listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'disabled', page: 1 }))
    expect(inst().setupState.page).toBe(1)
  })

  it('切换角色筛选 → 立即重查回第 1 页；清空后不再下发 roleCode', async () => {
    await mount()
    listUsers.mockClear()
    inst().setupState.page = 2
    const roleSelect = [...container.querySelectorAll('select.el-select')][0]
    roleSelect.value = 'FDE 工程师'
    roleSelect.dispatchEvent(new Event('change'))
    await flush()
    expect(listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ roleCode: 'FDE 工程师', page: 1 }))
    roleSelect.value = ''
    roleSelect.dispatchEvent(new Event('change'))
    await flush()
    expect(listUsers).toHaveBeenCalledTimes(2)
    expect(listUsers.mock.calls[1][0]).not.toHaveProperty('roleCode')
  })
})

describe('AdminUsers · 两种空态（md §一.3 L30-31 / §二.4 L125-126）', () => {
  it('无筛选无数据 → 「还没有用户 · 点「＋ 新建用户」创建第一个」；有搜索或筛选无结果 → 「没有符合条件的用户」', async () => {
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

describe('AdminUsers · 【更多】菜单（md §二.2.1 L58-64 / §二.2.4 L87-90）', () => {
  it('每行固定【编辑】【设置角色】【更多】；菜单内重置密码在上、删除用户在分隔线下、危险样式 + title「删除前需二次确认」', async () => {
    await mount()
    const row = rowByName('chenyu')
    const ops = [...row.querySelectorAll('.users-actions > .el-button, .users-actions .users-more-btn')].map((b) => b.textContent.trim())
    expect(ops).toEqual(['编辑', '设置角色', '更多'])
    const items = menuItems(row)
    expect(items.map((b) => b.textContent.trim())).toEqual(['重置密码', '删除用户'])
    expect(items[0].dataset.divided).toBeUndefined()
    expect(items[1].dataset.divided).toBe('1')
    expect(items[1].className).toContain('users-more-del')
    expect(items[1].title).toBe('删除前需二次确认')
    expect(items[0].title).toBe('')
  })

  it('展开箭头：收起 ▾（ArrowDown）/ 展开 ▴（ArrowUp），只翻当前行', async () => {
    await mount()
    const r1 = rowByName('chenyu')
    const r2 = rowByName('zhouming')
    expect(r1.querySelector('.users-more-btn .ico-down')).toBeTruthy()
    expect(r1.querySelector('.users-more-btn .ico-up')).toBeNull()
    r1.querySelector('.dd-toggle').click(); await nextTick()
    expect(r1.querySelector('.users-more-btn .ico-up')).toBeTruthy()
    expect(r1.querySelector('.users-more-btn .ico-down')).toBeNull()
    expect(r2.querySelector('.users-more-btn .ico-down')).toBeTruthy()
    r1.querySelector('.dd-toggle').click(); await nextTick()
    expect(r1.querySelector('.users-more-btn .ico-down')).toBeTruthy()
  })

  it('点菜单项进入对应确认流程：「重置密码」→ 标题「重置密码」；「删除用户」→ 标题「删除用户」', async () => {
    await mount()
    const row = rowByName('chenyu')
    menuItem(row, '重置密码').click(); await flush()
    expect(confirmDialog).toHaveBeenCalledTimes(1)
    expect(confirmDialog.mock.calls[0][1]).toBe('重置密码')
    menuItem(row, '删除用户').click(); await flush()
    expect(confirmDialog).toHaveBeenCalledTimes(2)
    expect(confirmDialog.mock.calls[1][1]).toBe('删除用户')
  })

  it('重置密码进行期间 → 当前行「重置密码」不可点，其他行不受影响；完成后恢复（md §二.2.1 L63）', async () => {
    let finish
    resetUserPassword.mockReturnValue(new Promise((r) => { finish = r }))
    await mount()
    const r1 = rowByName('chenyu')
    const r2 = rowByName('zhouming')
    menuItem(r1, '重置密码').click(); await flush()
    expect(menuItem(r1, '重置密码').disabled).toBe(true)
    expect(menuItem(r1, '删除用户').disabled).toBe(false)
    expect(menuItem(r2, '重置密码').disabled).toBe(false)
    // 进行期间再点无效（disabled 按钮不触发 click）
    menuItem(r1, '重置密码').click(); await flush()
    expect(resetUserPassword).toHaveBeenCalledTimes(1)
    finish({}); await flush()
    expect(menuItem(r1, '重置密码').disabled).toBe(false)
  })

  it('删除进行期间 → 当前行「删除用户」不可点；完成后恢复（md §二.2.1 L64）', async () => {
    let finish
    deleteUser.mockReturnValue(new Promise((r) => { finish = r }))
    await mount()
    const r1 = rowByName('chenyu')
    menuItem(r1, '删除用户').click(); await flush()
    expect(menuItem(r1, '删除用户').disabled).toBe(true)
    expect(rowByName('zhouming').querySelector('.dd-item[title]').disabled).toBe(false)
    menuItem(r1, '删除用户').click(); await flush()
    expect(deleteUser).toHaveBeenCalledTimes(1)
    finish({}); await flush()
    expect(menuItem(r1, '删除用户').disabled).toBe(false)
  })
})

describe('AdminUsers · 删除（md §二.2.6 L105-111）', () => {
  it('确认框文案照 md + danger【删除】；确认 → deleteUser + toast「用户已删除」并刷新；取消不删也不提示', async () => {
    await mount()
    listUsers.mockClear()
    await inst().setupState.remove(ROWS[0])
    expect(confirmDialog).toHaveBeenCalledWith(
      '删除「陈宇」后，其角色、登录会话、个人文档、任务、记忆及凭证将被永久删除，且无法恢复。',
      '删除用户',
      { confirmText: '删除', danger: true }
    )
    expect(deleteUser).toHaveBeenCalledWith(1)
    expect(ElMessage.success).toHaveBeenCalledWith('用户已删除')
    expect(listUsers).toHaveBeenCalledTimes(1)
    confirmDialog.mockResolvedValue(false)
    await inst().setupState.remove(ROWS[1])
    expect(deleteUser).toHaveBeenCalledTimes(1)
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  it('显示名为空 → 确认文案用用户名（L106）', async () => {
    await mount()
    await inst().setupState.remove(ROWS[2])
    expect(confirmBodyText(confirmDialog.mock.calls[0])).toContain('删除「noname」后')
  })

  it('删除失败：有具体原因显原因；无原因显「删除失败」（L111）', async () => {
    await mount()
    deleteUser.mockRejectedValueOnce(new Error('不能删除最后一个系统管理员'))
    await inst().setupState.remove(ROWS[0])
    expect(ElMessage.error).toHaveBeenLastCalledWith('不能删除最后一个系统管理员')
    deleteUser.mockRejectedValueOnce({})
    await inst().setupState.remove(ROWS[0])
    expect(ElMessage.error).toHaveBeenLastCalledWith('删除失败')
    expect(ElMessage.success).not.toHaveBeenCalled()
  })
})

describe('AdminUsers · 重置密码（md §二.2.5 L94-99）', () => {
  it('确认框标题「重置密码」、正文「确认将「周明」的密码重置为默认密码？」+ 默认密码 wemate123、确认键【重置密码】；成功 toast「密码已重置为 wemate123」', async () => {
    await mount()
    await inst().setupState.resetPassword(ROWS[1])
    const call = confirmDialog.mock.calls[0]
    expect(call[1]).toBe('重置密码')
    expect(call[2]).toEqual({ confirmText: '重置密码' })
    const body = confirmBodyText(call)
    expect(body).toContain('确认将「周明」的密码重置为默认密码？')
    expect(body).toContain('默认密码：wemate123')
    expect(resetUserPassword).toHaveBeenCalledWith(2)
    expect(ElMessage.success).toHaveBeenCalledWith('密码已重置为 wemate123')
  })

  it('显示名为空 → 正文用用户名（L95）；取消 → 不重置、不提示失败（L97）', async () => {
    await mount()
    confirmDialog.mockResolvedValue(false)
    await inst().setupState.resetPassword(ROWS[2])
    expect(confirmBodyText(confirmDialog.mock.calls[0])).toContain('确认将「noname」的密码重置为默认密码？')
    expect(resetUserPassword).not.toHaveBeenCalled()
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  it('重置失败：有具体原因显原因；无原因显「重置失败」（L99）', async () => {
    await mount()
    resetUserPassword.mockRejectedValueOnce(new Error('用户不存在'))
    await inst().setupState.resetPassword(ROWS[0])
    expect(ElMessage.error).toHaveBeenLastCalledWith('用户不存在')
    resetUserPassword.mockRejectedValueOnce({})
    await inst().setupState.resetPassword(ROWS[0])
    expect(ElMessage.error).toHaveBeenLastCalledWith('重置失败')
    expect(ElMessage.success).not.toHaveBeenCalled()
  })
})
