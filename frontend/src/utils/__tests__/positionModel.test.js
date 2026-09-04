import { describe, it, expect } from 'vitest'
import {
  LIMITS,
  INTAKE_TYPES,
  isSelectType,
  isValidIntakeType,
  genKeyFromLabel,
  isValidKey,
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
  validateVersionLabel,
  versionIncrementHint,
  parseSkillMdTools,
  mergeReferencedView,
  isTableLevelToolCode,
  tableLevelCodeOf,
  tableToolOpAliases,
  locateToolRefs,
  removeToolRefs,
  toolRefMarker,
  parseIntakePlaceholders,
  healthLabel,
  healthClass,
  computePublishCheck,
  normalizeIntakeForSubmit,
  validateIntakeRows,
  normalizePublishWarnings,
  // 2026-09-04 PRD-20260903 对齐新增
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

describe('采集类型常量', () => {
  it('6 类型齐全且 select 判定正确', () => {
    expect(INTAKE_TYPES.length).toBe(6)
    expect(isSelectType('single_select')).toBe(true)
    expect(isSelectType('multi_select')).toBe(true)
    expect(isSelectType('text')).toBe(false)
    expect(isValidIntakeType('date')).toBe(true)
    expect(isValidIntakeType('xxx')).toBe(false)
  })
})

describe('genKeyFromLabel（中文→英文 key）', () => {
  it('常见中文字段名生成拼音 key', () => {
    expect(genKeyFromLabel('负责区域')).toBe('fuzequyu')
    expect(genKeyFromLabel('负责行业')).toBe('fuzehangye')
  })
  it('ASCII 原样小写 + 空格转下划线', () => {
    expect(genKeyFromLabel('Region')).toBe('region')
    expect(genKeyFromLabel('user name')).toBe('user_name')
  })
  it('非字母开头补前缀 f_；空兜底 field', () => {
    expect(genKeyFromLabel('123')).toBe('f_123')
    expect(genKeyFromLabel('')).toBe('')
    expect(genKeyFromLabel('！@#')).toBe('field')
  })
  it('生成结果符合 key 正则', () => {
    expect(isValidKey(genKeyFromLabel('负责区域'))).toBe(true)
    expect(isValidKey(genKeyFromLabel('Region'))).toBe(true)
    expect(isValidKey(genKeyFromLabel('123'))).toBe(true)
  })
})

describe('isValidKey', () => {
  it('小写字母开头，仅小写字母/数字/下划线', () => {
    expect(isValidKey('region')).toBe(true)
    expect(isValidKey('a_1')).toBe(true)
    expect(isValidKey('Region')).toBe(false)
    expect(isValidKey('1abc')).toBe(false)
    expect(isValidKey('')).toBe(false)
  })
})

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
  it('上限常量与新 md 口径一致：描述 500 / 认领说明 6×100 / 示例问题 3×60 / SOP 4000', () => {
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
  it('AI 生成岗位 SOP：编号步骤式短文、≤4000 字、含岗位描述主题词', () => {
    const sop = genPositionSop('经营分析岗', '负责经营数据汇总与分析')
    expect(sop.startsWith('1. ')).toBe(true)
    expect(sop).toContain('负责经营数据汇总与分析')
    expect(sop.split('\n').length).toBeGreaterThanOrEqual(4)
    expect(sop.length).toBeLessThanOrEqual(SOP_MAX_LEN)
  })
})

describe('展示版本号（2026-09-02 起语义化 vX.Y.Z，取代旧 v001~v999 口径）', () => {
  it('合法 vX.Y.Z 通过；非法给样例报错', () => {
    expect(validateVersionLabel('v1.2.0')).toBeNull()
    expect(validateVersionLabel('v0.0.1')).toBeNull()
    expect(validateVersionLabel('v10.20.30')).toBeNull()
    // 空 / 旧三位数字格式 / 残段 / 无 v 前缀 均被拦，且报错含正确样例
    for (const bad of ['', 'v013', 'v1', 'v1.2', '1.2.0', 'vabc', 'v1.2.x']) {
      const err = validateVersionLabel(bad)
      expect(err).toBeTruthy()
      expect(err).toContain('v1.2.0')
    }
  })
  it('小于等于历史最大 → 建议递增软提示（不阻断）；递增则空串', () => {
    expect(versionIncrementHint('v1.1.0', 'v1.2.0')).toContain('v1.2.0')
    expect(versionIncrementHint('v1.2.0', 'v1.2.0')).toContain('未递增') // 等于也提示
    expect(versionIncrementHint('v1.2.1', 'v1.2.0')).toBe('') // 已递增无提示
    expect(versionIncrementHint('v2.0.0', 'v1.9.3')).toBe('') // 主版本跳档已递增
    expect(versionIncrementHint('v1.2.0', '')).toBe('') // 无历史不提示
  })
})

describe('parseSkillMdTools（去重解析工具引用）', () => {
  it('解析 :::tool{code=x} 与 @tool[x] 并去重计数', () => {
    const md = '查重 :::tool{code=crm_query}\n写入 :::tool{code=crm_update}\n再查 @tool[crm_query]'
    const refs = parseSkillMdTools(md)
    const map = Object.fromEntries(refs.map((r) => [r.code, r.count]))
    expect(map.crm_query).toBe(2)
    expect(map.crm_update).toBe(1)
    expect(refs.length).toBe(2)
  })
  it('容忍 block 内空格', () => {
    expect(parseSkillMdTools(':::tool{ code = a_b }')[0].code).toBe('a_b')
  })
  it('空 / 无引用 → 空数组', () => {
    expect(parseSkillMdTools('')).toEqual([])
    expect(parseSkillMdTools('纯文本无引用')).toEqual([])
  })
  it('遮罩代码区：围栏块 / 行内代码 / frontmatter 内的工具标记不计入（与后端 CodeRegionMask 一致，CR-P0）', () => {
    // 围栏代码块里的示例 @tool[x] 不应被统计
    expect(parseSkillMdTools('正文 @tool[real_one]\n```\n示例 @tool[in_code]\n```')).toEqual([
      { code: 'real_one', count: 1 }
    ])
    // 行内代码里的 @tool[x] 不计
    expect(parseSkillMdTools('用 `@tool[in_inline]` 表示，真引用 @tool[real_two]')).toEqual([
      { code: 'real_two', count: 1 }
    ])
    // frontmatter 内的工具标记不计（后端遮罩 frontmatter）
    expect(parseSkillMdTools('---\nnote: @tool[in_fm]\n---\n正文 @tool[real_three]')).toEqual([
      { code: 'real_three', count: 1 }
    ])
  })
  it('非法 code（大写/冒号）不计入（字符集与后端 [a-z][a-z0-9_]* 一致，CR-P1）', () => {
    expect(parseSkillMdTools('@tool[GetWeather] @tool[ns:tool] @tool[ok_one]')).toEqual([
      { code: 'ok_one', count: 1 }
    ])
  })
})

describe('locateToolRefs / removeToolRefs（多处引用定位与全删）', () => {
  const md = '第一行 :::tool{code=crm}\n中间\n第三行 :::tool{code=crm} 还有 @tool[crm]'
  it('定位每处引用的行号', () => {
    const locs = locateToolRefs(md, 'crm')
    expect(locs.map((l) => l.line)).toEqual([1, 3])
  })
  it('全删某 code 的所有标记', () => {
    const out = removeToolRefs(md, 'crm')
    expect(out).not.toContain(':::tool{code=crm}')
    expect(out).not.toContain('@tool[crm]')
    expect(parseSkillMdTools(out)).toEqual([])
  })
  it('toolRefMarker 生成行内形态 @tool[x]（已收敛单一行内，CR）', () => {
    expect(toolRefMarker('x')).toBe('@tool[x]')
  })
})

describe('parseIntakePlaceholders', () => {
  it('提取 {{intake.key}} 去重', () => {
    const md = '区域 {{intake.region}} 行业 {{intake.industry}} 又 {{intake.region}}'
    expect(parseIntakePlaceholders(md).sort()).toEqual(['industry', 'region'])
  })
  it('无占位符 → 空数组', () => {
    expect(parseIntakePlaceholders('无')).toEqual([])
  })
})

describe('健康状态四态中文映射', () => {
  it('HEALTHY/UNHEALTHY/DISABLED/UNKNOWN', () => {
    // 文案对齐 PRD-20260828 连接器（2026-09-01）：连接正常 / 连接异常 / 未探测
    expect(healthLabel('HEALTHY')).toBe('连接正常')
    expect(healthLabel('UNHEALTHY')).toBe('连接异常')
    expect(healthLabel('DISABLED')).toBe('已停用')
    expect(healthLabel('UNKNOWN')).toBe('未探测')
  })
  it('未知状态兜底未探测', () => {
    expect(healthLabel('XXX')).toBe('未探测')
    expect(healthClass(undefined)).toBe('unknown')
  })
  it('class 映射', () => {
    expect(healthClass('HEALTHY')).toBe('ok')
    expect(healthClass('UNHEALTHY')).toBe('bad')
    expect(healthClass('DISABLED')).toBe('off')
  })
})

describe('normalizePublishWarnings（发布告警归一，契约 §1.6.1）', () => {
  it('归一并单列 unhealthy_tool 类', () => {
    const w = normalizePublishWarnings([
      { type: 'unhealthy_tool', message: 'CRM 查询当前异常', detail: 'crm_query' },
      { type: 'intake_placeholder', message: '第 1 处 {{intake.xx}} 无对应采集字段' }
    ])
    expect(w.count).toBe(2)
    expect(w.unhealthy).toHaveLength(1)
    expect(w.unhealthy[0].label).toBe('引用了异常工具')
    expect(w.items[1].label).toBe('占位符无对应采集字段')
  })
  it('未知 type → 通用「提示」标签', () => {
    const w = normalizePublishWarnings([{ type: 'weird', message: 'x' }])
    expect(w.items[0].label).toBe('提示')
    expect(w.unhealthy).toHaveLength(0)
  })
  it('空 / 非数组安全返回', () => {
    expect(normalizePublishWarnings()).toEqual({ items: [], unhealthy: [], count: 0 })
    expect(normalizePublishWarnings(null).count).toBe(0)
    expect(normalizePublishWarnings('x').count).toBe(0)
  })
})

describe('computePublishCheck（发布前检查）', () => {
  // 2026-09-04 PRD-20260903 对齐：原 N4「推荐问题 4 条」项改为「示例问题 3 条」（key=exampleQuestions），
  // 本组断言按新口径重写。
  it('全满足 → blockingPassed=true', () => {
    const c = computePublishCheck({
      name: '销售',
      agents: [{ name: 'A', skills: [{ skillId: 1 }] }],
      intakeSchema: [{ type: 'single_select', options: ['a'] }],
      exampleQuestions: ['q1', 'q2', 'q3']
    })
    expect(c.blockingPassed).toBe(true)
    expect(c.doneRatio).toBe(1)
  })
  it('示例问题半填（少 1 条）→ 硬阻断', () => {
    const c = computePublishCheck({
      name: '销售',
      agents: [{ name: 'A', skills: [{ skillId: 1 }] }],
      intakeSchema: [{ type: 'single_select', options: ['a'] }],
      exampleQuestions: ['q1', 'q2', '']
    })
    const item = c.items.find((i) => i.key === 'exampleQuestions')
    expect(item.blocking).toBe(true)
    expect(item.ok).toBe(false)
    expect(c.blockingPassed).toBe(false)
  })
  it('示例问题缺字段（未传）→ 硬阻断', () => {
    const c = computePublishCheck({
      name: '销售',
      agents: [{ name: 'A', skills: [{ skillId: 1 }] }]
    })
    expect(c.items.find((i) => i.key === 'exampleQuestions').ok).toBe(false)
    expect(c.blockingPassed).toBe(false)
  })
  it('示例问题 3 条全填 → 该项通过', () => {
    const c = computePublishCheck({
      name: '销售',
      agents: [{ name: 'A', skills: [{ skillId: 1 }] }],
      exampleQuestions: ['帮我查', '帮我生成', '最近']
    })
    expect(c.items.find((i) => i.key === 'exampleQuestions').ok).toBe(true)
  })
  it('缺岗位名 → 阻断', () => {
    const c = computePublishCheck({ name: '', agents: [{ name: 'A', skills: [{ skillId: 1 }] }] })
    expect(c.blockingPassed).toBe(false)
    expect(c.items.find((i) => i.key === 'name').ok).toBe(false)
  })
  it('空 Agent → 阻断且列出空 Agent 名', () => {
    const c = computePublishCheck({ name: 'x', agents: [{ name: '空组', skills: [] }] })
    const item = c.items.find((i) => i.key === 'agents')
    expect(item.ok).toBe(false)
    expect(item.detail).toContain('空组')
  })
  it('单/多选无选项 → 阻断', () => {
    const c = computePublishCheck({
      name: 'x',
      agents: [{ name: 'A', skills: [{ skillId: 1 }] }],
      intakeSchema: [{ type: 'single_select', label: '区域', options: [] }]
    })
    expect(c.items.find((i) => i.key === 'intake').ok).toBe(false)
  })
  it('异常工具 → warning 不阻断（收纳区退役：不再有「未绑定技能」warning）', () => {
    const c = computePublishCheck({
      name: 'x',
      agents: [{ name: 'A', skills: [{ skillId: 1 }] }],
      exampleQuestions: ['q1', 'q2', 'q3'],
      // orphanSkills 已退役：即便传入也不应产生 warning（删 Agent 后技能脱离岗位、不属本岗位）。
      orphanSkills: [{ skillId: 9 }],
      unhealthyTools: ['crm']
    })
    expect(c.blockingPassed).toBe(true)
    // 仅异常工具 1 条 warning（未绑定技能 warning 已删除）。
    expect(c.warnings.length).toBe(1)
    expect(c.warnings.find((w) => w.key === 'orphan')).toBeUndefined()
  })
  it('无 Agent → 阻断', () => {
    const c = computePublishCheck({ name: 'x', agents: [] })
    expect(c.items.find((i) => i.key === 'agents').ok).toBe(false)
  })
})

describe('normalizeIntakeForSubmit', () => {
  it('过滤空 label，自动补 key / sortOrder，select 带 options', () => {
    const rows = [
      { label: '负责区域', type: 'single_select', required: true, options: ['华东', ''] },
      { label: '', type: 'text' },
      { label: '备注', type: 'text', placeholder: '可空', key: 'note' }
    ]
    const out = normalizeIntakeForSubmit(rows)
    expect(out.length).toBe(2)
    expect(out[0].key).toBe('fuzequyu')
    expect(out[0].options).toEqual(['华东'])
    expect(out[0].sortOrder).toBe(0)
    expect(out[1].key).toBe('note')
    expect(out[1].placeholder).toBe('可空')
  })
  it('非法 type 兜底 text', () => {
    expect(normalizeIntakeForSubmit([{ label: 'x', type: 'bad' }])[0].type).toBe('text')
  })
})

describe('validateIntakeRows', () => {
  it('合法行 → ok', () => {
    const { ok } = validateIntakeRows([{ label: '区域', type: 'text' }])
    expect(ok).toBe(true)
  })
  it('空 label / 非法 key / 单选无选项 / key 重复 → 报错', () => {
    const r1 = validateIntakeRows([{ label: '', type: 'text' }])
    expect(r1.ok).toBe(false)
    expect(r1.errors[0].label).toBeTruthy()

    const r2 = validateIntakeRows([{ label: 'x', key: 'Bad', type: 'text' }])
    expect(r2.errors[0].key).toBeTruthy()

    const r3 = validateIntakeRows([{ label: '区域', type: 'single_select', options: [] }])
    expect(r3.errors[0].options).toBeTruthy()

    const r4 = validateIntakeRows([
      { label: '区域', key: 'region', type: 'text' },
      { label: '地区', key: 'region', type: 'text' }
    ])
    expect(r4.ok).toBe(false)
    expect(r4.errors[0].key || r4.errors[1].key).toBeTruthy()
  })
})

describe('mergeReferencedView（左栏已引用工具合并 + 优先级回落护栏）', () => {
  const parsed = [{ code: 'crm_query', count: 1 }]

  it('① 回显有 bizName 时优先用回显（即使本地插入名不同）', () => {
    const view = mergeReferencedView(
      parsed,
      { crm_query: { checkStatus: 'HEALTHY', requiresConfirmation: false, bizName: '回显名' } },
      { crm_query: '本地名' }
    )
    expect(view[0].bizName).toBe('回显名')
    expect(view[0].known).toBe(true)
    expect(view[0].checkStatus).toBe('HEALTHY')
  })

  it('② 回显无、本地插入名有时用本地名（消除「先 code 后中文」闪现的核心场景）', () => {
    const view = mergeReferencedView(parsed, {}, { crm_query: '本地名' })
    expect(view[0].bizName).toBe('本地名')
    expect(view[0].known).toBe(false) // 不在回显 map → 未知
    expect(view[0].checkStatus).toBe('UNKNOWN') // 无回显 → 占位
  })

  it('③ 回显与本地都无 → bizName 回落空（模板再回落 code）、known=false', () => {
    const view = mergeReferencedView(parsed, {}, {})
    expect(view[0].bizName).toBe('')
    expect(view[0].known).toBe(false)
  })

  it('④ count 透传 + requiresConfirmation/known 标记正确', () => {
    const view = mergeReferencedView(
      [{ code: 'crm_del', count: 3 }],
      { crm_del: { checkStatus: 'UNHEALTHY', requiresConfirmation: true, bizName: '删除客户' } },
      {}
    )
    expect(view[0].count).toBe(3)
    expect(view[0].requiresConfirmation).toBe(true)
    expect(view[0].known).toBe(true)
    expect(view[0].checkStatus).toBe('UNHEALTHY')
  })

  it('空/异常入参不抛错', () => {
    expect(mergeReferencedView(null, null, null)).toEqual([])
    expect(mergeReferencedView(undefined, undefined, undefined)).toEqual([])
  })

  it('⑤ 整表收敛：存量操作级 table__X__op 聚合为一行表级条目（count 合计、codes 记成员、表名展示）', () => {
    const view = mergeReferencedView(
      [
        { code: 'table__crm__query', count: 2 },
        { code: 'crm_query', count: 1 },
        { code: 'table__crm__update', count: 1 }
      ],
      // 回显归一为表级 + tableToolOpAliases 派生的操作级别名（bizName=表名）
      {
        table__crm: { checkStatus: 'HEALTHY', requiresConfirmation: true, bizName: '客户交互记录表' },
        table__crm__query: { checkStatus: 'HEALTHY', requiresConfirmation: false, bizName: '客户交互记录表' },
        table__crm__update: { checkStatus: 'HEALTHY', requiresConfirmation: true, bizName: '客户交互记录表' }
      },
      {}
    )
    expect(view).toHaveLength(2)
    const tableRow = view.find((r) => r.code === 'table__crm')
    expect(tableRow.count).toBe(3) // 2 + 1 合计
    expect(tableRow.codes).toEqual(['table__crm__query', 'table__crm__update'])
    expect(tableRow.bizName).toBe('客户交互记录表') // 表名，无「· 操作」
    expect(tableRow.known).toBe(true)
    // 非数据表 code 原样一行，codes=[code]
    const plain = view.find((r) => r.code === 'crm_query')
    expect(plain.codes).toEqual(['crm_query'])
    expect(plain.count).toBe(1)
  })
})

describe('数据表整表引用 code（表级 table__<tableCode>）', () => {
  it('isTableLevelToolCode：表级命中，操作级/非数据表/空 → false', () => {
    expect(isTableLevelToolCode('table__crm')).toBe(true)
    expect(isTableLevelToolCode('table__ke_hu_jiao_hu_ji_lu_biao')).toBe(true) // 单下划线合法
    expect(isTableLevelToolCode('table__crm__query')).toBe(false) // 操作级
    expect(isTableLevelToolCode('crm_query')).toBe(false)
    expect(isTableLevelToolCode('table__')).toBe(false)
    expect(isTableLevelToolCode('')).toBe(false)
    expect(isTableLevelToolCode(null)).toBe(false)
  })

  it('tableToolOpAliases：表级 code 派生 4 个操作级展示别名（整表收敛：展示名一律为表名，无操作后缀）', () => {
    const aliases = tableToolOpAliases('table__crm', '客户表')
    expect(aliases.map((a) => a.code)).toEqual([
      'table__crm__create',
      'table__crm__query',
      'table__crm__update',
      'table__crm__delete'
    ])
    expect(aliases.map((a) => a.bizName)).toEqual(['客户表', '客户表', '客户表', '客户表'])
  })

  it('tableToolOpAliases：非表级 code / 空 → 空数组；无 bizName 回落 code', () => {
    expect(tableToolOpAliases('table__crm__query', '客户表')).toEqual([])
    expect(tableToolOpAliases('crm_query', 'x')).toEqual([])
    expect(tableToolOpAliases(null, null)).toEqual([])
    expect(tableToolOpAliases('table__crm', '')[0].bizName).toBe('table__crm')
  })

  it('tableLevelCodeOf：操作级 → 表级；表级/非数据表/空 → null', () => {
    expect(tableLevelCodeOf('table__crm__query')).toBe('table__crm')
    expect(tableLevelCodeOf('table__crm__delete')).toBe('table__crm')
    expect(tableLevelCodeOf('table__crm')).toBeNull() // 表级本身
    expect(tableLevelCodeOf('table__crm__export')).toBeNull() // 非 4 类操作
    expect(tableLevelCodeOf('crm_query')).toBeNull()
    expect(tableLevelCodeOf('')).toBeNull()
    expect(tableLevelCodeOf(null)).toBeNull()
  })
})
