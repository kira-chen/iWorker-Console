// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import { makeElTableStubs } from './helpers/elTableStub'
import { passthrough } from './helpers/commonStubs'

/**
 * AdminPositions.vue 操作列回归 —— 2026-09-01 PRD 对齐改造取代旧口径（原「以技能为标准」五项操作断言）。
 *
 * 新口径（对齐 md 02岗位/岗位/prd.岗位.md §二.3 操作列；历史出处：交互原型 v2 positionActions 约 L1170）：
 * - 编辑恒显，审核中 disabled + title「审核中不可编辑」；
 * - 审核中 → 【撤回】（确认说明撤回后恢复提交审核前状态，toast「已撤回」）；
 * - 未发布 → 【发布】（先跑 md §9.1 九项完整性校验，Q3 不弹确认窗，通过则打开发布前检查弹窗 md §三.9.2）
 *   +【删除】（领用护栏 + 确认文案照新 md）；
 * - 已发布 → 【停用】（领用护栏文案照新 md；否则确认提交停用审核）+【版本管理】（冻结保留）；
 * - 【查看】固定恒显 → 岗位详情页只读态（query.view=1）。
 *
 * 2026-09-04 PRD-20260903 对齐：停用/删除/撤回文案、领用护栏与【查看】断言按新口径重写。
 * 2026-09-12 测试审计：T39 el-table 桩改用 helpers/elTableStub（renderHeader 开，供列头排序按钮断言）；
 *   T53 补「最近更新时间」toggleSort（md §二.2 L53）、草稿【删除】title「删除前需二次确认」（md §二.3.1 L62）；
 *   T48 真实 ListPagination/ListStates 挂载 + 「加载失败 + 重试」在单独文件 adminPositionsSmoke.test.js（vi.mock 文件级）。
 *
 * 2026-10-08 对齐 docs/PRD/数字员工管理端PRD/02岗位/岗位/prd.岗位.md §一.1 / §一.2 / §二.5 补：
 *  - 工具栏：关键字只在回车 / 【查询】时生效（打字不刷新）；清空搜索框即按剩余条件刷新；
 *    状态筛选切换立即刷新，清空状态回落「全部状态」(all)；
 *  - 新建弹窗：岗位名称必填（空着点【创建岗位】不建）、输入框最多 64 个字符、超 64 被规则拦；
 *  - 防重复点击：停用提交中【停用】按钮 loading，再点不重复提交（unpublishPosition 只调一次）。
 */

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => ({ query: {} }) }))
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
// 2026-09-09 PRD 复核·G2（A1）：【发布】门改跑 md §9.1 九项完整性校验，需读岗位详情 + 自动化任务条数。
// 默认给「全项齐备」的详情，使既有操作列断言（发布 → 开版本侧栏）不变；缺项用例在下方各自覆写。
const listSampleTasks = vi.fn()
vi.mock('@/api/sampleTask', () => ({ listSampleTasks: (...a) => listSampleTasks(...a) }))

