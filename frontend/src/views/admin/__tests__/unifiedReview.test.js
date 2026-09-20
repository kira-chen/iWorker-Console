// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { makeElTableStubs } from './helpers/elTableStub'

/**
 * UnifiedReview.vue（审核中心）列表页单测（2026-09-12 测试审计 T56 新建，此前 368 行零测试）。
 *
 * 对齐 md `prd.审核中心.md`：
 * - §一 L8 页面说明；§二 查询区（占位「搜索名称 / 用户名」、业务类型九项（含 2026-09-20 起的「版本管理」）、申请类型三项、【查询】）；
 * - §3.1 七列（名称+描述 / 业务类型 / 申请类型 / 申请版本「—」/ 提交人 / 提交时间 ↓↑ / 操作【查看】【驳回】【通过】）；
 * - §四 【查看】：技能走整页只读路由，其余开原生详情抽屉（GovObjectDetail），底部 关闭|驳回|通过；
 * - §5.1 驳回弹窗 → 「已驳回审核」；§5.2 通过确认 → 发布类「已通过审核」/ 停用「已通过停用申请」，记录离开列表（重拉）；
 * - §七 L99 空态「暂无审核数据」；L102 快照缺失（岗位 / 专家 / 技能）阻止审核（aa7d251：列表行动作也过闸门）。
 * 桩法照 userSkillReviews.test.js：ListToolbar / ListStates / ListPagination / StatusTag 真挂载，EP 原生控件桩，
 * 子组件 GovObjectDetail / ReviewRejectDialog 桩（各有独立单测），只验「开没开、带的什么、回传什么」。
 */

const listReviews = vi.fn()
const approveReview = vi.fn()
const rejectReview = vi.fn()
vi.mock('@/api/reviews', () => ({
  listReviews: (...a) => listReviews(...a),
  approveReview: (...a) => approveReview(...a),
  rejectReview: (...a) => rejectReview(...a)
}))

const ElMessage = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() })
vi.mock('element-plus', () => ({ ElMessage }))

const confirmApproveReview = vi.fn()
vi.mock('@/utils/govDialogs', () => ({ confirmApproveReview: (...a) => confirmApproveReview(...a) }))

// 快照读取口：needsSnapshot / SNAPSHOT_MISSING_HINT 用真实现，只替换 loadReviewSnapshot（按用例给「有 / 无」）
const loadReviewSnapshot = vi.fn()
vi.mock('@/utils/reviewSnapshot', async (importOriginal) => ({
  ...(await importOriginal()),
  loadReviewSnapshot: (...a) => loadReviewSnapshot(...a)
}))

const push = vi.fn()
const routeQuery = { value: {} }
vi.mock('vue-router', () => ({ useRoute: () => ({ query: routeQuery.value }), useRouter: () => ({ push }) }))

vi.mock('@/components/PageHeader.vue', () => ({
  default: {
    props: ['title', 'subtitle'],
    template: '<div class="page-header">{{ title }}<span class="ph-sub">{{ subtitle }}</span></div>'
  }
}))

// 原生详情分发器桩：把收到的 props 落到 DOM 上，按钮组渲染成可点的按钮回抛 action
const detailProps = vi.fn()
vi.mock('@/components/admin/GovObjectDetail.vue', () => ({
  default: {
    name: 'GovObjectDetail',
    props: {
      visible: Boolean,
      kind: String,
      refId: [String, Number, null],
      item: Object,
      buttons: Array,
      busyKey: String,
      snapshotGate: Boolean
    },
    emits: ['update:visible', 'action'],
    setup(props, { emit }) {
      return () => {
        detailProps(props)
        return props.visible
          ? h('div', { class: 'gov-detail', 'data-kind': props.kind, 'data-ref': String(props.refId), 'data-gate': String(props.snapshotGate) }, [
              ...props.buttons.map((b) => h('button', { class: 'gov-btn', 'data-key': b.key, 'data-type': b.type || '', onClick: () => emit('action', b.key) }, b.label))
            ])
          : null
      }
    }
  }
}))
// 驳回弹窗桩：暴露一个按钮直接 emit confirm('x')
vi.mock('@/components/admin/ReviewRejectDialog.vue', () => ({
  default: {
    name: 'ReviewRejectDialog',
    props: { modelValue: Boolean, submitting: Boolean },
    emits: ['update:modelValue', 'confirm'],
    setup(props, { emit }) {
      return () =>
        props.modelValue
          ? h('div', { class: 'reject-dialog' }, [h('button', { class: 'reject-confirm', onClick: () => emit('confirm', 'x') }, '确认驳回')])
          : null
    }
  }
}))

