// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { makeElTableStubs } from './helpers/elTableStub'

/**
 * MyApplications.vue（我的申请）列表页单测（2026-09-12 测试审计 T56 新建，此前 407 行零测试）。
 *
 * 对齐 md `prd.我的申请.md`：
 * - §一 L8 页面说明；§二 查询区（占位「搜索申请对象名称 / 描述」、业务类型八项、申请类型三项、审核结果四项、【查询】）；
 * - §3.1 七列；审核结果四态标签，已驳回悬停展示驳回原因；操作列固定【查看】+ 待审核【撤回】+ 已驳回/已撤回【重新提交】；
 * - §四 L47 / §七 L98 对象已删除 → 【查看】置灰；技能走整页只读路由，其余开原生详情抽屉；
 * - §4.1 待审核底栏 关闭|撤回申请，撤回二次确认 → 「申请已撤回」；§4.2 已通过仅 关闭；
 *   §4.3/§4.4 已驳回 / 已撤回底栏 关闭|前往修改|重新提交，重新提交 → 「提交成功」提示窗（alertResubmitSuccess）；
 * - §七 L97 空态「暂无申请记录」；L99 撤回时已被审核 → toast 原因并重拉；L100 重新提交失败 → toast 原因。
 * 列表【撤回】走 warning 色档（5585a2b 负责人拍板「与全局色值保持一致」，md 未规定颜色）。
 * 桩法照 userSkillReviews.test.js：ListToolbar / ListStates / ListPagination / StatusTag 真挂载，EP 原生控件桩，
 * GovObjectDetail 桩只验「开没开、带的什么、回传什么」。
 */

const listMyApplications = vi.fn()
const withdrawMyApplication = vi.fn()
const resubmitMyApplication = vi.fn()
vi.mock('@/api/myApplications', () => ({
  listMyApplications: (...a) => listMyApplications(...a),
  withdrawMyApplication: (...a) => withdrawMyApplication(...a),
  resubmitMyApplication: (...a) => resubmitMyApplication(...a)
}))

const ElMessage = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() })
vi.mock('element-plus', () => ({ ElMessage }))

const confirmWithdrawMyApp = vi.fn()
const alertResubmitSuccess = vi.fn()
vi.mock('@/utils/govDialogs', () => ({
  confirmWithdrawMyApp: (...a) => confirmWithdrawMyApp(...a),
  alertResubmitSuccess: (...a) => alertResubmitSuccess(...a)
}))

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

vi.mock('@/components/PageHeader.vue', () => ({
  default: {
    props: ['title', 'subtitle'],
    template: '<div class="page-header">{{ title }}<span class="ph-sub">{{ subtitle }}</span></div>'
  }
}))

// 原生详情分发器桩：把 props 落到 DOM，按钮组渲染成可点按钮回抛 action
vi.mock('@/components/admin/GovObjectDetail.vue', () => ({
  default: {
    name: 'GovObjectDetail',
    props: {
      visible: Boolean,
      kind: String,
      refId: [String, Number, null],
      item: Object,
      readonly: { type: Boolean, default: true },
      buttons: Array,
      busyKey: String,
      snapshotGate: Boolean
    },
    emits: ['update:visible', 'action'],
    setup(props, { emit }) {
      return () =>
        props.visible
          ? h('div', { class: 'gov-detail', 'data-kind': props.kind, 'data-ref': String(props.refId), 'data-readonly': String(props.readonly), 'data-gate': String(props.snapshotGate) }, [
              ...props.buttons.map((b) => h('button', { class: 'gov-btn', 'data-key': b.key, 'data-type': b.type || '', onClick: () => emit('action', b.key) }, b.label))
            ])
          : null
    }
  }
}))

