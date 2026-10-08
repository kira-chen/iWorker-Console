// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, reactive, ref } from 'vue'

/**
 * PositionPersonaTab（岗位详情「人格」页签）—— 2026-09-12 测试审计 T53 新建，对齐 md 岗位 §2.1 / §2.4 / §2.5：
 *  - 岗位描述为空 → 两处【AI 生成】disabled + title「请先填写岗位描述」；填了描述恢复可用；
 *  - 点【AI 生成】→ 按钮变「生成中…」，500ms 后示例问题 3 条填入 / SOP 填入，toast「已生成示例问题」「已生成岗位 SOP」；
 *  - 示例问题占位：第 1 条「如：帮我分析本周经营数据」、第 2-3 条「请输入示例问题」，每条 maxlength 300；
 *  - 只读态不出【AI 生成】；
 *  - 2026-09-12 审计 J18：领用页文案满 6 条【＋ 新增一条】不隐藏，点击直调 ClaimNotesEditor.startAdd。
 * 数据走 usePositionStore（reactive 桩），三个重子组件（IconField / ClaimNotesEditor / SkillMilkdownEditor）桩掉。
 *
 * 2026-10-08 对齐 docs/PRD/数字员工管理端PRD/02岗位/岗位/prd.岗位.md §2.1 / §2.5 / §2.7 / §9.1 第 5 项补：
 *  - 岗位名称卡副标题「用于列表、标题栏与员工端展示」、maxlength 64、输入写回 store.basic.name；
 *  - 岗位人格富文本占位（§2.7 逐字）；
 *  - 示例问题【AI 生成】完成后再点会覆盖当前内容（含手改过的格子）；
 *  - 父层注入 pdEqShowErrors=true（发布被示例问题阻断）→ 空格带 pd-eq-err，已填的不带。
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
// ClaimNotesEditor 桩：暴露与真组件同名的 startAdd / editing / atLimit（J18 用例通过 claimStub 调 atLimit 与断言 startAdd）
const claimStub = { startAdd: vi.fn(), atLimit: false, editing: false }
vi.mock('@/components/position/ClaimNotesEditor.vue', () => ({
  default: {
    name: 'ClaimNotesEditor',
    setup: (_, { expose }) => {
      expose({ startAdd: (...a) => claimStub.startAdd(...a), get atLimit() { return claimStub.atLimit }, get editing() { return claimStub.editing } })
      return () => h('div', { class: 'stub-claim' })
    }
  }
}))
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
async function mount(props = {}, provides = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(PositionPersonaTab, props) })
  for (const [k, v] of Object.entries(provides)) app.provide(k, v)
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
  claimStub.atLimit = false
  claimStub.editing = false
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

  it('点示例问题【AI 生成】→ 按钮变「生成中…」+ loading；500ms 后 3 条示例问题填入（每条 ≤300 字，2026-09-18 待办 yuepu#5⑥，原 60）+ toast「已生成示例问题」', async () => {
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
    expect(store.basic.exampleQuestions.every((q) => q.trim() && q.length <= 300)).toBe(true)
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

// 已知缺陷钉桩（2026-10-08 待办 yuepu#54）：aiGenQuestions / aiGenSop 是手写 500ms setTimeout，没走 useAiLiveGenerate——
// 无撤销、不核对对象，回调直接写 Pinia 全局 store。#26 同类问题在这里仍在。
// 修好后本组会报红——把 it.fails 改回 it 即成正式回归用例。
describe('人格页签 · 【AI 生成】切换岗位时不串数据（yuepu#54）', () => {
  it.fails('yuepu#54 点【AI 生成】后 500ms 内切到另一个岗位 → 生成结果不得写进新岗位、不弹成功提示', async () => {
    const { ElMessage } = await import('element-plus')
    vi.useFakeTimers()
    store.basic.description = '负责经营数据汇总、异常识别与经营分析报告输出'
    await mount()
    aiBtns()[0].click()
    await flush()
    expect(aiBtns()[0].textContent.trim()).toBe('生成中…') // 前提：生成已发起
    // 工作台切到另一个岗位（store.basic 整体换成新对象）
    store.positionId = 6
    store.basic = { positionId: 6, name: '客户成功岗', description: '负责客户跟进', icon: '◎', claimDescriptions: [], exampleQuestions: ['原问题一', '原问题二', '原问题三'], positionSop: '', persona: '' }
    await flush()
    vi.advanceTimersByTime(500)
    await flush()
    expect(store.basic.exampleQuestions).toEqual(['原问题一', '原问题二', '原问题三'])
    expect(ElMessage.success).not.toHaveBeenCalled()
  })
})

describe('人格页签 · 领用页文案卡头【＋ 新增一条】（md §2.3 L188；2026-09-12 审计 J18）', () => {
  const claimCard = () => cardByTitle('领用页文案')
  const addBtn = () => [...claimCard().querySelectorAll('.el-button')].find((b) => b.textContent.trim() === '＋ 新增一条')

  it('卡头带必填红星（2026-09-21 负责人拍板：领用页文案必填至少 1 条、岗位图标必填；与名称 / 描述 / 示例问题 / SOP 同为必填卡）；岗位人格仍无星', async () => {
    await mount()
    expect(claimCard().querySelector('.pd-card-title .pd-req')?.textContent).toBe('*')
    expect(cardByTitle('岗位图标').querySelector('.pd-card-title .pd-req')?.textContent).toBe('*')
    expect(cardByTitle('岗位人格').querySelector('.pd-card-title .pd-req')).toBeNull()
  })

  it('满 6 条（atLimit）→ 卡头【＋ 新增一条】仍展示不隐藏，点击直调 ClaimNotesEditor.startAdd（由其 toast「领用页文案最多 6 条」）', async () => {
    claimStub.atLimit = true
    await mount()
    expect(addBtn()).not.toBeUndefined()
    addBtn().click()
    await flush()
    expect(claimStub.startAdd).toHaveBeenCalledTimes(1)
  })

  it('草稿行展开中（editing）→ 卡头按钮收起；只读态 → 无按钮', async () => {
    claimStub.editing = true
    await mount()
    expect(addBtn()).toBeUndefined()
    app.unmount(); container.remove()
    claimStub.editing = false
    await mount({ isReadonly: true })
    expect(addBtn()).toBeUndefined()
  })
})

describe('人格页签 · 示例问题 / 描述 / SOP 输入约束（md §2.1 / §2.4 / §2.5）', () => {
  it('示例问题 3 格：占位第 1 条「如：帮我分析本周经营数据」、第 2-3 条「请输入示例问题」，每条 maxlength 300；提示「3 条均为必填，每条不超过 300 个字符」', async () => {
    await mount()
    const card = cardByTitle('示例问题')
    const inputs = [...card.querySelectorAll('.pd-eq-row .el-input')]
    expect(inputs).toHaveLength(3)
    expect(inputs.map((i) => i.getAttribute('placeholder'))).toEqual(['如：帮我分析本周经营数据', '请输入示例问题', '请输入示例问题'])
    expect(inputs.map((i) => i.getAttribute('maxlength'))).toEqual(['300', '300', '300'])
    expect(card.textContent).toContain('3 条均为必填，每条不超过 300 个字符')
  })

  it('岗位描述 maxlength 2000 + 占位「说明该岗位负责什么、可以帮助用户完成哪些工作」；SOP maxlength 4000 + 占位「说明岗位如何组合使用 Agent、技能、知识与工具完成工作」', async () => {
    await mount()
    const desc = container.querySelector('.pd-desc-input')
    expect(desc.getAttribute('maxlength')).toBe('2000')
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

describe('人格页签 · 岗位名称 / 岗位人格（2026-10-08 对齐 md §2.1 / §2.7）', () => {
  it('岗位名称卡副标题为「用于列表、标题栏与员工端展示」，标题带必填红星', async () => {
    await mount()
    const card = cardByTitle('岗位名称')
    expect(card.querySelector('.pd-card-sub').textContent.trim()).toBe('用于列表、标题栏与员工端展示')
    expect(card.querySelector('.pd-card-title .pd-req')?.textContent).toBe('*')
  })

  it('岗位名称输入框最多 64 个字符，回显当前岗位名', async () => {
    await mount()
    const input = cardByTitle('岗位名称').querySelector('.el-input')
    expect(input.getAttribute('maxlength')).toBe('64')
    expect(input.value).toBe('经营分析岗')
  })

  it('在岗位名称框里改名 → 写回 store.basic.name（随顶部【保存】提交）', async () => {
    await mount()
    const input = cardByTitle('岗位名称').querySelector('.el-input')
    input.value = '经营分析二岗'
    input.dispatchEvent(new Event('input'))
    await flush()
    expect(store.basic.name).toBe('经营分析二岗')
  })

  it('岗位人格编辑器占位为「你是一名严谨的经营分析助手。优先核对数据口径，先给结论，再展示关键依据和风险提示。」', async () => {
    await mount()
    const md = cardByTitle('岗位人格').querySelector('.stub-md')
    expect(md.getAttribute('placeholder')).toBe('你是一名严谨的经营分析助手。优先核对数据口径，先给结论，再展示关键依据和风险提示。')
  })
})

describe('人格页签 · 示例问题【AI 生成】重复点击覆盖（2026-10-08 对齐 md §2.5「重复点击可重新生成，覆盖当前内容」）', () => {
  it('生成完成后手改一格，再点【AI 生成】→ 500ms 后 3 格整体被新生成内容覆盖，手改内容不保留', async () => {
    const { ElMessage } = await import('element-plus')
    vi.useFakeTimers()
    store.basic.description = '负责经营数据汇总、异常识别与经营分析报告输出'
    store.basic.exampleQuestions = ['旧问题一', '旧问题二', '旧问题三']
    await mount()
    aiBtns()[0].click()
    await flush()
    vi.advanceTimersByTime(500)
    await flush()
    const generated = [...store.basic.exampleQuestions]
    expect(generated).not.toEqual(['旧问题一', '旧问题二', '旧问题三'])

    // 用户手改第 1 格后再点一次
    const inputs = () => [...cardByTitle('示例问题').querySelectorAll('.pd-eq-row .el-input')]
    inputs()[0].value = '我手改过的问题'
    inputs()[0].dispatchEvent(new Event('input'))
    await flush()
    expect(store.basic.exampleQuestions[0]).toBe('我手改过的问题')
    expect(aiBtns()[0].disabled).toBe(false)
    aiBtns()[0].click()
    await flush()
    vi.advanceTimersByTime(500)
    await flush()
    expect(store.basic.exampleQuestions).toHaveLength(3)
    expect(store.basic.exampleQuestions).not.toContain('我手改过的问题')
    expect(store.basic.exampleQuestions.every((q) => q.trim())).toBe(true)
    expect(inputs().map((i) => i.value)).toEqual(store.basic.exampleQuestions)
    expect(ElMessage.success).toHaveBeenCalledTimes(2)
  })
})

describe('人格页签 · 示例问题发布阻断标红（2026-10-08 对齐 md §9.1 第 5 项 / §2.5）', () => {
  const eqInputs = () => [...cardByTitle('示例问题').querySelectorAll('.pd-eq-row .el-input')]

  it('父层注入 pdEqShowErrors=true 时 → 空着的格子（含只有空格的）带 pd-eq-err，已填的不带', async () => {
    store.basic.exampleQuestions = ['帮我分析本周经营数据', '', '   ']
    await mount({}, { pdEqShowErrors: ref(true) })
    expect(eqInputs().map((i) => i.classList.contains('pd-eq-err'))).toEqual([false, true, true])
  })

  it('未注入（或为 false）时 → 即使格子是空的也不标红', async () => {
    store.basic.exampleQuestions = ['帮我分析本周经营数据', '', '']
    await mount({}, { pdEqShowErrors: ref(false) })
    expect(eqInputs().some((i) => i.classList.contains('pd-eq-err'))).toBe(false)
  })

  it('标红状态下把空格填上 → 该格立即去掉 pd-eq-err', async () => {
    store.basic.exampleQuestions = ['帮我分析本周经营数据', '', 'q3']
    await mount({}, { pdEqShowErrors: ref(true) })
    expect(eqInputs()[1].classList.contains('pd-eq-err')).toBe(true)
    eqInputs()[1].value = '本月异常指标有哪些'
    eqInputs()[1].dispatchEvent(new Event('input'))
    await flush()
    expect(eqInputs()[1].classList.contains('pd-eq-err')).toBe(false)
  })
})
