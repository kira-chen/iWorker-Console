// 2026-09-12 测试审计 T35：自 positionModel.test.js 拆出「发布」主题（对齐 md 岗位 §3.7 版本号 / §9.1 阻断校验 /
// §9.2 发布前检查弹窗）：版本号校验 / 发布告警归一 / computePublishCheck / computeCompletenessMissing / agentsWithSkillOk。条目原样迁移，断言不改。
// 2026-09-21 负责人拍板：领用页文案必填（至少 1 条）、岗位图标必填，阻断项由六项扩为八项，夹具与断言随之补齐。
import { describe, it, expect } from 'vitest'
import {
  validateVersionLabel,
  versionIncrementHint,
  computePublishCheck,
  computeCompletenessMissing,
  claimNotesComplete,
  agentsWithSkillOk,
  normalizePublishWarnings
} from '@/utils/positionModel'

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
  // 2026-09-09 PRD 复核·G1（A1 / Q11 负责人新决策）：阻断项由 4 项扩到 md §9.1 六项——
  // 岗位名称 / 岗位描述 / 示例问题 3 条 / 岗位 SOP / Agent 与技能（≥1 Agent 且该 Agent ≥1 技能）/
  // 自动化任务（≥1 条）。此前「Agent 与技能仅警告不阻断」的口径已被推翻。
  // 2026-09-21 负责人拍板再追加岗位图标（已选择）、领用页文案（≥1 条）→ 八项。
  const FULL = {
    name: '销售',
    icon: '▤',
    description: '负责销售',
    claimDescriptions: ['自动汇总经营数据'],
    positionSop: '1. 先看数据',
    exampleQuestions: ['q1', 'q2', 'q3'],
    agents: [{ name: 'A', skills: [{ skillId: 1 }] }],
    sampleTaskCount: 1
  }
  it('八项全满足 → blockingPassed=true；清单七行标签与文案', () => {
    const c = computePublishCheck({ ...FULL })
    expect(c.blockingPassed).toBe(true)
    expect(c.doneRatio).toBe(1)
    expect(c.items.map((i) => i.label)).toEqual(['岗位名称与描述', '岗位图标', '领用页文案', '示例问题', '岗位 SOP', 'Agent 与技能', '自动化任务'])
    expect(c.items.map((i) => i.detail)).toEqual([
      '必填内容已填写', '岗位图标已选择', '领用页文案已填写', '3 条示例问题已填写', '岗位能力综述已填写', '已配置 Agent 与技能', '已配置 1 条自动化任务'
    ])
    expect(c.warnings).toEqual([]) // 无未验证工具 → 不出「存在告警项」提示行
    expect(c.items.every((i) => i.blocking)).toBe(true) // 七行全为阻断项
  })
  it('岗位图标缺（空串 / 未传 / 纯空白）→ 硬阻断（2026-09-21 负责人拍板：图标必填）', () => {
    for (const icon of ['', undefined, '   ']) {
      const c = computePublishCheck({ ...FULL, icon })
      const item = c.items.find((i) => i.key === 'icon')
      expect(item.blocking).toBe(true)
      expect(item.ok).toBe(false)
      expect(item.detail).toBe('请先选择岗位图标')
      expect(c.blockingPassed).toBe(false)
    }
  })
  it('领用页文案缺（空数组 / 未传 / 只有空白条）→ 硬阻断（2026-09-21 负责人拍板：必填至少 1 条）', () => {
    for (const claimDescriptions of [[], undefined, ['', '   ']]) {
      const c = computePublishCheck({ ...FULL, claimDescriptions })
      const item = c.items.find((i) => i.key === 'claimDescriptions')
      expect(item.blocking).toBe(true)
      expect(item.ok).toBe(false)
      expect(item.detail).toBe('请先填写领用页文案（至少 1 条）')
      expect(c.blockingPassed).toBe(false)
    }
  })
  it('领用页文案只要有 1 条非空即通过（不要求填满 6 条）', () => {
    const c = computePublishCheck({ ...FULL, claimDescriptions: ['', '第二条有内容'] })
    expect(c.items.find((i) => i.key === 'claimDescriptions').ok).toBe(true)
    expect(c.blockingPassed).toBe(true)
  })
  it('示例问题半填（少 1 条）→ 硬阻断', () => {
    const c = computePublishCheck({ ...FULL, exampleQuestions: ['q1', 'q2', ''] })
    const item = c.items.find((i) => i.key === 'exampleQuestions')
    expect(item.blocking).toBe(true)
    expect(item.ok).toBe(false)
    expect(c.blockingPassed).toBe(false)
  })
  it('示例问题缺字段（未传）→ 硬阻断', () => {
    const c = computePublishCheck({ ...FULL, exampleQuestions: undefined })
    expect(c.items.find((i) => i.key === 'exampleQuestions').ok).toBe(false)
    expect(c.blockingPassed).toBe(false)
  })
  it('示例问题 3 条全填 → 该项通过', () => {
    const c = computePublishCheck({ ...FULL, exampleQuestions: ['帮我查', '帮我生成', '最近'] })
    expect(c.items.find((i) => i.key === 'exampleQuestions').ok).toBe(true)
  })
  it('缺岗位名 / 缺描述 → 「岗位名称与描述」阻断并点名缺项', () => {
    let c = computePublishCheck({ ...FULL, name: '' })
    expect(c.blockingPassed).toBe(false)
    expect(c.items.find((i) => i.key === 'name').ok).toBe(false)
    expect(c.items.find((i) => i.key === 'name').detail).toBe('请先填写：岗位名称')
    c = computePublishCheck({ ...FULL, description: '' })
    expect(c.items.find((i) => i.key === 'name').detail).toBe('请先填写：岗位描述')
  })
  it('缺岗位 SOP → 阻断', () => {
    const c = computePublishCheck({ ...FULL, positionSop: '  ' })
    expect(c.items.find((i) => i.key === 'sop').ok).toBe(false)
    expect(c.blockingPassed).toBe(false)
  })
  it('空 Agent / Agent 无技能 → 阻断（md §6.5 / §9.1 第 7 条，2026-09-09 Q11 新决策）', () => {
    for (const agents of [[], undefined, [{ name: '空组', skills: [] }]]) {
      const c = computePublishCheck({ ...FULL, agents })
      expect(c.blockingPassed).toBe(false)
      const item = c.items.find((i) => i.key === 'agents')
      expect(item.blocking).toBe(true)
      expect(item.ok).toBe(false)
      expect(item.detail).toBe('至少配置 1 个 Agent，且该 Agent 至少引用 1 个技能')
    }
  })
  it('多 Agent 中只要有一个带技能即通过（md 用「该 Agent」单数指代，非「每个 Agent」）', () => {
    const c = computePublishCheck({ ...FULL, agents: [{ name: '空组', skills: [] }, { name: 'B', skills: [{ skillId: 2 }] }] })
    expect(c.items.find((i) => i.key === 'agents').ok).toBe(true)
    expect(c.blockingPassed).toBe(true)
  })
  it('自动化任务 0 条 → 阻断（md §7.9 / §9.1 第 8 条）', () => {
    for (const sampleTaskCount of [0, undefined]) {
      const c = computePublishCheck({ ...FULL, sampleTaskCount })
      expect(c.blockingPassed).toBe(false)
      const item = c.items.find((i) => i.key === 'sampleTasks')
      expect(item.blocking).toBe(true)
      expect(item.ok).toBe(false)
      expect(item.detail).toBe('至少配置 1 条自动化任务')
    }
  })
  it('单/多选无选项 → 不再是发布清单项（md §3.4 采集字段不参与发布阻断；抽屉保存时另拦）', () => {
    const c = computePublishCheck({ ...FULL, intakeSchema: [{ type: 'single_select', label: '区域', options: [] }] })
    expect(c.items.find((i) => i.key === 'intake')).toBeUndefined()
    expect(c.blockingPassed).toBe(true)
  })
  it('异常工具 → Agent 与技能行附注「存在 X 个工具未验证，不阻断发布」并计入 warnings（工具异常本身不阻断）', () => {
    const c = computePublishCheck({
      ...FULL,
      // orphanSkills 已退役：即便传入也不应产生 warning（删 Agent 后技能脱离岗位、不属本岗位）。
      orphanSkills: [{ skillId: 9 }],
      unhealthyTools: ['crm']
    })
    expect(c.blockingPassed).toBe(true) // Agent 与技能已配齐 → 阻断项通过；未验证工具只是告警
    expect(c.warnings.length).toBe(1)
    expect(c.warnings[0].key).toBe('agents')
    expect(c.warnings[0].detail).toBe('已配置 Agent 与技能；存在 1 个工具未验证，不阻断发布')
    expect(c.warnings.find((w) => w.key === 'orphan')).toBeUndefined()
  })
})