const ElMessage = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() })
const ElMessageBox = { prompt: vi.fn(), confirm: vi.fn(), alert: vi.fn() }
vi.mock('element-plus', () => ({ ElMessage, ElMessageBox }))
vi.mock('@/components/PageHeader.vue', () => ({ default: { template: '<div class="page-header"><slot name="actions" /></div>' } }))
vi.mock('@/components/StatusTag.vue', () => ({ default: { props: ['type'], template: '<span class="status-tag"><slot /></span>' } }))
vi.mock('@/components/admin/ListStates.vue', () => ({ default: { template: '<div class="list-states"><slot /></div>' } }))
vi.mock('@/components/admin/ListPagination.vue', () => ({ default: { template: '<div class="list-pager" />' } }))
// 版本管理已由三个同构弹窗合并为统一 VersionDrawer（2026-08-23），入参改为 adapter。
vi.mock('@/components/admin/VersionDrawer.vue', () => ({ default: { props: ['modelValue', 'adapter'], template: '<div class="ver-dialog" :data-open="modelValue" :data-entity="adapter?.entityLabel" :data-title="adapter?.title" />' } }))
// 发布前检查弹窗（2026-09-09 拍板：列表页【发布】改走它，与详情页同一组件）
vi.mock('@/components/position/PublishCheckDialog.vue', () => ({
  default: {
    props: ['visible', 'check', 'publishing', 'versionLabel', 'releaseNotes', 'bump', 'firstPublish', 'atMax', 'nextLoading'],
    template: '<div class="pub-check" :data-open="visible" :data-passed="check?.blockingPassed" />'
  }
}))
vi.mock('@/components/test/EffectTestStage.vue', () => ({ default: { template: '<div />' } }))
// featureFlags 局部 mock 必须与真实模块的导出保持一致，否则引用它的组件加载即报错。
// 2026-09-12 负责人决策 3（审计 J2）：FRONT_RUNTIME_ENABLED 随员工端整体退役删除，本 mock 同步去掉该键。
vi.mock('@/utils/featureFlags', () => ({ EFFECT_TEST_ENABLED: false, MCP_AUTH_CONFIG_ENABLED: true }))

const AdminPositions = (await import('@/views/admin/AdminPositions.vue')).default

// 共用 el-table 桩（T39）：renderHeader 开 → 表头阶段渲染 header 插槽，供「最近更新时间」排序按钮断言
const { tableStub, tableColStub } = makeElTableStubs({ renderHeader: true })
// 编辑按钮审核中 disabled + title 断言需要真实透传 disabled/title
const elButton = {
  props: { disabled: { type: Boolean, default: false }, title: { type: String, default: undefined } },
  emits: ['click'],
  template: '<button class="el-button" :disabled="disabled" :title="title" @click="!disabled && $emit(\'click\')"><slot /></button>'
}

let app, container
// 冲干净 microtask 队列（A1 发布门是 async：getPosition + listSampleTasks 两个 await 后才落 UI）
async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

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

// md §9.1 九项齐备的岗位详情（A1 发布门入参）：名称/图标/描述/领用页文案/示例问题 3 条/SOP/采集字段/Agent 与技能/自动化任务
const FULL_DETAIL = {
  name: '可发布草稿岗',
  icon: '▤',
  description: '描述',
  claimDescriptions: ['自动汇总经营数据'],
  exampleQuestions: ['q1', 'q2', 'q3'],
  positionSop: 'sop',
  intakeSchema: [{ label: '负责区域', key: 'region', type: 'text', required: true, options: [] }],
  agents: [{ name: 'A1', skills: [{ skillId: 1 }] }]
}

beforeEach(() => {
  push.mockReset()
  listPositions.mockReset().mockResolvedValue({ list: ROWS, total: ROWS.length })
  // 默认全项齐备 + 1 条自动化任务；单个用例可覆写以造缺项
  getPosition.mockReset().mockResolvedValue({ ...FULL_DETAIL })
  listSampleTasks.mockReset().mockResolvedValue({ list: [{ id: 1 }] })
  unpublishPosition.mockReset().mockResolvedValue({})
  deletePosition.mockReset().mockResolvedValue({})
  withdrawPosition.mockReset().mockResolvedValue({})
  ElMessageBox.prompt.mockReset()
  ElMessageBox.confirm.mockReset().mockResolvedValue()
  ElMessageBox.alert.mockReset().mockResolvedValue()
  ElMessage.success.mockReset(); ElMessage.error.mockReset(); ElMessage.warning.mockReset()
})
afterEach(() => { app?.unmount(); container?.remove() })

