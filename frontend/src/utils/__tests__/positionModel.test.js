// 2026-09-12 测试审计 T35：本文件拆为 4 份（条数 71 不减）——采集字段 → positionModel.intake.test.js、
// 技能工具引用 → positionModel.toolRef.test.js、发布校验 → positionModel.publish.test.js；本文件余留
// 触发词 / 技能示例问题 / 推荐问题 / 人格页签必填要素（对齐 md 岗位 §2 人格页签、技能 md §三）。
import { describe, it, expect } from 'vitest'
import {
  LIMITS,
  validateTrigger,
  triggerSoftHint,
  hasAtLeastOneTrigger,
  hasExampleQuestion,
  exampleQuestionSoftHint,
  EXAMPLE_QUESTION_SOFT_LEN,
  normalizeRecommendedQuestions,
  recommendedQuestionsComplete,
  validateRecommendedQuestions,
  RECOMMENDED_Q_MAX_LEN,
  DESCRIPTION_MAX_LEN,
  CLAIM_NOTE_MAX,
  CLAIM_NOTE_LEN,
  EXAMPLE_Q_COUNT,
  EXAMPLE_Q_MAX_LEN,
  SOP_MAX_LEN,
  normalizeExampleQuestions,
  exampleQuestionsComplete,
  normalizeClaimNotes,
  genExampleQuestions,
  genPositionSop
} from '@/utils/positionModel'

describe('validateTrigger（N1：硬拦空/重复，字数改软提示不硬拦）', () => {
  it('空 / 重复 硬拦报错', () => {
    expect(validateTrigger('')).toBe('触发词不能为空')
    expect(validateTrigger('   ')).toBe('触发词不能为空') // 纯空白视为空
    expect(validateTrigger('去了', ['去了'])).toBe('触发词重复')
  })
  it('超长（>软上限）不再硬拦，返回 null（改由 triggerSoftHint 软提示）', () => {
    expect(validateTrigger('x'.repeat(LIMITS.TRIGGER_SOFT_LEN + 5))).toBeNull()
  })
  it('合法返回 null', () => {
    expect(validateTrigger('去了', ['聊了'])).toBeNull()
  })
})

describe('triggerSoftHint / hasAtLeastOneTrigger（N1 软提示 + 必填判定）', () => {
  it('存在超软上限词 → 软提示含字数；否则空串', () => {
    expect(triggerSoftHint(['x'.repeat(LIMITS.TRIGGER_SOFT_LEN + 1)])).toContain(
      String(LIMITS.TRIGGER_SOFT_LEN)
    )
    expect(triggerSoftHint(['短词', '也短'])).toBe('')
    expect(triggerSoftHint([])).toBe('')
  })
  it('至少 1 个非空白触发词才算满足必填', () => {
    expect(hasAtLeastOneTrigger(['去了'])).toBe(true)
    expect(hasAtLeastOneTrigger(['  '])).toBe(false)
    expect(hasAtLeastOneTrigger([])).toBe(false)
  })
})

describe('N2 技能示例问题（1 个必填 + 20 字软提示）', () => {
  it('去空白后非空才算已填（必填判定）', () => {
    expect(hasExampleQuestion('帮我记一条客户拜访')).toBe(true)
    expect(hasExampleQuestion('   ')).toBe(false)
    expect(hasExampleQuestion('')).toBe(false)
    expect(hasExampleQuestion(null)).toBe(false)
    expect(hasExampleQuestion(undefined)).toBe(false)
  })
  it('超软上限（20 字）→ 软提示含字数；否则空串（不硬拦）', () => {
    expect(exampleQuestionSoftHint('x'.repeat(EXAMPLE_QUESTION_SOFT_LEN + 1))).toContain(
      String(EXAMPLE_QUESTION_SOFT_LEN)
    )
    expect(exampleQuestionSoftHint('x'.repeat(EXAMPLE_QUESTION_SOFT_LEN))).toBe('')
    expect(exampleQuestionSoftHint('短问题')).toBe('')
    expect(exampleQuestionSoftHint('')).toBe('')
  })
})

