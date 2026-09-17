// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, provide, inject, nextTick } from 'vue'
import { ElMessage } from 'element-plus'

/**
 * AdminPositionAssignments.vue 单测（2026-09-15 合并改版：双页签→单页面）。
 *
 * 覆盖：页头标题/副标题；挂载即拉分配列表 + 岗位选项 + 待分配数量；
 * 行渲染（显示名占位 / 有岗位 / 无岗位 / hasPendingRequest「待分配」标签）；
 * 「待分配申请」筛选按钮切换（hasPendingRequest 参数下发）；
 * 搜索停顿 / 状态切换不重置分页 / 【查询】回第 1 页；
 * 【分配岗位】弹窗打开与关闭；
 * 有待分配申请的用户分配后自动 markApplicationAssigned + 刷新计数 + 置顶高亮；
 * 无待分配申请的普通用户分配后直接 reload（不调 markApplicationAssigned）。
 */

const listPositionAssignments = vi.fn()
const countPendingApplications = vi.fn()
const markApplicationAssignedApi = vi.fn()
const listPositions = vi.fn(() => Promise.resolve({ list: [], total: 0 }))

vi.mock('@/api/positionAssignment', () => ({
  listPositionAssignments: (...a) => listPositionAssignments(...a),
  countPendingApplications: (...a) => countPendingApplications(...a),
  markApplicationAssigned: (...a) => markApplicationAssignedApi(...a)
}))
vi.mock('@/api/position', () => ({ listPositions: (...a) => listPositions(...a) }))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() })
}))
vi.mock('@/components/PageHeader.vue', () => ({
  default: { props: ['title', 'subtitle'], template: '<div class="page-header">{{ title }}|{{ subtitle }}</div>' }
}))
vi.mock('@/components/StatusTag.vue', () => ({
  default: { props: ['type'], template: '<span class="status-tag" :data-type="type"><slot /></span>' }
}))
vi.mock('@/components/admin/UserPositionEditDialog.vue', () => ({
  default: {
    name: 'UserPositionEditDialog',
    props: ['visible', 'row', 'positionOptions'],
    emits: ['update:visible', 'saved'],
    template:
      '<div class="edit-dialog" :data-visible="String(visible)" :data-user="row && row.username" :data-has-pending="String(!!(row && row.pendingRequestId))">' +
      '<button class="edit-save" @click="$emit(\'saved\')" /></div>'
  }
}))
vi.mock('@/assets/connector.css', () => ({}))

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
const elButton = {
  emits: ['click'],
  template: '<button class="el-button" @click="$emit(\'click\')"><slot /></button>'
}
const elInput = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<input class="el-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
}
const elSelect = {
  props: ['modelValue'],
  emits: ['update:modelValue', 'change'],
  template: '<select class="el-select" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\', $event.target.value)"><slot /></select>'
}
const elOption = { props: ['value', 'label'], template: '<option :value="value">{{ label }}</option>' }
const elEmpty = { props: ['description'], template: '<div class="el-empty">{{ description }}<slot /></div>' }
const pager = { name: 'el-pagination', template: '<div class="el-pagination" />' }

let app, container

async function flush() {
  await nextTick()
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(AdminPositionAssignments)
  for (const t of ['el-icon']) app.component(t, passthrough(t))
  app.component('el-input', elInput)
  app.component('el-select', elSelect)
  app.component('el-option', elOption)
  app.component('el-table', tableStub)
  app.component('el-table-column', tableColStub)
  app.component('el-button', elButton)
  app.component('el-empty', elEmpty)
  app.component('el-pagination', pager)
  app.component('Search', { template: '<i />' })
  app.directive('loading', {})
  app.mount(container)
  await flush()
  return container
}

// 两行种子：alice 已绑定、无申请；bob 未绑定、有待分配申请
const ROWS = [
  { userId: 11, username: 'alice', displayName: '爱丽丝', status: 'active',   positionId: 'ps_1', positionName: '销售', hasPendingRequest: false, pendingRequestId: null,  pendingRequestAt: null },
  { userId: 12, username: 'bob',   displayName: '',      status: 'disabled', positionId: null,   positionName: null,   hasPendingRequest: true,  pendingRequestId: 801,   pendingRequestAt: '2026-09-10 09:00' }
]

