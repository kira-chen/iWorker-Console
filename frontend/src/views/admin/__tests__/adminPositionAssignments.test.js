// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, provide, inject, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { passthrough, elEmpty } from './helpers/commonStubs'

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
 *
 * 2026-10-08 对齐 docs/PRD/数字员工管理端PRD/02岗位/岗位管理/prd.岗位管理.md §二.5 / §4.2（批量绑定，此前零用例）：
 * 未勾选【批量绑定】置灰；勾选后按钮带已选数徽标、弹窗「已选 N 名用户」；未选岗位 →「请选择要绑定的岗位」；
 * 二次确认文案「将 N 名用户（…）统一绑定至「X」？」；取消确认不绑定；确认后逐个 setUserPosition；
 * 有 pendingRequestId 的用户补调 markApplicationAssigned（待办 yuepu#9② 回归）；
 * 成功 toast「已将 N 名用户绑定至「X」」、关弹窗、清勾选、重拉列表与待分配计数；失败 → 错误提示、弹窗保持。
 * 注：「未勾选时按钮置灰」现状不符 md，已登记 yuepu#60②，此处不钉。
 */

const listPositionAssignments = vi.fn()
const countPendingApplications = vi.fn()
const markApplicationAssignedApi = vi.fn()
const listPositions = vi.fn(() => Promise.resolve({ list: [], total: 0 }))
const setUserPositionApi = vi.fn()
const clearSelectionSpy = vi.fn()

vi.mock('@/api/positionAssignment', () => ({
  listPositionAssignments: (...a) => listPositionAssignments(...a),
  countPendingApplications: (...a) => countPendingApplications(...a),
  markApplicationAssigned: (...a) => markApplicationAssignedApi(...a),
  setUserPosition: (...a) => setUserPositionApi(...a)
}))
vi.mock('@/api/position', () => ({ listPositions: (...a) => listPositions(...a) }))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
  ElMessageBox: { confirm: vi.fn() }
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
      '<button class="edit-save" @click="$emit(\'saved\', { positionId: \'ps_1\' })" />' +
      '<button class="edit-save-unbound" @click="$emit(\'saved\', { positionId: null })" /></div>'
  }
}))
vi.mock('@/assets/connector.css', () => ({}))
// 页面读 route.query.keyword（访问审计「查看」跳转注入），本测试无路由实例，给个空 query
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))

const AdminPositionAssignments = (await import('@/views/admin/AdminPositionAssignments.vue')).default

