import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { reactive } from 'vue'

/**
 * aiLiveGenerate.js 单测（2026-09-04 新增：统一 AI 实况生成机制）。
 * 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/各模块必填选填字段一览表.md L328-330
 * （按钮常规字重、静态「AI 生成」/ 生成中「生成中…」、耗时统一 500ms、取数源为空置灰并悬停「请先填写<对应描述字段>」）
 * + AI生成按钮Prompt规范.md L16（来源字段为空时置灰，悬停提示「请先填写{来源字段名}」）。
 * 覆盖：文本工具截断口径、三个本地模板生成器（模板句为前端 demo 固定模板）、
 * useAiLiveGenerate 四件套（空源禁用+title / 生成中… 约 500ms / 点击时刻取源 / 完成 toast）。
 */

const ElMessage = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() })
vi.mock('element-plus', () => ({ ElMessage }))

const {
  AI_LIVE_DELAY_MS,
  AI_LIVE_DONE_TOAST,
  AI_LIVE_BUSY_LABEL,
  shortText,
  limitLen,
  expertQuestionSet,
  connectorQuestionSet,
  skillExampleQuestion,
  useAiLiveGenerate
} = await import('@/utils/aiLiveGenerate')

beforeEach(() => {
  vi.useFakeTimers()
  ElMessage.success.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('文本工具（shortText / limitLen 截断口径）', () => {
  it('shortText：压空白；超长截断加省略号', () => {
    expect(shortText('  汇总  经营\n数据  ', 18)).toBe('汇总 经营 数据')
    expect(shortText('一二三四五', 3)).toBe('一二三…')
    expect(shortText('', 18)).toBe('')
  })

  it('limitLen：按码点硬截断到 max', () => {
    expect(limitLen('abc', 5)).toBe('abc')
    expect(limitLen('一二三四五', 3)).toBe('一二三')
  })
})

describe('本地模板生成器（demo 固定模板句逐字）', () => {
  it('expertQuestionSet：3 条『请围绕"…"给出专业分析』式，主语 18 字收束，每条 ≤300（2026-09-18 待办 yuepu#5⑥，原 60）', () => {
    const src = '汇总经营数据，识别异常并形成管理建议，输出可追溯的分析结论'
    const subject = shortText(src, 18)
    expect(subject.endsWith('…')).toBe(true) // 超 18 字被收束
    const qs = expertQuestionSet(src)
    expect(qs).toEqual([
      `请围绕"${subject}"给出专业分析`,
      `请基于"${subject}"识别关键问题并提出建议`,
      `请针对"${subject}"整理一份可执行方案`
    ])
    expect(qs.every((q) => Array.from(q).length <= 300)).toBe(true)
    // 短源不截断：主语原样入模板
    expect(expertQuestionSet('经营分析')[0]).toBe('请围绕"经营分析"给出专业分析')
  })

  it('connectorQuestionSet：3 条查询/提交/结果式连接器问题', () => {
    expect(connectorQuestionSet('客户管理')).toEqual([
      '请查询与"客户管理"相关的信息',
      '请处理一项关于"客户管理"的业务请求',
      '请返回"客户管理"的最新处理结果'
    ])
  })

  it('skillExampleQuestion：1 条『请帮我使用这个技能完成"…"』（主语 24 字收束，≤300，2026-09-18 待办 yuepu#5⑥，原 60）', () => {
    expect(skillExampleQuestion('整理销售周报')).toBe('请帮我使用这个技能完成"整理销售周报"')
    const long = skillExampleQuestion('一'.repeat(80))
    expect(long.startsWith('请帮我使用这个技能完成"')).toBe(true)
    expect(Array.from(long).length).toBeLessThanOrEqual(300)
  })
})

/**
 * 2026-09-09 PRD 复核批次 0（Q363–Q366）：三个生成器改吃上下文对象，补传「对象名称」。
 * md 依据=《AI生成按钮Prompt规范.md》§1/§4/§5/§6/§7 的「变量来源」表（均含 name）。
 * demo 本地模板只有一个主语位 → 口径为「名称优先做主语，名称为空回落描述」，
 * 不做多字段拼串（拼串后会被 18 字截断截没，正是清单 A17 警告的隐患）。
 */
describe('生成器补传对象名称（Q363–Q366）', () => {
  it('expertQuestionSet：吃 {name,intro,roleDesc,category}，名称做主语', () => {
    const qs = expertQuestionSet({
      name: '财务分析专家',
      intro: '负责经营数据的汇总与异常识别，输出可追溯的分析结论与管理建议',
      roleDesc: '按月度节奏产出经营分析报告',
      category: '财务'
    })
    expect(qs[0]).toBe('请围绕"财务分析专家"给出专业分析')
    expect(qs[1]).toBe('请基于"财务分析专家"识别关键问题并提出建议')
    expect(qs[2]).toBe('请针对"财务分析专家"整理一份可执行方案')
  })

  it('expertQuestionSet：名称为空 → 依次回落 简介 → 职责描述 → 分类（不拼串、不被截没）', () => {
    expect(expertQuestionSet({ name: '', intro: '经营分析' })[0]).toBe('请围绕"经营分析"给出专业分析')
    expect(expertQuestionSet({ name: '  ', intro: '', roleDesc: '月度复盘' })[0]).toBe(
      '请围绕"月度复盘"给出专业分析'
    )
    expect(expertQuestionSet({ category: '财务' })[0]).toBe('请围绕"财务"给出专业分析')
  })

  it('connectorQuestionSet / skillExampleQuestion：名称优先，缺名回落描述', () => {
    expect(connectorQuestionSet({ name: '报销系统', description: '报销单查询与提交' })[0]).toBe(
      '请查询与"报销系统"相关的信息'
    )
    expect(connectorQuestionSet({ description: '报销单查询与提交' })[0]).toBe(
      '请查询与"报销单查询与提交"相关的信息'
    )
    expect(skillExampleQuestion({ name: '周报助手', description: '把工作记录整理成周报' })).toBe(
      '请帮我使用这个技能完成"周报助手"'
    )
    expect(skillExampleQuestion({ description: '把工作记录整理成周报' })).toBe(
      '请帮我使用这个技能完成"把工作记录整理成周报"'
    )
  })

  it('三个生成器首参仍兼容旧的字符串写法（老调用方零改动）', () => {
    expect(expertQuestionSet('经营分析')).toEqual(expertQuestionSet({ intro: '经营分析' }))
    expect(connectorQuestionSet('客户管理')).toEqual(connectorQuestionSet({ description: '客户管理' }))
    expect(skillExampleQuestion('整理销售周报')).toBe(skillExampleQuestion({ description: '整理销售周报' }))
    // 空入参不炸（主语为空串）
    expect(expertQuestionSet(null)[0]).toBe('请围绕""给出专业分析')
    expect(connectorQuestionSet(undefined)[0]).toBe('请查询与""相关的信息')
  })

  it('长名称仍按 18 / 24 字收束，模板整体 ≤300（2026-09-18 待办 yuepu#5⑥，原 60）', () => {
    const qs = expertQuestionSet({ name: '一'.repeat(40), intro: '简介' })
    expect(qs.every((q) => Array.from(q).length <= 300)).toBe(true)
    expect(qs[0]).toContain('…')
    expect(Array.from(skillExampleQuestion({ name: '一'.repeat(80) })).length).toBeLessThanOrEqual(300)
  })
})

describe('useAiLiveGenerate（交互四件套）', () => {
  function setup(source = { text: '' }, extra = {}) {
    const apply = vi.fn()
    const generate = vi.fn((s) => `生成自：${s}`)
    const api = useAiLiveGenerate({
      getSourceText: () => source.text,
      sourceLabel: '专家简介',
      generate,
      apply,
      ...extra
    })
    return { api, apply, generate, source }
  }

  it('源文本为空 → 按钮禁用 + title「请先填写专家简介」；run 不执行', () => {
    const { api, apply } = setup({ text: '   ' })
    expect(api.sourceEmpty.value).toBe(true)
    expect(api.disabled.value).toBe(true)
    expect(api.title.value).toBe('请先填写专家简介')
    api.run()
    vi.advanceTimersByTime(AI_LIVE_DELAY_MS)
    expect(apply).not.toHaveBeenCalled()
    expect(ElMessage.success).not.toHaveBeenCalled()
  })

  it('有源文本 → 可用无引导 title；点击进「生成中…」约 500ms 后回填 + toast「AI 内容已生成，请确认后保存」', () => {
    const { api, apply, generate } = setup({ text: '汇总经营数据' })
    expect(api.disabled.value).toBe(false)
    expect(api.title.value).toBe('')
    expect(api.label.value).toBe('AI 生成')

    api.run()
    expect(api.busy.value).toBe(true)
    expect(api.label.value).toBe(AI_LIVE_BUSY_LABEL) // 「生成中…」
    expect(api.disabled.value).toBe(true) // busy 期间禁点，防连点
    expect(apply).not.toHaveBeenCalled()

    vi.advanceTimersByTime(AI_LIVE_DELAY_MS - 1)
    expect(apply).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(api.busy.value).toBe(false)
    expect(generate).toHaveBeenCalledWith('汇总经营数据')
    expect(apply).toHaveBeenCalledWith('生成自：汇总经营数据')
    expect(ElMessage.success).toHaveBeenCalledWith(AI_LIVE_DONE_TOAST)
    expect(AI_LIVE_DONE_TOAST).toBe('AI 内容已生成，请确认后保存')
  })

  it('源文本取点击那刻的值（点击后再改输入不影响本次生成）', () => {
    const source = { text: '旧描述' }
    const { api, generate } = setup(source)
    api.run()
    source.text = '新描述'
    vi.advanceTimersByTime(AI_LIVE_DELAY_MS)
    expect(generate).toHaveBeenCalledWith('旧描述')
  })

  it('只读态 → 禁用且不给「请先填写」引导 title', () => {
    const { api, apply } = setup({ text: '' }, { isReadonly: () => true })
    expect(api.disabled.value).toBe(true)
    expect(api.title.value).toBe('')
    api.run()
    vi.advanceTimersByTime(AI_LIVE_DELAY_MS)
    expect(apply).not.toHaveBeenCalled()
  })

  /**
   * 2026-09-09 PRD 复核批次 0 · A17：新增可选 getSourceContext（生成器入参）。
   * **契约不变**——sourceEmpty / disabled 仍只看 getSourceText，名称补传不参与禁用判定，
   * 避免出现「只填了名称没填描述却放行」的口径漂移（清单 A17 点名的 sourceEmpty 口径问题）。
   */
  it('getSourceContext：只喂 generate，不参与禁用判定（描述为空仍禁用，哪怕名称已填）', () => {
    const apply = vi.fn()
    const generate = vi.fn((ctx) => ctx)
    // 用 reactive 承载表单：computed(sourceEmpty) 才会随字段变化重算（组件里的 form 同样是 reactive）
    const form = reactive({ name: '财务分析专家', intro: '' })
    const api = useAiLiveGenerate({
      getSourceText: () => form.intro,
      sourceLabel: '专家简介',
      getSourceContext: () => ({ name: form.name, intro: form.intro }),
      generate,
      apply
    })
    // 名称已填但简介空 → 仍禁用、仍给「请先填写专家简介」引导
    expect(api.sourceEmpty.value).toBe(true)
    expect(api.disabled.value).toBe(true)
    expect(api.title.value).toBe('请先填写专家简介')
    api.run()
    vi.advanceTimersByTime(AI_LIVE_DELAY_MS)
    expect(generate).not.toHaveBeenCalled()

    // 补上简介后放行，生成器收到的是完整上下文对象（而非单一字符串）
    form.intro = '经营数据分析'
    expect(api.disabled.value).toBe(false)
    api.run()
    vi.advanceTimersByTime(AI_LIVE_DELAY_MS)
    expect(generate).toHaveBeenCalledWith({ name: '财务分析专家', intro: '经营数据分析' })
    expect(apply).toHaveBeenCalledWith({ name: '财务分析专家', intro: '经营数据分析' })
  })

  it('getSourceContext 同样取点击那刻的值（与 getSourceText 一致）', () => {
    const generate = vi.fn((ctx) => ctx)
    const form = { name: '旧名称', description: '旧描述' }
    const api = useAiLiveGenerate({
      getSourceText: () => form.description,
      sourceLabel: 'API 描述',
      getSourceContext: () => ({ name: form.name, description: form.description }),
      generate,
      apply: vi.fn()
    })
    api.run()
    form.name = '新名称'
    vi.advanceTimersByTime(AI_LIVE_DELAY_MS)
    expect(generate).toHaveBeenCalledWith({ name: '旧名称', description: '旧描述' })
  })

  it('未传 getSourceContext → 退化为旧行为（生成器吃 trim 后的源文本串）', () => {
    const { api, generate } = setup({ text: '  汇总经营数据  ' })
    api.run()
    vi.advanceTimersByTime(AI_LIVE_DELAY_MS)
    expect(generate).toHaveBeenCalledWith('汇总经营数据')
  })

  it('delayMs 可注入（接入方/测试可调；默认 500ms，2026-09-06 Q10 拍板全站统一）', () => {
    expect(AI_LIVE_DELAY_MS).toBe(500)
    const apply = vi.fn()
    const api = useAiLiveGenerate({
      getSourceText: () => '描述',
      sourceLabel: '技能描述',
      generate: (s) => s,
      apply,
      delayMs: 0
    })
    api.run()
    vi.advanceTimersByTime(0)
    expect(apply).toHaveBeenCalledWith('描述')
  })
})
