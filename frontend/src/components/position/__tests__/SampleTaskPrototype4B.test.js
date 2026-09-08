// @vitest-environment jsdom
/**
 * 2026-09-09 原型复刻批次 4B —— 岗位详情「自动化任务」页签复刻回归。
 *
 * 覆盖分路明细 B-岗位详情页 #16–#22 的可断言点：
 * - #16 主从容器：embedded 态去卡片外壳（无 zoomIn 动画类壳）、右栏内容限宽居中容器在位；
 * - #17 列表项操作精简为「删除」（在名称行内），不再有「编辑」按钮；启停移出列表项；
 * - #18 分区卡头（.te-card-title）承担绿条 + 灰底头条，卡体独立 .te-card-body；
 * - #19 SchedulePicker prototype 态：周期分段按钮 / 执行星期按钮条 / 绿底执行预览（药丸去 T 与时区）；
 * - #20 详细说明脚部字数计数；
 * - #21 引用工具卡：搜索框 + 已引用工具平铺行（已验证 tag）+ 卡底「+ 添加工具」；
 * - #22 引用平台技能卡：已选 chips + 搜索 + 卡底「+ 添加技能」（候选默认收起）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

async function flush(n = 8) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

/* ============================ 公共 mock ============================ */
vi.mock('@/api/sampleTask', () => ({
  createSampleTask: vi.fn(() => Promise.resolve({ id: 't1' })),
  updateSampleTask: vi.fn(() => Promise.resolve({ id: 't1' })),
  previewSampleSchedule: vi.fn(() =>
    Promise.resolve({ summary: '每周 09:00', nextRunTimes: ['2026-09-07T09:00:00+08:00'] })
  ),
  listSampleTasks: vi.fn(() =>
    Promise.resolve({
      list: [
        {
          id: 1,
          name: '每周经营报告',
          prompt: '每周汇总经营数据',
          status: 'ENABLED',
          scheduleSummary: '每周 09:00',
          schedule: { scheduleType: 'WEEKLY', daysOfWeek: [1], times: ['09:00'] },
          sopDoc: '汇总上周经营数据',
          toolRefs: [{ type: 'MCP', code: 'mcp__zhishiku', bizName: '知识库 MCP' }],
          skillRefs: [{ platformSkillId: 9, name: '经营分析技能' }]
        }
      ]
    })
  ),
  reorderSampleTasks: vi.fn(() => Promise.resolve()),
  deleteSampleTask: vi.fn(() => Promise.resolve()),
  setSampleTaskStatus: vi.fn(() => Promise.resolve()),
  testRunSampleTask: vi.fn(() => Promise.resolve({ success: true }))
}))
vi.mock('@/api/position', () => ({
  listToolPicker: vi.fn((params) =>
    Promise.resolve(
      params?.type === 'MCP'
        ? [{ code: 'mcp__zhishiku', bizName: '知识库 MCP', description: '检索企业知识库', checkStatus: 'HEALTHY', type: 'MCP' }]
        : []
    )
  ),
  listPlatformSkillCandidates: vi.fn(() => Promise.resolve([{ id: 9, name: '经营分析技能', description: '' }]))
}))
vi.mock('@/api/request', () => ({ ApiError: class ApiError extends Error {} }))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  ElMessageBox: { confirm: vi.fn(() => Promise.resolve()), prompt: vi.fn() }
}))
vi.mock('@/components/admin/MarkdownEditor.vue', () => ({
  default: {
    name: 'MarkdownEditor',
    props: ['modelValue'],
    setup: (p) => () => h('div', { class: 'stub-md' }, p.modelValue ?? '')
  }
}))
vi.mock('@/components/admin/ToolPicker.vue', () => ({
  default: { name: 'ToolPicker', setup: () => () => h('div', { class: 'stub-tool' }) }
}))
vi.mock('@/components/ReActSteps.vue', () => ({
  default: { name: 'ReActSteps', setup: () => () => h('div') }
}))
vi.mock('@/components/StatusTag.vue', () => ({
  default: { name: 'StatusTag', setup: (_, { slots }) => () => h('span', { class: 'stub-status' }, slots.default?.()) }
}))

