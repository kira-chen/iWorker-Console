// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { makeElTableStubs } from './helpers/elTableStub'

/**
 * UserSkillReviews.vue 列表页单测（2026-09-08 PRD-20260908 对齐整页重做）。
 *
 * 验：页面说明 md L8；工具栏（占位 / 尺度与状态下拉 / 【查询】/ 右端【风险设置】）；
 * 七列与状态 / 尺度标签词；操作列按状态（待审核 查看技能+通过+驳回、已完成仅 查看技能）；
 * 提交时间列头切换正倒序（默认 desc ↓）；空态文案；通过弹窗文案 + toast「审核已通过」+ 记审核人；
 * 驳回经弹窗 confirm → toast「审核已驳回」；查看技能开抽屉（不再新标签整页）；深链 ?view=id 自动开抽屉。
 * 子组件（抽屉 / 驳回弹窗 / 风险设置）各有独立单测，这里只验「开没开、带的什么」。
 * 2026-09-12 测试审计 T56（C1）：补尺度 / 状态下拉「选择后即时刷新列表」并回第 1 页（md §三 L52-53），
 * 查询用例改断行内容随结果变化；T39：el-table 桩改用 helpers/elTableStub.js。
 * ListToolbar / ListStates / ListPagination 为真实挂载（分页条真按钮用于把页码翻到第 2 页）。
 */

vi.mock('@element-plus/icons-vue', () => ({ Search: {} }))

const listReviewApplications = vi.fn()
const approveReviewApplication = vi.fn()
const rejectReviewApplication = vi.fn()
vi.mock('@/api/skillReview', () => ({
  listReviewApplications: (...a) => listReviewApplications(...a),
  approveReviewApplication: (...a) => approveReviewApplication(...a),
  rejectReviewApplication: (...a) => rejectReviewApplication(...a)
}))

const ElMessage = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() })
vi.mock('element-plus', () => ({ ElMessage }))

const confirmDialog = vi.fn()
vi.mock('@/composables/useConfirm', () => ({ confirmDialog: (...a) => confirmDialog(...a) }))

const routeQuery = { value: {} }
const replace = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: routeQuery.value }),
  useRouter: () => ({ replace })
}))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ userInfo: { name: 'audit.admin' } }) }))

vi.mock('@/components/PageHeader.vue', () => ({
  default: {
    props: ['title', 'subtitle'],
    template: '<div class="page-header">{{ title }}<span class="ph-sub">{{ subtitle }}</span></div>'
  }
}))

// 抽屉：只验开没开 / 带的 id；底部动作经 approve / reject 事件回到页面
const drawerProps = vi.fn()
vi.mock('@/components/admin/UserSkillAuditDrawer.vue', () => ({
  default: {
    name: 'UserSkillAuditDrawer',
    props: { visible: Boolean, reviewId: [String, Number, null], busyKey: String },
    emits: ['update:visible', 'approve', 'reject'],
    setup(props, { emit }) {
      return () => {
        drawerProps(props.visible, props.reviewId)
        return props.visible
          ? h('div', { class: 'audit-drawer' }, [
              String(props.reviewId),
              h('button', { class: 'drawer-approve', onClick: () => emit('approve', { id: props.reviewId, skillName: '抽屉技能', status: 'PENDING' }) }, '通过')
            ])
          : null
      }
    }
  }
}))
// 驳回弹窗：暴露一个按钮直接 emit confirm('原因')
vi.mock('@/components/admin/UserSkillRejectDialog.vue', () => ({
  default: {
    name: 'UserSkillRejectDialog',
    props: { modelValue: Boolean, submitting: Boolean },
    emits: ['update:modelValue', 'confirm'],
    setup(props, { emit }) {
      return () =>
        props.modelValue
          ? h('div', { class: 'reject-dialog' }, [h('button', { class: 'reject-confirm', onClick: () => emit('confirm', '权限过大') }, '确认驳回')])
          : null
    }
  }
}))
vi.mock('@/components/admin/RiskSettingsDrawer.vue', () => ({
  default: {
    name: 'RiskSettingsDrawer',
    props: { visible: Boolean },
    setup(props) {
      return () => (props.visible ? h('div', { class: 'risk-drawer' }) : null)
    }
  }
}))

const UserSkillReviews = (await import('@/views/admin/UserSkillReviews.vue')).default

