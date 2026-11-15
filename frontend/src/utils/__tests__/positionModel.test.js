// 2026-09-12 测试审计 T35：本文件拆为 4 份（条数 71 不减）——采集字段 → positionModel.intake.test.js、
// 技能工具引用 → positionModel.toolRef.test.js、发布校验 → positionModel.publish.test.js；本文件余留
// 触发词 / 技能示例问题 / 推荐问题 / 人格页签必填要素（对齐 md 岗位 §2 人格页签、技能 md §三）。
import { describe, it, expect } from 'vitest'
import { expertUsageImpactText } from '@/utils/positionModel'
import {
  LIMITS,
  validateTrigger,
  triggerSoftHint,
  hasAtLeastOneTrigger,
  hasExampleQuestion,
  exampleQuestionSoftHint,
  EXAMPLE_QUESTION_SOFT_LEN,
  DESCRIPTION_MAX_LEN,
  CLAIM_NOTE_MAX,
  CLAIM_NOTE_LEN,
  EXAMPLE_Q_COUNT,
  EXAMPLE_Q_MAX_LEN,
  SOP_MAX_LEN,
  SAMPLE_TASK_PROMPT_MAX_LEN,
  normalizeExampleQuestions,
  exampleQuestionsComplete,
  normalizeClaimNotes,
  genExampleQuestions,
  genPositionSop,
  genPositionSopBrief,
  SOP_BRIEF_MAX_LEN
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

describe('人格页签必填要素（2026-09-04 PRD-20260903 对齐新增）', () => {
  it('上限常量与一览表口径一致：描述 2000 / 领用页文案 6×300 / 示例问题 3×300 / SOP 4000 / 自动化任务提示词 8000', () => {
    expect(DESCRIPTION_MAX_LEN).toBe(2000)
    expect(CLAIM_NOTE_MAX).toBe(6)
    expect(CLAIM_NOTE_LEN).toBe(300)
    expect(EXAMPLE_Q_COUNT).toBe(3)
    expect(EXAMPLE_Q_MAX_LEN).toBe(300)
    expect(SOP_MAX_LEN).toBe(4000)
    expect(SAMPLE_TASK_PROMPT_MAX_LEN).toBe(8000) // md §7.4；UI 校验 / 字数计数 / sampleTaskMock 共用（待办 yuepu#19②）
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
  it('AI 生成示例问题：基于描述产出 3 条、每条 ≤300 字、内容含主题词', () => {
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

describe('专家 / 专家团停用确认窗口的影响范围（产品优化需求-202611 R13 §5）', () => {
  it('岗位引用、执行任务两句按实际有无分别出；都没有不出', () => {
    expect(expertUsageImpactText({ positionCount: 2, taskCount: 3 })).toBe('已被 2 个岗位引用，这些岗位再发布前要先移除它；3 条自动化任务由它执行，停用后这些任务将被挂起。')
    expect(expertUsageImpactText({ positionCount: 1, taskCount: 0 })).toBe('已被 1 个岗位引用，这些岗位再发布前要先移除它。')
    // 市场 / 通用专家没被岗位引用，也可能是自动化任务的执行对象
    expect(expertUsageImpactText({ positionCount: 0, taskCount: 1 })).toBe('1 条自动化任务由它执行，停用后这些任务将被挂起。')
    expect(expertUsageImpactText({ positionCount: 0, taskCount: 0 })).toBe('')
    expect(expertUsageImpactText()).toBe('')
  })
})

describe('genPositionSopBrief：按完整版 SOP 生成 SOP 简版（产品优化需求-202611 修改点 18）', () => {
  it('编号步骤式 SOP → 每步取到第一个逗号为止的主干，重新编号', () => {
    const full = '1. 理解用户意图，并结合岗位描述确认任务目标。\n2. 选择所需的技能与工具，必要时补充提问。\n3. 输出结论、依据和后续建议。'
    expect(genPositionSopBrief(full)).toBe('1. 理解用户意图\n2. 选择所需的技能与工具\n3. 输出结论、依据和后续建议')
  })

  it('只有一段文字 → 按句号拆成步骤', () => {
    expect(genPositionSopBrief('先确认需求，再拆分任务。逐项执行并核对。最后汇报结果')).toBe('1. 先确认需求\n2. 逐项执行并核对\n3. 最后汇报结果')
  })

  it('结果不超过 200 字', () => {
    const full = Array.from({ length: 40 }, (_, i) => `${i + 1}. 第${i + 1}步要做的关键动作描述得比较长一些`).join('\n')
    expect(Array.from(genPositionSopBrief(full)).length).toBeLessThanOrEqual(SOP_BRIEF_MAX_LEN)
  })

  it('完整版为空 → 空串', () => {
    expect(genPositionSopBrief('')).toBe('')
  })

  // 生成要求（修改点 18）：保留编号步骤，3–5 步，每步不超过 20 字，全文不超过 200 字
  it('超过 5 步 → 只留 5 步并重新编号，首尾两步必留', () => {
    const full = Array.from({ length: 9 }, (_, i) => `${i + 1}. 动作${i + 1}，补充说明`).join('\n')
    expect(genPositionSopBrief(full)).toBe('1. 动作1\n2. 动作3\n3. 动作5\n4. 动作7\n5. 动作9')
  })

  it('每步不超过 20 字：主干超长的截到 20 字', () => {
    const full = '1. 拉取昨日各业务线营收毛利回款与费用的全部明细数据并按事业部汇总\n2. 输出结论'
    const steps = genPositionSopBrief(full).split('\n').map((l) => l.replace(/^\d+\. /, ''))
    expect(steps[0]).toBe('拉取昨日各业务线营收毛利回款与费用的全部')
    expect(Array.from(steps[0]).length).toBe(20)
    expect(steps[1]).toBe('输出结论')
  })

  it('有编号步骤时只取编号行，标题、引言不进简版；「第 N 步：」前缀去掉', () => {
    const full = '# 经营分析岗 SOP\n\n先读一下背景说明。\n1. 第1步：核对数据口径\n2. 第2步：形成复盘建议'
    expect(genPositionSopBrief(full)).toBe('1. 核对数据口径\n2. 形成复盘建议')
  })

  it('不足 3 步 → 有几步留几步，不凑数', () => {
    expect(genPositionSopBrief('1. 汇总上周数据，形成报告')).toBe('1. 汇总上周数据')
  })
})
