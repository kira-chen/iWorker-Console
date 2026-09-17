// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { makeElTableStubs } from './helpers/elTableStub'

/**
 * AdminLoginLogs.vue（访问审计）列表页单测（2026-09-12 测试审计 T56 新建，薄）。
 *
 * 对齐 md `prd.访问审计.md`：
 * - §一 L8 页面说明；§二 查询区（占位「搜索用户名」、在线 / 离线、【查询】回第 1 页）；
 * - §3.1 六列：终端仅 Windows / Mac 蓝标签；登录时间 / 登出时间 双列可排序、箭头 ↓ / ↑；
 *   在线记录登出时间「—」、状态 在线绿 / 离线灰；来源 IP；默认按登录时间倒序；
 * - §五 L66 登出时间为空展示「—」不视为异常；L65 加载失败「加载失败」+【重试】。
 * 排序细节（AdminLoginLogs.vue:37-50）：同列再点切向，换列转倒序，非当前列恒显 ↓，均回第 1 页。
 * 桩法照 userSkillReviews.test.js：ListToolbar / ListStates / ListPagination / StatusTag 真挂载，EP 原生控件桩。
 */

const listLoginLogs = vi.fn()
vi.mock('@/api/loginLog', () => ({ listLoginLogs: (...a) => listLoginLogs(...a) }))
vi.mock('@element-plus/icons-vue', async (importOriginal) => importOriginal())
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({}) }))
vi.mock('@/api/accessAuditMock', () => ({ dlRecords: [], opsRecords: [] }))
vi.mock('@/components/PageHeader.vue', () => ({
  default: {
    props: ['title', 'subtitle'],
    template: '<div class="page-header">{{ title }}<span class="ph-sub">{{ subtitle }}</span></div>'
  }
}))

const AdminLoginLogs = (await import('@/views/admin/AdminLoginLogs.vue')).default

const { RowCells, tableColStub } = makeElTableStubs({ renderHeader: true })
const tableStub = {
  name: 'el-table',
  props: { data: { type: Array, default: () => [] } },
  setup(props, { slots }) {
    return () =>
      h('div', { class: 'el-table' }, [
        h('div', { class: 'el-head' }, slots.default?.()),
        ...props.data.map((row, i) => h(RowCells, { row, colSlot: slots.default, key: row.id ?? i }))
      ])
  }
}
const elInput = {
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue', 'keyup', 'clear'],
  template: '<input class="el-input" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keyup="$emit(\'keyup\', $event)" />'
}
const elSelect = {
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue', 'change'],
  template:
    '<div class="el-select" :data-placeholder="placeholder" @pick="$emit(\'update:modelValue\', $event.detail); $emit(\'change\', $event.detail)"><slot /></div>'
}
const pick = (selectEl, value) => selectEl.dispatchEvent(new CustomEvent('pick', { detail: value }))
const elOption = { props: ['label', 'value'], template: '<div class="el-option" :data-value="value">{{ label }}</div>' }
const passthrough = (tag) => ({ name: tag, template: `<div class="${tag}"><slot /></div>` })
const elEmpty = { props: ['description'], template: '<div class="el-empty">{{ description }}<slot /></div>' }
const elButton = {
  props: { disabled: Boolean, loading: Boolean, type: String, link: Boolean },
  emits: ['click'],
  template: '<button class="el-button" :disabled="disabled" :data-type="type" @click="!disabled && $emit(\'click\')"><slot /></button>'
}
const elTabs = {
  name: 'el-tabs',
  props: ['modelValue'],
  template: '<div class="el-tabs"><slot /></div>'
}
const elTabPane = {
  name: 'el-tab-pane',
  props: ['label', 'name'],
  setup(props, { slots }) {
    return () => props.name === 'login' ? h('div', { class: 'el-tab-pane' }, slots.default?.()) : null
  }
}
const elDatePicker = {
  name: 'el-date-picker',
  props: ['modelValue', 'type', 'rangeSeparator', 'startPlaceholder', 'endPlaceholder', 'disabledDate'],
  emits: ['update:modelValue'],
  template: '<div class="el-date-picker"></div>'
}

let app, container
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(AdminLoginLogs)
  app.component('el-input', elInput)
  app.component('el-select', elSelect)
  app.component('el-option', elOption)
  app.component('el-icon', passthrough('el-icon'))
  app.component('el-table', tableStub)
  app.component('el-table-column', tableColStub)
  app.component('el-empty', elEmpty)
  app.component('el-button', elButton)
  app.component('el-tabs', elTabs)
  app.component('el-tab-pane', elTabPane)
  app.component('el-date-picker', elDatePicker)
  app.directive('loading', {})
  app.mount(container)
  await flush()
  return container
}
async function flush(n = 4) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve()
    await Promise.resolve()
    await nextTick()
  }
}
const rowEls = () => [...container.querySelectorAll('.el-row')]
const toolbarBtn = (text) => [...container.querySelectorAll('.list-toolbar .el-button')].find((b) => b.textContent.trim() === text)
const sortBtns = () => [...container.querySelectorAll('.el-head .ll-sort')]
const arrows = () => sortBtns().map((b) => b.querySelector('.ll-sort-arrow').textContent)

// 夹具照 loginLogMock 种子形状：同一账号两条（在线 + 离线）、两种终端
const ROWS = [
  { id: 1, username: 'zhangwei', terminal: 'Windows', loginAt: '2026-08-28 09:16', logoutAt: '', status: 'ONLINE', ip: '10.20.14.36' },
  { id: 3, username: 'zhangwei', terminal: 'Mac', loginAt: '2026-08-27 20:05', logoutAt: '2026-08-27 22:18', status: 'OFFLINE', ip: '116.228.72.91' }
]

