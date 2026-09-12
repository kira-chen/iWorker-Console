// @vitest-environment jsdom
/**
 * 岗位详情「自动化任务」页签 —— 对齐 md 岗位 §7（2026-09-12 ed839c3：三模式调度 / 提示词 / 空闲时段提前准备）。
 * 历史出处：2026-09-09 原型复刻批次 4B（#16–#22），编号沿用便于回溯；
 * 2026-09-12 测试审计 T26 修头注（「#20 详细说明」已改名「提示词」、「执行星期按钮条」已删）、T53 补 Stage 组 5 条；
 * 2026-09-12 审计闭环批（J5 / K1-K9 / J6 占位 / J8③）：embedded / prototype 开关退役（两条零回归用例随删），
 *   补三模式多时间点 / 起止日期 / buildSchedule 字段 / preKick 两态 / 提示词上限与计数 / toast 与占位文案用例。
 *
 * 覆盖：
 * - #16 主从容器（md §7.1 双栏）：页签内联形态，右栏内容限宽居中容器在位；
 * - #17 列表项操作精简为「删除」（md §7.1 行内操作），不再有「编辑」按钮；启停移入右侧「基本信息」卡头（md §7.2）；
 * - Stage 组（md §7.1 L371-388 / §7.8）：缺指令红标 / 软上限 20 / 默认选中第一条（09-10 S2）/ 脏检查 confirm / 启停 toast / 删除确认与 toast；
 * - #18 分区卡头（.te-card-title）承担绿条 + 灰底头条，卡体独立 .te-card-body（md §7.1 末条）；
 * - #19 SchedulePicker 三模式：模式 Tab / 按周期预设 / 多时间点去重 / 每间隔起始时刻 / 单次 / 起止日期 / 绿底执行预览（md §7.3）；
 * - K4 buildSchedule：保存 payload.schedule 带 scheduleMode / periodicPreset / intervalCount / intervalUnit；
 * - K1 / K2 空闲时段提前准备：默认勾选 + 两态提示 + payload.preKick；
 * - #20 提示词卡：非必填、引导文案、「已输入 N / 8000 字」计数（md §7.4）；
 * - #21 引用工具卡：搜索框（占位「搜索工具名称或类型」）+ 平铺行（已验证 tag）+ 空态 + 卡底「+ 添加工具」（md §7.5）；
 * - #22 引用平台技能卡：已选 chips / 空态「暂无引用技能，点击下方添加」+ 搜索（占位「搜索平台技能名称或描述」）+ 卡底「+ 添加技能」（md §7.6）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import { listSampleTasks, setSampleTaskStatus } from '@/api/sampleTask'

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
  // 声明 emits 避免 onClick 透传到根 <button> 造成双触发；带 $event（列表行【删除】用 @click.stop）
  'el-button': { emits: ['click'], template: '<button @click="$emit(\'click\', $event)"><slot /></button>' },
  'el-icon': { template: '<i><slot /></i>' },
  // 透传 v-model 的勾选框（K1 / K2 需要读默认勾选态与切换）
  'el-checkbox': {
    props: ['modelValue'],
    emits: ['update:modelValue', 'change'],
    template:
      '<label class="stub-checkbox-wrap"><input type="checkbox" class="stub-checkbox" :checked="!!modelValue" @change="$emit(\'update:modelValue\', $event.target.checked); $emit(\'change\', $event.target.checked)" /><slot /></label>'
  },
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
  'el-date-picker': {
    props: ['modelValue', 'type', 'placeholder'],
    template: '<div class="stub-date" :data-type="type" :data-placeholder="placeholder" />'
  },
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

  it('#16 页签内联形态：不渲染浮层面包屑顶栏，两栏体在位（J5 embedded 开关已退役，不传开关亦然）', async () => {
    mountComp(PositionSampleTaskStage, { positionId: 1 })
    await flush()
    expect(container.querySelector('.st-editor')).not.toBeNull()
    expect(container.querySelector('.ed-crumb')).toBeNull()
    expect(container.querySelector('.st-body .st-col-list')).not.toBeNull()
  })

  it('#17 列表项操作只剩「删除」，落在名称行内；不再有「编辑」「停用」按钮', async () => {
    mountComp(PositionSampleTaskStage, { positionId: 1 })
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

/* ============================ Stage 组：md §7.1 左侧列表规则（2026-09-12 审计 T53） ============================ */
describe('自动化任务 · 左侧列表规则（md 岗位 §7.1 L371-388）', () => {
  let PositionSampleTaskStage
  beforeEach(async () => {
    PositionSampleTaskStage = (await import('@/components/position/PositionSampleTaskStage.vue')).default
  })
  const task = (id, over = {}) => ({
    id,
    name: `任务${id}`,
    prompt: `指令${id}`,
    status: 'ENABLED',
    scheduleSummary: '每天 09:00',
    schedule: { scheduleType: 'DAILY', times: ['09:00'] },
    sopDoc: 'sop',
    toolRefs: [],
    skillRefs: [],
    ...over
  })
  // 任务名称占位逐字照 md §7.2 L385（J6 无关部分）
  const nameInput = () => container.querySelector('.stub-el-input[placeholder="如：每日经营分析报告"]')

  it('缺「一句话指令」的条目 → 名称旁出红色「缺指令」标签；已填的不出（md §7.1 L371）', async () => {
    listSampleTasks.mockResolvedValueOnce({ list: [task(1, { prompt: '' }), task(2)] })
    mountComp(PositionSampleTaskStage, { positionId: 1 })
    await flush()
    const items = [...container.querySelectorAll('.st-item')]
    expect(items[0].querySelector('.st-flag')?.textContent.trim()).toBe('缺指令')
    expect(items[1].querySelector('.st-flag')).toBeNull()
  })

  it('已有 20 条 → 新增按钮置灰、文案「已达 20 条任务上限」，点击不进新建态（md §7.1 L374 软上限）', async () => {
    const { ElMessage } = await import('element-plus')
    listSampleTasks.mockResolvedValueOnce({ list: Array.from({ length: 20 }, (_, i) => task(i + 1)) })
    mountComp(PositionSampleTaskStage, { positionId: 1 })
    await flush()
    const btn = container.querySelector('.st-new')
    expect(btn.classList.contains('disabled')).toBe(true)
    expect(btn.textContent.trim()).toBe('已达 20 条任务上限')
    btn.click()
    await flush()
    expect(container.querySelector('.st-creating')).toBeNull()
    expect(ElMessage.warning).toHaveBeenCalledWith('自动化任务建议不超过 20 条，把最推荐的放前面')
  })

  it('19 条 → 新增按钮可点、文案「＋ 新增自动化任务」，点击后左栏出「新增中…」行（md §7.1 L373）', async () => {
    listSampleTasks.mockResolvedValueOnce({ list: Array.from({ length: 19 }, (_, i) => task(i + 1)) })
    mountComp(PositionSampleTaskStage, { positionId: 1 })
    await flush()
    const btn = container.querySelector('.st-new')
    expect(btn.classList.contains('disabled')).toBe(false)
    expect(btn.textContent.trim()).toBe('＋ 新增自动化任务')
    btn.click()
    await flush()
    expect(container.querySelector('.st-creating')?.textContent).toContain('新增中…')
  })

  it('列表非空 → 进入页签默认选中第一条，右侧直接是编辑器而非占位（md §7.1 L376；09-10 S2）', async () => {
    listSampleTasks.mockResolvedValueOnce({ list: [task(1), task(2)] })
    mountComp(PositionSampleTaskStage, { positionId: 1 })
    await flush()
    const items = [...container.querySelectorAll('.st-item')]
    expect(items[0].classList.contains('on')).toBe(true)
    expect(items[1].classList.contains('on')).toBe(false)
    expect(container.querySelector('.st-placeholder')).toBeNull()
    expect(nameInput()?.value).toBe('任务1')
  })

  it('列表为空 → 右侧占位「还没有自动化任务」（md §7.1 L375）', async () => {
    listSampleTasks.mockResolvedValueOnce({ list: [] })
    mountComp(PositionSampleTaskStage, { positionId: 1 })
    await flush()
    expect(container.querySelector('.st-placeholder .ph-title')?.textContent.trim()).toBe('还没有自动化任务')
  })

  it('编辑器有未保存修改时切换条目 → confirm「有未保存的修改，切换将丢弃。继续？」；取消则停留原条目（md §7.1 L380）', async () => {
    const { ElMessageBox } = await import('element-plus')
    listSampleTasks.mockResolvedValueOnce({ list: [task(1), task(2)] })
    mountComp(PositionSampleTaskStage, { positionId: 1 })
    await flush()
    // 改名 → 编辑器上报 dirty
    const input = nameInput()
    input.value = '任务1-改'
    input.dispatchEvent(new Event('input'))
    await flush()
    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    const items = [...container.querySelectorAll('.st-item')]
    items[1].click()
    await flush()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '有未保存的修改，切换将丢弃。继续？',
      '切换样例',
      expect.objectContaining({ confirmButtonText: '丢弃并切换', cancelButtonText: '继续编辑' })
    )
    expect(items[0].classList.contains('on')).toBe(true)
    expect(items[1].classList.contains('on')).toBe(false)
    // 确认丢弃 → 切到第二条
    items[1].click()
    await flush()
    expect(container.querySelector('.st-item.on .st-name-text').textContent.trim()).toBe('任务2')
  })

  it('无未保存修改时切换条目 → 不弹确认直接切换', async () => {
    const { ElMessageBox } = await import('element-plus')
    listSampleTasks.mockResolvedValueOnce({ list: [task(1), task(2)] })
    mountComp(PositionSampleTaskStage, { positionId: 1 })
    await flush()
    ;[...container.querySelectorAll('.st-item')][1].click()
    await flush()
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    expect(container.querySelector('.st-item.on .st-name-text').textContent.trim()).toBe('任务2')
  })

  it('K6 行内【删除】→ confirm「删除后该任务将不可恢复，确认删除？」；确认后 deleteSampleTask + toast「样例任务已删除」+ 右侧回空态（md §7.8）', async () => {
    const { ElMessage, ElMessageBox } = await import('element-plus')
    const { deleteSampleTask } = await import('@/api/sampleTask')
    listSampleTasks.mockResolvedValueOnce({ list: [task(1)] }).mockResolvedValueOnce({ list: [] })
    mountComp(PositionSampleTaskStage, { positionId: 1 })
    await flush()
    const del = [...container.querySelectorAll('.st-item .st-name button')].find((b) => b.textContent.trim() === '删除')
    del.click()
    await flush()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '删除后该任务将不可恢复，确认删除？',
      '删除自动化任务',
      expect.objectContaining({ confirmButtonText: '删除', cancelButtonText: '取消' })
    )
    expect(deleteSampleTask).toHaveBeenCalledWith(1, 1)
    expect(ElMessage.success).toHaveBeenCalledWith('样例任务已删除')
    expect(container.querySelector('.st-placeholder .ph-title')?.textContent.trim()).toBe('还没有自动化任务')
  })

  it('K6 删除确认取消 → 不调 deleteSampleTask、无 toast', async () => {
    const { ElMessage, ElMessageBox } = await import('element-plus')
    const { deleteSampleTask } = await import('@/api/sampleTask')
    listSampleTasks.mockResolvedValueOnce({ list: [task(1)] })
    mountComp(PositionSampleTaskStage, { positionId: 1 })
    await flush()
    ElMessageBox.confirm.mockRejectedValueOnce('cancel')
    ;[...container.querySelectorAll('.st-item .st-name button')].find((b) => b.textContent.trim() === '删除').click()
    await flush()
    expect(deleteSampleTask).not.toHaveBeenCalled()
    expect(ElMessage.success).not.toHaveBeenCalled()
  })

  it('「基本信息」卡头开关停用 → setSampleTaskStatus(DISABLED) + toast「任务已停用」；再点 → ENABLED + 「任务已启用」（md §7.1 L388 / §7.2）', async () => {
    const { ElMessage } = await import('element-plus')
    listSampleTasks.mockResolvedValueOnce({ list: [task(1)] })
    mountComp(PositionSampleTaskStage, { positionId: 1 })
    await flush()
    const sw = container.querySelector('.te-card-actions .stub-switch')
    sw.click()
    await flush()
    expect(setSampleTaskStatus).toHaveBeenCalledWith(1, 1, 'DISABLED')
    expect(ElMessage.success).toHaveBeenCalledWith('任务已停用')
    expect(container.querySelector('.te-card-action-label').textContent.trim()).toBe('已停用')
    sw.click()
    await flush()
    expect(setSampleTaskStatus).toHaveBeenLastCalledWith(1, 1, 'ENABLED')
    expect(ElMessage.success).toHaveBeenLastCalledWith('任务已启用')
  })
})