const UnifiedReview = (await import('@/views/admin/UnifiedReview.vue')).default
const { SNAPSHOT_MISSING_HINT } = await import('@/utils/reviewSnapshot')

// el-table-column / 行单元用共享 helper；el-table 本地包一层按 row.id 作 key（行集合变化后不复用旧行，见 userSkillReviews.test）
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
  template:
    '<button class="el-button" :disabled="disabled" :data-type="type" :data-link="link" @click="!disabled && $emit(\'click\')"><slot /></button>'
}

let app, container
async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(UnifiedReview)
  app.component('el-input', elInput)
  app.component('el-select', elSelect)
  app.component('el-option', elOption)
  app.component('el-icon', passthrough('el-icon'))
  app.component('Search', { template: '<i class="icon-search" />' })
  app.component('el-table', tableStub)
  app.component('el-table-column', tableColStub)
  app.component('el-empty', elEmpty)
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
const rowBtn = (row, text) => [...row.querySelectorAll('.rev-ops .el-button')].find((b) => b.textContent.trim() === text)
const rowOps = (row) => [...row.querySelectorAll('.rev-ops .el-button')].map((b) => b.textContent.trim())
const toolbarBtn = (text) => [...container.querySelectorAll('.list-toolbar .el-button')].find((b) => b.textContent.trim() === text)

// 夹具照 reviewsMock 种子形状（id 1 API 首次发布 / 2 技能新版本 / 3 业务系统停用 / 5 岗位新版本）
const ROWS = [
  { id: 1, name: '客户资料查询', description: '按客户编号读取客户基础信息', type: 'TOOL', subType: 'API', refId: 'api_1103', submitterName: 'config.admin', submittedAt: '2026-08-28 09:42', status: 'PENDING_REVIEW', requestAction: 'FIRST_PUBLISH', version: '—' },
  { id: 2, name: '经营数据分析', description: '读取经营数据并生成趋势分析和异常说明', type: 'SKILL', refId: 'sk_302', submitterName: 'li.na', submittedAt: '2026-08-28 09:18', status: 'PENDING_REVIEW', requestAction: 'VERSION_PUBLISH', version: 'v1.2.0' },
  { id: 3, name: '人力资源系统', description: '员工、组织、请假和入转调离管理', type: 'BIZ_SYSTEM', refId: 'biz_2102', submitterName: 'config.admin', submittedAt: '2026-08-27 18:34', status: 'PENDING_REVIEW', requestAction: 'DELIST', version: 'v2.0.0' },
  { id: 5, name: '财务审核岗', description: '负责报销材料核验、财务单据检查与风险提示', type: 'POSITION', refId: 403, submitterName: 'wangfang', submittedAt: '2026-08-27 14:05', status: 'PENDING_REVIEW', requestAction: 'VERSION_PUBLISH', version: 'v1.2.0' }
]
const byId = (id) => ROWS.find((r) => r.id === id)
const rowById = (id) => rowEls().find((el) => el.textContent.includes(byId(id).name))