/* ============================ Element Plus stub ============================ */
const elInput = {
  name: 'el-input',
  props: { modelValue: { default: '' }, placeholder: { default: '' } },
  emits: ['update:modelValue', 'input', 'clear'],
  setup(props, { emit }) {
    return () =>
      h('input', {
        class: 'stub-el-input',
        placeholder: props.placeholder,
        value: props.modelValue,
        onInput: (e) => {
          emit('update:modelValue', e.target.value)
          emit('input')
        }
      })
  }
}
const stubs = {
  'el-input': elInput,
  'el-button': { template: '<button @click="$emit(\'click\')"><slot /></button>' },
  'el-icon': { template: '<i><slot /></i>' },
  'el-checkbox': { template: '<span class="stub-checkbox" />' },
  'el-checkbox-group': { template: '<div><slot /></div>' },
  'el-checkbox-button': { template: '<label><slot /></label>' },
  'el-radio-group': { template: '<div><slot /></div>' },
  'el-radio-button': { template: '<label><slot /></label>' },
  'el-tooltip': { template: '<span><slot /></span>' },
  'el-switch': {
    props: ['modelValue'],
    template: '<button class="stub-switch" @click="$emit(\'change\', !modelValue)" />'
  },
  'el-select': { template: '<div><slot /></div>' },
  'el-option': { template: '<div />' },
  'el-time-picker': { template: '<div />' },
  'el-date-picker': { template: '<div />' },
  'el-dialog': {
    props: ['modelValue'],
    template: '<div v-if="modelValue" class="stub-dialog"><slot /><slot name="footer" /></div>'
  },
  'el-drawer': { template: '<div />' },
  'el-empty': { template: '<div />' },
  'el-skeleton': { template: '<div />' },
  'el-tag': { template: '<span><slot /></span>' }
}

let app, container
function mountComp(Comp, props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(Comp, props) })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.directive('loading', {})
  app.mount(container)
  return container
}
beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  app?.unmount()
  container?.remove()
})

const SAMPLE = {
  id: 1,
  name: '每周经营报告',
  prompt: '每周汇总经营数据',
  status: 'ENABLED',
  schedule: { scheduleType: 'WEEKLY', daysOfWeek: [1], times: ['09:00'] },
  sopDoc: '汇总上周经营数据，识别异常指标',
  toolRefs: [{ type: 'MCP', code: 'mcp__zhishiku', bizName: '知识库 MCP' }],
  skillRefs: [{ platformSkillId: 9, name: '经营分析技能' }]
}

/* ============================ #16 / #17 主从容器与列表项 ============================ */
describe('自动化任务 · 主从容器与列表项（4B #16 / #17）', () => {
  let PositionSampleTaskStage
  beforeEach(async () => {
    PositionSampleTaskStage = (await import('@/components/position/PositionSampleTaskStage.vue')).default
  })

  it('#16 embedded 态挂 .st-embedded（去卡片外壳），非 embedded 不挂', async () => {
    mountComp(PositionSampleTaskStage, { positionId: 1, embedded: true })
    await flush()
    expect(container.querySelector('.st-editor').classList.contains('st-embedded')).toBe(true)
    // 内联态不渲染面包屑顶栏
    expect(container.querySelector('.ed-crumb')).toBeNull()
  })

  it('#16 非 embedded 态保留浮层卡外壳与面包屑（零回归）', async () => {
    mountComp(PositionSampleTaskStage, { positionId: 1, embedded: false })
    await flush()
    expect(container.querySelector('.st-editor').classList.contains('st-embedded')).toBe(false)
    expect(container.querySelector('.ed-crumb')).not.toBeNull()
  })

  it('#17 列表项操作只剩「删除」，落在名称行内；不再有「编辑」「停用」按钮', async () => {
    mountComp(PositionSampleTaskStage, { positionId: 1, embedded: true })
    await flush()
    const nameRow = container.querySelector('.st-item .st-name')
    expect(nameRow).not.toBeNull()
    expect(nameRow.textContent).toContain('删除')
    // 旧的 .st-ops 操作簇已移除
    expect(container.querySelector('.st-item .st-ops')).toBeNull()
    const itemText = container.querySelector('.st-item').textContent
    expect(itemText).not.toContain('编辑')
    expect(itemText).not.toContain('停用')
    expect(itemText).not.toContain('启用')
  })
})