describe('AdminPositions 操作列（md §二.3；历史出处：原型 positionActions）', () => {
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

  it('①b 查看（固定操作，所有状态展示）→ 跳岗位详情页只读态（query.view=1）', async () => {
    await mount()
    // 已发布 / 未发布 / 审核中行均有【查看】
    for (const name of ['销售', '草稿岗', '停用中岗']) {
      expect(btn(rowByName(name), '查看')).toBeTruthy()
    }
    btn(rowByName('草稿岗'), '查看').click()
    await nextTick()
    expect(push).toHaveBeenCalledWith({ name: 'PositionWorkbench', params: { id: 'ps_draft' }, query: { view: '1' } })
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

  // 2026-09-09 PRD 复核·G2（A1 / md §9.1）：列表页【发布】门由「技能数≥1」改为与详情页共用的
  // 九项完整性校验（computeCompletenessMissing），缺项 toast「请先填写：…」并跳详情页对应页签。
  // 2026-09-09 负责人拍板：列表页与详情页两个【发布】入口行为一致，九项齐备后统一开
  // 「发布前检查弹窗」（md §3.3/§9.2）。原断言「直接开版本管理侧栏」是 Q3 旧口径（原型作
  // 基准时的处理），原型已退场故推翻。【版本管理】按钮仍走 VersionDrawer，见 ②e。
  it('②b 发布（未发布行）：九项齐备 → 开发布前检查弹窗，不开版本侧栏、不弹 confirm', async () => {
    await mount()
    btn(rowByName('可发布草稿岗'), '发布').click()
    await flush()
    expect(getPosition).toHaveBeenCalledWith('ps_draft_ok')
    expect(listSampleTasks).toHaveBeenCalledWith('ps_draft_ok')
    const dlg = container.querySelector('.pub-check')
    expect(dlg.getAttribute('data-open')).toBe('true')
    expect(dlg.getAttribute('data-passed')).toBe('true') // 九项齐备 → 可发布
    expect(container.querySelector('.ver-dialog').getAttribute('data-open')).not.toBe('true')
    expect(ElMessage.warning).not.toHaveBeenCalled()
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
  })

  it('②c 发布门（A1）：缺项 → toast「请先填写：…」+ 跳详情页第一个缺失项所在页签，不开侧栏', async () => {
    // 缺 岗位 SOP（persona 页签）+ Agent 与技能（agents 页签）+ 自动化任务（tasks 页签，md §1.3 L160）
    getPosition.mockResolvedValue({ ...FULL_DETAIL, positionSop: '', agents: [{ name: 'A1', skills: [] }] })
    listSampleTasks.mockResolvedValue({ list: [] })
    await mount()
    btn(rowByName('可发布草稿岗'), '发布').click()
    await flush()
    expect(ElMessage.warning).toHaveBeenCalledWith('请先填写：岗位 SOP、Agent 与技能、自动化任务')
    // 第一个缺失项 = 岗位 SOP → persona 页签
    expect(push).toHaveBeenCalledWith({
      name: 'PositionWorkbench',
      params: { id: 'ps_draft_ok' },
      query: { tab: 'persona' }
    })
    expect(container.querySelector('.ver-dialog').getAttribute('data-open')).toBe('false')
  })

  it('②d 发布门（A1）：岗位详情读取失败 → 报错不跳转、不开侧栏', async () => {
    getPosition.mockRejectedValue(new Error('boom'))
    await mount()
    btn(rowByName('可发布草稿岗'), '发布').click()
    await flush()
    expect(ElMessage.error).toHaveBeenCalledWith('boom')
    expect(push).not.toHaveBeenCalled()
    expect(container.querySelector('.ver-dialog').getAttribute('data-open')).toBe('false')
  })

  it('③ 停用（Q5 降级为简单确认）：确认后 unpublishPosition + toast「已提交停用审核」', async () => {
    await mount()
    btn(rowByName('零领用岗'), '停用').click()
    await Promise.resolve(); await Promise.resolve(); await nextTick()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '停用「零领用岗」需提交停用审核。审核通过前客户端仍可正常使用。',
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
      '该岗位已被 5 个用户领用，需先解除领用后再停用',
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

  it('④b 删除流程（2026-09-04 PRD-20260903 对齐）：确认文案照新 md → deletePosition → 重拉', async () => {
    await mount()
    btn(rowByName('可发布草稿岗'), '删除').click()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await nextTick()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '删除后「可发布草稿岗」将不可用，确认删除？',
      '删除岗位',
      expect.objectContaining({ confirmButtonText: '删除' })
    )
    expect(deletePosition).toHaveBeenCalledWith('ps_draft_ok', '可发布草稿岗')
    expect(ElMessage.success).toHaveBeenCalledWith('岗位已删除')
    expect(listPositions).toHaveBeenCalledTimes(2) // 初次 + 删后重拉
  })

  it('④c 删除领用护栏（2026-09-04 新 md）：被领用的未发布岗 → 提示先解除领用，不执行删除', async () => {
    listPositions.mockResolvedValue({
      list: [{ positionId: 'ps_claimed_draft', name: '被领用草稿岗', description: '', agentCount: 1, skillCount: 1, claimedUserCount: 3, status: 'draft', pendingAction: null, latestVersion: '', updatedAt: '2026-08-20T09:00:00+08:00' }],
      total: 1
    })
    await mount()
    btn(rowByName('被领用草稿岗'), '删除').click()
    await Promise.resolve(); await Promise.resolve(); await nextTick()
    expect(ElMessageBox.alert).toHaveBeenCalledWith(
      '该岗位已被 3 个用户领用，需先解除领用后再删除',
      '删除岗位',
      expect.objectContaining({ confirmButtonText: '知道了' })
    )
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    expect(deletePosition).not.toHaveBeenCalled()
  })

  it('⑤ 撤回（审核中行）：确认说明恢复提交审核前状态 → withdrawPosition + toast「已撤回」', async () => {
    await mount()
    btn(rowByName('停用中岗'), '撤回').click()
    await Promise.resolve(); await Promise.resolve(); await nextTick()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '「停用中岗」当前处于审核中。撤回后恢复提交审核前的状态。',
      '撤回审核申请',
      expect.objectContaining({ confirmButtonText: '撤回申请' })
    )
    expect(withdrawPosition).toHaveBeenCalledWith('ps_reviewing')
    expect(ElMessage.success).toHaveBeenCalledWith('已撤回')
    expect(listPositions).toHaveBeenCalledTimes(2) // 撤回后重拉
  })

  it('⑥ 状态三态展示映射（Q6 展示层）：未发布 / 审核中 / 已发布', async () => {
    await mount()
    expect(rowByName('销售').querySelector('.status-tag').textContent).toBe('已发布')
    expect(rowByName('草稿岗').querySelector('.status-tag').textContent).toBe('未发布')
    expect(rowByName('停用中岗').querySelector('.status-tag').textContent).toBe('审核中')
  })

  it('⑦ 列头「最近更新时间」默认 ↓（降序）；点一下 → listPositions sort=asc + ↑；再点 → desc + ↓（md §二.2 L53）', async () => {
    await mount()
    const sortBtn = () => container.querySelector('.el-head .time-sort')
    expect(sortBtn().textContent).toContain('最近更新时间')
    expect(sortBtn().querySelector('.time-sort-arrow').textContent).toBe('↓')
    expect(listPositions).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'desc' }))
    sortBtn().click()
    await flush()
    expect(listPositions).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'asc' }))
    expect(sortBtn().querySelector('.time-sort-arrow').textContent).toBe('↑')
    sortBtn().click()
    await flush()
    expect(listPositions).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'desc' }))
    expect(sortBtn().querySelector('.time-sort-arrow').textContent).toBe('↓')
    expect(listPositions).toHaveBeenCalledTimes(3)
  })

  it('⑧ 草稿行【删除】带悬停提示 title「删除前需二次确认」（md §二.3.1 L62）', async () => {
    await mount()
    expect(btn(rowByName('草稿岗'), '删除').getAttribute('title')).toBe('删除前需二次确认')
    expect(btn(rowByName('可发布草稿岗'), '删除').getAttribute('title')).toBe('删除前需二次确认')
  })
})