beforeEach(() => {
  listReviews.mockReset().mockResolvedValue({ list: ROWS, total: ROWS.length })
  approveReview.mockReset().mockResolvedValue({})
  rejectReview.mockReset().mockResolvedValue({})
  confirmApproveReview.mockReset().mockResolvedValue(true)
  loadReviewSnapshot.mockReset().mockResolvedValue({ kind: 'POSITION', detail: {} }) // 默认：快照在
  detailProps.mockReset()
  push.mockReset()
  routeQuery.value = {}
  ElMessage.success.mockReset()
  ElMessage.error.mockReset()
  ElMessage.warning.mockReset()
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('UnifiedReview · 审核中心（md prd.审核中心.md）', () => {
  it('页面说明取 md §一 L8；挂载即拉待审列表（默认 sortDir=desc、page=1）', async () => {
    await mount()
    expect(container.querySelector('.ph-sub').textContent).toBe('审核系统配置员提交的连接器、技能、模型、岗位与专家发布、停用申请，以及用户端版本的发布、停用申请')
    expect(listReviews).toHaveBeenCalledWith(expect.objectContaining({ sortDir: 'desc', page: 1 }))
  })

  // 待办 yuepu#12④：访问审计【查看】跳转统一带 query.keyword（md 访问审计 §6.3 L128），本页须作为初始搜索词。
  it('跨模块入口 ?keyword=xxx（访问审计【查看】）：首拉即按该关键词取数，搜索框回显', async () => {
    routeQuery.value = { keyword: '经营分析岗' }
    await mount()
    expect(listReviews.mock.calls[0][0]).toEqual(expect.objectContaining({ keyword: '经营分析岗', page: 1 }))
    expect(container.querySelector('.el-input').value).toBe('经营分析岗')
  })

  it('查询区（md §二）：占位「搜索名称 / 用户名」、业务类型九项（含版本管理）、申请类型三项、【查询】按钮', async () => {
    await mount()
    expect(container.querySelector('.el-input').placeholder).toBe('搜索名称 / 用户名')
    const selects = [...container.querySelectorAll('.el-select')]
    expect(selects.map((s) => s.dataset.placeholder)).toEqual(['全部业务类型', '全部申请类型'])
    expect([...selects[0].querySelectorAll('.el-option')].map((o) => o.textContent)).toEqual(['岗位', '专家', '技能', '知识库', 'MCP', 'API', '业务系统', '模型', '版本管理'])
    expect([...selects[1].querySelectorAll('.el-option')].map((o) => o.textContent)).toEqual(['首次发布', '新版本发布', '停用'])
    expect(toolbarBtn('查询')).toBeTruthy()
  })

  it('业务类型下拉选中「停用」申请类型 → 即时按 requestAction 重查回第 1 页；【查询】带 keyword 且行随结果变化（md §二 L18）', async () => {
    listReviews.mockImplementation((p = {}) => {
      let list = ROWS
      if (p.requestAction) list = list.filter((r) => r.requestAction === p.requestAction)
      if (p.keyword) list = list.filter((r) => r.name.includes(p.keyword))
      return Promise.resolve({ list, total: list.length })
    })
    await mount()
    expect(rowEls()).toHaveLength(4)
    listReviews.mockClear()
    pick(container.querySelectorAll('.el-select')[1], 'DELIST')
    await flush()
    expect(listReviews).toHaveBeenCalledWith(expect.objectContaining({ requestAction: 'DELIST', page: 1 }))
    expect(rowEls()).toHaveLength(1)
    expect(rowEls()[0].textContent).toContain('人力资源系统')
    // 再叠加 keyword 走【查询】：条件可组合（md §二 L20）
    const input = container.querySelector('.el-input')
    input.value = '客户'
    input.dispatchEvent(new Event('input'))
    await flush()
    listReviews.mockClear()
    toolbarBtn('查询').click()
    await flush()
    expect(listReviews).toHaveBeenCalledWith(expect.objectContaining({ keyword: '客户', requestAction: 'DELIST', page: 1 }))
    expect(rowEls()).toHaveLength(0)
    expect(container.querySelector('.ls-empty').textContent).toContain('暂无审核数据')
  })

  it('七列表头（提交时间列头带 ↓）；行：名称+描述、业务类型 / 申请类型标签词、版本「—」、提交人、分钟级时间（md §3.1）', async () => {
    await mount()
    const heads = [...container.querySelectorAll('.el-head .el-table-column')].map((c) => c.textContent.replace(/\s+/g, ' ').trim())
    expect(heads).toEqual(['名称', '业务类型', '申请类型', '申请版本', '提交人', '提交时间 ↓', '操作'])
    const r1 = rowById(1)
    expect(r1.querySelector('.rev-name').textContent).toBe('客户资料查询')
    expect(r1.querySelector('.rev-desc').textContent).toBe('按客户编号读取客户基础信息')
    const tags = (row) => [...row.querySelectorAll('.status-tag')].map((t) => t.textContent.trim())
    expect(tags(r1)).toEqual(['API', '首次发布'])
    expect(tags(rowById(3))).toEqual(['业务系统', '停用'])
    expect(tags(rowById(5))).toEqual(['岗位', '新版本发布'])
    expect(r1.querySelector('[data-label="申请版本"]').textContent.trim()).toBe('—')
    expect(rowById(2).querySelector('[data-label="申请版本"]').textContent.trim()).toBe('v1.2.0')
    expect(r1.querySelector('.rev-submitter').textContent).toBe('config.admin')
    expect(r1.textContent).toContain('2026-08-28 09:42')
  })

  it('操作列按顺序【查看】【驳回】【通过】，驳回为红色文字链（md §3.1 L34）', async () => {
    await mount()
    for (const row of rowEls()) {
      expect(rowOps(row)).toEqual(['查看', '驳回', '通过'])
      expect(rowBtn(row, '驳回').dataset.type).toBe('danger')
      expect(rowBtn(row, '驳回').dataset.link).toBe('true')
    }
  })

  it('提交时间列头点击 → 切正序 ↑ 并按 sortDir=asc 重查回第 1 页；再点回倒序 ↓', async () => {
    await mount()
    listReviews.mockClear()
    container.querySelector('.rev-sort').click()
    await flush()
    expect(listReviews).toHaveBeenCalledWith(expect.objectContaining({ sortDir: 'asc', page: 1 }))
    expect(container.querySelector('.rev-sort-arrow').textContent).toBe('↑')
    container.querySelector('.rev-sort').click()
    await flush()
    expect(listReviews).toHaveBeenLastCalledWith(expect.objectContaining({ sortDir: 'desc' }))
    expect(container.querySelector('.rev-sort-arrow').textContent).toBe('↓')
  })

  it('空态「暂无审核数据」（md §七 L99）；加载失败出「加载失败」+【重试】', async () => {
    listReviews.mockResolvedValueOnce({ list: [], total: 0 })
    await mount()
    expect(container.querySelector('.ls-empty').textContent).toContain('暂无审核数据')
    app.unmount(); container.remove()
    listReviews.mockRejectedValueOnce(new Error('x'))
    await mount()
    expect(container.querySelector('.el-empty').textContent).toContain('加载失败')
    expect([...container.querySelectorAll('.el-empty .el-button')].map((b) => b.textContent.trim())).toContain('重试')
  })

  it('【通过】发布类申请（VERSION_PUBLISH）→ 先弹确认（confirmApproveReview 收到该行）→ 调 approveReview(row) → toast「已通过审核」→ 重拉列表（md §5.2 L81-82）', async () => {
    await mount()
    rowBtn(rowById(2), '通过').click()
    await flush()
    expect(confirmApproveReview).toHaveBeenCalledWith(byId(2))
    expect(approveReview).toHaveBeenCalledWith(byId(2))
    expect(ElMessage.success).toHaveBeenCalledWith('已通过审核')
    expect(listReviews).toHaveBeenCalledTimes(2)
  })

  it('【通过】停用申请（DELIST）→ toast「已通过停用申请」（md §5.2 L81）', async () => {
    await mount()
    rowBtn(rowById(3), '通过').click()
    await flush()
    expect(approveReview).toHaveBeenCalledWith(byId(3))
    expect(ElMessage.success).toHaveBeenCalledWith('已通过停用申请')
  })

  it('【通过】确认弹窗取消 → 不调接口、不 toast、不重拉', async () => {
    confirmApproveReview.mockResolvedValueOnce(false)
    await mount()
    rowBtn(rowById(2), '通过').click()
    await flush()
    expect(approveReview).not.toHaveBeenCalled()
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(listReviews).toHaveBeenCalledTimes(1)
  })

  it('【通过】接口失败 → toast 错误原因（md §七 L101 记录已被其他审核人处理）', async () => {
    approveReview.mockRejectedValueOnce(new Error('审核记录不存在'))
    await mount()
    rowBtn(rowById(1), '通过').click()
    await flush()
    expect(ElMessage.error).toHaveBeenCalledWith('审核记录不存在')
  })

  it('【驳回】→ 开「驳回审核」弹窗 → 确认原因 → rejectReview(row, 原因) → toast「已驳回审核」→ 关弹窗并重拉（md §5.1 L71）', async () => {
    await mount()
    rowBtn(rowById(1), '驳回').click()
    await flush()
    expect(container.querySelector('.reject-dialog')).toBeTruthy()
    container.querySelector('.reject-confirm').click()
    await flush()
    expect(rejectReview).toHaveBeenCalledWith(byId(1), 'x')
    expect(ElMessage.success).toHaveBeenCalledWith('已驳回审核')
    expect(container.querySelector('.reject-dialog')).toBeNull()
    expect(listReviews).toHaveBeenCalledTimes(2)
  })

  it('岗位行快照缺失 → 【通过】【驳回】均被闸门拦下：warning 提示、不弹确认、不开弹窗、不调接口（md §七 L102；aa7d251）', async () => {
    loadReviewSnapshot.mockResolvedValue(null)
    await mount()
    rowBtn(rowById(5), '通过').click()
    await flush()
    expect(loadReviewSnapshot).toHaveBeenCalledWith('POSITION', 403)
    expect(ElMessage.warning).toHaveBeenCalledWith(SNAPSHOT_MISSING_HINT)
    expect(confirmApproveReview).not.toHaveBeenCalled()
    expect(approveReview).not.toHaveBeenCalled()
    rowBtn(rowById(5), '驳回').click()
    await flush()
    expect(container.querySelector('.reject-dialog')).toBeNull()
    expect(ElMessage.warning).toHaveBeenCalledTimes(2)
  })

  it('不需快照的类型（API / 业务系统）不查快照直接进审核流程', async () => {
    await mount()
    rowBtn(rowById(1), '通过').click()
    await flush()
    expect(loadReviewSnapshot).not.toHaveBeenCalled()
    expect(approveReview).toHaveBeenCalledWith(byId(1))
  })

  it('技能行【查看】→ 跳整页只读路由 SysConfigSkillView（params.id=refId、query.govReview=审核行 id）（md §4.2）', async () => {
    await mount()
    rowBtn(rowById(2), '查看').click()
    await flush()
    expect(push).toHaveBeenCalledWith({ name: 'SysConfigSkillView', params: { id: 'sk_302' }, query: { govReview: '2' } })
    expect(container.querySelector('.gov-detail')).toBeNull()
  })

  it('非技能行【查看】→ 打开原生详情抽屉（kind 归一化：TOOL/API → API），底部 关闭|驳回|通过、快照闸门开启（md §四 / §4.1）', async () => {
    await mount()
    rowBtn(rowById(1), '查看').click()
    await flush()
    const detail = container.querySelector('.gov-detail')
    expect(detail).toBeTruthy()
    expect(detail.dataset.kind).toBe('API')
    expect(detail.dataset.ref).toBe('api_1103')
    expect(detail.dataset.gate).toBe('true')
    const btns = [...detail.querySelectorAll('.gov-btn')]
    expect(btns.map((b) => b.textContent)).toEqual(['关闭', '驳回', '通过'])
    expect(btns.map((b) => b.dataset.type)).toEqual(['', 'danger', 'primary'])
    expect(push).not.toHaveBeenCalled()
    // 【关闭】→ 抽屉关
    btns[0].click()
    await flush()
    expect(container.querySelector('.gov-detail')).toBeNull()
  })

  it('详情底部【通过】→ 走同一通过流程，成功后关详情并重拉（md §5.2 L81「确认后关闭详情并提示」）', async () => {
    await mount()
    rowBtn(rowById(3), '查看').click()
    await flush()
    container.querySelector('.gov-btn[data-key="approve"]').click()
    await flush()
    expect(confirmApproveReview).toHaveBeenCalledWith(byId(3))
    expect(approveReview).toHaveBeenCalledWith(byId(3))
    expect(ElMessage.success).toHaveBeenCalledWith('已通过停用申请')
    expect(container.querySelector('.gov-detail')).toBeNull()
    expect(listReviews).toHaveBeenCalledTimes(2)
  })

  it('详情底部【驳回】→ 开驳回弹窗，确认后关弹窗与详情', async () => {
    await mount()
    rowBtn(rowById(1), '查看').click()
    await flush()
    container.querySelector('.gov-btn[data-key="reject"]').click()
    await flush()
    expect(container.querySelector('.reject-dialog')).toBeTruthy()
    container.querySelector('.reject-confirm').click()
    await flush()
    expect(rejectReview).toHaveBeenCalledWith(byId(1), 'x')
    expect(container.querySelector('.reject-dialog')).toBeNull()
    expect(container.querySelector('.gov-detail')).toBeNull()
  })
})
