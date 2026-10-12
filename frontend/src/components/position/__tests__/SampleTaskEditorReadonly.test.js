// @vitest-environment jsdom
/**
 * 自动化任务页只读态（J20，浦月 2026-10-10 按团队建议选 A）——
 * 对齐 md 岗位 §10「审核中全部页签只读」：自动化任务页不能只靠父级 .pd-ro-freeze 的 pointer-events 冻结
 * （键盘 Tab 聚焦后仍可编辑），而要由组件 readonly 入参真正禁用。
 *
 * 本文件挂真 element-plus + 真 SampleTaskEditor / SchedulePicker（仅替换重型 MarkdownEditor 与 ToolPicker），
 * 断言落在用户可见结果：输入控件 disabled、保存按钮消失、列表无删除 / 新增 / 排序手柄但仍可点选查看。
 *
 * 刻意保留可用的控件：右栏「引用工具」「引用平台技能」两个搜索框（.tl-search / .sk-search）只做筛选、不改任务数据，
 * 只读态下仍可用（便于查看时检索已引用项），所以 editorControls 把它们排除在「必须 disabled」之外，另有用例单独钉它们不被禁用。
 * 调度选择器（SchedulePicker）四种模式（按周期 / 每间隔 / 单次 / 闲时）在只读下的 disabled 由末尾一组直挂用例钉住。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import ElementPlus from 'element-plus'

vi.mock('@/api/sampleTask', () => ({
  createSampleTask: vi.fn(() => Promise.resolve({ id: 't1' })),
  updateSampleTask: vi.fn(() => Promise.resolve({ id: 't1' })),
  previewSampleSchedule: vi.fn(() => Promise.resolve({ summary: '每周 09:00', nextRunTimes: [] })),
  listSampleTasks: vi.fn(() =>
    Promise.resolve({
      list: [
        { id: 1, name: '每周经营报告', prompt: '每周汇总', status: 'ENABLED', scheduleSummary: '每周 09:00',
          schedule: { scheduleType: 'WEEKLY', scheduleMode: 'PERIODIC', daysOfWeek: [1], times: ['09:00'] },
          sopDoc: '汇总上周经营数据', toolRefs: [{ type: 'MCP', code: 'm1', bizName: '知识库 MCP' }], skillRefs: [{ platformSkillId: 9, name: '经营分析技能' }] },
        { id: 2, name: '月度复盘', prompt: '月度复盘', status: 'ENABLED', scheduleSummary: '每月 1 日', schedule: { scheduleType: 'MONTHLY', scheduleMode: 'PERIODIC', times: ['09:00'] },
          sopDoc: 'x', toolRefs: [], skillRefs: [] }
      ]
    })
  ),
  reorderSampleTasks: vi.fn(() => Promise.resolve()),
  deleteSampleTask: vi.fn(() => Promise.resolve()),
  setSampleTaskStatus: vi.fn(() => Promise.resolve()),
  testRunSampleTask: vi.fn(() => Promise.resolve({ success: true }))
}))
vi.mock('@/api/position', () => ({
  listToolPicker: vi.fn(() => Promise.resolve([])),
  listPlatformSkillCandidates: vi.fn(() => Promise.resolve([]))
}))
vi.mock('@/stores/position', () => ({ usePositionStore: () => ({ agents: [] }) }))
vi.mock('@/components/admin/MarkdownEditor.vue', () => ({
  default: {
    name: 'MarkdownEditor',
    props: ['modelValue', 'error', 'readonly', 'height', 'placeholder'],
    setup: (p) => () => h('div', { class: 'stub-md', 'data-readonly': String(p.readonly) })
  }
}))
vi.mock('@/components/admin/ToolPicker.vue', () => ({ default: { name: 'ToolPicker', setup: () => () => h('div') } }))
vi.mock('@/components/ReActSteps.vue', () => ({ default: { name: 'ReActSteps', setup: () => () => h('div') } }))

import PositionSampleTaskStage from '../PositionSampleTaskStage.vue'
import SchedulePicker from '@/components/task/SchedulePicker.vue'

let app, container
async function mountStage(readonly) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(PositionSampleTaskStage, { positionId: 7, positionName: '销售', readonly }) })
  app.use(ElementPlus)
  app.mount(container)
  for (let i = 0; i < 12; i++) { await Promise.resolve(); await nextTick() }
  return container
}
afterEach(() => { app?.unmount(); container?.remove(); document.body.innerHTML = '' })

// 右栏控件数下限：名称输入、提示词、调度选择器（模式 4 钮 + 周期 / 星期 / 时间等）、状态开关、执行位置、测试运行等合计远多于此值；
// 取 10 只为「确认抓到的是整块编辑器而不是漏选器抓到个位数」，不是精确个数（精确数会随编辑器加字段而变）。
const CTRL_FLOOR = 10

/** 右侧编辑器内全部可交互控件（排除只做筛选的两个搜索框）。 */
const editorControls = (el) =>
  [...el.querySelectorAll('.st-col-edit input, .st-col-edit textarea, .st-col-edit button')].filter(
    (c) => !c.closest('.tl-search, .sk-search')
  )