/* ============================ #18 / #20 / #21 / #22 分区卡 ============================ */
describe('自动化任务 · 详情分区卡（4B #18 / #20 / #21 / #22）', () => {
  let SampleTaskEditor
  beforeEach(async () => {
    SampleTaskEditor = (await import('@/components/position/SampleTaskEditor.vue')).default
  })

  it('#18 五个分区卡头 + 独立卡体；卡头文案逐字对齐原型', async () => {
    mountComp(SampleTaskEditor, { positionId: 1, sample: SAMPLE, embedded: true })
    await flush()
    const heads = [...container.querySelectorAll('.te-card-title')].map((n) => n.textContent.trim())
    expect(heads[0]).toContain('基本信息')
    expect(heads[1]).toContain('调度计划')
    expect(heads[2]).toContain('详细说明')
    expect(heads[3]).toContain('引用工具')
    expect(heads[4]).toContain('引用平台技能')
    expect(container.querySelectorAll('.te-card-body').length).toBe(5)
  })

  it('#16 embedded 态右栏内容有限宽居中容器 .ste-inner', async () => {
    mountComp(SampleTaskEditor, { positionId: 1, sample: SAMPLE, embedded: true })
    await flush()
    expect(container.querySelector('.ste-body').classList.contains('ste-embedded')).toBe(true)
    expect(container.querySelector('.ste-inner')).not.toBeNull()
  })

  it('md §7.2 启停：编辑态在「基本信息」卡头出开关，点击上抛 toggle-status', async () => {
    const onToggle = vi.fn()
    mountComp(SampleTaskEditor, {
      positionId: 1,
      sample: SAMPLE,
      embedded: true,
      onToggleStatus: onToggle
    })
    await flush()
    const sw = container.querySelector('.te-card-actions .stub-switch')
    expect(sw).not.toBeNull()
    expect(container.querySelector('.te-card-action-label').textContent.trim()).toBe('已启用')
    sw.click()
    await flush()
    expect(onToggle).toHaveBeenCalled()
  })

  it('新建态不出启停开关（未落库无状态可切）', async () => {
    mountComp(SampleTaskEditor, { positionId: 1, sample: null, embedded: true })
    await flush()
    expect(container.querySelector('.te-card-actions')).toBeNull()
  })

  it('#20 详细说明卡脚部展示字数计数（折叠空白后长度）', async () => {
    mountComp(SampleTaskEditor, { positionId: 1, sample: SAMPLE, embedded: true })
    await flush()
    const counter = container.querySelector('.te-editor-counter')
    expect(counter).not.toBeNull()
    expect(counter.textContent.trim()).toBe(`字数: ${SAMPLE.sopDoc.replace(/\s+/g, ' ').trim().length}`)
  })

  it('#21 引用工具卡：搜索框 + 平铺行（已验证 tag）+ 卡底「+ 添加工具」，搜索可过滤', async () => {
    mountComp(SampleTaskEditor, { positionId: 1, sample: SAMPLE, embedded: true })
    await flush()
    // 搜索框文案逐字对齐原型 data-static-tool-search
    const search = container.querySelector('.stub-el-input[placeholder="搜索工具名称 / 类型"]')
    expect(search).not.toBeNull()
    const rows = [...container.querySelectorAll('.tl-row')]
    expect(rows.length).toBe(1)
    expect(rows[0].querySelector('.tl-name').textContent.trim()).toBe('知识库 MCP')
    expect(rows[0].querySelector('.tl-type').textContent.trim()).toBe('MCP')
    expect(rows[0].querySelector('.stub-status').textContent.trim()).toBe('已验证')
    // 卡底虚线「+ 添加工具」
    const adds = [...container.querySelectorAll('.te-dash-add')].map((b) => b.textContent.trim())
    expect(adds).toContain('+ 添加工具')
    // 搜索过滤
    search.value = '不存在的工具'
    search.dispatchEvent(new Event('input'))
    await flush()
    expect(container.querySelectorAll('.tl-row').length).toBe(0)
    expect(container.querySelector('.tl-empty')).not.toBeNull()
  })

  it('#21 点「+ 添加工具」开弹窗，弹窗内复用 ToolPicker', async () => {
    mountComp(SampleTaskEditor, { positionId: 1, sample: SAMPLE, embedded: true })
    await flush()
    expect(container.querySelector('.stub-dialog')).toBeNull()
    const btn = [...container.querySelectorAll('.te-dash-add')].find((b) => b.textContent.trim() === '+ 添加工具')
    btn.click()
    await flush()
    const dialog = container.querySelector('.stub-dialog')
    expect(dialog).not.toBeNull()
    expect(dialog.querySelector('.stub-tool')).not.toBeNull()
  })

  it('#22 引用平台技能卡：已选 chips + 搜索框，候选列表默认收起，点「+ 添加技能」才展开', async () => {
    mountComp(SampleTaskEditor, { positionId: 1, sample: SAMPLE, embedded: true })
    await flush()
    // 已选 chip
    const chip = container.querySelector('.sk-chip .sk-chip-name')
    expect(chip.textContent.trim()).toBe('经营分析技能')
    // 搜索框文案逐字
    expect(container.querySelector('.stub-el-input[placeholder="搜索平台技能名 / 描述"]')).not.toBeNull()
    // 候选默认收起
    expect(container.querySelector('.sk-list')).toBeNull()
    const addBtn = [...container.querySelectorAll('.te-dash-add')].find((b) => b.textContent.trim() === '+ 添加技能')
    expect(addBtn).not.toBeNull()
    addBtn.click()
    await flush()
    expect(container.querySelector('.sk-list')).not.toBeNull()
  })
})