const MyApplications = (await import('@/views/admin/MyApplications.vue')).default

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
// tooltip 桩：把 content 落到 data-tip 上，好断「已驳回悬停展示驳回原因」
const elTooltip = { props: ['content', 'placement'], template: '<span class="el-tooltip" :data-tip="content"><slot /></span>' }
const elButton = {
  props: { disabled: Boolean, loading: Boolean, type: String, link: Boolean },
  emits: ['click'],
  template:
    '<button class="el-button" :disabled="disabled" :data-type="type" :data-link="link" @click="!disabled && $emit(\'click\')"><slot /></button>'
}

let app, container
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(MyApplications)
  app.component('el-input', elInput)
  app.component('el-select', elSelect)
  app.component('el-option', elOption)
  app.component('el-icon', passthrough('el-icon'))
  app.component('Search', { template: '<i class="icon-search" />' })
  app.component('el-table', tableStub)
  app.component('el-table-column', tableColStub)
  app.component('el-empty', elEmpty)
  app.component('el-tooltip', elTooltip)
  app.component('el-button', elButton)
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
const rowBtn = (row, text) => [...row.querySelectorAll('.ma-ops .el-button')].find((b) => b.textContent.trim() === text)
const rowOps = (row) => [...row.querySelectorAll('.ma-ops .el-button')].map((b) => b.textContent.trim())
const toolbarBtn = (text) => [...container.querySelectorAll('.list-toolbar .el-button')].find((b) => b.textContent.trim() === text)
const detailBtns = () => [...container.querySelectorAll('.gov-detail .gov-btn')]