// 2026-09-12 测试审计 T39：el-table-column / 行单元 桩改用共享 helper（表头阶段渲染 header 插槽以验「提交时间 ↓」）。
// el-table 本地包一层：helper 的 tableStub 按下标 i 作 key，行集合变了（查询 / 筛选后）同下标的 RowCells 会被复用、
// setup 里 provide 的仍是旧行对象 → 断不出「行内容变化」；这里改用 row.id 作 key（行换了就重建）。
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
// 下拉桩：用例经 CustomEvent('pick', { detail }) 模拟用户选中一项 → 同步 v-model 并触发 change（EP 行为）
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
  app = createApp(UserSkillReviews)
  app.component('el-input', elInput)
  app.component('el-select', elSelect)
  app.component('el-option', elOption)
  app.component('el-icon', passthrough('el-icon'))
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
const rowBtn = (row, text) => [...row.querySelectorAll('.el-button')].find((b) => b.textContent.trim() === text)
const toolbarBtn = (text) => [...container.querySelectorAll('.list-toolbar .el-button')].find((b) => b.textContent.trim() === text)

const ROWS = [
  { id: 'usr_1', skillName: '自动发送邮件', description: '批量向外部邮箱发送邮件', submitter: 'zhangsan', submittedAt: '2026-09-01T10:23:00+08:00', status: 'PENDING', scale: '通用' },
  { id: 'usr_2', skillName: '数据库批量清理', description: '定期清理过期数据库记录', submitter: 'lisi', submittedAt: '2026-08-30T14:05:00+08:00', status: 'REJECTED', scale: '严格' },
  { id: 'usr_3', skillName: 'Slack 通知推送', description: '将系统告警实时推送', submitter: 'wangwu', submittedAt: '2026-08-28T09:17:00+08:00', status: 'APPROVED', scale: '宽松' }
]

beforeEach(() => {
  listReviewApplications.mockReset().mockResolvedValue({ list: ROWS, total: 3 })
  approveReviewApplication.mockReset().mockResolvedValue({})
  rejectReviewApplication.mockReset().mockResolvedValue({})
  confirmDialog.mockReset().mockResolvedValue(true)
  drawerProps.mockReset()
  replace.mockReset()
  routeQuery.value = {}
  ElMessage.success.mockReset()
  ElMessage.error.mockReset()
})
afterEach(() => {
  app?.unmount()
  container?.remove()
})

