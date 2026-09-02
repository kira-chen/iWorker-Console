// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, provide, inject, nextTick } from 'vue'

/**
 * AdminPositions.vue 操作列回归 —— 2026-09-01 PRD 对齐改造取代旧口径（原「以技能为标准」五项操作断言）。
 *
 * 新口径（照交互原型 v2 positionActions，约 L1170）：
 * - 编辑恒显，审核中 disabled + title「审核中不可编辑」；
 * - 审核中 → 【撤回】（简单确认「撤回审核申请」，Q5 强确认已降级）；
 * - 未发布 → 【发布】（先校验技能数，Q3 不弹确认窗，直接开版本管理侧栏）+【删除】（简单确认）；
 * - 已发布 → 【停用】（领用数>0 先拦提示窗；否则简单确认提交停用审核）+【版本管理】；
 * - 【查看】暂不实现（Q4 待拍板）。
 */

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('@element-plus/icons-vue', () => ({ Plus: {}, Search: {} }))

const listPositions = vi.fn()
const createPosition = vi.fn()
const unpublishPosition = vi.fn()
const deletePosition = vi.fn()
const withdrawPosition = vi.fn()
const getPosition = vi.fn()
vi.mock('@/api/position', () => ({
  listPositions: (...a) => listPositions(...a),
  createPosition: (...a) => createPosition(...a),
  unpublishPosition: (...a) => unpublishPosition(...a),
  deletePosition: (...a) => deletePosition(...a),
  withdrawPosition: (...a) => withdrawPosition(...a),
  getPosition: (...a) => getPosition(...a),
  // 版本抽屉适配器所需（本页只组装 adapter，不直接调用）
  publishPosition: vi.fn(),
  getNextVersionLabel: vi.fn(),
  listPositionPublications: vi.fn(),
  delistPositionPublication: vi.fn(),
  relistPositionPublication: vi.fn()
}))
vi.mock('@/api/dataTable', () => ({ listDataTables: vi.fn().mockResolvedValue([]) }))

const ElMessage = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() })
const ElMessageBox = { prompt: vi.fn(), confirm: vi.fn(), alert: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage, ElMessageBox }))
vi.mock('@/assets/connector.css', () => ({}))
vi.mock('@/components/PageHeader.vue', () => ({ default: { template: '<div class="page-header"><slot name="actions" /></div>' } }))
vi.mock('@/components/StatusTag.vue', () => ({ default: { props: ['type'], template: '<span class="status-tag"><slot /></span>' } }))
vi.mock('@/components/admin/ListStates.vue', () => ({ default: { template: '<div class="list-states"><slot /></div>' } }))
vi.mock('@/components/admin/ListPagination.vue', () => ({ default: { template: '<div class="list-pager" />' } }))
// 版本管理已由三个同构弹窗合并为统一 VersionDrawer（2026-08-23），入参改为 adapter。
vi.mock('@/components/admin/VersionDrawer.vue', () => ({ default: { props: ['modelValue', 'adapter'], template: '<div class="ver-dialog" :data-open="modelValue" :data-entity="adapter?.entityLabel" :data-title="adapter?.title" />' } }))
vi.mock('@/components/test/EffectTestStage.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/utils/featureFlags', () => ({ EFFECT_TEST_ENABLED: false }))

const AdminPositions = (await import('@/views/admin/AdminPositions.vue')).default

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
// 编辑按钮审核中 disabled + title 断言需要真实透传 disabled/title
const elButton = {
  props: { disabled: { type: Boolean, default: false }, title: { type: String, default: undefined } },
  emits: ['click'],
  template: '<button class="el-button" :disabled="disabled" :title="title" @click="!disabled && $emit(\'click\')"><slot /></button>'
}

let app, container
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(AdminPositions)
  for (const t of ['el-input', 'el-select', 'el-option', 'el-icon']) app.component(t, passthrough(t))
  app.component('el-table', tableStub)
  app.component('el-table-column', tableColStub)
  app.component('el-button', elButton)
  app.directive('loading', {})
  app.mount(container)
  await nextTick(); await Promise.resolve(); await Promise.resolve(); await nextTick()
  return container
}