describe('自动化任务页 · 只读态（md §10 审核中全部页签只读）', () => {
  it('前提：可编辑态下右栏控件可用、有保存按钮 / 删除 / 新增 / 排序手柄', async () => {
    const el = await mountStage(false)
    const ctrls = editorControls(el)
    expect(ctrls.length).toBeGreaterThan(CTRL_FLOOR)
    expect(ctrls.filter((c) => !c.disabled).length).toBeGreaterThan(CTRL_FLOOR)
    expect(el.querySelector('.meta-actions')).not.toBeNull()
    expect(el.querySelector('.st-op-del')).not.toBeNull()
    expect(el.querySelector('.st-new')).not.toBeNull()
    expect(el.querySelector('.st-drag')).not.toBeNull()
  })

  it('只读态：右栏所有输入控件 / 按钮 disabled，键盘聚焦也改不了；无保存按钮；提示词编辑器收到 readonly', async () => {
    const el = await mountStage(true)
    const ctrls = editorControls(el)
    expect(ctrls.length).toBeGreaterThan(CTRL_FLOOR)
    expect(ctrls.filter((c) => !c.disabled).map((c) => c.outerHTML.slice(0, 80))).toEqual([])
    expect(el.querySelector('.meta-actions')).toBeNull()
    expect(el.querySelector('.stub-md').getAttribute('data-readonly')).toBe('true')
    expect(el.querySelector('.te-card-actions .el-switch').classList.contains('is-disabled')).toBe(true)
  })

  it('只读态：列表无【删除】/【＋ 新增】/排序手柄、条目不可拖拽，但仍可点选另一条查看', async () => {
    const el = await mountStage(true)
    expect(el.querySelector('.st-op-del')).toBeNull()
    expect(el.querySelector('.st-new')).toBeNull()
    expect(el.querySelector('.st-drag')).toBeNull()
    const items = [...el.querySelectorAll('.st-item')]
    expect(items.every((i) => i.getAttribute('draggable') === 'false')).toBe(true)
    items[1].click()
    for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick() }
    expect(el.querySelector('.st-col-edit .te-field input').value).toBe('月度复盘')
  })
})

describe('自动化任务页 · 只读态 · 刻意保留可用的搜索框', () => {
  it('「引用工具」「引用平台技能」两个搜索框存在且不被禁用（只做筛选、不改任务数据）', async () => {
    const el = await mountStage(true)
    const searches = [...el.querySelectorAll('.st-col-edit .tl-search input, .st-col-edit .sk-search input')]
    expect(searches.length).toBe(2)
    expect(searches.every((i) => !i.disabled)).toBe(true)
  })
})

describe('SchedulePicker · disabled 在四种模式下都禁用全部可交互控件（md §10 只读态）', () => {
  const SCHEDULES = {
    PERIODIC: { scheduleMode: 'PERIODIC', scheduleType: 'WEEKLY', daysOfWeek: [1], daysOfMonth: [], times: ['09:00', '14:00'] },
    INTERVAL: { scheduleMode: 'INTERVAL', scheduleType: 'INTERVAL_DAY', intervalCount: 2, intervalUnit: 'DAY', times: ['09:00'] },
    ONCE: { scheduleMode: 'ONCE', scheduleType: 'ONCE', onceAt: '2026-12-01 09:00' },
    IDLE: { scheduleMode: 'IDLE', scheduleType: 'IDLE', idleCount: 1, idleCountUnit: 'DAY', idleWindow: 'NIGHT' }
  }
  const pickerControls = (el) => [...el.querySelectorAll('input, textarea, button')]

  for (const [mode, schedule] of Object.entries(SCHEDULES)) {
    it(`${mode} 模式：disabled=true 时没有一个可用控件；disabled=false 时有可用控件（对照）`, async () => {
      for (const disabled of [true, false]) {
        container = document.createElement('div')
        document.body.appendChild(container)
        app = createApp({ render: () => h(SchedulePicker, { schedule, disabled }) })
        app.use(ElementPlus)
        app.mount(container)
        for (let i = 0; i < 4; i++) { await Promise.resolve(); await nextTick() }
        const ctrls = pickerControls(container)
        expect(ctrls.length).toBeGreaterThan(4) // 至少模式 4 钮 + 本模式的字段
        const enabled = ctrls.filter((c) => !c.disabled)
        if (disabled) expect(enabled.map((c) => c.outerHTML.slice(0, 80))).toEqual([])
        else expect(enabled.length).toBeGreaterThan(0)
        app.unmount(); container.remove()
      }
    })
  }
})
