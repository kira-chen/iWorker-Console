// 2026-09-12 测试审计 T35：自 positionModel.test.js 拆出「技能工具引用」主题（parseSkillMdTools / locateToolRefs /
// 健康状态映射 / mergeReferencedView / 数据表整表引用 code；对齐 md 技能 §三 工具引用与岗位 §6.4）。条目原样迁移，断言不改。
import { describe, it, expect } from 'vitest'
import {
  parseSkillMdTools,
  mergeReferencedView,
  isTableLevelToolCode,
  tableLevelCodeOf,
  tableToolOpAliases,
  locateToolRefs,
  removeToolRefs,
  toolRefMarker,
  healthLabel,
  healthClass
} from '@/utils/positionModel'

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