/**
 * 2026-09-08 原型复刻批次 2A（B2 新建弹窗 / B4 提交后关侧栏 / B6 名称格图标 / B7 列宽）。
 * el-dialog / el-form 在本文件按需 stub（上方 mount 未注册），此处单独挂。
 */
describe('AdminPositions · 新建弹窗 / 版本侧栏 / 名称格（md §一.1 新建入口、§二.1、§二.3.7；历史出处：原型复刻批次 2A）', () => {
  const elDialog = {
    name: 'el-dialog',
    props: ['modelValue', 'title', 'width', 'closeOnClickModal'],
    template:
      '<div class="el-dialog" :data-open="modelValue" :data-width="width" :data-ccm="String(closeOnClickModal)"><slot /><div class="dlg-footer"><slot name="footer" /></div></div>'
  }
  const elForm = {
    name: 'el-form',
    template: '<form><slot /></form>',
    methods: { validate() { return Promise.resolve(true) }, clearValidate() {} }
  }
  const elFormItem = { name: 'el-form-item', props: ['label', 'prop'], template: '<div class="el-form-item" :data-prop="prop"><label>{{ label }}</label><slot /></div>' }

  async function mount2A() {
    container = document.createElement('div')
    document.body.appendChild(container)
    app = createApp(AdminPositions)
    for (const t of ['el-input', 'el-select', 'el-option', 'el-icon']) app.component(t, passthrough(t))
    app.component('el-table', tableStub)
    app.component('el-table-column', tableColStub)
    app.component('el-button', elButton)
    app.component('el-dialog', elDialog)
    app.component('el-form', elForm)
    app.component('el-form-item', elFormItem)
    app.directive('loading', {})
    app.mount(container)
    await nextTick(); await Promise.resolve(); await Promise.resolve(); await nextTick()
    return container
  }
  const inst = () => app._instance

  it('B2 新建弹窗：520px、可点遮罩关闭、字段仅 岗位名称 + 岗位描述（无「岗位定位」）、按钮「创建岗位」', async () => {
    await mount2A()
    const openBtn = [...container.querySelectorAll('.el-button')].find((b) => b.textContent.includes('新建岗位'))
    openBtn.click(); await nextTick()
    const dlg = container.querySelector('.el-dialog')
    expect(dlg.dataset.open).toBe('true')
    expect(dlg.dataset.width).toBe('520px')
    expect(dlg.dataset.ccm).toBe('true')
    const labels = [...dlg.querySelectorAll('.el-form-item > label')].map((l) => l.textContent.trim())
    expect(labels).toEqual(['岗位名称', '岗位描述'])
    expect(dlg.textContent).not.toContain('岗位定位')
    expect([...dlg.querySelectorAll('.dlg-footer .el-button')].map((b) => b.textContent.trim())).toEqual(['取消', '创建岗位'])
  })

  it('B2 校验规则：岗位描述必填、上限 2000；创建成功 toast 后进岗位详情页', async () => {
    await mount2A()
    const rules = inst().setupState.createRules
    expect(rules.description[0]).toMatchObject({ required: true, message: '请填写岗位描述' })
    expect(rules.description[1]).toMatchObject({ max: 2000 })
    createPosition.mockResolvedValue({ positionId: 'ps_new' })
    inst().setupState.createForm.name = '经营分析岗'
    inst().setupState.createForm.description = '负责经营分析'
    inst().setupState.createVisible = true
    await nextTick()
    await inst().setupState.submitCreate()
    expect(createPosition).toHaveBeenCalledWith({ name: '经营分析岗', description: '负责经营分析' })
    expect(ElMessage.success).toHaveBeenCalledWith('岗位已创建，请完善岗位配置')
    expect(push).toHaveBeenCalledWith({ name: 'PositionWorkbench', params: { id: 'ps_new' } })
  })

  it('B4 岗位版本适配器带 closeOnSubmit=true（提交发布后关侧栏，原型 submitPositionVersion）', async () => {
    await mount2A()
    btn(rowByName('销售'), '版本管理').click(); await nextTick()
    expect(inst().setupState.versionAdapter.closeOnSubmit).toBe(true)
  })

  it('B6/B7 名称格：图标框 .pos-icon + 名称 .pos-name；状态 pill 已拆为独立列；描述 / 时间带单行类', async () => {
    await mount2A()
    const row = rowByName('销售')
    const primary = row.querySelector('.pos-primary')
    expect(primary.querySelector('.pos-icon')).toBeTruthy()
    expect(primary.querySelector('.pos-name-line .pos-name').textContent).toBe('销售')
    // 状态 pill 不再与名称同格（2026-09-11 负责人指示「按照设计图拆出来」，依据《列表页UI.png》
    // ——稿面「状态」是独立一列；此前「状态并入名称格」的口径作废）。
    expect(primary.querySelector('.status-tag')).toBeNull()
    // 但状态本身仍在行内，只是搬到了自己的列
    expect(row.querySelector('.status-tag')).toBeTruthy()
    expect(row.querySelector('.pos-desc').textContent).toBe('卖货')
    expect(row.querySelector('.pos-time')).toBeTruthy()
  })
})

