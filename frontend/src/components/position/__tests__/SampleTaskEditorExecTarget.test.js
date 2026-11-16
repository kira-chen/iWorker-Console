// @vitest-environment jsdom
/**
 * SampleTaskEditor「执行动作」选专家 / 专家团 + 脏检查（产品优化需求-202611 修改点 3，2026-11-12 原型走查补齐）。
 *
 * 口径（docs/PRD/数字员工管理端PRD/产品优化需求-202611.md §3「校验与失效」）：
 * - 选了「专家」或「专家团」却没选具体对象，与「缺指令」同样处理：保存时拦截，提示「请选择要执行的专家」/「请选择要执行的专家团」；
 * - 执行对象被停用、回收、缺员或删除后，下拉框里仍显示该对象的名称并标「（不可用）」，下方红字提示重新选择；
 * - 脏检查：切换任务时「有未保存的修改」只在真改过时出现——md-editor-v3 回填后会把同一段提示词原样回抛一次
 *   update:modelValue，不能因此算作修改（下方 MarkdownEditor 桩模拟了这个回抛）。
 *
 * - R13-6（2026-11-16 确认，md §7.6）：没设主理人的专家团同样可选、不置灰，下拉项展示主理人（没设的展示「无主理人」）；
 *   选中后提示按有无主理人分两种；
 * - R13-7（2026-11-16 确认，md §7.6 / §7.8）：执行方式为专家 / 专家团时「引用技能」区隐藏，切换前已选了技能时提示
 *   「切换后已选的引用技能将在保存时清空」，保存时 payload.skillRefs 为空。
 *
 * el-select / el-option 用透明桩：选项渲染成 .stub-opt（data-value / data-disabled + .stub-opt-label 文本 + 默认插槽），
 * 断言下拉里有什么；el-radio-group 桩点 .stub-radio 时回抛 update:modelValue / change，模拟切换执行方式。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, watch } from 'vue'
import { createSampleTask, updateSampleTask } from '@/api/sampleTask'
import { listTaskExecTargetCandidates } from '@/api/position'
import { ElMessage } from 'element-plus'

async function flush(n = 8) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

vi.mock('@/api/sampleTask', () => ({
  createSampleTask: vi.fn(() => Promise.resolve({ id: 't1' })),
  updateSampleTask: vi.fn(() => Promise.resolve({ id: 't1' })),
  previewSampleSchedule: vi.fn(() => Promise.resolve({ summary: '每天 09:00', nextRunTimes: [] }))
}))
// 执行对象候选：专家 205 / 团 304（设了主理人）/ 团 302（没设主理人）可选；团 303（未发布）不在候选里，名称表里能查到
const CANDIDATES = {
  experts: [{ expertId: 205, name: '经营数据核查专家', typeLabel: '岗位私有' }],
  teams: [
    { teamId: 304, name: '经营复盘团', typeLabel: '岗位私有', leaderId: 205, leaderName: '经营数据核查专家' },
    { teamId: 302, name: '知识问答团', typeLabel: '通用专家团', leaderId: null, leaderName: '' }
  ],
  names: { EXPERT: { 205: '经营数据核查专家' }, TEAM: { 302: '知识问答团', 303: '岗位协同团', 304: '经营复盘团' } }
}
vi.mock('@/api/position', () => ({
  listToolPicker: vi.fn(() => Promise.resolve([])),
  listTaskSkillCandidates: vi.fn(() => Promise.resolve([])),
  listTaskExecTargetCandidates: vi.fn(() => Promise.resolve(CANDIDATES))
}))
vi.mock('@/api/request', () => ({ ApiError: class ApiError extends Error {} }))
vi.mock('@/stores/position', () => ({ usePositionStore: () => ({ positionId: 401 }) }))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  ElMessageBox: { confirm: vi.fn(() => Promise.resolve()) }
}))
// 模拟 md-editor-v3：父组件程序赋值后，把同一段文本原样回抛一次 update:modelValue（真实组件的行为，脏检查误报的根因）
let sopEmit = null
vi.mock('@/components/admin/MarkdownEditor.vue', () => ({
  default: {
    name: 'MarkdownEditor',
    props: ['modelValue', 'error'],
    emits: ['update:modelValue'],
    setup(p, { emit }) {
      sopEmit = (v) => emit('update:modelValue', v)
      watch(() => p.modelValue, (v) => Promise.resolve().then(() => emit('update:modelValue', v)))
      return () => h('div', { class: 'stub-md' }, p.modelValue ?? '')
    }
  }
}))
vi.mock('@/components/admin/ToolPicker.vue', () => ({ default: { name: 'ToolPicker', setup: () => () => h('div') } }))
vi.mock('@/components/task/SchedulePicker.vue', () => ({ default: { name: 'SchedulePicker', setup: () => () => h('div') } }))
vi.mock('@/components/StatusTag.vue', () => ({
  default: { name: 'StatusTag', setup: (_, { slots }) => () => h('span', slots.default?.()) }
}))

const stubs = {
  'el-input': {
    props: { modelValue: { default: '' }, placeholder: { default: '' } },
    emits: ['update:modelValue', 'input'],
    template: '<input class="stub-el-input" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value); $emit(\'input\')" />'
  },
  'el-button': { emits: ['click'], template: '<button @click="$emit(\'click\', $event)"><slot /></button>' },
  'el-icon': { template: '<i><slot /></i>' },
  'el-checkbox': { template: '<span />' },
  'el-radio-group': {
    props: ['modelValue'],
    emits: ['update:modelValue', 'change'],
    methods: {
      pick(e) {
        const v = e.target.closest('.stub-radio')?.dataset.value
        if (v) { this.$emit('update:modelValue', v); this.$emit('change', v) }
      }
    },
    template: '<div class="stub-radio-group" :data-value="modelValue" @click="pick"><slot /></div>'
  },
  'el-radio': { props: ['value'], template: '<label class="stub-radio" :data-value="value"><slot /></label>' },
  'el-tooltip': { template: '<span><slot /></span>' },
  'el-switch': { template: '<span />' },
  'el-select': {
    props: ['modelValue', 'placeholder'],
    emits: ['update:modelValue', 'change'],
    template: '<div class="stub-select" :data-value="String(modelValue)" :data-placeholder="placeholder"><slot /></div>'
  },
  'el-option': {
    // disabled 声明成 Boolean（同 Element Plus）：模板里裸写的 disabled 才会被当成 true
    props: { label: null, value: null, disabled: Boolean },
    template: '<div class="stub-opt" :data-value="String(value)" :data-disabled="String(!!disabled)"><span class="stub-opt-label">{{ label }}</span><slot /></div>'
  },
  'el-dialog': { template: '<div />' }
}

let app, container
function mount(props) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(Editor, props) })
  for (const [n, c] of Object.entries(stubs)) app.component(n, c)
  app.directive('loading', {})
  app.mount(container)
}
beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  app?.unmount()
  container?.remove()
})
const Editor = (await import('@/components/position/SampleTaskEditor.vue')).default

const sample = (over = {}) => ({
  id: 7002,
  name: '周度经营复盘提醒',
  prompt: '整理上周经营数据形成复盘要点',
  status: 'ENABLED',
  schedule: { scheduleType: 'DAILY', times: ['09:00'] },
  sopDoc: '1. 汇总上周核心指标\n2. 输出待跟进事项',
  toolRefs: [{ type: 'MCP', code: 'mcp__zhishiku', bizName: '知识库 MCP' }],
  skillRefs: [],
  execType: 'TEAM',
  execTargetId: 304,
  ...over
})
const save = async () => {
  container.querySelector('.meta-actions button').click()
  await flush()
}
const optionsOf = (testid) =>
  [...container.querySelectorAll(`[data-testid="${testid}"] .stub-opt`)].map((o) => ({
    value: o.dataset.value,
    label: o.querySelector('.stub-opt-label').textContent.trim(),
    disabled: o.dataset.disabled === 'true'
  }))

describe('缺执行对象：保存时拦截（修改点 3，与「缺指令」同样处理）', () => {
  it('存量任务「专家团」没选对象 → 保存被拦：不落 update，下拉下方「请选择要执行的专家团」，toast「请检查表单中标红的项」', async () => {
    mount({ positionId: 401, sample: sample({ execTargetId: null }) })
    await flush()
    await save()
    expect(updateSampleTask).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="exec-team"] .te-err')?.textContent.trim()).toBe('请选择要执行的专家团')
    expect(ElMessage.warning).toHaveBeenCalledWith('请检查表单中标红的项')
  })

  it('「专家」没选对象 → 保存被拦，提示「请选择要执行的专家」；选了对象放行，payload 带 execTargetId', async () => {
    mount({ positionId: 401, sample: sample({ execType: 'EXPERT', execTargetId: null }) })
    await flush()
    await save()
    expect(updateSampleTask).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="exec-expert"] .te-err')?.textContent.trim()).toBe('请选择要执行的专家')

    app.unmount()
    container.remove()
    mount({ positionId: 401, sample: sample({ execType: 'EXPERT', execTargetId: 205 }) })
    await flush()
    await save()
    expect(container.querySelector('[data-testid="exec-expert"] .te-err')).toBeNull()
    expect(updateSampleTask.mock.calls[0][2]).toMatchObject({ execType: 'EXPERT', execTargetId: 205 })
  })
})

describe('所选执行对象已不可用：下拉显示「名称（不可用）」而不是裸 id（修改点 3）', () => {
  it('团 303 已不在候选里 → 下拉补一个置灰项「岗位协同团（不可用）」，红字提示仍在', async () => {
    mount({ positionId: 401, sample: sample({ execTargetId: 303 }) })
    await flush()
    expect(listTaskExecTargetCandidates).toHaveBeenCalledWith(401)
    expect(optionsOf('exec-team')).toContainEqual({ value: '303', label: '岗位协同团（不可用）', disabled: true })
    expect(optionsOf('exec-team').map((o) => o.label)).not.toContain('303')
    expect(container.querySelector('[data-testid="exec-target-lost"]')?.textContent).toContain('所选对象已停用、被回收、缺员或已从本岗位移除')
  })

  it('对象已被删除（名称表里也查不到）→「已删除的专家团（不可用）」；所选对象可用时不补置灰项', async () => {
    mount({ positionId: 401, sample: sample({ execTargetId: 999 }) })
    await flush()
    expect(optionsOf('exec-team')).toContainEqual({ value: '999', label: '已删除的专家团（不可用）', disabled: true })

    app.unmount()
    container.remove()
    mount({ positionId: 401, sample: sample({ execTargetId: 304 }) })
    await flush()
    expect(optionsOf('exec-team')).toEqual([
      { value: '304', label: '经营复盘团', disabled: false },
      { value: '302', label: '知识问答团', disabled: false }
    ])
    expect(container.querySelector('[data-testid="exec-target-lost"]')).toBeNull()
  })
})

const teamOptText = (value) =>
  container.querySelector(`[data-testid="exec-team"] .stub-opt[data-value="${value}"] small`)?.textContent.trim()
const hintText = () => container.querySelector('[data-testid="exec-team-hint"]')?.textContent.trim()

describe('没设主理人的专家团可作执行对象（R13-6，md §7.6）', () => {
  it('下拉里没设主理人的团可选、不置灰、不标「（不可用）」；下拉项展示主理人，没设的展示「无主理人」', async () => {
    mount({ positionId: 401, sample: sample() })
    await flush()
    expect(optionsOf('exec-team')).toContainEqual({ value: '302', label: '知识问答团', disabled: false })
    expect(teamOptText(304)).toBe('岗位私有 · 主理人：经营数据核查专家')
    expect(teamOptText(302)).toBe('通用专家团 · 无主理人')
  })

  it('选了设了主理人的团 → 提示「由主理人拆解分派」', async () => {
    mount({ positionId: 401, sample: sample({ execTargetId: 304 }) })
    await flush()
    expect(hintText()).toBe('任务整个交给该专家团，由主理人拆解分派。')
  })

  it('选了没设主理人的团 → 提示「由系统按团队协作关系拆解后直接执行」，不出失效红字，保存放行', async () => {
    mount({ positionId: 401, sample: sample({ execTargetId: 302 }) })
    await flush()
    expect(hintText()).toBe('任务整个交给该专家团，由系统按团队协作关系拆解后直接执行。')
    expect(container.querySelector('[data-testid="exec-target-lost"]')).toBeNull()
    await save()
    expect(updateSampleTask.mock.calls[0][2]).toMatchObject({ execType: 'TEAM', execTargetId: 302 })
  })
})

const skillCard = () => container.querySelector('[data-testid="skill-refs-card"]')
const clearWarn = () => container.querySelector('[data-testid="skill-refs-will-clear"]')
const pickExecType = async (v) => {
  container.querySelector(`.stub-radio[data-value="${v}"]`).click()
  await flush()
}

describe('执行方式为专家 / 专家团时「引用技能」隐藏、保存时清空（R13-7，md §7.6 / §7.8）', () => {
  it('执行方式「技能」→ 展示「引用技能」区；「专家团」→ 不展示', async () => {
    mount({ positionId: 401, sample: sample({ execType: 'SKILL', execTargetId: null }) })
    await flush()
    expect(skillCard()).not.toBeNull()

    app.unmount()
    container.remove()
    mount({ positionId: 401, sample: sample() })
    await flush()
    expect(skillCard()).toBeNull()
  })

  it('已选了引用技能，从「技能」切到「专家」→「引用技能」区隐藏，执行动作下方提示「切换后已选的引用技能将在保存时清空」；切回「技能」已选仍在、提示消失', async () => {
    const skillRefs = [{ platformSkillId: 'sk_302', name: '经营数据分析' }]
    mount({ positionId: 401, sample: sample({ execType: 'SKILL', execTargetId: null, skillRefs }) })
    await flush()
    expect(clearWarn()).toBeNull()

    await pickExecType('EXPERT')
    expect(skillCard()).toBeNull()
    expect(clearWarn()?.textContent.trim()).toBe('切换后已选的引用技能将在保存时清空')

    await pickExecType('SKILL')
    expect(clearWarn()).toBeNull()
    expect(skillCard()?.textContent).toContain('经营数据分析')
  })

  it('没选引用技能时切到「专家团」→ 不出清空提示', async () => {
    mount({ positionId: 401, sample: sample({ execType: 'SKILL', execTargetId: null, skillRefs: [] }) })
    await flush()
    await pickExecType('TEAM')
    expect(container.querySelector('[data-testid="exec-team"]')).not.toBeNull() // 前提：确实切到了专家团
    expect(clearWarn()).toBeNull()
  })

  it('执行方式为「专家团」的任务带着引用技能保存 → payload.skillRefs 为空；「技能」任务照常带上', async () => {
    const skillRefs = [{ platformSkillId: 'sk_302', name: '经营数据分析' }]
    mount({ positionId: 401, sample: sample({ skillRefs }) })
    await flush()
    expect(clearWarn()).not.toBeNull()
    await save()
    expect(updateSampleTask.mock.calls[0][2]).toMatchObject({ execType: 'TEAM', execTargetId: 304, skillRefs: [] })

    app.unmount()
    container.remove()
    vi.clearAllMocks()
    mount({ positionId: 401, sample: sample({ execType: 'SKILL', execTargetId: null, skillRefs }) })
    await flush()
    await save()
    expect(updateSampleTask.mock.calls[0][2].skillRefs).toEqual([{ platformSkillId: 'sk_302', name: '经营数据分析' }])
  })
})

describe('脏检查只认值变化：回填后提示词被原样回抛不算修改', () => {
  it('打开任务不改任何东西 → 不上报 dirty；改了提示词 → 上报 true；改回原值 → 回到 false', async () => {
    const onDirty = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    app = createApp({ render: () => h(Editor, { positionId: 401, sample: sample(), onDirtyChange: onDirty }) })
    for (const [n, c] of Object.entries(stubs)) app.component(n, c)
    app.directive('loading', {})
    app.mount(container)
    await flush()
    expect(onDirty).not.toHaveBeenCalledWith(true)

    sopEmit('1. 汇总上周核心指标\n2. 输出待跟进事项\n3. 发给管理层')
    await flush()
    expect(onDirty).toHaveBeenLastCalledWith(true)

    sopEmit(sample().sopDoc)
    await flush()
    expect(onDirty).toHaveBeenLastCalledWith(false)
    expect(createSampleTask).not.toHaveBeenCalled()
  })
})
