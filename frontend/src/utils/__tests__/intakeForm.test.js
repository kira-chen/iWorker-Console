import { describe, it, expect } from 'vitest'
import {
  buildIntakeModel,
  isEmptyValue,
  validateIntakeField,
  validateIntakeValues,
  normalizeIntakeValues,
  hasIntakeSchema
} from '@/utils/intakeForm'

// 覆盖 6 类型：默认值初始化 / 字段级校验（必填·类型·选项命中）/ 提交归一。
// 与契约 §5 双校验对齐（前端拦截 + 后端二次校验）。

const schema6 = [
  { key: 'region', label: '负责区域', type: 'single_select', required: true, options: ['华东', '华北'] },
  { key: 'industry', label: '负责行业', type: 'text', required: true, placeholder: '如 快消' },
  { key: 'lines', label: '关注产品线', type: 'multi_select', required: false, options: ['监护仪', '超声'] },
  { key: 'target', label: '月度目标额', type: 'number', required: false },
  { key: 'joinedAt', label: '入职日期', type: 'date', required: false },
  { key: 'note', label: '补充说明', type: 'textarea', required: false }
]

describe('hasIntakeSchema', () => {
  it('空/非数组 → false；非空 → true', () => {
    expect(hasIntakeSchema([])).toBe(false)
    expect(hasIntakeSchema(null)).toBe(false)
    expect(hasIntakeSchema([{ key: 'a' }])).toBe(true)
  })
})

describe('buildIntakeModel · 默认值初始化', () => {
  it('无 existing：用 defaultValue 预填，multi_select 为数组、number 转数字', () => {
    const s = [
      { key: 'r', type: 'single_select', options: ['a', 'b'], defaultValue: 'a' },
      { key: 'm', type: 'multi_select', options: ['x', 'y'], defaultValue: ['x'] },
      { key: 'n', type: 'number', defaultValue: '12' },
      { key: 't', type: 'text' }
    ]
    const m = buildIntakeModel(s)
    expect(m.r).toBe('a')
    expect(m.m).toEqual(['x'])
    expect(m.n).toBe(12)
    expect(m.t).toBe('')
  })

  it('multi_select 无默认值 → 空数组；number 无默认 → null', () => {
    const m = buildIntakeModel([
      { key: 'm', type: 'multi_select', options: [] },
      { key: 'n', type: 'number' }
    ])
    expect(m.m).toEqual([])
    expect(m.n).toBeNull()
  })

  it('改采集值场景：existing 优先回填，覆盖 defaultValue', () => {
    const m = buildIntakeModel(schema6, { region: '华北', lines: ['监护仪'], target: 99 })
    expect(m.region).toBe('华北')
    expect(m.lines).toEqual(['监护仪'])
    expect(m.target).toBe(99)
    expect(m.industry).toBe('') // existing 无 → 空
  })

  it('existing 的 multi_select 非数组单值 → 包成数组', () => {
    const m = buildIntakeModel([{ key: 'm', type: 'multi_select', options: ['a'] }], { m: 'a' })
    expect(m.m).toEqual(['a'])
  })
})

describe('isEmptyValue · 各类型空判定', () => {
  it('multi_select 空数组为空', () => {
    expect(isEmptyValue('multi_select', [])).toBe(true)
    expect(isEmptyValue('multi_select', ['a'])).toBe(false)
  })
  it('number：null/空串/NaN 为空，0 不为空', () => {
    expect(isEmptyValue('number', null)).toBe(true)
    expect(isEmptyValue('number', '')).toBe(true)
    expect(isEmptyValue('number', 'abc')).toBe(true)
    expect(isEmptyValue('number', 0)).toBe(false)
  })
  it('text：空白串为空', () => {
    expect(isEmptyValue('text', '  ')).toBe(true)
    expect(isEmptyValue('text', 'x')).toBe(false)
  })
})

describe('validateIntakeField · 字段级校验', () => {
  it('必填未填 → 拦截', () => {
    expect(validateIntakeField({ type: 'single_select', required: true, options: ['a'] }, '')).toBe('此项为必填')
    expect(validateIntakeField({ type: 'multi_select', required: true, options: ['a'] }, [])).toBe('此项为必填')
  })
  it('非必填且空 → 放行', () => {
    expect(validateIntakeField({ type: 'text', required: false }, '')).toBe('')
  })
  it('单选值须命中 options', () => {
    expect(validateIntakeField({ type: 'single_select', options: ['华东'] }, '西南')).toBe('请选择有效选项')
    expect(validateIntakeField({ type: 'single_select', options: ['华东'] }, '华东')).toBe('')
  })
  it('多选每项须命中 options', () => {
    expect(validateIntakeField({ type: 'multi_select', options: ['a', 'b'] }, ['a', 'c'])).toBe('存在无效选项')
    expect(validateIntakeField({ type: 'multi_select', options: ['a', 'b'] }, ['a', 'b'])).toBe('')
  })
  it('number 合法数字放行；非数字（NaN）视为空，必填时按必填拦截', () => {
    expect(validateIntakeField({ type: 'number' }, 12)).toBe('')
    // 非可解析数字（NaN）→ isEmptyValue 判空：非必填放行
    expect(validateIntakeField({ type: 'number', required: false }, 'abc')).toBe('')
    // 必填 + 非可解析数字（空）→ 必填拦截
    expect(validateIntakeField({ type: 'number', required: true }, 'abc')).toBe('此项为必填')
  })
  it('date 须为 YYYY-MM-DD', () => {
    expect(validateIntakeField({ type: 'date' }, '2024/03/01')).toBe('请选择有效日期')
    expect(validateIntakeField({ type: 'date' }, '2024-03-01')).toBe('')
  })
})

describe('validateIntakeValues · 整表校验', () => {
  it('必填项缺失收集为 errors，ok=false', () => {
    const m = buildIntakeModel(schema6) // region/industry 必填，初值空
    const { ok, errors } = validateIntakeValues(schema6, m)
    expect(ok).toBe(false)
    expect(errors.region).toBeTruthy()
    expect(errors.industry).toBeTruthy()
    expect(errors.note).toBeUndefined()
  })
  it('全部合法 → ok=true，无 errors', () => {
    const m = { region: '华东', industry: '快消', lines: ['监护仪'], target: 12, joinedAt: '2024-03-01', note: '' }
    const { ok, errors } = validateIntakeValues(schema6, m)
    expect(ok).toBe(true)
    expect(Object.keys(errors)).toHaveLength(0)
  })
})

describe('normalizeIntakeValues · 提交归一', () => {
  it('剔除空值、number 转数字、保留 schema 内 key', () => {
    const m = {
      region: '华东',
      industry: '',
      lines: ['监护仪'],
      target: '120',
      joinedAt: '',
      note: '  ',
      __stray: 'x' // schema 外脏字段
    }
    const out = normalizeIntakeValues(schema6, m)
    expect(out).toEqual({ region: '华东', lines: ['监护仪'], target: 120 })
    expect(out.__stray).toBeUndefined()
    expect('industry' in out).toBe(false)
  })
  it('number 0 保留（非空）', () => {
    const out = normalizeIntakeValues([{ key: 'n', type: 'number' }], { n: 0 })
    expect(out.n).toBe(0)
  })
})