/* ============================ #18 / #20 / #21 / #22 分区卡 ============================ */
describe('自动化任务 · 详情分区卡（4B #18 / #20 / #21 / #22）', () => {
  let SampleTaskEditor
  beforeEach(async () => {
    SampleTaskEditor = (await import('@/components/position/SampleTaskEditor.vue')).default
  })

  it('#18 五个分区卡头 + 独立卡体；卡头文案逐字对齐 md §7.1「分 N 个配置区：基本信息 / 调度计划 / 提示词 / 引用工具 / 引用平台技能」', async () => {
    mountComp(SampleTaskEditor, { positionId: 1, sample: SAMPLE })
    await flush()
    const heads = [...container.querySelectorAll('.te-card-title')].map((n) => n.textContent.trim())
    expect(heads[0]).toContain('基本信息')
    expect(heads[1]).toContain('调度计划')
    expect(heads[2]).toContain('提示词')
    expect(heads[3]).toContain('引用工具')
    expect(heads[4]).toContain('引用平台技能')
    expect(container.querySelectorAll('.te-card-body').length).toBe(5)
  })

  it('#16 右栏内容有限宽居中容器 .ste-inner（J5：embedded 开关退役后即基础形态）', async () => {
    mountComp(SampleTaskEditor, { positionId: 1, sample: SAMPLE })
    await flush()
    expect(container.querySelector('.ste-inner')).not.toBeNull()
  })

  it('md §7.2 启停：编辑态在「基本信息」卡头出开关，点击上抛 toggle-status', async () => {
    const onToggle = vi.fn()
    mountComp(SampleTaskEditor, {
      positionId: 1,
      sample: SAMPLE,
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
    mountComp(SampleTaskEditor, { positionId: 1, sample: null })
    await flush()
    expect(container.querySelector('.te-card-actions')).toBeNull()
  })

  it('#20 提示词卡（md §7.4 L407/L409）：卡头无必填星号、引导文案逐字、脚部计数「已输入 N / 8000 字」（N = 原文字符数；K7）', async () => {
    mountComp(SampleTaskEditor, { positionId: 1, sample: SAMPLE })
    await flush()
    const head = [...container.querySelectorAll('.te-card-title')][2]
    expect(head.textContent.trim()).toBe('提示词')
    expect(head.querySelector('.req')).toBeNull()
    const guide = [...container.querySelectorAll('.te-card-guide')][0]
    expect(guide.textContent.trim()).toBe('使用自然语言描述任务目标、产出格式和推送方式。定时触发时，Agent 读取该内容作为任务指令执行业务。')
    const counter = container.querySelector('.te-editor-counter')
    expect(counter.textContent.trim()).toBe(`已输入 ${SAMPLE.sopDoc.length} / 8000 字`)
  })

  it('K7 提示词 8001 字 → 阻断保存、不落 update，计数标红；8000 字放行（md §7.4 L405）', async () => {
    const { updateSampleTask } = await import('@/api/sampleTask')
    const { ElMessage } = await import('element-plus')
    mountComp(SampleTaskEditor, { positionId: 1, sample: { ...SAMPLE, sopDoc: 'x'.repeat(8001) } })
    await flush()
    expect(container.querySelector('.te-editor-counter').classList.contains('is-over')).toBe(true)
    ;[...container.querySelectorAll('.meta-actions button')].pop().click()
    await flush()
    expect(updateSampleTask).not.toHaveBeenCalled()
    expect(ElMessage.warning).toHaveBeenCalledWith('请检查表单中标红的项')
    app.unmount()
    container.remove()
    mountComp(SampleTaskEditor, { positionId: 1, sample: { ...SAMPLE, sopDoc: 'x'.repeat(8000) } })
    await flush()
    ;[...container.querySelectorAll('.meta-actions button')].pop().click()
    await flush()
    expect(updateSampleTask).toHaveBeenCalled()
    expect(updateSampleTask.mock.calls[0][2].sopDoc).toHaveLength(8000)
  })

  it('J7 提示词留空 → 仍可保存（md §7.7 必填只有任务名称 + 一句话指令），payload.sopDoc 为空串', async () => {
    const { updateSampleTask } = await import('@/api/sampleTask')
    mountComp(SampleTaskEditor, { positionId: 1, sample: { ...SAMPLE, sopDoc: '' } })
    await flush()
    ;[...container.querySelectorAll('.meta-actions button')].pop().click()
    await flush()
    expect(updateSampleTask).toHaveBeenCalled()
    expect(updateSampleTask.mock.calls[0][2].sopDoc).toBe('')
    expect(container.textContent).not.toContain('请填写详细说明')
  })

  it('K6 编辑态保存 → toast「样例任务已保存」；新建态创建 → toast「样例任务已创建」（md §7.7 L431-432）', async () => {
    const { ElMessage } = await import('element-plus')
    mountComp(SampleTaskEditor, { positionId: 1, sample: SAMPLE })
    await flush()
    ;[...container.querySelectorAll('.meta-actions button')].pop().click()
    await flush()
    expect(ElMessage.success).toHaveBeenCalledWith('样例任务已保存')
    app.unmount()
    container.remove()
    mountComp(SampleTaskEditor, { positionId: 1, sample: null })
    await flush()
    const name = container.querySelector('.stub-el-input[placeholder="如：每日经营分析报告"]')
    name.value = '新任务'
    name.dispatchEvent(new Event('input'))
    const prompt = container.querySelector('.stub-el-input[placeholder="描述任务目标，如：分析昨日核心指标并生成周报"]')
    prompt.value = '做点事'
    prompt.dispatchEvent(new Event('input'))
    await flush()
    ;[...container.querySelectorAll('.meta-actions button')].pop().click()
    await flush()
    expect(ElMessage.success).toHaveBeenLastCalledWith('样例任务已创建')
  })

  it('J6 基本信息三处占位逐字照 md §7.2 L385-387（maxlength 60 / 200 待裁 J6 不动）', async () => {
    mountComp(SampleTaskEditor, { positionId: 1, sample: null })
    await flush()
    const phs = [...container.querySelectorAll('.te-card-body .stub-el-input')].slice(0, 3).map((i) => i.placeholder)
    expect(phs).toEqual(['如：每日经营分析报告', '描述任务目标，如：分析昨日核心指标并生成周报', '补充任务背景或注意事项'])
  })

  /* ---- K1 / K2：空闲时段提前准备（md §7.3 L398-400） ---- */
  const preKickBox = () => container.querySelector('.te-pre-kick .stub-checkbox')
  const preKickHint = () => container.querySelector('.te-pre-kick-hint').textContent.trim()

  it('K1 新建态「空闲时段提前准备」默认勾选 + 勾选态提示逐字（md §7.3 L398-399）', async () => {
    mountComp(SampleTaskEditor, { positionId: 1, sample: null })
    await flush()
    expect(preKickBox().checked).toBe(true)
    expect(preKickHint()).toBe('送达前系统会在空闲时段先把结果做好，到点直接给你，不占用你工作时的资源。')
  })

  it('K1 回填无 preKick 字段的存量样例 → 仍默认勾选；回填 preKick=false → 不勾选', async () => {
    mountComp(SampleTaskEditor, { positionId: 1, sample: SAMPLE })
    await flush()
    expect(preKickBox().checked).toBe(true)
    app.unmount()
    container.remove()
    mountComp(SampleTaskEditor, { positionId: 1, sample: { ...SAMPLE, preKick: false } })
    await flush()
    expect(preKickBox().checked).toBe(false)
  })

  it('K2 取消勾选 → 关闭态提示「到点才开始执行，结果会晚几分钟。」且保存 payload.preKick=false（md §7.3 L400）', async () => {
    const { updateSampleTask } = await import('@/api/sampleTask')
    mountComp(SampleTaskEditor, { positionId: 1, sample: SAMPLE })
    await flush()
    const box = preKickBox()
    box.checked = false
    box.dispatchEvent(new Event('change'))
    await flush()
    expect(preKickHint()).toBe('到点才开始执行，结果会晚几分钟。')
    expect(container.querySelector('.te-pre-kick').textContent).not.toContain('送达前系统会在空闲时段')
    ;[...container.querySelectorAll('.meta-actions button')].pop().click()
    await flush()
    expect(updateSampleTask.mock.calls[0][2].preKick).toBe(false)
  })

  it('#21 引用工具卡：搜索框 + 平铺行（已验证 tag）+ 卡底「+ 添加工具」，搜索可过滤', async () => {
    mountComp(SampleTaskEditor, { positionId: 1, sample: SAMPLE })
    await flush()
    // 搜索框占位逐字照 md §7.5 L413（K8）
    const search = container.querySelector('.stub-el-input[placeholder="搜索工具名称或类型"]')
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

  it('K8 无已添加工具 → 空态「暂无引用工具，点击下方添加」（md §7.5 L416）', async () => {
    mountComp(SampleTaskEditor, { positionId: 1, sample: { ...SAMPLE, toolRefs: [] } })
    await flush()
    expect(container.querySelector('.tl-empty').textContent.trim()).toBe('暂无引用工具，点击下方添加')
  })

  it('K8 无已选技能 → 空态「暂无引用技能，点击下方添加」，无 chips；有已选时不出空态（md §7.6 L425）', async () => {
    mountComp(SampleTaskEditor, { positionId: 1, sample: { ...SAMPLE, skillRefs: [] } })
    await flush()
    expect(container.querySelector('.sk-none').textContent.trim()).toBe('暂无引用技能，点击下方添加')
    expect(container.querySelector('.sk-chips')).toBeNull()
    app.unmount()
    container.remove()
    mountComp(SampleTaskEditor, { positionId: 1, sample: SAMPLE })
    await flush()
    expect(container.querySelector('.sk-none')).toBeNull()
  })

  it('#21 点「+ 添加工具」开弹窗，弹窗内复用 ToolPicker', async () => {
    mountComp(SampleTaskEditor, { positionId: 1, sample: SAMPLE })
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
    mountComp(SampleTaskEditor, { positionId: 1, sample: SAMPLE })
    await flush()
    // 已选 chip
    const chip = container.querySelector('.sk-chip .sk-chip-name')
    expect(chip.textContent.trim()).toBe('经营分析技能')
    // 搜索框占位逐字照 md §7.6 L422（K8）
    expect(container.querySelector('.stub-el-input[placeholder="搜索平台技能名称或描述"]')).not.toBeNull()
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
describe('自动化任务 · 调度计划三模式（4B #19 / md §7.3）', () => {
  let SchedulePicker
  beforeEach(async () => {
    SchedulePicker = (await import('@/components/task/SchedulePicker.vue')).default
  })

  function mountSched(extra = {}) {
    const schedule = ref({
      scheduleMode: 'PERIODIC',
      periodicPreset: 'DAILY',
      intervalCount: 1,
      intervalUnit: 'DAY',
      scheduleType: 'DAILY',
      daysOfWeek: [],
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

  it('顶层三个模式 Tab（按周期/每间隔/单次），当前项高亮', async () => {
    const schedule = mountSched({ previewSummary: '每天 09:00', previewTimes: [] })
    await flush()
    // 只选第一行的模式 Tab，不包括预设按钮
    const modeRow = container.querySelector('.sp-row:first-child .sp-seg')
    const modes = [...modeRow.querySelectorAll('.sp-seg-btn')].map((b) => b.textContent.trim())
    expect(modes).toEqual(['按周期', '每间隔', '单次'])
    expect(modeRow.querySelector('.sp-seg-btn.on').textContent.trim()).toBe('按周期')
  })

  it('按周期模式：5个预设快捷按钮，点击切换', async () => {
    const schedule = mountSched()
    await flush()
    const presets = [...container.querySelectorAll('.sp-seg-preset .sp-seg-btn')].map((b) => b.textContent.trim())
    expect(presets).toEqual(['每天', '每周一', '每周一三五', '每周五', '每月1日'])
    expect(container.querySelector('.sp-seg-preset .sp-seg-btn.on').textContent.trim()).toBe('每天')
    // 点击「每周一」
    container.querySelectorAll('.sp-seg-preset .sp-seg-btn')[1].click()
    await flush()
    expect(schedule.value.scheduleType).toBe('WEEKLY')
    expect(schedule.value.daysOfWeek).toEqual([1])
    expect(schedule.value.periodicPreset).toBe('WEEKLY_MON')
  })

  it('按周期模式：定点时间行为「⏰ time input」，改值回写 times', async () => {
    const schedule = mountSched()
    await flush()
    const input = container.querySelector('.sp-time-input input')
    expect(input.type).toBe('time')
    expect(input.value).toBe('09:00')
    input.value = '18:30'
    input.dispatchEvent(new Event('input'))
    await flush()
    expect(schedule.value.times).toEqual(['18:30'])
  })

  it('每间隔模式：数字输入 + 单位按钮组', async () => {
    const schedule = mountSched()
    await flush()
    // 切换到「每间隔」
    container.querySelectorAll('.sp-seg .sp-seg-btn')[1].click()
    await flush()
    expect(schedule.value.scheduleMode).toBe('INTERVAL')
    // 数字输入框
    const numInput = container.querySelector('.sp-interval-input')
    expect(numInput).not.toBeNull()
    expect(numInput.value).toBe('1')
    // 单位按钮组
    const units = [...container.querySelectorAll('.sp-interval-row .sp-seg .sp-seg-btn')].map((b) => b.textContent.trim())
    expect(units).toEqual(['小时', '天', '周'])
    expect(container.querySelector('.sp-interval-row .sp-seg .sp-seg-btn.on').textContent.trim()).toBe('天')
  })

  it('单次模式：显示日期选择器', async () => {
    const schedule = mountSched()
    await flush()
    // 切换到「单次」
    container.querySelectorAll('.sp-seg .sp-seg-btn')[2].click()
    await flush()
    expect(schedule.value.scheduleMode).toBe('ONCE')
    expect(schedule.value.scheduleType).toBe('ONCE')
  })

  it('执行预览走绿底框 + 白底药丸，药丸去掉 T 与时区后缀', async () => {
    mountSched({
      previewSummary: '每天 09:00',
      previewTimes: ['2026-09-07T09:00:00+08:00', '2026-09-14T09:00:00+08:00']
    })
    await flush()
    const box = container.querySelector('.sp-proto-preview')
    expect(box).not.toBeNull()
    expect(box.querySelector('.sp-proto-sched').textContent.trim()).toContain('每天 09:00')
    expect(box.querySelector('.sp-proto-next-label').textContent.trim()).toBe('接下来 2 次：')
    const pills = [...box.querySelectorAll('.sp-proto-pill')].map((p) => p.textContent.trim())
    expect(pills).toEqual(['2026-09-07 09:00', '2026-09-14 09:00'])
    // 旧 Element Plus 预览块（prototype=false 分支）已随 J5 退役
    expect(container.querySelector('.sp-preview')).toBeNull()
  })

  /* ---- 2026-09-12 审计 K3：md §7.3 L396-397 多时间点 / 每间隔起始时刻 / 起止日期 ---- */
  it('K3 按周期：【＋ 添加时间】加第二个时间点；第二个改成与第一个相同 → 同一天自动去重只剩一个（md §7.3 L396）', async () => {
    const schedule = mountSched()
    await flush()
    const addBtn = container.querySelector('.sp-add-time-link')
    expect(addBtn?.textContent.trim()).toBe('＋ 添加时间')
    addBtn.click()
    await flush()
    let inputs = [...container.querySelectorAll('.sp-time-input input')]
    expect(inputs).toHaveLength(2)
    expect(schedule.value.times).toHaveLength(2)
    // 第二个改成 18:30 → 两个时间点
    inputs[1].value = '18:30'
    inputs[1].dispatchEvent(new Event('input'))
    await flush()
    expect(schedule.value.times).toEqual(['09:00', '18:30'])
    // 再把第二个改回 09:00（与第一个相同）→ 去重只剩一个
    inputs = [...container.querySelectorAll('.sp-time-input input')]
    inputs[1].value = '09:00'
    inputs[1].dispatchEvent(new Event('input'))
    await flush()
    expect(schedule.value.times).toEqual(['09:00'])
    expect(container.querySelectorAll('.sp-time-input input')).toHaveLength(1)
  })

  it('K3 按周期：两个时间点时每行带 × 移除，点第二行 × → times 只剩第一个；单行不出 ×', async () => {
    const schedule = mountSched()
    await flush()
    expect(container.querySelector('.sp-time-remove')).toBeNull()
    container.querySelector('.sp-add-time-link').click()
    await flush()
    const inputs = [...container.querySelectorAll('.sp-time-input input')]
    inputs[1].value = '18:30'
    inputs[1].dispatchEvent(new Event('input'))
    await flush()
    const removes = [...container.querySelectorAll('.sp-time-remove')]
    expect(removes).toHaveLength(2)
    removes[1].click()
    await flush()
    expect(schedule.value.times).toEqual(['09:00'])
  })

  it('K3 每间隔模式：出「定点时间」起始时刻输入（单个 time input，改值回写 times[0]），无【＋ 添加时间】（md §7.3 L396）', async () => {
    const schedule = mountSched()
    await flush()
    container.querySelectorAll('.sp-row:first-child .sp-seg .sp-seg-btn')[1].click()
    await flush()
    expect(schedule.value.scheduleMode).toBe('INTERVAL')
    const labels = [...container.querySelectorAll('.sp-label')].map((n) => n.textContent.trim())
    expect(labels).toContain('定点时间')
    const inputs = [...container.querySelectorAll('.sp-time-input input')]
    expect(inputs).toHaveLength(1)
    expect(container.querySelector('.sp-add-time-link')).toBeNull()
    inputs[0].value = '07:30'
    inputs[0].dispatchEvent(new Event('input'))
    await flush()
    expect(schedule.value.times).toEqual(['07:30'])
  })

  it('K3 起止日期：按周期 / 每间隔出「从哪天开始」+「到哪天结束」两个日期框；单次仅出起始（md §7.3 L397）', async () => {
    mountSched()
    await flush()
    const labelsOf = () => [...container.querySelectorAll('.sp-label')].map((n) => n.textContent.trim())
    expect(labelsOf()).toContain('起止日期')
    let pickers = [...container.querySelectorAll('.sp-range .stub-date')]
    expect(pickers.map((p) => p.dataset.placeholder)).toEqual(['从哪天开始（不填 = 立即生效）', '到哪天结束（不填 = 一直有效）'])
    // 每间隔同样两个
    container.querySelectorAll('.sp-row:first-child .sp-seg .sp-seg-btn')[1].click()
    await flush()
    expect(container.querySelectorAll('.sp-range .stub-date')).toHaveLength(2)
    // 单次仅起始
    container.querySelectorAll('.sp-row:first-child .sp-seg .sp-seg-btn')[2].click()
    await flush()
    pickers = [...container.querySelectorAll('.sp-range .stub-date')]
    expect(pickers.map((p) => p.dataset.placeholder)).toEqual(['从哪天开始（不填 = 立即生效）'])
  })

  it('J5 退役 prototype 开关：不传任何开关也只渲染三模式（无 el-radio-button 周期类型 / 无旧 .sp-preview）', async () => {
    mountSched({ previewSummary: '每天 09:00', previewTimes: ['2026-09-07T09:00:00+08:00'] })
    await flush()
    expect(container.querySelector('.sp-seg-preset')).not.toBeNull()
    expect(container.querySelector('.sp-proto-preview')).not.toBeNull()
    expect(container.querySelector('.sp-preview')).toBeNull()
    expect(container.textContent).not.toContain('周期类型')
  })
})

/* ============================ K4：buildSchedule 带三模式字段（2026-09-12 审计） ============================ */
describe('自动化任务 · 保存 payload.schedule 带三模式字段（md §7.3；审计 K4）', () => {
  let SampleTaskEditor
  beforeEach(async () => {
    SampleTaskEditor = (await import('@/components/position/SampleTaskEditor.vue')).default
  })
  const modeBtns = () => [...container.querySelectorAll('.sp-row:first-child .sp-seg .sp-seg-btn')]
  const saveBtn = () => [...container.querySelectorAll('.meta-actions button')].pop()

  it('编辑态切「每间隔 · 每 3 小时」保存 → payload.schedule = { scheduleMode INTERVAL, intervalCount 3, intervalUnit HOUR, scheduleType INTERVAL_HOUR, times [起始时刻] }', async () => {
    const { updateSampleTask } = await import('@/api/sampleTask')
    mountComp(SampleTaskEditor, { positionId: 1, sample: SAMPLE })
    await flush()
    modeBtns()[1].click()
    await flush()
    const num = container.querySelector('.sp-interval-input')
    num.value = '3'
    num.dispatchEvent(new Event('input'))
    await flush()
    const units = [...container.querySelectorAll('.sp-interval-row .sp-seg .sp-seg-btn')]
    units[0].click() // 小时
    await flush()
    saveBtn().click()
    await flush()
    expect(updateSampleTask).toHaveBeenCalled()
    const payload = updateSampleTask.mock.calls[0][2]
    expect(payload.schedule).toMatchObject({
      scheduleMode: 'INTERVAL',
      intervalCount: 3,
      intervalUnit: 'HOUR',
      scheduleType: 'INTERVAL_HOUR',
      times: ['09:00']
    })
    expect(payload.schedule.periodicPreset).toBeUndefined()
  })

  it('新建态按周期选「每周一」+ 两个时间点保存 → payload.schedule 带 scheduleMode PERIODIC / periodicPreset WEEKLY_MON / daysOfWeek [1] / times 去重', async () => {
    const { createSampleTask } = await import('@/api/sampleTask')
    mountComp(SampleTaskEditor, { positionId: 1, sample: null })
    await flush()
    const name = container.querySelector('.stub-el-input[placeholder="如：每日经营分析报告"]')
    name.value = '每周经营周报'
    name.dispatchEvent(new Event('input'))
    const prompt = container.querySelector('.stub-el-input[placeholder="描述任务目标，如：分析昨日核心指标并生成周报"]')
    prompt.value = '汇总上周经营数据'
    prompt.dispatchEvent(new Event('input'))
    container.querySelectorAll('.sp-seg-preset .sp-seg-btn')[1].click()
    await flush()
    container.querySelector('.sp-add-time-link').click()
    await flush()
    const inputs = [...container.querySelectorAll('.sp-time-input input')]
    inputs[1].value = '18:00'
    inputs[1].dispatchEvent(new Event('input'))
    await flush()
    saveBtn().click()
    await flush()
    expect(createSampleTask).toHaveBeenCalled()
    const payload = createSampleTask.mock.calls[0][1]
    expect(payload.schedule).toMatchObject({
      scheduleMode: 'PERIODIC',
      periodicPreset: 'WEEKLY_MON',
      scheduleType: 'WEEKLY',
      daysOfWeek: [1],
      times: ['09:00', '18:00']
    })
    expect(payload.schedule.intervalCount).toBeUndefined()
  })

  it('回填 INTERVAL 样例（每 2 天）→ 编辑器落在「每间隔」模式、数字 2、单位「天」高亮（K4 读回三字段）', async () => {
    mountComp(SampleTaskEditor, {
      positionId: 1,
      sample: {
        ...SAMPLE,
        schedule: { scheduleMode: 'INTERVAL', intervalCount: 2, intervalUnit: 'DAY', scheduleType: 'INTERVAL_DAY', times: ['08:00'] }
      }
    })
    await flush()
    expect(container.querySelector('.sp-row:first-child .sp-seg .sp-seg-btn.on').textContent.trim()).toBe('每间隔')
    expect(container.querySelector('.sp-interval-input').value).toBe('2')
    expect(container.querySelector('.sp-interval-row .sp-seg .sp-seg-btn.on').textContent.trim()).toBe('天')
    expect(container.querySelector('.sp-time-input input').value).toBe('08:00')
  })
})
