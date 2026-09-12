// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'

/**
 * PositionPersonaTab（岗位详情「人格」页签）—— 2026-09-12 测试审计 T53 新建，对齐 md 岗位 §2.1 / §2.4 / §2.5：
 *  - 岗位描述为空 → 两处【AI 生成】disabled + title「请先填写岗位描述」；填了描述恢复可用；
 *  - 点【AI 生成】→ 按钮变「生成中…」，500ms 后示例问题 3 条填入 / SOP 填入，toast「已生成示例问题」「已生成岗位 SOP」；
 *  - 示例问题占位：第 1 条「如：帮我分析本周经营数据」、第 2-3 条「请输入示例问题」，每条 maxlength 60；
 *  - 只读态不出【AI 生成】。
 * 数据走 usePositionStore（reactive 桩），三个重子组件（IconField / ClaimNotesEditor / SkillMilkdownEditor）桩掉。
 */

const store = reactive({
  positionId: 5,
  basic: { positionId: 5, name: '经营分析岗', description: '', icon: '▤', claimDescriptions: [], exampleQuestions: ['', '', ''], positionSop: '', persona: '' }
})
vi.mock('@/stores/position', () => ({ usePositionStore: () => store }))
vi.mock('element-plus', () => ({
  ElMessage: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() })
}))
vi.mock('@/components/common/IconField.vue', () => ({ default: { name: 'IconField', setup: () => () => h('div', { class: 'stub-icon' }) } }))
vi.mock('@/components/position/ClaimNotesEditor.vue', () => ({ default: { name: 'ClaimNotesEditor', setup: () => () => h('div', { class: 'stub-claim' }) } }))
vi.mock('@/components/position/SkillMilkdownEditor.vue', () => ({ default: { name: 'SkillMilkdownEditor', setup: () => () => h('div', { class: 'stub-md' }) } }))

const PositionPersonaTab = (await import('@/components/position/PositionPersonaTab.vue')).default

const elButton = {
  name: 'el-button',
  props: ['disabled', 'title', 'loading', 'plain', 'size', 'link', 'type'],
  emits: ['click'],
  template: '<button class="el-button" :disabled="disabled" :title="title" :data-loading="String(!!loading)" @click="$emit(\'click\')"><slot /></button>'
}
const elInput = {
  name: 'el-input',
  props: ['modelValue', 'maxlength', 'placeholder', 'disabled', 'type', 'rows'],
  emits: ['update:modelValue'],
  // type=textarea 时渲染 textarea（jsdom 的 <input type=text> 会把换行剥掉，SOP 生成文本含换行）
  template:
    '<textarea v-if="type === \'textarea\'" class="el-input" :maxlength="maxlength" :placeholder="placeholder" :disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' +
    '<input v-else class="el-input" :maxlength="maxlength" :placeholder="placeholder" :disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
}

let app, container
async function mount(props = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(PositionPersonaTab, props) })
  app.component('el-button', elButton)
  app.component('el-input', elInput)
  app.mount(container)
  await nextTick()
  return container
}
const flush = async () => { await nextTick(); await Promise.resolve(); await nextTick() }
// 两个【AI 生成】按钮：[0]=示例问题卡、[1]=岗位 SOP 卡
const aiBtns = () => [...container.querySelectorAll('.pd-ai-btn')]
const cardByTitle = (title) => [...container.querySelectorAll('.pd-card')].find((c) => c.querySelector('.pd-card-title')?.textContent.startsWith(title))

beforeEach(() => {
  vi.clearAllMocks()
  store.basic = { positionId: 5, name: '经营分析岗', description: '', icon: '▤', claimDescriptions: [], exampleQuestions: ['', '', ''], positionSop: '', persona: '' }
})
afterEach(() => {
  app?.unmount()
  container?.remove()
  vi.useRealTimers()
})