beforeEach(() => {
  listLoginLogs.mockReset().mockResolvedValue({ list: ROWS, total: ROWS.length })
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('AdminLoginLogs · 访问审计（md prd.访问审计.md）', () => {
  it('页面说明取 md §一 L8；挂载即按登录时间倒序拉列表（sortField=loginAt、sortDir=desc、page=1）（md §3.1 L34）', async () => {
    await mount()
    expect(container.querySelector('.ph-sub').textContent).toBe('记录用户登录访问、产物下载与管理端操作的完整行为轨迹')
    expect(listLoginLogs).toHaveBeenCalledWith(expect.objectContaining({ sortField: 'loginAt', sortDir: 'desc', page: 1 }))
  })

  it('查询区（md §二）：占位「搜索用户名」、在线状态 在线 / 离线、【查询】；下拉选中即时重查回第 1 页', async () => {
    await mount()
    expect(container.querySelector('.el-input').placeholder).toBe('搜索用户名')
    const select = container.querySelector('.el-select')
    expect(select.dataset.placeholder).toBe('全部在线状态')
    expect([...select.querySelectorAll('.el-option')].map((o) => o.textContent)).toEqual(['在线', '离线'])
    expect(toolbarBtn('查询')).toBeTruthy()
    listLoginLogs.mockClear()
    pick(select, 'ONLINE')
    await flush()
    expect(listLoginLogs).toHaveBeenCalledWith(expect.objectContaining({ status: 'ONLINE', page: 1 }))
  })

  it('六列表头：登录时间 / 登出时间 均为文字箭头列头，默认 ↓ / ↓（当前列倒序、非当前列恒显 ↓）（md §3.1）', async () => {
    await mount()
    const heads = [...container.querySelectorAll('.el-head .el-table-column')].map((c) => c.textContent.replace(/\s+/g, ' ').trim())
    expect(heads).toEqual(['用户名', '终端', '登录时间 ↓', '登出时间 ↓', '状态', '来源 IP'])
    expect(arrows()).toEqual(['↓', '↓'])
  })

  it('点登出时间列头 → 换列转倒序：listLoginLogs 收到 {sortField:"logoutAt", sortDir:"desc", page:1}；再点同列 → asc 且箭头 ↑，登录时间列仍 ↓', async () => {
    await mount()
    listLoginLogs.mockClear()
    sortBtns()[1].click()
    await flush()
    expect(listLoginLogs).toHaveBeenCalledWith(expect.objectContaining({ sortField: 'logoutAt', sortDir: 'desc', page: 1 }))
    expect(arrows()).toEqual(['↓', '↓'])
    sortBtns()[1].click()
    await flush()
    expect(listLoginLogs).toHaveBeenLastCalledWith(expect.objectContaining({ sortField: 'logoutAt', sortDir: 'asc', page: 1 }))
    expect(arrows()).toEqual(['↓', '↑'])
    // 换回登录时间列 → 又转倒序
    sortBtns()[0].click()
    await flush()
    expect(listLoginLogs).toHaveBeenLastCalledWith(expect.objectContaining({ sortField: 'loginAt', sortDir: 'desc', page: 1 }))
    expect(arrows()).toEqual(['↓', '↓'])
  })

  it('在线行：登出时间「—」、状态「在线」绿标（success）；离线行：登出时间实际值、状态「离线」灰标（info）；终端均蓝标（md §3.1 / §五 L66）', async () => {
    await mount()
    const [online, offline] = rowEls()
    const cell = (row, label) => row.querySelector(`[data-label="${label}"]`)
    expect(online.querySelector('.ll-sort')).toBeNull() // 行内不渲染表头按钮
    expect([...online.querySelectorAll('.el-table-column')][3].textContent.trim()).toBe('—')
    expect([...offline.querySelectorAll('.el-table-column')][3].textContent.trim()).toBe('2026-08-27 22:18')
    const status = (row) => cell(row, '状态').querySelector('.status-tag')
    expect(status(online).textContent.trim()).toBe('在线')
    expect(status(online).classList.contains('st--success')).toBe(true)
    expect(status(offline).textContent.trim()).toBe('离线')
    expect(status(offline).classList.contains('st--info')).toBe(true)
    const term = (row) => cell(row, '终端').querySelector('.status-tag')
    expect(term(online).textContent.trim()).toBe('Windows')
    expect(term(offline).textContent.trim()).toBe('Mac')
    expect(term(online).classList.contains('st--accent')).toBe(true)
    expect(term(offline).classList.contains('st--accent')).toBe(true)
    expect(cell(online, '来源 IP').textContent.trim()).toBe('10.20.14.36')
    expect(cell(online, '用户名').textContent.trim()).toBe('zhangwei')
  })

  it('空态；加载失败出「加载失败」+【重试】（md §五 L64-65）', async () => {
    listLoginLogs.mockResolvedValueOnce({ list: [], total: 0 })
    await mount()
    expect(container.querySelector('.ls-empty')).toBeTruthy()
    app.unmount(); container.remove()
    listLoginLogs.mockRejectedValueOnce(new Error('x'))
    await mount()
    expect(container.querySelector('.el-empty').textContent).toContain('加载失败')
    expect([...container.querySelectorAll('.el-empty .el-button')].map((b) => b.textContent.trim())).toContain('重试')
  })
})