// 夹具照 myApplicationsMock 种子形状：四态各一 + 技能行 + 对象已删除行
const ROWS = [
  { id: 501, objectName: '客户资料查询', description: '按客户编号读取客户基础信息和当前商机状态', businessType: 'API', applicationType: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-08-28 10:30', result: 'PENDING', reviewer: '', reviewedAt: '', rejectReason: '', refId: 'api_1103', objectDeleted: false },
  { id: 502, objectName: '经营分析专家', description: '汇总经营数据，识别异常并形成管理建议', businessType: 'EXPERT', applicationType: 'VERSION_PUBLISH', version: 'v1.2.0', submittedAt: '2026-08-27 16:20', result: 'APPROVED', reviewer: 'audit.admin', reviewedAt: '2026-08-27 17:05', rejectReason: '', refId: 201, objectDeleted: false },
  { id: 503, objectName: '经营分析岗', description: '负责经营数据汇总、异常识别与经营分析报告输出', businessType: 'POSITION', applicationType: 'VERSION_PUBLISH', version: 'v2.2.0', submittedAt: '2026-08-27 15:10', result: 'REJECTED', reviewer: 'audit.admin', reviewedAt: '2026-08-27 16:02', rejectReason: '岗位说明未明确数据使用范围，请补充后重新提交。', refId: 401, objectDeleted: false },
  { id: 504, objectName: '行业研究助手', description: '汇总行业资料、竞品动态并生成结构化研究结论', businessType: 'SKILL', applicationType: 'FIRST_PUBLISH', version: 'v1.0.0', submittedAt: '2026-08-27 11:42', result: 'WITHDRAWN', reviewer: '—', reviewedAt: '2026-08-27 12:10', rejectReason: '', refId: 'sk_309', objectDeleted: false },
  { id: 507, objectName: 'Kimi K2', description: '支持长上下文分析和文本生成的通用模型', businessType: 'MODEL', applicationType: 'FIRST_PUBLISH', version: '—', submittedAt: '2026-08-26 15:08', result: 'REJECTED', reviewer: 'model.audit', reviewedAt: '2026-08-26 16:30', rejectReason: '连通性验证未通过。', refId: 'md_104', objectDeleted: false },
  { id: 510, objectName: '法务审阅专家', description: '辅助审阅合同条款并识别法律风险', businessType: 'EXPERT', applicationType: 'DELIST', version: 'v1.3.0', submittedAt: '2026-08-24 10:18', result: 'WITHDRAWN', reviewer: '—', reviewedAt: '2026-08-24 10:46', rejectReason: '', refId: 203, objectDeleted: true }
]
const byId = (id) => ROWS.find((r) => r.id === id)
const rowById = (id) => rowEls().find((el) => el.querySelector('.ma-name').textContent === byId(id).objectName)

beforeEach(() => {
  listMyApplications.mockReset().mockResolvedValue({ list: ROWS, total: ROWS.length })
  withdrawMyApplication.mockReset().mockResolvedValue({})
  resubmitMyApplication.mockReset().mockResolvedValue({})
  confirmWithdrawMyApp.mockReset().mockResolvedValue(true)
  alertResubmitSuccess.mockReset().mockResolvedValue(undefined)
  push.mockReset()
  ElMessage.success.mockReset()
  ElMessage.error.mockReset()
  ElMessage.info.mockReset()
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('MyApplications · 我的申请（md prd.我的申请.md）', () => {
  it('页面说明取 md §一 L8；挂载即拉列表（默认 sortDir=desc、page=1）', async () => {
    await mount()
    expect(container.querySelector('.ph-sub').textContent).toBe('查看和跟踪自己从各业务模块提交的审核申请')
    expect(listMyApplications).toHaveBeenCalledWith(expect.objectContaining({ sortDir: 'desc', page: 1 }))
  })

  it('查询区（md §二）：占位「搜索申请对象名称 / 描述」、业务类型八项、申请类型三项、审核结果四项、【查询】', async () => {
    await mount()
    expect(container.querySelector('.el-input').placeholder).toBe('搜索申请对象名称 / 描述')
    const selects = [...container.querySelectorAll('.el-select')]
    expect(selects.map((s) => s.dataset.placeholder)).toEqual(['全部业务类型', '全部申请类型', '全部审核结果'])
    const opts = (i) => [...selects[i].querySelectorAll('.el-option')].map((o) => o.textContent)
    expect(opts(0)).toEqual(['专家', '岗位', '技能', '知识库', 'MCP', 'API', '业务系统', '模型'])
    expect(opts(1)).toEqual(['首次发布', '新版本发布', '停用'])
    expect(opts(2)).toEqual(['待审核', '已通过', '已驳回', '已撤回'])
    expect(toolbarBtn('查询')).toBeTruthy()
  })

  it('审核结果下拉选中「已驳回」→ 即时按 result 重查回第 1 页，列表只剩已驳回行；条件可组合（md §二 L19-21）', async () => {
    listMyApplications.mockImplementation((p = {}) => {
      let list = ROWS
      if (p.result) list = list.filter((r) => r.result === p.result)
      if (p.businessType) list = list.filter((r) => r.businessType === p.businessType)
      return Promise.resolve({ list, total: list.length })
    })
    await mount()
    expect(rowEls()).toHaveLength(ROWS.length)
    listMyApplications.mockClear()
    pick(container.querySelectorAll('.el-select')[2], 'REJECTED')
    await flush()
    expect(listMyApplications).toHaveBeenCalledWith(expect.objectContaining({ result: 'REJECTED', page: 1 }))
    expect(rowEls()).toHaveLength(2) // 503 岗位 + 507 模型
    expect(rowEls()[0].textContent).toContain('经营分析岗')
    pick(container.querySelectorAll('.el-select')[0], 'EXPERT')
    await flush()
    expect(listMyApplications).toHaveBeenLastCalledWith(expect.objectContaining({ result: 'REJECTED', businessType: 'EXPERT', page: 1 }))
    expect(container.querySelector('.ls-empty').textContent).toContain('暂无申请记录')
  })

  it('七列表头（申请时间列头带 ↓）；行：对象名+描述、业务类型 / 申请类型 / 审核结果标签词、版本「—」、分钟级时间（md §3.1）', async () => {
    await mount()
    const heads = [...container.querySelectorAll('.el-head .el-table-column')].map((c) => c.textContent.replace(/\s+/g, ' ').trim())
    expect(heads).toEqual(['申请对象', '业务类型', '申请类型', '申请版本', '申请时间 ↓', '审核结果', '操作'])
    const tags = (row) => [...row.querySelectorAll('.status-tag')].map((t) => t.textContent.trim())
    const r501 = rowById(501)
    expect(r501.querySelector('.ma-desc').textContent).toBe('按客户编号读取客户基础信息和当前商机状态')
    expect(tags(r501)).toEqual(['API', '首次发布', '待审核'])
    expect(tags(rowById(502))).toEqual(['专家', '新版本发布', '已通过'])
    expect(tags(rowById(503))).toEqual(['岗位', '新版本发布', '已驳回'])
    expect(tags(rowById(504))).toEqual(['技能', '首次发布', '已撤回'])
    expect(tags(rowById(510))).toEqual(['专家', '停用', '已撤回'])
    expect(r501.querySelector('[data-label="申请版本"]').textContent.trim()).toBe('—')
    expect(rowById(503).querySelector('[data-label="申请版本"]').textContent.trim()).toBe('v2.2.0')
    expect(r501.textContent).toContain('2026-08-28 10:30')
  })

  it('已驳回行的审核结果标签悬停展示驳回原因（tooltip content=rejectReason）；其余状态无气泡（md §3.1 L34）', async () => {
    await mount()
    const tip = rowById(503).querySelector('[data-label="审核结果"] .el-tooltip')
    expect(tip).toBeTruthy()
    expect(tip.dataset.tip).toBe('岗位说明未明确数据使用范围，请补充后重新提交。')
    expect(tip.querySelector('.status-tag').textContent.trim()).toBe('已驳回')
    expect(rowById(502).querySelector('[data-label="审核结果"] .el-tooltip')).toBeNull()
    expect(rowById(501).querySelector('[data-label="审核结果"] .el-tooltip')).toBeNull()
  })

  it('操作列按状态（md §3.1 L35 / §五）：待审核【查看】【撤回】/ 已驳回、已撤回【查看】【重新提交】/ 已通过仅【查看】；撤回为 warning 链（5585a2b）', async () => {
    await mount()
    expect(rowOps(rowById(501))).toEqual(['查看', '撤回'])
    expect(rowBtn(rowById(501), '撤回').dataset.type).toBe('warning')
    expect(rowBtn(rowById(501), '撤回').dataset.link).toBe('true')
    expect(rowOps(rowById(503))).toEqual(['查看', '重新提交'])
    expect(rowOps(rowById(504))).toEqual(['查看', '重新提交'])
    expect(rowOps(rowById(502))).toEqual(['查看'])
  })

  it('对象已被删除的行（objectDeleted）→ 【查看】置灰不可点并带说明气泡；行与六个信息字段照常保留（md §四 L47 / §七 L98）', async () => {
    await mount()
    const row = rowById(510)
    const view = rowBtn(row, '查看')
    expect(view.disabled).toBe(true)
    expect(row.querySelector('.ma-ops .el-tooltip').dataset.tip).toBe('该申请对象已被删除，无法查看详情')
    view.click()
    await flush()
    expect(container.querySelector('.gov-detail')).toBeNull()
    expect(push).not.toHaveBeenCalled()
    // 行信息仍在：对象名 / 业务类型 / 申请类型 / 申请版本 / 申请时间 / 审核结果
    expect(row.textContent).toContain('法务审阅专家')
    expect(row.textContent).toContain('v1.3.0')
    expect(row.textContent).toContain('2026-08-24 10:18')
    expect([...row.querySelectorAll('.status-tag')].map((t) => t.textContent.trim())).toEqual(['专家', '停用', '已撤回'])
    // 对象仍在的行【查看】可点
    expect(rowBtn(rowById(502), '查看').disabled).toBe(false)
  })

  it('列表【撤回】→ 二次确认（confirmWithdrawMyApp 收到对象名）→ withdrawMyApplication(id) → toast「申请已撤回」→ 重拉（md §4.1 L51）', async () => {
    await mount()
    rowBtn(rowById(501), '撤回').click()
    await flush()
    expect(confirmWithdrawMyApp).toHaveBeenCalledWith('客户资料查询')
    expect(withdrawMyApplication).toHaveBeenCalledWith(501)
    expect(ElMessage.success).toHaveBeenCalledWith('申请已撤回')
    expect(listMyApplications).toHaveBeenCalledTimes(2)
  })

  it('【撤回】确认取消 → 不调接口；撤回时申请已被审核（接口 409）→ toast 原因并重拉最新结果（md §七 L99）', async () => {
    confirmWithdrawMyApp.mockResolvedValueOnce(false)
    await mount()
    rowBtn(rowById(501), '撤回').click()
    await flush()
    expect(withdrawMyApplication).not.toHaveBeenCalled()
    withdrawMyApplication.mockRejectedValueOnce(new Error('该申请已被审核，无法撤回，请查看最新审核结果'))
    rowBtn(rowById(501), '撤回').click()
    await flush()
    expect(ElMessage.error).toHaveBeenCalledWith('该申请已被审核，无法撤回，请查看最新审核结果')
    expect(ElMessage.success).not.toHaveBeenCalled()
  })

  it('非技能行【查看】→ 开只读原生详情（readonly=true、不开快照闸门）；待审核底栏 关闭|撤回申请（danger）（md §四 / §4.1）', async () => {
    await mount()
    rowBtn(rowById(501), '查看').click()
    await flush()
    const detail = container.querySelector('.gov-detail')
    expect(detail.dataset.kind).toBe('API')
    expect(detail.dataset.ref).toBe('api_1103')
    expect(detail.dataset.readonly).toBe('true')
    expect(detail.dataset.gate).toBe('false')
    expect(detailBtns().map((b) => b.textContent)).toEqual(['关闭', '撤回申请'])
    expect(detailBtns()[1].dataset.type).toBe('danger')
    // 底栏【撤回申请】走同一撤回流程，成功后关详情
    detailBtns()[1].click()
    await flush()
    expect(confirmWithdrawMyApp).toHaveBeenCalledWith('客户资料查询')
    expect(withdrawMyApplication).toHaveBeenCalledWith(501)
    expect(container.querySelector('.gov-detail')).toBeNull()
  })

  it('已通过行详情底栏仅【关闭】，点关闭即收起（md §4.2）', async () => {
    await mount()
    rowBtn(rowById(502), '查看').click()
    await flush()
    expect(container.querySelector('.gov-detail').dataset.kind).toBe('EXPERT')
    expect(detailBtns().map((b) => b.textContent)).toEqual(['关闭'])
    detailBtns()[0].click()
    await flush()
    expect(container.querySelector('.gov-detail')).toBeNull()
  })

  it('已驳回行详情底栏 关闭|前往修改|重新提交；【重新提交】→ resubmitMyApplication(id) → 关详情、重拉、弹「提交成功」（md §4.3）', async () => {
    await mount()
    rowBtn(rowById(503), '查看').click()
    await flush()
    expect(container.querySelector('.gov-detail').dataset.kind).toBe('POSITION')
    expect(detailBtns().map((b) => b.textContent)).toEqual(['关闭', '前往修改', '重新提交'])
    expect(detailBtns()[2].dataset.type).toBe('primary')
    detailBtns()[2].click()
    await flush()
    expect(resubmitMyApplication).toHaveBeenCalledWith(503)
    expect(alertResubmitSuccess).toHaveBeenCalledWith('经营分析岗')
    expect(container.querySelector('.gov-detail')).toBeNull()
    expect(listMyApplications).toHaveBeenCalledTimes(2)
  })

  it('已驳回详情【前往修改】→ 先关只读抽屉再以编辑态重开（readonly=false），底栏换为 关闭|提交审核；【提交审核】走重新提交（md §4.3 L65）', async () => {
    await mount()
    rowBtn(rowById(503), '查看').click()
    await flush()
    detailBtns()[1].click()
    await flush()
    const detail = container.querySelector('.gov-detail')
    expect(detail).toBeTruthy()
    expect(detail.dataset.readonly).toBe('false')
    expect(detailBtns().map((b) => b.textContent)).toEqual(['关闭', '提交审核'])
    detailBtns()[1].click()
    await flush()
    expect(resubmitMyApplication).toHaveBeenCalledWith(503)
    expect(alertResubmitSuccess).toHaveBeenCalledWith('经营分析岗')
  })

  it('列表【重新提交】（已驳回岗位行 503）→ 直接 resubmitMyApplication(503)，不再先开编辑态（2026-09-18 R1：重提经业务模块，改内容走【前往修改】）', async () => {
    await mount()
    rowBtn(rowById(503), '重新提交').click()
    await flush()
    expect(resubmitMyApplication).toHaveBeenCalledWith(503)
    expect(container.querySelector('.gov-detail')).toBeNull()
  })

  it('详情【前往修改】→ 非岗位类以编辑态打开且**不出吸底条**（编辑器自己的保存可用，09-18 G-6）；岗位类保留 关闭|提交审核', async () => {
    await mount()
    // 岗位行 503：只读视图 + 关闭|提交审核
    rowBtn(rowById(503), '查看').click()
    await flush()
    detailBtns().find((b) => b.textContent === '前往修改').click()
    await flush()
    let detail = container.querySelector('.gov-detail')
    expect(detail.dataset.readonly).toBe('false')
    expect(detailBtns().map((b) => b.textContent)).toEqual(['关闭', '提交审核'])
    detailBtns().find((b) => b.textContent === '关闭').click()
    await flush()
    // 模型行 507（已驳回）：编辑态无吸底条
    rowBtn(rowById(507), '查看').click()
    await flush()
    detailBtns().find((b) => b.textContent === '前往修改').click()
    await flush()
    detail = container.querySelector('.gov-detail')
    expect(detail.dataset.readonly).toBe('false')
    expect(detailBtns()).toHaveLength(0)
  })

  it('技能行【查看】→ 跳整页只读路由 SysConfigSkillView（query.myApp=申请 id）；列表【重新提交】直接重提（md §四 L46 / §4.4）', async () => {
    await mount()
    rowBtn(rowById(504), '查看').click()
    await flush()
    expect(push).toHaveBeenCalledWith({ name: 'SysConfigSkillView', params: { id: 'sk_309' }, query: { myApp: '504' } })
    expect(container.querySelector('.gov-detail')).toBeNull()
    // 列表【重新提交】对技能行同样直接经 mock 重提，不跳编辑路由（2026-09-18 R1）
    rowBtn(rowById(504), '重新提交').click()
    await flush()
    expect(resubmitMyApplication).toHaveBeenCalledWith(504)
  })

  it('申请时间列头点击 → 切正序 ↑ 并按 sortDir=asc 重查回第 1 页（md §3.1 L33）', async () => {
    await mount()
    listMyApplications.mockClear()
    container.querySelector('.ma-sort').click()
    await flush()
    expect(listMyApplications).toHaveBeenCalledWith(expect.objectContaining({ sortDir: 'asc', page: 1 }))
    expect(container.querySelector('.ma-sort-arrow').textContent).toBe('↑')
  })

  it('空态「暂无申请记录」（md §七 L97）；加载失败出「加载失败」+【重试】', async () => {
    listMyApplications.mockResolvedValueOnce({ list: [], total: 0 })
    await mount()
    expect(container.querySelector('.ls-empty').textContent).toContain('暂无申请记录')
    app.unmount(); container.remove()
    listMyApplications.mockRejectedValueOnce(new Error('x'))
    await mount()
    expect(container.querySelector('.el-empty').textContent).toContain('加载失败')
    expect([...container.querySelectorAll('.el-empty .el-button')].map((b) => b.textContent.trim())).toContain('重试')
  })
})