describe('N4 推荐问题（固定 4 格）', () => {
  it('归一为恒 4 格：不足补空、超出截断、null→空串', () => {
    expect(normalizeRecommendedQuestions(['a'])).toEqual(['a', '', '', ''])
    expect(normalizeRecommendedQuestions(['a', 'b', 'c', 'd', 'e'])).toEqual(['a', 'b', 'c', 'd'])
    expect(normalizeRecommendedQuestions([null, undefined, 1, 'x'])).toEqual(['', '', '1', 'x'])
    expect(normalizeRecommendedQuestions(null)).toEqual(['', '', '', ''])
  })
  it('全填才算完整（必填）', () => {
    expect(recommendedQuestionsComplete(['a', 'b', 'c', 'd'])).toBe(true)
    expect(recommendedQuestionsComplete(['a', 'b', 'c', '  '])).toBe(false) // 纯空白视为未填
    expect(recommendedQuestionsComplete(['a', 'b', 'c'])).toBe(false) // 少 1 格
  })
  it('校验逐格标记未填格', () => {
    const r = validateRecommendedQuestions(['a', '', 'c', ' '])
    expect(r.ok).toBe(false)
    expect(r.errors).toEqual([false, true, false, true])
    expect(validateRecommendedQuestions(['a', 'b', 'c', 'd']).ok).toBe(true)
  })
  it('单格硬上限 30 字（输入框 maxlength 用）', () => {
    expect(RECOMMENDED_Q_MAX_LEN).toBe(30)
  })
})

describe('人格页签必填要素（2026-09-04 PRD-20260903 对齐新增）', () => {
  it('上限常量与新 md 口径一致：描述 500（2026-09-08 决议第 5 项：统一 500）/ 领用页文案 6×100 / 示例问题 3×60 / SOP 4000', () => {
    expect(DESCRIPTION_MAX_LEN).toBe(500)
    expect(CLAIM_NOTE_MAX).toBe(6)
    expect(CLAIM_NOTE_LEN).toBe(100)
    expect(EXAMPLE_Q_COUNT).toBe(3)
    expect(EXAMPLE_Q_MAX_LEN).toBe(60)
    expect(SOP_MAX_LEN).toBe(4000)
  })
  it('示例问题归一为恒 3 格：不足补空、超出截断、null→空串', () => {
    expect(normalizeExampleQuestions(['a'])).toEqual(['a', '', ''])
    expect(normalizeExampleQuestions(['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c'])
    expect(normalizeExampleQuestions(null)).toEqual(['', '', ''])
    expect(normalizeExampleQuestions([null, 1, 'x'])).toEqual(['', '1', 'x'])
  })
  it('示例问题全填才算完整（纯空白视为未填）', () => {
    expect(exampleQuestionsComplete(['a', 'b', 'c'])).toBe(true)
    expect(exampleQuestionsComplete(['a', 'b', '  '])).toBe(false)
    expect(exampleQuestionsComplete(['a', 'b'])).toBe(false)
  })
  it('认领说明归一为字符串数组', () => {
    expect(normalizeClaimNotes(['a', null, 2])).toEqual(['a', '', '2'])
    expect(normalizeClaimNotes(null)).toEqual([])
  })
  it('AI 生成示例问题：基于描述产出 3 条、每条 ≤60 字、内容含主题词', () => {
    const qs = genExampleQuestions('经营分析岗', '负责经营数据汇总与分析')
    expect(qs).toHaveLength(3)
    qs.forEach((q) => {
      expect(q.trim().length).toBeGreaterThan(0)
      expect(Array.from(q).length).toBeLessThanOrEqual(EXAMPLE_Q_MAX_LEN)
    })
    expect(qs[0]).toContain('负责经营数据汇总与分析')
    // 描述为空回落岗位名做主题词
    expect(genExampleQuestions('财务审核岗', '')[0]).toContain('财务审核岗')
  })
  // 2026-09-09 PRD 复核·G1（A18 / Q370，二轮决策选 A）：SOP 模板 4 步 → 5 步，
  // 按《AI生成按钮Prompt规范.md》§3「理解意图 → 选择能力 → 执行任务 → 核对结果 → 输出结论」。
  it('AI 生成岗位 SOP：编号步骤式短文、恰 5 步覆盖规范五环节、≤4000 字、含岗位描述主题词', () => {
    const sop = genPositionSop('经营分析岗', '负责经营数据汇总与分析')
    const lines = sop.split('\n')
    expect(lines.length).toBe(5)
    expect(lines.map((l) => l.slice(0, 3))).toEqual(['1. ', '2. ', '3. ', '4. ', '5. '])
    expect(sop).toContain('负责经营数据汇总与分析')
    // 五环节关键词逐行落位
    expect(lines[0]).toContain('理解用户意图')
    expect(lines[1]).toContain('选择')
    expect(lines[2]).toContain('执行任务')
    expect(lines[3]).toContain('核对')
    expect(lines[4]).toContain('输出结论')
    expect(sop.length).toBeLessThanOrEqual(SOP_MAX_LEN)
  })
})