// 五态样本：已发布(有领用) / 已发布(零领用) / 未发布(无技能) / 未发布(有技能) / 审核中(停用在审)
const ROWS = [
  { positionId: 'ps_pub', name: '销售', description: '卖货', agentCount: 2, skillCount: 3, claimedUserCount: 5, status: 'published', pendingAction: null, latestVersion: 'v1.0.0', updatedAt: '2026-08-25T16:20:00+08:00' },
  { positionId: 'ps_pub0', name: '零领用岗', description: '', agentCount: 1, skillCount: 1, claimedUserCount: 0, status: 'published', pendingAction: null, latestVersion: 'v1.1.0', updatedAt: '2026-08-24T10:00:00+08:00' },
  { positionId: 'ps_draft', name: '草稿岗', description: '', agentCount: 0, skillCount: 0, claimedUserCount: 0, status: 'draft', pendingAction: null, latestVersion: '', updatedAt: '2026-08-23T09:00:00+08:00' },
  { positionId: 'ps_draft_ok', name: '可发布草稿岗', description: '', agentCount: 1, skillCount: 2, claimedUserCount: 0, status: 'draft', pendingAction: null, latestVersion: '', updatedAt: '2026-08-22T09:00:00+08:00' },
  { positionId: 'ps_reviewing', name: '停用中岗', description: '', agentCount: 1, skillCount: 1, claimedUserCount: 0, status: 'published', pendingAction: 'DELIST', latestVersion: 'v1.0.0', updatedAt: '2026-08-21T09:00:00+08:00' }
]

function rowByName(name) {
  return [...container.querySelectorAll('.el-row')].find((r) => r.textContent.includes(name))
}
function btns(row) {
  return [...row.querySelectorAll('.el-button')]
}
function btn(row, text) {
  return btns(row).find((b) => b.textContent.trim() === text)
}

beforeEach(() => {
  push.mockReset()
  listPositions.mockReset().mockResolvedValue({ list: ROWS, total: ROWS.length })
  unpublishPosition.mockReset().mockResolvedValue({})
  deletePosition.mockReset().mockResolvedValue({})
  withdrawPosition.mockReset().mockResolvedValue({})
  ElMessageBox.prompt.mockReset()
  ElMessageBox.confirm.mockReset().mockResolvedValue()
  ElMessageBox.alert.mockReset().mockResolvedValue()
  ElMessage.success.mockReset(); ElMessage.error.mockReset(); ElMessage.warning.mockReset()
})
afterEach(() => { app?.unmount(); container?.remove() })

