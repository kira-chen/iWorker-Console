// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, provide, inject, nextTick } from 'vue'

/**
 * AdminPositionAssignments.vue 单测（提案 20260721-2 岗位分配页）：
 * 列表渲染（用户名/显示名占位/绑定岗位或「未绑定」）、加载失败态、空态、「修改绑定」打开弹窗（传入行副本）。
 * el-table 用逐行注入 row 的存根（复用 adminSkillsUnreferenced 范式）；弹窗/api 存根化。
 */

const listPositionAssignments = vi.fn()
const listPositions = vi.fn(() => Promise.resolve({ list: [], total: 0 }))
vi.mock('@/api/positionAssignment', () => ({ listPositionAssignments: (...a) => listPositionAssignments(...a) }))
vi.mock('@/api/position', () => ({ listPositions: (...a) => listPositions(...a) }))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
  ElMessageBox: { confirm: vi.fn() }
}))
vi.mock('@/assets/connector.css', () => ({}))
vi.mock('@/components/PageHeader.vue', () => ({ default: { template: '<div class="page-header" />' } }))
vi.mock('@/components/StatusTag.vue', () => ({
  default: { props: ['type'], template: '<span class="status-tag" :data-type="type"><slot /></span>' }
}))
vi.mock('@/components/admin/UserPositionEditDialog.vue', () => ({
  default: {
    name: 'UserPositionEditDialog',
    props: ['visible', 'row', 'positionOptions'],
    template: '<div class="edit-dialog" :data-visible="String(visible)" :data-user="row && row.username" />'
  }
}))

const AdminPositionAssignments = (await import('@/views/admin/AdminPositionAssignments.vue')).default

// —— el-table 逐行注入 row 存根 ——
const ROW_KEY = Symbol('row')
const tableStub = {
  name: 'el-table',
  props: { data: { type: Array, default: () => [] } },
  setup(props, { slots }) {
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
    return () => h('div', { class: 'el-table-column' }, [row ? slots.default?.({ row }) : slots.header?.()])
  }
}
const passthrough = (tag) => ({ name: tag, template: `<div class="${tag}"><slot /></div>` })
const elEmpty = { props: ['description'], template: '<div class="el-empty">{{ description }}<slot /></div>' }
const elButton = { emits: ['click'], template: '<button class="el-button" @click="$emit(\'click\')"><slot /></button>' }
const pager = { name: 'el-pagination', template: '<div class="el-pagination" />' }

let app, container
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(AdminPositionAssignments)
  for (const t of ['el-input', 'el-select', 'el-option', 'el-icon']) app.component(t, passthrough(t))
  app.component('el-table', tableStub)
  app.component('el-table-column', tableColStub)
  app.component('el-empty', elEmpty)
  app.component('el-button', elButton)
  app.component('el-pagination', pager)
  app.component('Search', { template: '<i />' })
  app.directive('loading', {})
  app.mount(container)
  // 等 onMounted 的 fetchList/loadPositions promise 落地
  await nextTick()
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
  return container
}

const ROWS = [
  { username: 'alice', displayName: '爱丽丝', status: 'active', positionName: '销售', positionId: 'ps_1' },
  { username: 'bob', displayName: '', status: 'disabled', positionName: '', positionId: null }
]

beforeEach(() => {
  listPositionAssignments.mockReset().mockResolvedValue({ list: ROWS, total: 2 })
  listPositions.mockReset().mockResolvedValue({ list: [{ positionId: 'ps_1', name: '销售' }], total: 1 })
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('AdminPositionAssignments', () => {
  it('挂载即拉列表与已发布岗位选项', async () => {
    await mount()
    expect(listPositionAssignments).toHaveBeenCalledTimes(1)
    expect(listPositions).toHaveBeenCalledWith(expect.objectContaining({ status: 'published' }))
  })

  it('渲染行：显示名占位「—」、有岗位显示岗位名、无岗位显示「未绑定」', async () => {
    await mount()
    const rows = [...container.querySelectorAll('.el-row')]
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('销售')
    expect(rows[1].textContent).toContain('未绑定')
    expect(rows[1].textContent).toContain('—') // bob 显示名为空 → 占位
  })

  it('加载失败 → 展示「加载失败」空态', async () => {
    listPositionAssignments.mockRejectedValueOnce(new Error('boom'))
    await mount()
    expect(container.querySelector('.el-empty')?.textContent).toContain('加载失败')
  })

  it('无数据 → 展示「没有匹配的用户」', async () => {
    listPositionAssignments.mockResolvedValueOnce({ list: [], total: 0 })
    await mount()
    expect(container.querySelector('.el-empty')?.textContent).toContain('没有匹配的用户')
  })

  it('点「修改绑定」→ 弹窗可见且传入该行副本', async () => {
    await mount()
    const rows = [...container.querySelectorAll('.el-row')]
    const editBtn = [...rows[0].querySelectorAll('.el-button')].find((b) => b.textContent.includes('修改绑定'))
    editBtn.click()
    await nextTick()
    const dlg = container.querySelector('.edit-dialog')
    expect(dlg.getAttribute('data-visible')).toBe('true')
    expect(dlg.getAttribute('data-user')).toBe('alice')
  })
})
