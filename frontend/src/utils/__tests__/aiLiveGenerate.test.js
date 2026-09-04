import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * aiLiveGenerate.js 单测（2026-09-04 PRD-20260903 对齐新增：统一 AI 实况生成机制，
 * 基准=新交互原型最终覆写态 unified-ai-live-generation-module）。
 * 覆盖：文本工具截断口径、三个本地模板生成器（模板句照原型逐字）、
 * useAiLiveGenerate 四件套（空源禁用+title / 生成中… 约 420ms / 点击时刻取源 / 完成 toast）。
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

describe('文本工具（原型 shortText / limit 同口径）', () => {
  it('shortText：压空白；超长截断加省略号', () => {
    expect(shortText('  汇总  经营\n数据  ', 18)).toBe('汇总 经营 数据')
    expect(shortText('一二三四五', 3)).toBe('一二三…')
    expect(shortText('', 18)).toBe('')
  })

  it('limitLen：按码点硬截断到 max（对齐输入框 maxlength=60）', () => {
    expect(limitLen('abc', 5)).toBe('abc')
    expect(limitLen('一二三四五', 3)).toBe('一二三')
  })
})

describe('本地模板生成器（模板句照原型 questionSet 逐字）', () => {
  it('expertQuestionSet：3 条『请围绕"…"给出专业分析』式，主语=源文本 18 字收束，每条 ≤60', () => {
    const src = '汇总经营数据，识别异常并形成管理建议，输出可追溯的分析结论'
    const subject = shortText(src, 18)
    expect(subject.endsWith('…')).toBe(true) // 超 18 字被收束
    const qs = expertQuestionSet(src)
    expect(qs).toEqual([
      `请围绕"${subject}"给出专业分析`,
      `请基于"${subject}"识别关键问题并提出建议`,
      `请针对"${subject}"整理一份可执行方案`
    ])
    expect(qs.every((q) => Array.from(q).length <= 60)).toBe(true)
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

  it('skillExampleQuestion：1 条『请帮我使用这个技能完成"…"』（主语 24 字收束，≤60）', () => {
    expect(skillExampleQuestion('整理销售周报')).toBe('请帮我使用这个技能完成"整理销售周报"')
    const long = skillExampleQuestion('一'.repeat(80))
    expect(long.startsWith('请帮我使用这个技能完成"')).toBe(true)
    expect(Array.from(long).length).toBeLessThanOrEqual(60)
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

  it('有源文本 → 可用无引导 title；点击进「生成中…」约 420ms 后回填 + toast「AI 内容已生成，请确认后保存」', () => {
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

  it('源文本取点击那刻的值（原型 liveValue：点击后再改输入不影响本次生成）', () => {
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

  it('delayMs 可注入（接入方/测试可调；默认 420ms）', () => {
    expect(AI_LIVE_DELAY_MS).toBe(420)
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