describe('AdminPositions 操作列（原型 positionActions 口径）', () => {
  it('① 编辑 → 跳岗位配置台（PositionWorkbench）；审核中行编辑 disabled + title 提示', async () => {
    await mount()
    btn(rowByName('销售'), '编辑').click()
    await nextTick()
    expect(push).toHaveBeenCalledWith({ name: 'PositionWorkbench', params: { id: 'ps_pub' } })
    const reviewingEdit = btn(rowByName('停用中岗'), '编辑')
    expect(reviewingEdit.disabled).toBe(true)
    expect(reviewingEdit.getAttribute('title')).toBe('审核中不可编辑')
    reviewingEdit.click()
    await nextTick()
    expect(push).toHaveBeenCalledTimes(1) // 置灰后点击不跳转
  })

  it('② 版本管理（仅已发布行）→ 打开版本管理抽屉，带岗位适配器与「版本管理」标题', async () => {
    await mount()
    const el = () => container.querySelector('.ver-dialog')
    expect(el().getAttribute('data-open')).toBe('false')
    expect(btn(rowByName('草稿岗'), '版本管理')).toBeUndefined() // 未发布行无版本管理入口
    btn(rowByName('销售'), '版本管理').click()
    await nextTick()
    expect(el().getAttribute('data-open')).toBe('true')
    expect(el().getAttribute('data-entity')).toBe('岗位')
    expect(el().getAttribute('data-title')).toBe('版本管理')
  })

  it('②b 发布（未发布行，Q3 不弹确认窗）：无技能 toast 拦下；有技能直接开版本管理侧栏', async () => {
    await mount()
    const el = () => container.querySelector('.ver-dialog')
    btn(rowByName('草稿岗'), '发布').click()
    await nextTick()
    expect(ElMessage.warning).toHaveBeenCalledWith('至少关联 1 个岗位私有技能才能发布')
    expect(el().getAttribute('data-open')).toBe('false')
    btn(rowByName('可发布草稿岗'), '发布').click()
    await nextTick()
    expect(el().getAttribute('data-open')).toBe('true')
    expect(ElMessageBox.confirm).not.toHaveBeenCalled() // 不弹确认窗
  })

  it('③ 停用（Q5 降级为简单确认）：确认后 unpublishPosition + toast「已提交停用审核」', async () => {
    await mount()
    btn(rowByName('零领用岗'), '停用').click()
    await Promise.resolve(); await Promise.resolve(); await nextTick()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '停用「零领用岗」需提交审核。审核通过前客户端仍可使用。',
      '停用岗位',
      expect.objectContaining({ confirmButtonText: '提交停用审核' })
    )
    expect(ElMessageBox.prompt).not.toHaveBeenCalled() // 不再输入岗位名强确认
    expect(unpublishPosition).toHaveBeenCalledWith('ps_pub0')
    expect(ElMessage.success).toHaveBeenCalledWith('已提交停用审核')
  })

  it('③b 停用拦截：领用数>0 → 提示窗「知道了」，不执行停用', async () => {
    await mount()
    btn(rowByName('销售'), '停用').click()
    await Promise.resolve(); await Promise.resolve(); await nextTick()
    expect(ElMessageBox.alert).toHaveBeenCalledWith(
      '当前有 5 个用户领用该岗位，请先解除领用后再停用。',
      '停用岗位',
      expect.objectContaining({ confirmButtonText: '知道了' })
    )
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    expect(unpublishPosition).not.toHaveBeenCalled()
  })

  it('③c 停用仅已发布且无待审时显示：草稿/停用审核中行无「停用」按钮', async () => {
    await mount()
    expect(btn(rowByName('销售'), '停用')).toBeTruthy()          // 已发布无待审 → 有
    expect(btn(rowByName('草稿岗'), '停用')).toBeUndefined()      // 草稿 → 无
    expect(btn(rowByName('停用中岗'), '停用')).toBeUndefined()    // 已在审 → 无
  })

  it('④ 删除前置门：仅未发布可删——草稿有删除按钮，已发布/审核中无', async () => {
    await mount()
    expect(btn(rowByName('草稿岗'), '删除')).toBeTruthy()          // 未发布 → 可删
    expect(btn(rowByName('销售'), '删除')).toBeUndefined()         // 已发布 → 隐藏
    expect(btn(rowByName('停用中岗'), '删除')).toBeUndefined()     // 审核中 → 隐藏
  })

  it('④b 删除流程（Q5 降级为简单确认）：确认文案带技能关联数 → deletePosition → 重拉', async () => {
    await mount()
    btn(rowByName('可发布草稿岗'), '删除').click()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await nextTick()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '删除「可发布草稿岗」后会解除 2 条岗位技能关联。确认删除？',
      '删除岗位',
      expect.objectContaining({ confirmButtonText: '删除' })
    )
    expect(deletePosition).toHaveBeenCalledWith('ps_draft_ok', '可发布草稿岗')
    expect(ElMessage.success).toHaveBeenCalledWith('岗位已删除')
    expect(listPositions).toHaveBeenCalledTimes(2) // 初次 + 删后重拉
  })

  it('⑤ 撤回（审核中行）：确认「撤回审核申请」→ withdrawPosition + toast「审核申请已撤回」', async () => {
    await mount()
    btn(rowByName('停用中岗'), '撤回').click()
    await Promise.resolve(); await Promise.resolve(); await nextTick()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '「停用中岗」当前处于审核中。撤回后回到修改前状态。',
      '撤回审核申请',
      expect.objectContaining({ confirmButtonText: '撤回申请' })
    )
    expect(withdrawPosition).toHaveBeenCalledWith('ps_reviewing')
    expect(ElMessage.success).toHaveBeenCalledWith('审核申请已撤回')
    expect(listPositions).toHaveBeenCalledTimes(2) // 撤回后重拉
  })

  it('⑥ 状态三态展示映射（Q6 展示层）：未发布 / 审核中 / 已发布', async () => {
    await mount()
    expect(rowByName('销售').querySelector('.status-tag').textContent).toBe('已发布')
    expect(rowByName('草稿岗').querySelector('.status-tag').textContent).toBe('未发布')
    expect(rowByName('停用中岗').querySelector('.status-tag').textContent).toBe('审核中')
  })
})
