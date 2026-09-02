// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

// flush：连续 microtask + nextTick 若干轮，等 onMounted 的 Promise.all(loadTools/loadSkillCandidates) → fillFrom 完成。
async function flush(n = 6) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

/**
 * SampleTaskEditor · 一句话指令(prompt)：
 * - 详情回填 SampleTaskVO.prompt；
 * - 空 prompt（启用样例）阻断保存并标红，不落 create；
 * - 填了 prompt → createSampleTask payload 含 prompt。
 */
const createSpy = vi.fn(() => Promise.resolve({ id: 't1' }))
const updateSpy = vi.fn(() => Promise.resolve({ id: 't1' }))
vi.mock('@/api/sampleTask', () => ({
  createSampleTask: createSpy,
  updateSampleTask: updateSpy,
  previewSampleSchedule: vi.fn(() => Promise.resolve({ summary: '', nextRunTimes: [] }))
}))
vi.mock('@/api/position', () => ({
  listToolPicker: vi.fn(() => Promise.resolve([])),
  listPlatformSkillCandidates: vi.fn(() => Promise.resolve([]))
}))
vi.mock('@/api/request', () => ({ ApiError: class ApiError extends Error {} }))
const warnSpy = vi.fn()
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: warnSpy, info: vi.fn() }),
  ElMessageBox: { confirm: vi.fn(() => Promise.resolve()), prompt: vi.fn() }
}))
// 子组件 stub（隔离重依赖）。
vi.mock('@/components/task/SchedulePicker.vue', () => ({ default: { name: 'SchedulePicker', setup: () => () => h('div', { class: 'stub-sched' }) } }))
vi.mock('@/components/admin/ToolPicker.vue', () => ({ default: { name: 'ToolPicker', setup: () => () => h('div', { class: 'stub-tool' }) } }))
// MarkdownEditor stub 暴露 emit 句柄（lastSopEmit），供测试在创建态填 sopDoc（必填门用）。
let lastSopEmit = null
vi.mock('@/components/admin/MarkdownEditor.vue', () => ({
  default: {
    name: 'MarkdownEditor',
    props: ['modelValue'],
    emits: ['update:modelValue', 'update:model-value'],
    setup: (p, { emit }) => {
      lastSopEmit = (v) => emit('update:modelValue', v)
      return () => h('div', { class: 'stub-md', 'data-md': p.modelValue ?? '' })
    }
  }
}))
vi.mock('@/components/StatusTag.vue', () => ({ default: { name: 'StatusTag', setup: (_, { slots }) => () => h('span', slots.default?.()) } }))

const SampleTaskEditor = (await import('@/components/position/SampleTaskEditor.vue')).default

// el-input stub：透传 v-model（textarea/input 统一），供测试改 prompt/name。
const elInput = {
  name: 'el-input',
  props: { modelValue: { default: '' }, type: { default: 'text' } },
  emits: ['update:modelValue', 'input'],
  setup(props, { emit }) {
    return () =>
      h('input', {
        class: 'stub-el-input',
        value: props.modelValue,
        onInput: (e) => { emit('update:modelValue', e.target.value); emit('input') }
      })
  }
}
const passthroughStubs = {
  'el-input': elInput,
  'el-button': { template: '<button @click="$emit(\'click\')"><slot /></button>' },
  'el-icon': { template: '<i><slot /></i>' },
  'el-checkbox': { template: '<span />' },
  'el-tooltip': { template: '<span><slot /></span>' }
}

let app, container
function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(SampleTaskEditor, props) })
  for (const [n, c] of Object.entries(passthroughStubs)) app.component(n, c)
  app.mount(container)
  return container
}
beforeEach(() => vi.clearAllMocks())
afterEach(() => { app?.unmount(); container?.remove() })

// 取所有 stub-el-input（顺序：name, prompt, remark, ...）。
function inputs() {
  return [...container.querySelectorAll('.stub-el-input')]
}
function setInput(idx, val) {
  const el = inputs()[idx]
  el.value = val
  el.dispatchEvent(new Event('input'))
}

describe('SampleTaskEditor · 一句话指令(prompt)', () => {
  it('详情回填 SampleTaskVO.prompt', async () => {
    mount({
      positionId: 1,
      sample: { id: 't1', name: '样例A', prompt: '每天拉工单汇总 [SILENT]', schedule: { scheduleType: 'DAILY', times: ['09:00'] }, sopDoc: 'x', toolRefs: [], skillRefs: [] }
    })
    await flush()
    // prompt 为第二个输入框（name 之后）。
    expect(inputs()[1].value).toBe('每天拉工单汇总 [SILENT]')
  })

  it('空 prompt → 阻断保存，不落 create（其余必填齐备，证明归因到 prompt 门）', async () => {
    mount({ positionId: 1, sample: null })
    await flush()
    // 填齐除 prompt 外全部必填：name（输入框 0）、sopDoc（MarkdownEditor emit 句柄）；
    // schedule 创建态默认 DAILY + ['09:00'] 本就合法（blankSchedule），仅 prompt 留空。
    setInput(0, '样例B')
    lastSopEmit('怎么办：拉昨日工单，汇总成待办清单')
    await flush()
    // 点击保存（最后一个按钮为主保存）。
    const btns = [...container.querySelectorAll('button')]
    btns[btns.length - 1].click()
    await flush()
    expect(createSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    // 归因：标红错误仅 prompt 一条（name/sopDoc/schedule 均已通过校验）。
    const errs = [...container.querySelectorAll('.te-err')].map((e) => e.textContent)
    expect(errs).toEqual(['请填写一句话指令（启用样例必填）'])
  })

  it('编辑态改 prompt → updateSampleTask payload 含新 prompt', async () => {
    // 编辑态：sopDoc / schedule 由 sample 回填齐（避开 MarkdownEditor stub 不发 update 的困扰），仅改 prompt。
    mount({
      positionId: 1,
      sample: { id: 't1', name: '样例C', prompt: '旧指令', schedule: { scheduleType: 'DAILY', times: ['09:00'] }, sopDoc: '怎么办', toolRefs: [], skillRefs: [] }
    })
    await flush()
    setInput(1, '新指令：到点做汇总') // prompt（第二输入框）
    await flush()
    const btns = [...container.querySelectorAll('button')]
    btns[btns.length - 1].click() // 保存
    await flush()
    expect(updateSpy).toHaveBeenCalled()
    const payload = updateSpy.mock.calls[0][2]
    expect(payload.prompt).toBe('新指令：到点做汇总')
  })
})
