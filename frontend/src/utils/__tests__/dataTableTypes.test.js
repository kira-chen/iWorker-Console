import { describe, it, expect } from 'vitest'
import {
  DATA_FIELD_TYPES,
  isValidFieldType,
  fieldTypeLabel,
  defaultValueControl,
  validateDefaultValue,
  validateFields,
  validateTableMeta,
  normalizeFieldForSubmit
} from '@/utils/dataTableTypes'

describe('唯一 ID（主键）', () => {
  it('至多一个、类型限短文本 / 整数、提交时强制必填', () => {
    const rows = [
      { label: 'a', fieldType: 'TEXT', isPrimary: true },
      { label: 'b', fieldType: 'INTEGER', isPrimary: true },
      { label: 'c', fieldType: 'DECIMAL', isPrimary: true }
    ]
    const r = validateFields(rows)
    expect(r.errors.rows[1].isPrimary).toContain('只能指定一个')
    expect(r.errors.rows[2].isPrimary).toBeTruthy()
    expect(normalizeFieldForSubmit({ label: 'a', fieldType: 'TEXT', isPrimary: true, required: false }).required).toBe(true)
    expect(normalizeFieldForSubmit({ label: 'a', fieldType: 'TEXT' }).isPrimary).toBe(false)
  })
})

describe('字段类型常量', () => {
  it('7 类：6 基础类 + ENUM（工作档案「标签」卡位取值范围），不含 DATETIME', () => {
    const vals = DATA_FIELD_TYPES.map((t) => t.value)
    expect(vals).toEqual(['TEXT', 'LONGTEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATE', 'ENUM'])
    expect(vals).not.toContain('DATETIME')
  })
  it('isValidFieldType', () => {
    expect(isValidFieldType('TEXT')).toBe(true)
    expect(isValidFieldType('DATETIME')).toBe(false)
  })
  it('label 为业务白话、不暴露裸英文类型名；布尔称「是/否」', () => {
    const byVal = DATA_FIELD_TYPES.reduce((m, t) => ((m[t.value] = t), m), {})
    expect(byVal.TEXT.label).toBe('短文本')
    expect(byVal.LONGTEXT.label).toBe('长文本')
    expect(byVal.INTEGER.label).toBe('整数')
    expect(byVal.DECIMAL.label).toBe('小数')
    expect(byVal.BOOLEAN.label).toBe('是/否')
    expect(byVal.DATE.label).toBe('日期')
    // 不应把底层英文类型名塞进 label 给用户看
    DATA_FIELD_TYPES.forEach((t) => {
      expect(t.label).not.toContain(t.value)
      expect(t.hint).toBeTruthy()
    })
  })
})

describe('fieldTypeLabel 类型 → 中文 label', () => {
  it('已知类型转中文 label', () => {
    expect(fieldTypeLabel('TEXT')).toBe('短文本')
    expect(fieldTypeLabel('BOOLEAN')).toBe('是/否')
    expect(fieldTypeLabel('DATE')).toBe('日期')
  })
  it('未知类型原样回显 String(type)', () => {
    expect(fieldTypeLabel('XXX')).toBe('XXX')
  })
  it('null / undefined 不抛错，回退为空串', () => {
    expect(() => fieldTypeLabel(null)).not.toThrow()
    expect(fieldTypeLabel(null)).toBe('')
    expect(fieldTypeLabel(undefined)).toBe('')
  })
})

describe('defaultValueControl 控件映射', () => {
  it('类型 → 控件', () => {
    expect(defaultValueControl('TEXT')).toBe('text')
    expect(defaultValueControl('LONGTEXT')).toBe('textarea')
    expect(defaultValueControl('INTEGER')).toBe('integer')
    expect(defaultValueControl('DECIMAL')).toBe('decimal')
    expect(defaultValueControl('BOOLEAN')).toBe('boolean')
    expect(defaultValueControl('DATE')).toBe('date')
  })
  it('未知类型退化为 text', () => {
    expect(defaultValueControl('XXX')).toBe('text')
  })
})

describe('validateDefaultValue 默认值相容', () => {
  it('空值一律放行', () => {
    expect(validateDefaultValue('INTEGER', null)).toBeNull()
    expect(validateDefaultValue('INTEGER', '')).toBeNull()
    expect(validateDefaultValue('DATE', undefined)).toBeNull()
  })
  it('INTEGER', () => {
    expect(validateDefaultValue('INTEGER', '10')).toBeNull()
    expect(validateDefaultValue('INTEGER', '-3')).toBeNull()
    expect(validateDefaultValue('INTEGER', '1.5')).toBeTruthy()
    expect(validateDefaultValue('INTEGER', 'abc')).toBeTruthy()
  })
  it('DECIMAL', () => {
    expect(validateDefaultValue('DECIMAL', '1.5')).toBeNull()
    expect(validateDefaultValue('DECIMAL', '10')).toBeNull()
    expect(validateDefaultValue('DECIMAL', 'x')).toBeTruthy()
  })
  it('BOOLEAN 仅 true/false', () => {
    expect(validateDefaultValue('BOOLEAN', 'true')).toBeNull()
    expect(validateDefaultValue('BOOLEAN', 'false')).toBeNull()
    expect(validateDefaultValue('BOOLEAN', '1')).toBeTruthy()
  })
  it('DATE YYYY-MM-DD', () => {
    expect(validateDefaultValue('DATE', '2026-06-01')).toBeNull()
    expect(validateDefaultValue('DATE', '2026/06/01')).toBeTruthy()
    expect(validateDefaultValue('DATE', '2026-13-40')).toBeTruthy()
  })
  it('TEXT/LONGTEXT 不约束', () => {
    expect(validateDefaultValue('TEXT', '任意文本')).toBeNull()
    expect(validateDefaultValue('LONGTEXT', '段落')).toBeNull()
  })
})