describe('computeCompletenessMissing（md §9.1 八项完整性校验 · 保存与发布共用）', () => {
  // 2026-09-09 PRD 复核·G1（A1 / Q11）：【发布岗位】按此数组硬阻断并定位页签；【保存】按同一数组出提示条不阻断。
  // 2026-09-21 负责人拍板：追加岗位图标（第 2 项）、领用页文案（第 4 项），均在人格页签。
  const FULL = {
    name: '销售', icon: '▤', description: '负责销售', claimDescriptions: ['自动汇总经营数据'], positionSop: '1. 先看数据',
    exampleQuestions: ['q1', 'q2', 'q3'],
    agents: [{ name: 'A', skills: [{ skillId: 1 }] }],
    sampleTaskCount: 2
  }
  it('八项齐备 → 空数组', () => {
    expect(computeCompletenessMissing(FULL)).toEqual([])
  })
  it('全空 → 八项按 md 列举顺序全部返回，且各带所在页签', () => {
    const miss = computeCompletenessMissing({})
    expect(miss.map((i) => i.label)).toEqual(['岗位名称', '岗位图标', '岗位描述', '领用页文案', '3 条示例问题', '岗位 SOP', 'Agent 与技能', '自动化任务'])
    expect(miss.map((i) => i.tab)).toEqual(['persona', 'persona', 'persona', 'persona', 'persona', 'persona', 'agents', 'tasks'])
  })
  it('逐项缺失只报该项', () => {
    expect(computeCompletenessMissing({ ...FULL, name: '  ' }).map((i) => i.key)).toEqual(['name'])
    expect(computeCompletenessMissing({ ...FULL, icon: '' }).map((i) => i.key)).toEqual(['icon'])
    expect(computeCompletenessMissing({ ...FULL, icon: '  ' }).map((i) => i.key)).toEqual(['icon'])
    expect(computeCompletenessMissing({ ...FULL, description: '' }).map((i) => i.key)).toEqual(['description'])
    expect(computeCompletenessMissing({ ...FULL, claimDescriptions: [] }).map((i) => i.key)).toEqual(['claimDescriptions'])
    expect(computeCompletenessMissing({ ...FULL, claimDescriptions: ['  '] }).map((i) => i.key)).toEqual(['claimDescriptions'])
    expect(computeCompletenessMissing({ ...FULL, exampleQuestions: ['q1', '', 'q3'] }).map((i) => i.key)).toEqual(['exampleQuestions'])
    expect(computeCompletenessMissing({ ...FULL, positionSop: '' }).map((i) => i.key)).toEqual(['positionSop'])
    expect(computeCompletenessMissing({ ...FULL, agents: [{ name: '空组', skills: [] }] }).map((i) => i.key)).toEqual(['agents'])
    expect(computeCompletenessMissing({ ...FULL, sampleTaskCount: 0 }).map((i) => i.key)).toEqual(['sampleTasks'])
  })
  it('与 computePublishCheck 口径一致：missing 为空 ⇔ blockingPassed', () => {
    expect(computePublishCheck(FULL).blockingPassed).toBe(computeCompletenessMissing(FULL).length === 0)
    const partial = { ...FULL, sampleTaskCount: 0 }
    expect(computePublishCheck(partial).blockingPassed).toBe(computeCompletenessMissing(partial).length === 0)
  })
})

describe('claimNotesComplete（领用页文案必填：至少 1 条非空）', () => {
  it('空 / 非数组 / 全空白 → false；任一条有内容 → true', () => {
    expect(claimNotesComplete()).toBe(false)
    expect(claimNotesComplete(null)).toBe(false)
    expect(claimNotesComplete([])).toBe(false)
    expect(claimNotesComplete(['', '  ', null])).toBe(false)
    expect(claimNotesComplete(['', '有内容'])).toBe(true)
  })
})

describe('agentsWithSkillOk（md §9.1 第 7 条）', () => {
  it('无 Agent / 非数组 / Agent 全无技能 → false；任一 Agent 有技能 → true', () => {
    expect(agentsWithSkillOk()).toBe(false)
    expect(agentsWithSkillOk([])).toBe(false)
    expect(agentsWithSkillOk([{ skills: [] }, { skills: null }])).toBe(false)
    expect(agentsWithSkillOk([{ skills: [] }, { skills: [{ skillId: 1 }] }])).toBe(true)
  })
})