describe('UserSkillReviews（2026-09-08 PRD-20260908 对齐）', () => {
  it('页面说明取 md L8；挂载拉列表默认 sort=desc', async () => {
    await mount()
    expect(container.querySelector('.ph-sub').textContent).toBe('审核用户上传的自定义技能，处理高风险检测记录，并设置风险尺度。')
    expect(listReviewApplications).toHaveBeenCalledWith(expect.objectContaining({ sort: 'desc', page: 1 }))
    // 旧「用途 自用/平台共享」概念不再出现
    expect(container.textContent).not.toContain('平台共享')
    expect(container.textContent).not.toContain('用户自用')
  })

  it('工具栏：搜索占位、审核尺度 / 审核状态下拉（含全部项与选项词）、【查询】、右端【风险设置】', async () => {
    await mount()
    expect(container.querySelector('.el-input').placeholder).toBe('搜索技能名称 / 描述 / 提交人')
    const selects = [...container.querySelectorAll('.el-select')]
    expect(selects.map((s) => s.dataset.placeholder)).toEqual(['全部审核尺度', '全部审核状态'])
    expect([...selects[0].querySelectorAll('.el-option')].map((o) => o.textContent)).toEqual(['宽松', '通用', '严格'])
    expect([...selects[1].querySelectorAll('.el-option')].map((o) => o.textContent)).toEqual(['待审核', '已通过', '已驳回'])
    expect(toolbarBtn('查询')).toBeTruthy()
    const risk = toolbarBtn('风险设置')
    expect(risk).toBeTruthy()
    expect(risk.dataset.type).toBe('primary')
    expect(container.querySelector('.list-toolbar-right').contains(risk)).toBe(true)
    // 点【风险设置】开抽屉
    risk.click()
    await flush()
    expect(container.querySelector('.risk-drawer')).toBeTruthy()
  })

  it('【查询】/ Enter 触发查询（带 keyword）→ 列表行随结果变化（3 行 → 只剩命中的 1 行）', async () => {
    // 按 keyword 过滤的接口替身：让「查询后行内容变化」成为可见结果而非只看调用参数
    listReviewApplications.mockImplementation((p = {}) => {
      const list = p.keyword ? ROWS.filter((r) => r.skillName.includes(p.keyword)) : ROWS
      return Promise.resolve({ list, total: list.length })
    })
    await mount()
    expect(rowEls()).toHaveLength(3)
    const input = container.querySelector('.el-input')
    input.value = '邮件'
    input.dispatchEvent(new Event('input'))
    await flush()
    listReviewApplications.mockClear()
    toolbarBtn('查询').click()
    await flush()
    expect(listReviewApplications).toHaveBeenCalledWith(expect.objectContaining({ keyword: '邮件', page: 1 }))
    const rows = rowEls()
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('自动发送邮件')
    expect(container.textContent).not.toContain('数据库批量清理')
    listReviewApplications.mockClear()
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }))
    await flush()
    expect(listReviewApplications).toHaveBeenCalledTimes(1)
  })

  // md §三 L52「审核尺度……选择后即时刷新列表」/ L53「审核状态……选择后即时刷新列表」（UserSkillReviews.vue:162,165 @change=reload）
  it('审核尺度下拉选中「严格」→ 不点【查询】即按 scale 重查并回第 1 页；列表只剩严格行（md §三 L52）', async () => {
    // 先给 20 条总数把页码翻到第 2 页，才能证明「回第 1 页」不是空话
    listReviewApplications.mockImplementation((p = {}) => {
      if (p.scale) {
        const list = ROWS.filter((r) => r.scale === p.scale)
        return Promise.resolve({ list, total: list.length })
      }
      return Promise.resolve({ list: ROWS, total: 20 })
    })
    await mount()
    const page2 = [...container.querySelectorAll('.list-pager .page-btn')].find((b) => b.textContent.trim() === '2')
    expect(page2).toBeTruthy()
    page2.click()
    await flush()
    expect(listReviewApplications).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
    listReviewApplications.mockClear()
    pick(container.querySelectorAll('.el-select')[0], '严格')
    await flush()
    expect(listReviewApplications).toHaveBeenCalledTimes(1)
    expect(listReviewApplications).toHaveBeenCalledWith(expect.objectContaining({ scale: '严格', page: 1 }))
    const rows = rowEls()
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('数据库批量清理')
  })

  it('审核状态下拉选中「已通过」→ 即时按 status 重查回第 1 页；列表只剩已通过行（md §三 L53）', async () => {
    listReviewApplications.mockImplementation((p = {}) => {
      const list = p.status ? ROWS.filter((r) => r.status === p.status) : ROWS
      return Promise.resolve({ list, total: list.length })
    })
    await mount()
    listReviewApplications.mockClear()
    pick(container.querySelectorAll('.el-select')[1], 'APPROVED')
    await flush()
    expect(listReviewApplications).toHaveBeenCalledTimes(1)
    expect(listReviewApplications).toHaveBeenCalledWith(expect.objectContaining({ status: 'APPROVED', page: 1 }))
    const rows = rowEls()
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('Slack 通知推送')
    expect(rows[0].querySelector('.usa-tag').textContent).toBe('已通过')
  })

  it('七列表头（提交时间列头带 ↓）；状态 / 尺度标签词；操作列按状态', async () => {
    await mount()
    const heads = [...container.querySelectorAll('.el-head .el-table-column')].map((c) => c.textContent.replace(/\s+/g, ' ').trim())
    expect(heads).toEqual(['技能名称', '描述', '提交人', '提交时间 ↓', '审核状态', '审核尺度', '操作'])
    const rows = rowEls()
    expect(rows).toHaveLength(3)
    const tags = (row) => [...row.querySelectorAll('.usa-tag')].map((t) => t.textContent)
    expect(tags(rows[0])).toEqual(['待审核', '通用'])
    expect(tags(rows[1])).toEqual(['已驳回', '严格'])
    expect(tags(rows[2])).toEqual(['已通过', '宽松'])
    expect(container.textContent).not.toContain('待审批')
    expect(container.textContent).not.toContain('审核中')
    // 时间精确到分钟
    expect(rows[0].textContent).toContain('2026-09-01 10:23')
    // 操作列：待审核 查看技能 / 通过 / 驳回（驳回红字链）；已完成仅 查看技能
    const ops = (row) => [...row.querySelectorAll('.usr-ops .el-button')].map((b) => b.textContent.trim())
    expect(ops(rows[0])).toEqual(['查看技能', '通过', '驳回'])
    expect(rowBtn(rows[0], '驳回').dataset.type).toBe('danger')
    expect(ops(rows[1])).toEqual(['查看技能'])
    expect(ops(rows[2])).toEqual(['查看技能'])
  })

  it('提交时间列头点击切换正序 ↑ / 倒序 ↓，并按新方向重查', async () => {
    await mount()
    const head = container.querySelector('.usr-sort-head')
    listReviewApplications.mockClear()
    head.click()
    await flush()
    expect(listReviewApplications).toHaveBeenCalledWith(expect.objectContaining({ sort: 'asc' }))
    expect(container.querySelector('.usr-sort-head').textContent).toContain('↑')
    head.click()
    await flush()
    expect(listReviewApplications).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'desc' }))
    expect(container.querySelector('.usr-sort-head').textContent).toContain('↓')
  })

  it('空态文案「没有符合条件的审核记录」；加载失败出重试', async () => {
    listReviewApplications.mockResolvedValueOnce({ list: [], total: 0 })
    await mount()
    expect(container.querySelector('.ls-empty').textContent).toContain('没有符合条件的审核记录')
    app.unmount(); container.remove()
    listReviewApplications.mockRejectedValueOnce(new Error('x'))
    await mount()
    expect(container.querySelector('.el-empty').textContent).toContain('加载失败')
  })

  it('【查看技能】开抽屉（带行 id），不再新标签整页', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    await mount()
    rowBtn(rowEls()[1], '查看技能').click()
    await flush()
    expect(container.querySelector('.audit-drawer').textContent).toContain('usr_2')
    expect(openSpy).not.toHaveBeenCalled()
    openSpy.mockRestore()
  })

  // 待办 yuepu#12④：访问审计【查看】跳转统一带 query.keyword（md 访问审计 §6.3 L128），本页须作为初始搜索词。
  it('跨模块入口 ?keyword=xxx（访问审计【查看】）：首拉即按该关键词取数', async () => {
    routeQuery.value = { keyword: 'usr_skill_a' }
    await mount()
    expect(listReviewApplications.mock.calls[0][0]).toEqual(expect.objectContaining({ keyword: 'usr_skill_a', page: 1 }))
  })

  it('深链 ?view=id：挂载即开抽屉并清掉 query', async () => {
    routeQuery.value = { view: 'usr_3' }
    await mount()
    expect(container.querySelector('.audit-drawer').textContent).toContain('usr_3')
    expect(replace).toHaveBeenCalledWith({ query: { view: undefined } })
  })

  it('【通过】：弹窗标题「通过审核」/ 正文 md §6.1 / 确认键「确认通过」→ 记审核人 → toast「审核已通过」并刷新', async () => {
    await mount()
    rowBtn(rowEls()[0], '通过').click()
    await flush()
    expect(confirmDialog).toHaveBeenCalledWith(
      '确认通过「自动发送邮件」的审核申请，通过后提交人将可立即使用此技能。',
      '通过审核',
      expect.objectContaining({ confirmText: '确认通过' })
    )
    expect(approveReviewApplication).toHaveBeenCalledWith('usr_1', { reviewer: 'audit.admin' })
    expect(ElMessage.success).toHaveBeenCalledWith('审核已通过')
    expect(listReviewApplications).toHaveBeenCalledTimes(2)
  })

  it('【通过】取消弹窗 → 不调接口', async () => {
    confirmDialog.mockResolvedValueOnce(false)
    await mount()
    rowBtn(rowEls()[0], '通过').click()
    await flush()
    expect(approveReviewApplication).not.toHaveBeenCalled()
  })

  it('【驳回】：开驳回弹窗，confirm 原因 → 调接口带审核人与原因 → toast「审核已驳回」并关弹窗刷新', async () => {
    await mount()
    rowBtn(rowEls()[0], '驳回').click()
    await flush()
    expect(container.querySelector('.reject-dialog')).toBeTruthy()
    container.querySelector('.reject-confirm').click()
    await flush()
    expect(rejectReviewApplication).toHaveBeenCalledWith('usr_1', { reviewer: 'audit.admin', reason: '权限过大' })
    expect(ElMessage.success).toHaveBeenCalledWith('审核已驳回')
    expect(container.querySelector('.reject-dialog')).toBeNull()
    expect(listReviewApplications).toHaveBeenCalledTimes(2)
  })

  it('抽屉底部【通过】走同一通过流程，成功后关抽屉', async () => {
    await mount()
    rowBtn(rowEls()[0], '查看技能').click()
    await flush()
    container.querySelector('.drawer-approve').click()
    await flush()
    expect(confirmDialog).toHaveBeenCalledWith(expect.stringContaining('「抽屉技能」'), '通过审核', expect.anything())
    expect(approveReviewApplication).toHaveBeenCalledWith('usr_1', { reviewer: 'audit.admin' })
    expect(container.querySelector('.audit-drawer')).toBeNull()
  })

  it('接口失败 → toast 错误原因', async () => {
    approveReviewApplication.mockRejectedValueOnce(new Error('该记录已审核，不能重复操作'))
    await mount()
    rowBtn(rowEls()[0], '通过').click()
    await flush()
    expect(ElMessage.error).toHaveBeenCalledWith('该记录已审核，不能重复操作')
  })
})