describe('validateFields 整表字段校验', () => {
  const sys = { fieldCode: 'uid', label: '用户', fieldType: 'TEXT', isSystem: true }
  const good = {
    fieldCode: 'customer_name',
    label: '客户全称',
    fieldType: 'TEXT',
    required: true,
    defaultValue: null,
    isSystem: false
  }
  it('合法表通过', () => {
    expect(validateFields([sys, good]).ok).toBe(true)
  })
  it('无业务字段（仅系统字段）报全局错', () => {
    const r = validateFields([sys])
    expect(r.ok).toBe(false)
    expect(r.errors.__global).toBeTruthy()
  })
  it('fieldCode 留空放行（交后端生成）；填了才校验格式 / 保留字 / 重复', () => {
    // 留空：不再报「必填」，整行（仅缺 code）可通过
    expect(validateFields([{ ...good, fieldCode: '' }]).ok).toBe(true)
    expect(validateFields([{ ...good, fieldCode: 'Bad-Code' }]).errors.rows[0].fieldCode).toBeTruthy()
    expect(validateFields([{ ...good, fieldCode: 'uid' }]).errors.rows[0].fieldCode).toContain('保留')
    const dup = validateFields([good, { ...good }])
    expect(dup.errors.rows[0].fieldCode).toContain('重复')
  })
  it('label 必填', () => {
    expect(validateFields([{ ...good, label: '' }]).errors.rows[0].label).toBeTruthy()
  })
  it('默认值与类型不相容标红', () => {
    const r = validateFields([{ ...good, fieldType: 'INTEGER', defaultValue: 'abc' }])
    expect(r.errors.rows[0].defaultValue).toBeTruthy()
  })
  it('系统字段不参与业务校验（不挡）', () => {
    // 系统字段即使没 label 也不报错（其本身 isSystem 跳过），只要有 1 个业务字段
    const r = validateFields([{ ...sys, label: '' }, good])
    expect(r.ok).toBe(true)
  })
})

describe('validateTableMeta', () => {
  it('建表：tableCode 留空放行（交后端生成）；填了才校验格式 + 保留字', () => {
    expect(validateTableMeta({ tableCode: '', label: 'x' }).ok).toBe(true)
    expect(validateTableMeta({ tableCode: 'Bad', label: 'x' }).errors.tableCode).toBeTruthy()
    expect(validateTableMeta({ tableCode: 'id', label: 'x' }).errors.tableCode).toBeTruthy()
    expect(validateTableMeta({ tableCode: 'crm_x', label: 'x' }).ok).toBe(true)
  })
  it('改表：tableCode 只读不校验', () => {
    const r = validateTableMeta({ tableCode: '', label: 'x' }, { isEdit: true })
    expect(r.errors.tableCode).toBeUndefined()
    expect(r.ok).toBe(true)
  })
  it('label 必填', () => {
    expect(validateTableMeta({ tableCode: 'crm_x', label: '' }).errors.label).toBeTruthy()
  })
})

describe('normalizeFieldForSubmit', () => {
  it('默认值空 → null，非空 → trim 字符串', () => {
    expect(normalizeFieldForSubmit({ fieldCode: 'a', label: 'A', fieldType: 'TEXT', defaultValue: '' }).defaultValue).toBeNull()
    expect(normalizeFieldForSubmit({ fieldCode: 'a', label: 'A', fieldType: 'TEXT', defaultValue: '  hi  ' }).defaultValue).toBe('hi')
  })
  it('fieldDesc 空 → null', () => {
    expect(normalizeFieldForSubmit({ fieldCode: 'a', label: 'A', fieldType: 'TEXT', fieldDesc: '' }).fieldDesc).toBeNull()
  })
  it('保留必要字段', () => {
    const r = normalizeFieldForSubmit({ fieldCode: ' c ', label: ' L ', fieldType: 'INTEGER', required: true, defaultValue: '5' })
    expect(r).toMatchObject({ fieldCode: 'c', label: 'L', fieldType: 'INTEGER', required: true, defaultValue: '5' })
  })
  it('fieldCode 留空 → null（交后端按字段名生成）', () => {
    expect(normalizeFieldForSubmit({ fieldCode: '', label: 'A', fieldType: 'TEXT' }).fieldCode).toBeNull()
    expect(normalizeFieldForSubmit({ fieldCode: '   ', label: 'A', fieldType: 'TEXT' }).fieldCode).toBeNull()
  })
})
