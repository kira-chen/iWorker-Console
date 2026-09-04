// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, provide, inject, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

/**
 * AdminPositionAssignments.vue 单测（2026-09-04 PRD-20260903 对齐：「岗位分配」页升级「岗位管理」双页签）。
 *
 * 覆盖：页头标题/副标题；双页签 + 待审核徽标（0 不展示）、默认进分配页签；
 * 分配页签既有行为（行渲染/失败态/空态/修改绑定弹窗）；
 * 审批页签行渲染、空态（标题+副文案）、【通过】确认→绑定接口+联动刷新、取消不动、
 * 【驳回】弹窗（标题「驳回岗位申请」）确认上抛、【重新绑定】复用修改绑定弹窗（forceSave）
 * →保存后标记已重新绑定+回分配页签清筛选置顶（focusUserId 下发）。
 * el-table 用逐行注入 row 的存根（复用 adminSkillsUnreferenced 范式）；弹窗/api 存根化。
 */

const listPositionAssignments = vi.fn()
const listPositionApplications = vi.fn()
const countPendingApplications = vi.fn()
const approveApi = vi.fn()
const rejectApi = vi.fn()
const reboundApi = vi.fn()
const listPositions = vi.fn(() => Promise.resolve({ list: [], total: 0 }))

vi.mock('@/api/positionAssignment', () => ({
  listPositionAssignments: (...a) => listPositionAssignments(...a),
  listPositionApplications: (...a) => listPositionApplications(...a),
  countPendingApplications: (...a) => countPendingApplications(...a),
  approvePositionApplication: (...a) => approveApi(...a),
  rejectPositionApplication: (...a) => rejectApi(...a),
  markApplicationRebound: (...a) => reboundApi(...a)
}))
vi.mock('@/api/position', () => ({ listPositions: (...a) => listPositions(...a) }))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
  ElMessageBox: { confirm: vi.fn() }
}))
vi.mock('@/assets/connector.css', () => ({}))
vi.mock('@/components/PageHeader.vue', () => ({
  default: { props: ['title', 'subtitle'], template: '<div class="page-header">{{ title }}|{{ subtitle }}</div>' }
}))
vi.mock('@/components/StatusTag.vue', () => ({
  default: { props: ['type'], template: '<span class="status-tag" :data-type="type"><slot /></span>' }
}))
vi.mock('@/components/admin/UserPositionEditDialog.vue', () => ({
  default: {
    name: 'UserPositionEditDialog',
    props: ['visible', 'row', 'positionOptions', 'forceSave'],
    emits: ['update:visible', 'saved'],
    template:
      '<div class="edit-dialog" :data-visible="String(visible)" :data-user="row && row.username" :data-force="String(!!forceSave)">' +
      '<button class="edit-save" @click="$emit(\'saved\')" /></div>'
  }
}))
vi.mock('@/components/admin/ReviewRejectDialog.vue', () => ({
  default: {
    name: 'ReviewRejectDialog',
    props: ['modelValue', 'title', 'submitting'],
    emits: ['update:modelValue', 'confirm'],
    template:
      '<div class="reject-dialog" :data-visible="String(modelValue)" :data-title="title">' +
      '<button class="reject-confirm" @click="$emit(\'confirm\', \'岗位编制已满\')" /></div>'
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
// —— el-tabs / el-tab-pane 存根：pane 渲染为可点按钮（label 属性或 #label 插槽），点击回写 v-model ——
const TAB_SET = Symbol('tabset')
const tabsStub = {
  name: 'el-tabs',
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  setup(props, { slots, emit }) {
    provide(TAB_SET, (name) => emit('update:modelValue', name))
    return () => h('div', { class: 'el-tabs', 'data-active': props.modelValue }, slots.default?.())
  }
}
const tabPaneStub = {
  name: 'el-tab-pane',
  props: { name: { type: String, default: '' }, label: { type: String, default: '' } },
  setup(props, { slots }) {
    const set = inject(TAB_SET, () => {})
    return () =>
      h(
        'button',
        { class: 'el-tab-btn', 'data-name': props.name, onClick: () => set(props.name) },
        [props.label, slots.label?.()]
      )
  }
}
const passthrough = (tag) => ({ name: tag, template: `<div class="${tag}"><slot /></div>` })
const elEmpty = { props: ['description'], template: '<div class="el-empty">{{ description }}<slot /></div>' }
const elButton = { emits: ['click'], template: '<button class="el-button" @click="$emit(\'click\')"><slot /></button>' }
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
  for (const t of ['el-input', 'el-select', 'el-option', 'el-icon']) app.component(t, passthrough(t))
  app.component('el-table', tableStub)
  app.component('el-table-column', tableColStub)
  app.component('el-tabs', tabsStub)
  app.component('el-tab-pane', tabPaneStub)
  app.component('el-empty', elEmpty)
  app.component('el-button', elButton)
  app.component('el-pagination', pager)
  app.component('Search', { template: '<i />' })
  app.directive('loading', {})
  app.mount(container)
  // 等 onMounted 的 fetchList/loadPositions/appList/徽标计数 promise 落地
  await flush()
  return container
}

const ROWS = [
  { userId: 11, username: 'alice', displayName: '爱丽丝', status: 'active', positionName: '销售', positionId: 'ps_1' },
  { userId: 12, username: 'bob', displayName: '', status: 'disabled', positionName: '', positionId: null }
]
const APP_ROWS = [
  {
    id: 701, userId: 3, username: 'chenyu', displayName: '陈宇', status: 'active',
    currentPositionId: null, currentPositionName: null,
    requestedPositionId: 404, requestedPositionName: '市场研究岗', submittedAt: '2026-08-28 10:32'
  },
  {
    id: 702, userId: 2, username: 'li.na', displayName: '李娜', status: 'active',
    currentPositionId: 402, currentPositionName: '客户成功岗',
    requestedPositionId: 401, requestedPositionName: '经营分析岗', submittedAt: '2026-08-28 09:46'
  }
]

const paneApps = () => container.querySelector('.pm-pane-applications')
const paneAssign = () => container.querySelector('.pm-pane-assignments')
function appRowButton(rowIndex, text) {
  const rows = [...paneApps().querySelectorAll('.el-row')]
  return [...rows[rowIndex].querySelectorAll('.el-button')].find((b) => b.textContent.includes(text))
}

beforeEach(() => {
  vi.clearAllMocks()
  listPositionAssignments.mockResolvedValue({ list: ROWS, total: 2 })
  listPositionApplications.mockResolvedValue({ list: APP_ROWS, total: 2 })
  countPendingApplications.mockResolvedValue({ count: 2 })
  approveApi.mockResolvedValue({})
  rejectApi.mockResolvedValue({})
  reboundApi.mockResolvedValue({})
  listPositions.mockResolvedValue({ list: [{ positionId: 'ps_1', name: '销售' }], total: 1 })
  ElMessageBox.confirm.mockResolvedValue()
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('AdminPositionAssignments —— 岗位管理双页签（2026-09-04 PRD-20260903 对齐）', () => {
  it('页头标题「岗位管理」+ 副标题照 md；默认进「用户岗位分配」页签', async () => {
    await mount()
    expect(container.querySelector('.page-header').textContent).toBe(
      '岗位管理|管理用户岗位绑定，支持直接分配与处理用户岗位申请。'
    )
    expect(container.querySelector('.el-tabs').getAttribute('data-active')).toBe('assignments')
    expect(paneAssign().style.display).not.toBe('none')
    expect(paneApps().style.display).toBe('none')
  })

  it('挂载即拉分配列表、已发布岗位选项、申请列表与徽标计数', async () => {
    await mount()
    expect(listPositionAssignments).toHaveBeenCalledTimes(1)
    expect(listPositions).toHaveBeenCalledWith(expect.objectContaining({ status: 'published' }))
    expect(listPositionApplications).toHaveBeenCalledTimes(1)
    expect(countPendingApplications).toHaveBeenCalledTimes(1)
  })

  it('审批页签徽标显示待审核数量；数量为 0 时不展示徽标', async () => {
    await mount()
    const tabBtn = container.querySelector('.el-tab-btn[data-name="applications"]')
    expect(tabBtn.textContent).toContain('岗位申请审批')
    expect(tabBtn.querySelector('.pm-count')?.textContent).toBe('2')
    app.unmount()
    container.remove()

    countPendingApplications.mockResolvedValue({ count: 0 })
    await mount()
    expect(container.querySelector('.el-tab-btn[data-name="applications"] .pm-count')).toBeNull()
  })

  it('分配页签渲染行：显示名占位「—」、有岗位显示岗位名、无岗位显示「未绑定」', async () => {
    await mount()
    const rows = [...paneAssign().querySelectorAll('.el-row')]
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('销售')
    expect(rows[1].textContent).toContain('未绑定')
    expect(rows[1].textContent).toContain('—') // bob 显示名为空 → 占位
  })

  it('分配列表加载失败 → 展示「加载失败」；无数据 → 「没有匹配的用户」', async () => {
    listPositionAssignments.mockRejectedValueOnce(new Error('boom'))
    await mount()
    expect(paneAssign().querySelector('.el-empty')?.textContent).toContain('加载失败')
    app.unmount()
    container.remove()

    listPositionAssignments.mockResolvedValueOnce({ list: [], total: 0 })
    await mount()
    expect(paneAssign().querySelector('.el-empty')?.textContent).toContain('没有匹配的用户')
  })

  it('点「修改绑定」→ 弹窗可见、传入该行副本、非 forceSave', async () => {
    await mount()
    const rows = [...paneAssign().querySelectorAll('.el-row')]
    const editBtn = [...rows[0].querySelectorAll('.el-button')].find((b) => b.textContent.includes('修改绑定'))
    editBtn.click()
    await nextTick()
    const dlg = container.querySelector('.edit-dialog')
    expect(dlg.getAttribute('data-visible')).toBe('true')
    expect(dlg.getAttribute('data-user')).toBe('alice')
    expect(dlg.getAttribute('data-force')).toBe('false')
  })

  it('切到审批页签：行渲染（用户名/现有绑定「未绑定」/申请岗位/提交时间/三枚操作）', async () => {
    await mount()
    container.querySelector('.el-tab-btn[data-name="applications"]').click()
    await flush()
    expect(container.querySelector('.el-tabs').getAttribute('data-active')).toBe('applications')
    const rows = [...paneApps().querySelectorAll('.el-row')]
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('chenyu')
    expect(rows[0].textContent).toContain('未绑定') // 现有绑定为空
    expect(rows[0].textContent).toContain('市场研究岗')
    expect(rows[0].textContent).toContain('2026-08-28 10:32')
    for (const t of ['通过', '驳回', '重新绑定']) expect(appRowButton(0, t)).toBeTruthy()
    expect(rows[1].textContent).toContain('客户成功岗') // 李娜现有绑定
  })

  it('审批页签空态：「暂无待审核的岗位申请」+ 副文案', async () => {
    listPositionApplications.mockResolvedValue({ list: [], total: 0 })
    await mount()
    const empty = paneApps().querySelector('.el-empty')
    expect(empty.textContent).toContain('暂无待审核的岗位申请')
    expect(empty.textContent).toContain('新的用户岗位申请会显示在这里')
  })

  it('【通过】确认弹窗（标题/按钮文案照 md §4.3.1）→ 调用通过接口 + 成功 toast + 三处联动刷新', async () => {
    await mount()
    appRowButton(0, '通过').click()
    await flush()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      expect.anything(),
      '确认通过岗位申请',
      expect.objectContaining({ confirmButtonText: '确认通过' })
    )
    expect(approveApi).toHaveBeenCalledWith(701)
    expect(ElMessage.success).toHaveBeenCalledWith('岗位申请已通过，绑定已更新')
    // 联动刷新：申请列表 / 徽标计数 / 分配列表（绑定变了）各 +1 次
    expect(listPositionApplications).toHaveBeenCalledTimes(2)
    expect(countPendingApplications).toHaveBeenCalledTimes(2)
    expect(listPositionAssignments).toHaveBeenCalledTimes(2)
  })

  it('【通过】取消确认 → 不调接口不刷新', async () => {
    await mount()
    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    appRowButton(0, '通过').click()
    await flush()
    expect(approveApi).not.toHaveBeenCalled()
    expect(listPositionApplications).toHaveBeenCalledTimes(1)
  })

  it('【驳回】打开弹窗（标题「驳回岗位申请」）→ 确认上抛原因 → 调驳回接口 + toast + 关闭刷新', async () => {
    await mount()
    appRowButton(0, '驳回').click()
    await nextTick()
    const dlg = container.querySelector('.reject-dialog')
    expect(dlg.getAttribute('data-visible')).toBe('true')
    expect(dlg.getAttribute('data-title')).toBe('驳回岗位申请')
    dlg.querySelector('.reject-confirm').click()
    await flush()
    expect(rejectApi).toHaveBeenCalledWith(701, '岗位编制已满')
    expect(ElMessage.success).toHaveBeenCalledWith('岗位申请已驳回')
    expect(dlg.getAttribute('data-visible')).toBe('false')
    expect(listPositionApplications).toHaveBeenCalledTimes(2)
    expect(countPendingApplications).toHaveBeenCalledTimes(2)
    // 驳回不改变绑定 → 分配列表无须刷新
    expect(listPositionAssignments).toHaveBeenCalledTimes(1)
  })

  it('【重新绑定】复用修改绑定弹窗（forceSave + 现有绑定回填）；保存后标记已重新绑定并回分配页签置顶', async () => {
    await mount()
    container.querySelector('.el-tab-btn[data-name="applications"]').click()
    await nextTick()
    appRowButton(1, '重新绑定').click() // 李娜（702，现绑 402）
    await nextTick()
    const dlg = container.querySelector('.edit-dialog')
    expect(dlg.getAttribute('data-visible')).toBe('true')
    expect(dlg.getAttribute('data-user')).toBe('li.na')
    expect(dlg.getAttribute('data-force')).toBe('true')

    dlg.querySelector('.edit-save').click()
    await flush()
    // 申请标记「已重新绑定」
    expect(reboundApi).toHaveBeenCalledWith(702)
    // 自动切回分配页签
    expect(container.querySelector('.el-tabs').getAttribute('data-active')).toBe('assignments')
    // 清筛选 + 该用户置顶（focusUserId 随查询下发）
    const lastCall = listPositionAssignments.mock.calls.at(-1)[0]
    expect(lastCall).toEqual(expect.objectContaining({ focusUserId: 2, page: 1 }))
    expect(lastCall.keyword).toBeUndefined()
    expect(lastCall.status).toBeUndefined()
    // 申请列表与徽标同步刷新
    expect(listPositionApplications).toHaveBeenCalledTimes(2)
    expect(countPendingApplications).toHaveBeenCalledTimes(2)
  })
})
