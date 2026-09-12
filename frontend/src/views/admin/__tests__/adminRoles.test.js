// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { makeElTableStubs } from './helpers/elTableStub'
import { COL, COL_NOWRAP } from '@/utils/tableLayout'

/**
 * AdminRoles.vue（角色与权限列表）—— 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/06组织/角色/prd.角色.md
 * §一（导航栏）/ §二（角色列表）（历史出处：2026-09-08 原型复刻批次 2A G#10/#12）。
 *
 * 覆盖：
 *  - §一.2 搜索仅在点【查询】或回车后生效，输入不实时过滤；清空后【查询】展示全部；
 *  - §一.3 权限树加载失败 → 列表仍可看，页面权限列统一「未开通任何页面」；
 *  - §二.1 列序与主列：角色名称 .rl-name、「N 个用户」、页面权限聚合「√ 用户端」/「√ 管理端（页面、页面…）」/「未开通任何页面」、
 *    最近更新时间列头排序按钮；
 *  - §二.3.3 / §二.4 删除分流：有绑定 → alertDialog「无法删除角色」；无绑定 → confirmDialog danger【删除】→ toast「角色已删除」；
 *    失败显具体原因或「删除失败」；进行中【删除】loading。
 *
 * el-table-column / RowCells 用公共桩（helpers/elTableStub.js），el-table 本地按 row.id 作 key（原因见下）；
 * 真实 Element Plus 挂载见 adminRolesSmoke.test.js。
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

// 渲染 header 插槽：最近更新时间列的排序按钮在表头里。
// el-table 桩本地覆盖：公共桩按下标 key 行组件，行数据重排 / 过滤后同下标的 RowCells 被复用、
// 列桩 inject 到的仍是旧行（本页搜索 / 排序用例要断言行序变化，会假绿）。这里改按 row.id 作 key，
// 列桩与 RowCells 仍用公共桩的。
const { RowCells, tableColStub } = makeElTableStubs({ renderHeader: true })
const tableStub = {
  name: 'el-table',
  props: { data: { type: Array, default: () => [] } },
  setup(props, { slots }) {
    return () =>
      h('div', { class: 'el-table' }, [
        h('div', { class: 'el-head' }, slots.default?.()),
        ...props.data.map((row) => h(RowCells, { row, colSlot: slots.default, key: row.id }))
      ])
  }
}
const passthrough = (tag) => ({ name: tag, template: `<div class="${tag}"><slot /></div>` })
const elInput = {
  name: 'el-input',
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue', 'clear'],
  // keyup 不声明为 emit → 作为原生监听透传到 <input>，页面的 @keyup.enter 能收到真实 KeyboardEvent
  template: '<input class="el-input" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
}
const elButton = {
  props: { disabled: Boolean, loading: Boolean, title: String },
  emits: ['click'],
  template: '<button class="el-button" :title="title" :data-loading="loading ? \'1\' : null" @click="$emit(\'click\')"><slot /></button>'
}

const ROWS = [
  { id: 301, name: '系统管理员', modules: ['岗位', '岗位管理', '对话'], userCount: 2, updatedAt: '2026-08-24T15:02:00+08:00' },
  { id: 302, name: '普通用户', modules: ['对话'], userCount: 18, updatedAt: '2026-08-21T16:40:00+08:00' },
  { id: 305, name: '审计观察员', modules: [], userCount: 0, updatedAt: '2026-08-20T14:08:00+08:00' }
]
const TREE = [
  { scope: '用户端', groups: [{ name: '工作台', pages: ['对话', '定时任务'] }] },
  { scope: '管理端', groups: [{ name: '02 岗位', pages: ['岗位', '岗位管理'] }] }
]

let app, container
const flush = async () => { for (let i = 0; i < 4; i++) { await Promise.resolve(); await nextTick() } }
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(AdminRoles)
  app.component('el-icon', passthrough('el-icon'))
  app.component('el-input', elInput)
  app.component('el-table', tableStub)
  app.component('el-table-column', tableColStub)
  app.component('el-button', elButton)
  app.directive('loading', {})
  app.mount(container)
  await flush()
  return container
}
const inst = () => app._instance
const rowNames = () => [...container.querySelectorAll('.el-row .rl-name')].map((n) => n.textContent)
const rowByName = (name) => [...container.querySelectorAll('.el-row')].find((r) => r.querySelector('.rl-name')?.textContent === name)
const permText = (row) => row.querySelector('[data-label="页面权限"]').textContent.replace(/\s+/g, '')
const toolbarBtn = (text) => [...container.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)

beforeEach(() => {
  listRoles.mockReset().mockResolvedValue(ROWS) // 真实 mock（adminUserMock.listRoles）返回裸数组
  getPermissionTree.mockReset().mockResolvedValue(TREE)
  deleteRole.mockReset().mockResolvedValue({})
  confirmDialog.mockReset().mockResolvedValue(true)
  alertDialog.mockReset().mockResolvedValue()
  ElMessage.success.mockReset(); ElMessage.error.mockReset()
})
afterEach(() => { app?.unmount(); container?.remove() })

describe('AdminRoles · 列表展示（md §二.1 L39-43）', () => {
  it('列序：角色名称 / 用户数量 / 页面权限 / 最近更新时间（表头排序按钮）/ 操作；角色名 .rl-name（历史出处：原型 colgroup 185/110/auto）', async () => {
    await mount()
    const cols = [...container.querySelectorAll('.el-head .el-table-column')]
    expect(cols.map((c) => c.dataset.label)).toEqual(['角色名称', '用户数量', '页面权限', '最近更新时间', '操作'])
    expect(cols[0].dataset.width).toBe('185')
    expect(cols[1].dataset.width).toBe('110')
    expect(cols[2].dataset.width).toBe('360')
    // 时间列：2026-09-12 审计 K16 闭环——宽度取共享 COL.TIME（不再硬编码 165）并挂 col-nowrap
    expect(cols[3].dataset.width).toBe(String(COL.TIME))
    expect(cols[3].getAttribute('class-name')).toBe(COL_NOWRAP)
    expect(cols[3].getAttribute('label-class-name')).toBe(COL_NOWRAP)
    expect(cols[3].querySelector('.time-sort').textContent.replace(/\s+/g, '')).toBe('最近更新时间↓')
    expect(cols[4].dataset.fixed).toBe('right')
    expect(container.querySelector('.el-row .rl-name').textContent).toBe('系统管理员')
  })

  it('用户数量显「N 个用户」（L40）；操作列固定【编辑】【删除】，【删除】title「删除前需二次确认」（L43 / §二.3.3 L72）', async () => {
    await mount()
    const row = rowByName('系统管理员')
    expect(row.querySelector('[data-label="用户数量"]').textContent.trim()).toBe('2 个用户')
    expect(rowByName('审计观察员').querySelector('[data-label="用户数量"]').textContent.trim()).toBe('0 个用户')
    const ops = [...row.querySelectorAll('.tbl-ops .el-button')]
    expect(ops.map((b) => b.textContent.trim())).toEqual(['编辑', '删除'])
    expect(ops[1].title).toBe('删除前需二次确认')
  })

  it('页面权限列聚合（L41）：管理端「√ 管理端（岗位、岗位管理）」+ 用户端「√ 用户端」不展开子页面；无权限「未开通任何页面」', async () => {
    await mount()
    expect(permText(rowByName('系统管理员'))).toBe('√用户端√管理端（岗位、岗位管理）')
    expect(permText(rowByName('普通用户'))).toBe('√用户端')
    expect(permText(rowByName('审计观察员'))).toBe('未开通任何页面')
  })

  it('默认按最近更新时间由近到远；点列头切换升序↑ 再点回降序↓（§二.2 L49）', async () => {
    await mount()
    expect(rowNames()).toEqual(['系统管理员', '普通用户', '审计观察员'])
    const sortBtn = () => container.querySelector('.el-head .time-sort')
    sortBtn().click(); await flush()
    expect(sortBtn().querySelector('.time-sort-arrow').textContent).toBe('↑')
    expect(rowNames()).toEqual(['审计观察员', '普通用户', '系统管理员'])
    sortBtn().click(); await flush()
    expect(sortBtn().querySelector('.time-sort-arrow').textContent).toBe('↓')
    expect(rowNames()).toEqual(['系统管理员', '普通用户', '审计观察员'])
  })
})

describe('AdminRoles · 搜索（md §一.1 L11 / §一.2 L20）', () => {
  it('搜索占位「搜索角色名称」；输入不实时过滤，点【查询】才生效（模糊匹配）；清空后【查询】展示全部', async () => {
    await mount()
    const input = container.querySelector('.el-input')
    expect(input.placeholder).toBe('搜索角色名称')
    input.value = '观察'
    input.dispatchEvent(new Event('input'))
    await flush()
    expect(rowNames()).toEqual(['系统管理员', '普通用户', '审计观察员'])
    toolbarBtn('查询').click(); await flush()
    expect(rowNames()).toEqual(['审计观察员'])
    input.value = ''
    input.dispatchEvent(new Event('input'))
    toolbarBtn('查询').click(); await flush()
    expect(rowNames()).toEqual(['系统管理员', '普通用户', '审计观察员'])
  })

  it('搜索框按回车 → 同【查询】生效', async () => {
    await mount()
    const input = container.querySelector('.el-input')
    input.value = '普通'
    input.dispatchEvent(new Event('input'))
    await flush()
    expect(rowNames()).toHaveLength(3)
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await flush()
    expect(rowNames()).toEqual(['普通用户'])
  })
})

describe('AdminRoles · 权限树加载失败（md §一.3 L31）', () => {
  it('getPermissionTree 失败 → 角色列表仍可看，页面权限列统一「未开通任何页面」', async () => {
    getPermissionTree.mockRejectedValue(new Error('boom'))
    await mount()
    expect(rowNames()).toEqual(['系统管理员', '普通用户', '审计观察员'])
    expect([...container.querySelectorAll('.el-row')].map(permText)).toEqual(['未开通任何页面', '未开通任何页面', '未开通任何页面'])
  })
})

describe('AdminRoles · 删除分流（md §二.3.3 L72-76 / §二.4 L87）', () => {
  it('有绑定用户 → alertDialog「无法删除角色」文案照 md，不删', async () => {
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

  it('无绑定 → confirmDialog danger【删除】→ deleteRole + toast「角色已删除」并刷新；取消不删', async () => {
    await mount()
    listRoles.mockClear()
    await inst().setupState.remove(ROWS[2])
    expect(confirmDialog).toHaveBeenCalledWith(
      '删除后角色「审计观察员」及其页面权限将不可恢复。确认删除？',
      '删除角色',
      { confirmText: '删除', danger: true }
    )
    expect(deleteRole).toHaveBeenCalledWith(305)
    expect(ElMessage.success).toHaveBeenCalledWith('角色已删除')
    expect(listRoles).toHaveBeenCalledTimes(1)
    confirmDialog.mockResolvedValue(false)
    await inst().setupState.remove(ROWS[2])
    expect(deleteRole).toHaveBeenCalledTimes(1)
  })

  it('删除失败：有具体原因显原因；无原因显「删除失败」；角色保留在列表', async () => {
    await mount()
    deleteRole.mockRejectedValueOnce(new Error('角色「审计观察员」仍绑定 1 个用户。请先在用户页完成角色改绑。'))
    await inst().setupState.remove(ROWS[2])
    expect(ElMessage.error).toHaveBeenLastCalledWith('角色「审计观察员」仍绑定 1 个用户。请先在用户页完成角色改绑。')
    deleteRole.mockRejectedValueOnce({})
    await inst().setupState.remove(ROWS[2])
    expect(ElMessage.error).toHaveBeenLastCalledWith('删除失败')
    expect(ElMessage.success).not.toHaveBeenCalled()
    await flush()
    expect(rowNames()).toContain('审计观察员')
  })

  it('删除进行中 → 当前行【删除】展示进行中（loading），【编辑】保持；完成后恢复（§二.3.1 L58）', async () => {
    let finish
    deleteRole.mockReturnValue(new Promise((r) => { finish = r }))
    await mount()
    const delBtn = () => [...rowByName('审计观察员').querySelectorAll('.tbl-ops .el-button')][1]
    delBtn().click(); await flush()
    expect(delBtn().dataset.loading).toBe('1')
    expect([...rowByName('审计观察员').querySelectorAll('.tbl-ops .el-button')][0].dataset.loading).toBeUndefined()
    expect([...rowByName('系统管理员').querySelectorAll('.tbl-ops .el-button')][1].dataset.loading).toBeUndefined()
    finish({}); await flush()
    expect(delBtn().dataset.loading).toBeUndefined()
  })
})