describe('AdminPositions · 工具栏 / 新建弹窗必填 / 防重复点击（2026-10-08 对齐 md §一.1 / §一.2 / §二.5）', () => {
  // 工具栏桩：输入框 input 回写、带清空按钮（emit clear）；@keyup.enter 未声明 emits → 作原生监听透传到 <input>
  const tbInput = {
    name: 'el-input',
    props: ['modelValue', 'placeholder', 'maxlength', 'type'],
    emits: ['update:modelValue', 'clear', 'input'],
    template:
      '<span class="el-input-wrap"><input class="el-input" :placeholder="placeholder" :maxlength="maxlength" :value="modelValue" ' +
      '@input="$emit(\'update:modelValue\', $event.target.value); $emit(\'input\', $event.target.value)" />' +
      '<button type="button" class="el-input-clear" @click="$emit(\'update:modelValue\', \'\'); $emit(\'clear\')" /></span>'
  }
  const tbSelect = {
    name: 'el-select',
    props: ['modelValue', 'placeholder'],
    emits: ['update:modelValue', 'change'],
    template:
      '<select class="el-select" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\', $event.target.value)"><option value="" /><slot /></select>'
  }
  const tbOption = { name: 'el-option', props: ['value', 'label'], template: '<option :value="value">{{ label }}</option>' }
  const tbButton = {
    name: 'el-button',
    props: { disabled: { type: Boolean, default: false }, loading: { type: Boolean, default: false }, title: { type: String, default: undefined } },
    emits: ['click'],
    template: '<button class="el-button" :disabled="disabled" :data-loading="String(loading)" :title="title" @click="!disabled && $emit(\'click\')"><slot /></button>'
  }
  const tbDialog = {
    name: 'el-dialog',
    props: ['modelValue', 'title'],
    template: '<div v-if="modelValue" class="el-dialog" :data-title="title"><slot /><div class="dlg-footer"><slot name="footer" /></div></div>'
  }
  // 简易表单桩：validate 按传入 rules 的 required / max 真校（jsdom 下真 ElForm 校验跑不通，见 J22 记录）
  const tbForm = {
    name: 'el-form',
    props: ['model', 'rules'],
    template: '<form class="el-form"><slot /></form>',
    methods: {
      validate() {
        for (const [field, rules] of Object.entries(this.rules || {})) {
          const v = String(this.model?.[field] ?? '')
          for (const r of rules) {
            if (r.required && !v.trim()) return Promise.reject({ [field]: [{ message: r.message }] })
            if (r.max != null && v.length > r.max) return Promise.reject({ [field]: [{ message: r.message }] })
          }
        }
        return Promise.resolve(true)
      },
      clearValidate() {}
    }
  }
  const tbFormItem = { name: 'el-form-item', props: ['label', 'prop', 'error'], template: '<div class="el-form-item" :data-prop="prop"><label>{{ label }}</label><slot /></div>' }

  async function mountTb() {
    container = document.createElement('div')
    document.body.appendChild(container)
    app = createApp(AdminPositions)
    app.component('el-input', tbInput)
    app.component('el-select', tbSelect)
    app.component('el-option', tbOption)
    app.component('el-icon', passthrough('el-icon'))
    app.component('el-table', tableStub)
    app.component('el-table-column', tableColStub)
    app.component('el-button', tbButton)
    app.component('el-dialog', tbDialog)
    app.component('el-form', tbForm)
    app.component('el-form-item', tbFormItem)
    app.directive('loading', {})
    app.mount(container)
    await flush()
    return container
  }
  const searchInput = () => container.querySelector('.list-toolbar input[placeholder="搜索岗位名称或岗位描述"]')
  const typeKeyword = async (v) => {
    const el = searchInput()
    el.value = v
    el.dispatchEvent(new Event('input'))
    await flush()
  }
  const statusSelect = () => container.querySelector('.list-toolbar select.el-select')
  const pickStatus = async (v) => {
    statusSelect().value = v
    statusSelect().dispatchEvent(new Event('change'))
    await flush()
  }
  const lastParams = () => listPositions.mock.calls.at(-1)[0]
  const toolbarBtn = (text) => [...container.querySelectorAll('.list-toolbar .el-button')].find((b) => b.textContent.trim() === text)
  // 文件级 beforeEach 不重置 createPosition（B2 用例会留调用记录），本组自清
  beforeEach(() => { createPosition.mockReset() })

  it('只在搜索框里打字、不回车也不点【查询】→ 列表不刷新', async () => {
    await mountTb()
    expect(listPositions).toHaveBeenCalledTimes(1)
    await typeKeyword('销售')
    expect(listPositions).toHaveBeenCalledTimes(1)
  })

  it('输入关键字后按回车 → 立即按关键字刷新（状态条件一并带上）', async () => {
    await mountTb()
    await typeKeyword('销售')
    searchInput().dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await flush()
    expect(listPositions).toHaveBeenCalledTimes(2)
    expect(lastParams()).toEqual(expect.objectContaining({ keyword: '销售', page: 1, status: 'all' }))
  })

  it('输入关键字后点【查询】→ 按关键字刷新', async () => {
    await mountTb()
    await typeKeyword('卖货')
    toolbarBtn('查询').click()
    await flush()
    expect(listPositions).toHaveBeenCalledTimes(2)
    expect(lastParams()).toEqual(expect.objectContaining({ keyword: '卖货' }))
  })

  it('点搜索框的清空 → 立即按剩余条件刷新（关键字为空、状态筛选保留）', async () => {
    await mountTb()
    await pickStatus('draft')
    await typeKeyword('销售')
    searchInput().dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await flush()
    const before = listPositions.mock.calls.length
    container.querySelector('.list-toolbar .el-input-clear').click()
    await flush()
    expect(listPositions.mock.calls.length).toBe(before + 1)
    // 空关键字由取数层省略不下发（useAdminList 丢空参），只认「不再带上次的关键字」
    expect(lastParams().keyword ?? '').toBe('')
    expect(lastParams()).toEqual(expect.objectContaining({ status: 'draft' }))
    expect(searchInput().value).toBe('')
  })

  it('状态筛选选「未发布」→ 立即刷新（不需要点【查询】），下发 status=draft', async () => {
    await mountTb()
    await pickStatus('draft')
    expect(listPositions).toHaveBeenCalledTimes(2)
    expect(lastParams()).toEqual(expect.objectContaining({ status: 'draft' }))
  })

  it('状态筛选被清成空值 → 立即刷新并回落「全部状态」：下拉显示全部状态、下发 status=all', async () => {
    await mountTb()
    await pickStatus('published')
    expect(lastParams()).toEqual(expect.objectContaining({ status: 'published' }))
    const before = listPositions.mock.calls.length
    await pickStatus('')
    expect(listPositions.mock.calls.length).toBe(before + 1)
    expect(lastParams()).toEqual(expect.objectContaining({ status: 'all' }))
    expect(statusSelect().value).toBe('all')
  })

  it('状态筛选下拉四项：全部状态 / 未发布 / 审核中 / 已发布', async () => {
    await mountTb()
    const labels = [...statusSelect().querySelectorAll('option')].map((o) => o.textContent.trim()).filter(Boolean)
    expect(labels).toEqual(['全部状态', '未发布', '审核中', '已发布'])
  })

  it('新建弹窗：岗位名称输入框最多 64 个字符', async () => {
    await mountTb()
    toolbarBtn('＋ 新建岗位').click()
    await flush()
    const dlg = container.querySelector('.el-dialog[data-title="新建岗位"]')
    const nameInput = dlg.querySelector('.el-form-item[data-prop="name"] input')
    expect(nameInput.getAttribute('maxlength')).toBe('64')
  })

  it('新建弹窗：岗位名称空着（只填描述）点【创建岗位】→ 不建岗位、弹窗不关', async () => {
    await mountTb()
    toolbarBtn('＋ 新建岗位').click()
    await flush()
    const dlg = () => container.querySelector('.el-dialog[data-title="新建岗位"]')
    const desc = dlg().querySelector('.el-form-item[data-prop="description"] input')
    desc.value = '负责经营分析'
    desc.dispatchEvent(new Event('input'))
    await flush()
    ;[...dlg().querySelectorAll('.dlg-footer .el-button')].find((b) => b.textContent.trim() === '创建岗位').click()
    await flush()
    expect(createPosition).not.toHaveBeenCalled()
    expect(dlg()).toBeTruthy()
  })

  it('新建弹窗：岗位名称超过 64 个字符（绕过输入框上限，如粘贴进模型）→ 校验规则拦下，不建岗位', async () => {
    await mountTb()
    toolbarBtn('＋ 新建岗位').click()
    await flush()
    const st = app._instance.setupState
    st.createForm.name = '岗'.repeat(65)
    st.createForm.description = '负责经营分析'
    await st.submitCreate()
    expect(createPosition).not.toHaveBeenCalled()
    st.createForm.name = '岗'.repeat(64)
    createPosition.mockResolvedValue({ positionId: 'ps_new' })
    await st.submitCreate()
    expect(createPosition).toHaveBeenCalledTimes(1)
  })

  it('停用提交中（unpublishPosition 未返回）→【停用】按钮 loading', async () => {
    let release
    unpublishPosition.mockImplementation(() => new Promise((r) => { release = r }))
    await mountTb()
    btn(rowByName('零领用岗'), '停用').click()
    await flush()
    expect(unpublishPosition).toHaveBeenCalledTimes(1)
    expect(btn(rowByName('零领用岗'), '停用').getAttribute('data-loading')).toBe('true')
    release({})
    await flush()
    expect(btn(rowByName('零领用岗'), '停用').getAttribute('data-loading')).toBe('false')
  })

  it('停用提交中再点一次【停用】→ 不重复提交：确认框只弹一次、unpublishPosition 只调一次', async () => {
    let release
    unpublishPosition.mockImplementation(() => new Promise((r) => { release = r }))
    await mountTb()
    btn(rowByName('零领用岗'), '停用').click()
    await flush()
    btn(rowByName('零领用岗'), '停用').click()
    await flush()
    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
    expect(unpublishPosition).toHaveBeenCalledTimes(1)
    release({})
    await flush()
    expect(ElMessage.success).toHaveBeenCalledTimes(1)
  })
})
