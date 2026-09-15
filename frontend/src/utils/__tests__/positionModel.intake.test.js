// 2026-09-12 测试审计 T35：自 positionModel.test.js 拆出「采集字段」主题（对齐 md 岗位 §3 采集字段页签：
// 类型常量 / key 生成与校验 / {{intake.key}} 占位符 / 提交归一 / 行校验）。条目原样迁移，断言不改。
import { describe, it, expect } from 'vitest'
import {
  INTAKE_TYPES,
  isSelectType,
  isValidIntakeType,
  genKeyFromLabel,
  isValidKey,
  parseIntakePlaceholders,
  normalizeIntakeForSubmit,
  validateIntakeRows
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

describe('parseIntakePlaceholders', () => {
  it('提取 {{intake.key}} 去重', () => {
    const md = '区域 {{intake.region}} 行业 {{intake.industry}} 又 {{intake.region}}'
    expect(parseIntakePlaceholders(md).sort()).toEqual(['industry', 'region'])
  })
  it('无占位符 → 空数组', () => {
    expect(parseIntakePlaceholders('无')).toEqual([])
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