describe('人格页签 · 【AI 生成】门与拟真生成（md §2.4 / §2.5）', () => {
  it('岗位描述为空 → 示例问题 / 岗位 SOP 两处【AI 生成】均 disabled + title「请先填写岗位描述」', async () => {
    await mount()
    expect(aiBtns()).toHaveLength(2)
    for (const b of aiBtns()) {
      expect(b.textContent.trim()).toBe('AI 生成')
      expect(b.disabled).toBe(true)
      expect(b.getAttribute('title')).toBe('请先填写岗位描述')
    }
  })

  it('填写岗位描述后 → 两处【AI 生成】恢复可用、不再带 tooltip', async () => {
    await mount()
    const desc = container.querySelector('.pd-desc-input')
    desc.value = '负责经营数据汇总与分析'
    desc.dispatchEvent(new Event('input'))
    await flush()
    expect(store.basic.description).toBe('负责经营数据汇总与分析')
    for (const b of aiBtns()) {
      expect(b.disabled).toBe(false)
      expect(b.getAttribute('title')).toBeNull()
    }
  })

  it('点示例问题【AI 生成】→ 按钮变「生成中…」+ loading；500ms 后 3 条示例问题填入（每条 ≤60 字）+ toast「已生成示例问题」', async () => {
    const { ElMessage } = await import('element-plus')
    vi.useFakeTimers()
    store.basic.description = '负责经营数据汇总、异常识别与经营分析报告输出'
    await mount()
    aiBtns()[0].click()
    await flush()
    expect(aiBtns()[0].textContent.trim()).toBe('生成中…')
    expect(aiBtns()[0].getAttribute('data-loading')).toBe('true')
    vi.advanceTimersByTime(499)
    await flush()
    expect(store.basic.exampleQuestions).toEqual(['', '', ''])
    expect(ElMessage.success).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await flush()
    expect(store.basic.exampleQuestions).toHaveLength(3)
    expect(store.basic.exampleQuestions.every((q) => q.trim() && q.length <= 60)).toBe(true)
    expect(ElMessage.success).toHaveBeenCalledWith('已生成示例问题')
    expect(aiBtns()[0].textContent.trim()).toBe('AI 生成')
    // 输入框回显生成结果
    const inputs = [...cardByTitle('示例问题').querySelectorAll('.el-input')]
    expect(inputs.map((i) => i.value)).toEqual(store.basic.exampleQuestions)
  })

  it('点岗位 SOP【AI 生成】→ 500ms 后 SOP 填入（≤4000 字）+ toast「已生成岗位 SOP」', async () => {
    const { ElMessage } = await import('element-plus')
    vi.useFakeTimers()
    store.basic.description = '负责经营数据汇总、异常识别与经营分析报告输出'
    await mount()
    aiBtns()[1].click()
    await flush()
    expect(aiBtns()[1].textContent.trim()).toBe('生成中…')
    vi.advanceTimersByTime(500)
    await flush()
    expect(store.basic.positionSop.trim().length).toBeGreaterThan(0)
    expect(store.basic.positionSop.length).toBeLessThanOrEqual(4000)
    expect(ElMessage.success).toHaveBeenCalledWith('已生成岗位 SOP')
    expect(container.querySelector('.pd-sop-input').value).toBe(store.basic.positionSop)
  })

  it('生成中重复点击不重复触发（500ms 内只生成一次、只 toast 一次）', async () => {
    const { ElMessage } = await import('element-plus')
    vi.useFakeTimers()
    store.basic.description = '负责经营分析'
    await mount()
    aiBtns()[0].click()
    await flush()
    aiBtns()[0].click()
    await flush()
    vi.advanceTimersByTime(500)
    await flush()
    expect(ElMessage.success).toHaveBeenCalledTimes(1)
  })
})

describe('人格页签 · 示例问题 / 描述 / SOP 输入约束（md §2.1 / §2.4 / §2.5）', () => {
  it('示例问题 3 格：占位第 1 条「如：帮我分析本周经营数据」、第 2-3 条「请输入示例问题」，每条 maxlength 60；提示「3 条均为必填，每条不超过 60 个字符」', async () => {
    await mount()
    const card = cardByTitle('示例问题')
    const inputs = [...card.querySelectorAll('.pd-eq-row .el-input')]
    expect(inputs).toHaveLength(3)
    expect(inputs.map((i) => i.getAttribute('placeholder'))).toEqual(['如：帮我分析本周经营数据', '请输入示例问题', '请输入示例问题'])
    expect(inputs.map((i) => i.getAttribute('maxlength'))).toEqual(['60', '60', '60'])
    expect(card.textContent).toContain('3 条均为必填，每条不超过 60 个字符')
  })

  it('岗位描述 maxlength 500 + 占位「说明该岗位负责什么、可以帮助用户完成哪些工作」；SOP maxlength 4000 + 占位「说明岗位如何组合使用 Agent、技能、知识与工具完成工作」', async () => {
    await mount()
    const desc = container.querySelector('.pd-desc-input')
    expect(desc.getAttribute('maxlength')).toBe('500')
    expect(desc.getAttribute('placeholder')).toBe('说明该岗位负责什么、可以帮助用户完成哪些工作')
    const sop = container.querySelector('.pd-sop-input')
    expect(sop.getAttribute('maxlength')).toBe('4000')
    expect(sop.getAttribute('placeholder')).toBe('说明岗位如何组合使用 Agent、技能、知识与工具完成工作')
  })

  it('示例问题逐格输入 → 写回 store.basic.exampleQuestions 对应位置', async () => {
    await mount()
    const inputs = [...cardByTitle('示例问题').querySelectorAll('.pd-eq-row .el-input')]
    inputs[1].value = '帮我看看本月异常指标'
    inputs[1].dispatchEvent(new Event('input'))
    await flush()
    expect(store.basic.exampleQuestions).toEqual(['', '帮我看看本月异常指标', ''])
  })

  it('只读态 → 不出【AI 生成】，描述 / 示例问题 / SOP 输入框均 disabled', async () => {
    store.basic.description = '有描述'
    await mount({ isReadonly: true })
    expect(aiBtns()).toHaveLength(0)
    expect(container.querySelector('.pd-desc-input').disabled).toBe(true)
    expect(container.querySelector('.pd-sop-input').disabled).toBe(true)
    for (const i of container.querySelectorAll('.pd-eq-row .el-input')) expect(i.disabled).toBe(true)
  })
})