// —— el-table 逐行注入 row 存根 ——
const ROW_KEY = Symbol('row')
// 每行前置一个 .row-check 勾选框模拟 type="selection" 列；勾选变化按行序 emit selection-change；
// 暴露 clearSelection（页面批量绑定成功后经 tableRef 调用）
const tableStub = {
  name: 'el-table',
  props: { data: { type: Array, default: () => [] } },
  emits: ['selection-change'],
  setup(props, { slots, emit, expose }) {
    const picked = new Set()
    const toggle = (row, on) => {
      if (on) picked.add(row)
      else picked.delete(row)
      emit('selection-change', props.data.filter((r) => picked.has(r)))
    }
    expose({
      clearSelection() {
        clearSelectionSpy()
        picked.clear()
      }
    })
    return () =>
      h('div', { class: 'el-table' }, props.data.map((row, i) => h(RowCells, { row, colSlot: slots.default, onToggle: (on) => toggle(row, on), key: i })))
  }
}
const RowCells = {
  props: { row: { type: Object, required: true }, colSlot: { type: Function, required: true } },
  emits: ['toggle'],
  setup(props, { emit }) {
    provide(ROW_KEY, props.row)
    return () =>
      h('div', { class: 'el-row' }, [
        h('input', { type: 'checkbox', class: 'row-check', onChange: (e) => emit('toggle', e.target.checked) }),
        props.colSlot?.()
      ])
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
const pager = { name: 'el-pagination', template: '<div class="el-pagination" />' }
const elDialog = {
  props: ['modelValue', 'title'],
  emits: ['update:modelValue'],
  template:
    '<div v-if="modelValue" class="el-dialog" :data-title="title"><slot /><div class="el-dialog__footer"><slot name="footer" /></div></div>'
}

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
  app.component('el-dialog', elDialog)
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
  setUserPositionApi.mockResolvedValue({})
  ElMessageBox.confirm.mockResolvedValue('confirm')
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

  it('有待分配申请的用户在弹窗里选「未绑定」保存 → 申请不标为已分配、徽标不减、不置顶高亮，只刷新列表（md §五：选择合适岗位并保存才算处理；yuepu#57⑦）', async () => {
    await mount()
    const rows = [...container.querySelectorAll('.el-row')]
    ;[...rows[1].querySelectorAll('.el-button')].find((b) => b.textContent.includes('分配岗位')).click()
    await nextTick()
    container.querySelector('.edit-save-unbound').click()
    await flush()
    expect(markApplicationAssignedApi).not.toHaveBeenCalled()
    expect(countPendingApplications).toHaveBeenCalledTimes(1) // 只有挂载时那一次
    const lastCall = listPositionAssignments.mock.calls.at(-1)[0]
    expect(lastCall?.focusUserId).toBeUndefined()
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

// —— 批量绑定小工具 ——
const btnByText = (root, text) => [...root.querySelectorAll('.el-button')].find((b) => b.textContent.trim().startsWith(text))
const batchBtn = () => btnByText(container.querySelector('.list-toolbar') || container, '批量绑定')
async function tick(row) {
  const box = container.querySelectorAll('.row-check')[row]
  box.checked = true
  box.dispatchEvent(new Event('change'))
  await flush()
}
async function openBatchWith(rowIdxs) {
  for (const i of rowIdxs) await tick(i)
  batchBtn().click()
  await flush()
  return container.querySelector('.el-dialog[data-title="批量绑定岗位"]')
}
async function pickPosition(dlg, positionId) {
  const sel = dlg.querySelector('select.el-select')
  sel.value = positionId
  sel.dispatchEvent(new Event('change'))
  await flush()
}
const confirmBind = async (dlg) => {
  btnByText(dlg, '确认绑定').click()
  await flush()
}

describe('AdminPositionAssignments —— 批量绑定（2026-10-08 对齐岗位管理 md §二.5 / §4.2）', () => {
  it('未勾选任何用户 →【批量绑定】置灰不可点（md §二.5「勾选用户后激活，未勾选时置灰」），点击不弹批量绑定弹窗；勾选后激活', async () => {
    await mount()
    expect(batchBtn().disabled).toBe(true)
    batchBtn().click()
    await flush()
    expect(container.querySelector('.el-dialog[data-title="批量绑定岗位"]')).toBeNull()
    await tick(0)
    expect(batchBtn().disabled).toBe(false)
  })

  it('勾选 2 名用户 →【批量绑定】按钮右侧徽标显示 2；打开弹窗顶部写「已选 2 名用户」', async () => {
    await mount()
    const dlg = await openBatchWith([0, 1])
    expect(batchBtn().querySelector('.pm-count')?.textContent).toBe('2')
    expect(dlg).toBeTruthy()
    expect(dlg.querySelector('.batch-tip').textContent.replace(/\s+/g, '')).toBe('已选2名用户，请选择要统一绑定的岗位：')
  })

  it('批量弹窗岗位下拉只列已发布岗位（销售），不列未发布草稿（草稿岗）', async () => {
    listPositions.mockResolvedValue({
      list: [
        { positionId: 'ps_1', name: '销售', status: 'published' },
        { positionId: 'ps_9', name: '草稿岗', status: 'draft' }
      ],
      total: 2
    })
    await mount()
    const dlg = await openBatchWith([0])
    const labels = [...dlg.querySelectorAll('option')].map((o) => o.textContent)
    expect(labels).toEqual(['销售'])
  })

  it('弹窗里没选岗位就点【确认绑定】→ 提示「请选择要绑定的岗位」，不弹二次确认、不绑定', async () => {
    await mount()
    const dlg = await openBatchWith([0])
    await confirmBind(dlg)
    expect(ElMessage.warning).toHaveBeenCalledWith('请选择要绑定的岗位')
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    expect(setUserPositionApi).not.toHaveBeenCalled()
  })

  it('选了岗位点【确认绑定】→ 二次确认写明人数、涉及用户与目标岗位：「将 2 名用户（alice、bob）统一绑定至「销售」？」', async () => {
    await mount()
    const dlg = await openBatchWith([0, 1])
    await pickPosition(dlg, 'ps_1')
    await confirmBind(dlg)
    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
    const [msg, title] = ElMessageBox.confirm.mock.calls[0]
    expect(msg).toBe('将 2 名用户（alice、bob）统一绑定至「销售」？')
    expect(title).toBe('批量绑定确认')
  })

  it('二次确认点【取消】→ 一个用户都不绑定，批量弹窗仍开着', async () => {
    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    await mount()
    const dlg = await openBatchWith([0, 1])
    await pickPosition(dlg, 'ps_1')
    await confirmBind(dlg)
    expect(setUserPositionApi).not.toHaveBeenCalled()
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(container.querySelector('.el-dialog[data-title="批量绑定岗位"]')).toBeTruthy()
  })

  it('确认后逐个更新绑定：每名勾选用户各调一次 setUserPosition(用户 ID, 所选岗位)', async () => {
    await mount()
    const dlg = await openBatchWith([0, 1])
    await pickPosition(dlg, 'ps_1')
    await confirmBind(dlg)
    expect(setUserPositionApi).toHaveBeenCalledTimes(2)
    expect(setUserPositionApi).toHaveBeenCalledWith(11, 'ps_1')
    expect(setUserPositionApi).toHaveBeenCalledWith(12, 'ps_1')
  })

  it('勾选里有待分配申请的用户（bob）→ 绑定后把他的申请标记为已分配；无申请的 alice 不标记（yuepu#9② 回归）', async () => {
    await mount()
    const dlg = await openBatchWith([0, 1])
    await pickPosition(dlg, 'ps_1')
    await confirmBind(dlg)
    expect(markApplicationAssignedApi).toHaveBeenCalledTimes(1)
    expect(markApplicationAssignedApi).toHaveBeenCalledWith(801)
  })

  it('全部绑完 → 提示「已将 2 名用户绑定至「销售」」，弹窗关闭，勾选清空（徽标消失），列表与待分配计数重拉', async () => {
    await mount()
    const dlg = await openBatchWith([0, 1])
    await pickPosition(dlg, 'ps_1')
    const listCallsBefore = listPositionAssignments.mock.calls.length
    const countCallsBefore = countPendingApplications.mock.calls.length
    await confirmBind(dlg)
    expect(ElMessage.success).toHaveBeenCalledWith('已将 2 名用户绑定至「销售」')
    expect(container.querySelector('.el-dialog[data-title="批量绑定岗位"]')).toBeNull()
    expect(clearSelectionSpy).toHaveBeenCalledTimes(1)
    expect(batchBtn().querySelector('.pm-count')).toBeNull()
    expect(listPositionAssignments.mock.calls.length).toBe(listCallsBefore + 1)
    expect(countPendingApplications.mock.calls.length).toBe(countCallsBefore + 1)
  })

  it('某个用户绑定失败 → 弹出失败原因，不提示成功，批量弹窗保持打开', async () => {
    setUserPositionApi.mockImplementation((uid) => (uid === 12 ? Promise.reject(new Error('岗位未发布')) : Promise.resolve({})))
    await mount()
    const dlg = await openBatchWith([0, 1])
    await pickPosition(dlg, 'ps_1')
    await confirmBind(dlg)
    expect(ElMessage.error).toHaveBeenCalledWith('岗位未发布')
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(container.querySelector('.el-dialog[data-title="批量绑定岗位"]')).toBeTruthy()
  })
})