/* ============================ #19 调度计划 ============================ */
describe('自动化任务 · 调度计划原型态（4B #19）', () => {
  let SchedulePicker
  beforeEach(async () => {
    SchedulePicker = (await import('@/components/task/SchedulePicker.vue')).default
  })

  function mountSched(extra = {}) {
    const schedule = ref({
      scheduleType: 'WEEKLY',
      daysOfWeek: [1],
      daysOfMonth: [],
      times: ['09:00'],
      onceAt: '',
      startDate: '',
      endDate: ''
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    app = createApp({
      render: () =>
        h(SchedulePicker, {
          schedule: schedule.value,
          'onUpdate:schedule': (v) => (schedule.value = v),
          ...extra
        })
    })
    for (const [n, c] of Object.entries(stubs)) app.component(n, c)
    app.directive('loading', {})
    app.mount(container)
    return schedule
  }

  it('prototype=true：周期类型走分段按钮组，当前项高亮；点「每天」切类型', async () => {
    const schedule = mountSched({ prototype: true, previewSummary: '每周 09:00', previewTimes: [] })
    await flush()
    const segs = [...container.querySelectorAll('.sp-seg .sp-seg-btn')].map((b) => b.textContent.trim())
    expect(segs).toEqual(['每天', '每周', '每月', '仅一次'])
    expect(container.querySelector('.sp-seg .sp-seg-btn.on').textContent.trim()).toBe('每周')
    container.querySelectorAll('.sp-seg .sp-seg-btn')[0].click()
    await flush()
    expect(schedule.value.scheduleType).toBe('DAILY')
  })

  it('prototype=true：每周出七个执行星期按钮，点击切换 daysOfWeek 且保持升序', async () => {
    const schedule = mountSched({ prototype: true })
    await flush()
    const days = [...container.querySelectorAll('.sp-week-seg .sp-seg-btn')]
    expect(days.map((b) => b.textContent.trim())).toEqual(['周一', '周二', '周三', '周四', '周五', '周六', '周日'])
    expect(days[0].classList.contains('on')).toBe(true)
    days[4].click() // 周五 = 5
    await flush()
    expect(schedule.value.daysOfWeek).toEqual([1, 5])
    // 再点周一取消
    container.querySelectorAll('.sp-week-seg .sp-seg-btn')[0].click()
    await flush()
    expect(schedule.value.daysOfWeek).toEqual([5])
  })

  it('prototype=true：定点时间行为「序号圆 + ⏰ time input」，改值回写 times', async () => {
    const schedule = mountSched({ prototype: true })
    await flush()
    expect(container.querySelector('.sp-time-no').textContent.trim()).toBe('1')
    const input = container.querySelector('.sp-time-input input')
    expect(input.type).toBe('time')
    input.value = '18:30'
    input.dispatchEvent(new Event('input'))
    await flush()
    expect(schedule.value.times).toEqual(['18:30'])
    // 「+添加时间」文字按钮
    const addTime = container.querySelector('.sp-add-time-link')
    expect(addTime.textContent.trim()).toBe('+添加时间')
    addTime.click()
    await flush()
    expect(schedule.value.times.length).toBe(2)
  })

  it('prototype=true：执行预览走绿底框 + 白底药丸，药丸去掉 T 与时区后缀', async () => {
    mountSched({
      prototype: true,
      previewSummary: '每周 09:00',
      previewTimes: ['2026-09-07T09:00:00+08:00', '2026-09-14T09:00:00+08:00']
    })
    await flush()
    const box = container.querySelector('.sp-proto-preview')
    expect(box).not.toBeNull()
    expect(box.querySelector('.sp-proto-sched').textContent.trim()).toBe('每周 09:00')
    expect(box.querySelector('.sp-proto-next-label').textContent.trim()).toBe('接下来 2 次：')
    const pills = [...box.querySelectorAll('.sp-proto-pill')].map((p) => p.textContent.trim())
    expect(pills).toEqual(['2026-09-07 09:00', '2026-09-14 09:00'])
    // 原 Element Plus 预览块不再渲染
    expect(container.querySelector('.sp-preview')).toBeNull()
  })

  it('prototype 缺省（用户端 TaskEditor 口径）：仍走 el-radio-button / el-time-picker / .sp-preview（零回归）', async () => {
    mountSched({ previewSummary: '每周 09:00', previewTimes: ['2026-09-07T09:00:00+08:00'] })
    await flush()
    expect(container.querySelector('.sp-seg')).toBeNull()
    expect(container.querySelector('.sp-week-seg')).toBeNull()
    expect(container.querySelector('.sp-time-input')).toBeNull()
    expect(container.querySelector('.sp-proto-preview')).toBeNull()
    expect(container.querySelector('.sp-preview')).not.toBeNull()
  })
})