beforeEach(() => {
  vi.clearAllMocks()
  listPositionAssignments.mockResolvedValue({ list: ROWS, total: 2 })
  countPendingApplications.mockResolvedValue({ count: 1 })
  markApplicationAssignedApi.mockResolvedValue({})
  listPositions.mockResolvedValue({
    list: [
      { positionId: 'ps_1', name: '销售', status: 'published', pendingAction: null },
      { positionId: 'ps_2', name: '客服', status: 'published', pendingAction: 'PUBLISH' }
    ],
    total: 2
  })
})

afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('AdminPositionAssignments —— 单页面（2026-09-15 合并改版）', () => {
  it('页头标题 / 副标题正确', async () => {
    await mount()
    expect(container.querySelector('.page-header').textContent).toBe(
      '岗位管理|管理用户岗位绑定，分配岗位或处理待分配申请。'
    )
  })

  it('无页签元素（已合并为单页面）', async () => {
    await mount()
    expect(container.querySelector('.el-tabs')).toBeNull()
  })

  it('挂载即拉分配列表 + 可绑定岗位选项 + 待分配数量', async () => {
    await mount()
    expect(listPositionAssignments).toHaveBeenCalledTimes(1)
    expect(listPositions).toHaveBeenCalledTimes(1)
    expect(countPendingApplications).toHaveBeenCalledTimes(1)
  })

  it('行渲染：显示名占位「—」/ 有岗位 / 无岗位「未绑定」', async () => {
    await mount()
    const rows = [...container.querySelectorAll('.el-row')]
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('销售')
    expect(rows[0].textContent).not.toContain('未绑定')
    expect(rows[1].textContent).toContain('未绑定')
    expect(rows[1].textContent).toContain('—') // bob 显示名为空
  })

  it('hasPendingRequest=true 的行显示「待分配」标签；hasPendingRequest=false 的行不显示', async () => {
    await mount()
    const rows = [...container.querySelectorAll('.el-row')]
    expect(rows[0].textContent).not.toContain('待分配')  // alice 无申请
    expect(rows[1].textContent).toContain('待分配')      // bob 有申请
  })

  it('工具栏「待分配申请」按钮显示计数徽标（count=1）；count=0 时不展示徽标', async () => {
    await mount()
    const pendingBtn = [...container.querySelectorAll('.el-button')].find((b) => b.textContent.includes('待分配申请'))
    expect(pendingBtn).toBeTruthy()
    expect(pendingBtn.querySelector('.pm-count')?.textContent).toBe('1')

    app.unmount(); container.remove()
    countPendingApplications.mockResolvedValue({ count: 0 })
    await mount()
    const btn2 = [...container.querySelectorAll('.el-button')].find((b) => b.textContent.includes('待分配申请'))
    expect(btn2.querySelector('.pm-count')).toBeNull()
  })

  it('点「待分配申请」按钮 → 下发 hasPendingRequest:true；再点 → 还原不下发', async () => {
    await mount()
    const pendingBtn = [...container.querySelectorAll('.el-button')].find((b) => b.textContent.includes('待分配申请'))
    pendingBtn.click()
    await flush()
    expect(listPositionAssignments.mock.calls.at(-1)[0]).toMatchObject({ hasPendingRequest: true })

    pendingBtn.click()
    await flush()
    const lastParams = listPositionAssignments.mock.calls.at(-1)[0]
    expect(lastParams.hasPendingRequest).toBeFalsy()
  })

  it('搜索停顿 220ms / 状态切换 → 刷新不重置页码；【查询】回第 1 页', async () => {
    listPositionAssignments.mockResolvedValue({ list: ROWS, total: 60 })
    vi.useFakeTimers()
    try {
      await mount()
      const calls = () => listPositionAssignments.mock.calls.map((c) => c[0])

      // 翻到第 2 页
      container.querySelector('.list-pager button[aria-label="下一页"]').click()
      await flush()
      expect(calls().at(-1).page).toBe(2)

      // ① 搜索：219ms 不触发，220ms 触发且 page 仍为 2
      const input = container.querySelector('input.el-input')
      input.value = 'al'
      input.dispatchEvent(new Event('input'))
      await flush()
      const before = calls().length
      vi.advanceTimersByTime(219); await flush()
      expect(calls().length).toBe(before)
      vi.advanceTimersByTime(1); await flush()
      expect(calls().length).toBe(before + 1)
      expect(calls().at(-1)).toEqual(expect.objectContaining({ keyword: 'al', page: 2 }))

      // ② 状态切换：立即刷新，page 仍 2
      const select = container.querySelector('select.el-select')
      select.value = 'disabled'
      select.dispatchEvent(new Event('change'))
      await flush()
      expect(calls().at(-1)).toEqual(expect.objectContaining({ status: 'disabled', page: 2 }))

      // ③ 【查询】：回第 1 页
      ;[...container.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '查询').click()
      await flush()
      expect(calls().at(-1)).toEqual(expect.objectContaining({ page: 1 }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('点「分配岗位」→ 弹窗可见，传入该行副本', async () => {
    await mount()
    const rows = [...container.querySelectorAll('.el-row')]
    ;[...rows[0].querySelectorAll('.el-button')].find((b) => b.textContent.includes('分配岗位')).click()
    await nextTick()
    const dlg = container.querySelector('.edit-dialog')
    expect(dlg.getAttribute('data-visible')).toBe('true')
    expect(dlg.getAttribute('data-user')).toBe('alice')
  })

  it('有待分配申请的用户分配后自动 markApplicationAssigned + 刷新计数 + 置顶高亮', async () => {
    await mount()
    const rows = [...container.querySelectorAll('.el-row')]
    ;[...rows[1].querySelectorAll('.el-button')].find((b) => b.textContent.includes('分配岗位')).click()
    await nextTick()
    // 弹窗显示 bob（有 pendingRequestId）
    expect(container.querySelector('.edit-dialog').getAttribute('data-has-pending')).toBe('true')

    container.querySelector('.edit-save').click()
    await flush()

    // markApplicationAssigned 被调用，参数为 bob 的 pendingRequestId
    expect(markApplicationAssignedApi).toHaveBeenCalledWith(801)
    // 计数刷新
    expect(countPendingApplications).toHaveBeenCalledTimes(2)
    // 列表重查，附 focusUserId 置顶
    const lastCall = listPositionAssignments.mock.calls.at(-1)[0]
    expect(lastCall).toEqual(expect.objectContaining({ focusUserId: 12, page: 1 }))
    // 筛选已清空
    expect(lastCall.hasPendingRequest).toBeFalsy()
  })

  it('无待分配申请的用户分配后直接 reload，不调 markApplicationAssigned', async () => {
    await mount()
    const rows = [...container.querySelectorAll('.el-row')]
    ;[...rows[0].querySelectorAll('.el-button')].find((b) => b.textContent.includes('分配岗位')).click()
    await nextTick()
    container.querySelector('.edit-save').click()
    await flush()

    expect(markApplicationAssignedApi).not.toHaveBeenCalled()
    // 普通 reload（无 focusUserId）
    const lastCall = listPositionAssignments.mock.calls.at(-1)[0]
    expect(lastCall?.focusUserId).toBeUndefined()
  })

  it('加载失败 → 展示「加载失败」；无数据 → 「没有匹配的用户」', async () => {
    listPositionAssignments.mockRejectedValueOnce(new Error('boom'))
    await mount()
    expect(container.querySelector('.el-empty')?.textContent).toContain('加载失败')

    app.unmount(); container.remove()
    listPositionAssignments.mockResolvedValueOnce({ list: [], total: 0 })
    await mount()
    expect(container.querySelector('.ls-empty')?.textContent).toContain('没有匹配的用户')
  })

  it('待分配筛选激活时空态文案改为「暂无待分配申请」', async () => {
    listPositionAssignments.mockResolvedValue({ list: [], total: 0 })
    await mount()
    const pendingBtn = [...container.querySelectorAll('.el-button')].find((b) => b.textContent.includes('待分配申请'))
    pendingBtn.click()
    await flush()
    expect(container.querySelector('.ls-empty')?.textContent).toContain('暂无待分配申请')
  })
})
