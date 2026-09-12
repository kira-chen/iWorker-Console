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
  it('至多一个、类型限短文本 / 整数', () => {
    const rows = [
      { label: 'a', fieldType: 'TEXT', isPrimary: true },
      { label: 'b', fieldType: 'INTEGER', isPrimary: true },
      { label: 'c', fieldType: 'DECIMAL', isPrimary: true }
    ]
    const r = validateFields(rows)
    expect(r.errors.rows[1].isPrimary).toContain('只能指定一个')
    expect(r.errors.rows[2].isPrimary).toBeTruthy()
    expect(normalizeFieldForSubmit({ label: 'a', fieldType: 'TEXT' }).isPrimary).toBe(false)
  })

  // 2026-09-09 PRD 复核·G1（A3 / Q25②）：md §4.2.2「该标记仅用于向用户端传值，
  // 不联动改变该字段的必填属性」→ 提交口不再把 isPrimary 折算成 required（旧行为已推翻）。
  it('不联动必填：勾唯一 ID 不改 required，required 只认配置者自己勾的值', () => {
    expect(normalizeFieldForSubmit({ label: 'a', fieldType: 'TEXT', isPrimary: true, required: false }).required).toBe(false)
    expect(normalizeFieldForSubmit({ label: 'a', fieldType: 'TEXT', isPrimary: true }).required).toBe(false)
    expect(normalizeFieldForSubmit({ label: 'a', fieldType: 'TEXT', isPrimary: true, required: true }).required).toBe(true)
    expect(normalizeFieldForSubmit({ label: 'a', fieldType: 'TEXT', isPrimary: false, required: true }).required).toBe(true)
  })
})

describe('字段类型常量', () => {
  // 2026-09-12 审计改名：md 岗位 §4.2.2 字段类型只列六项（日期/长文本/短文本/整数/小数/是否）；
  // ENUM 已退役为存量兼容项（仅回显 mock 种子里的「经营阶段」「风险等级」，下拉不再提供，Q25①）。
  it('md §4.2.2 六项 + ENUM 存量兼容（仅回显），不含 DATETIME', () => {
    const vals = DATA_FIELD_TYPES.map((t) => t.value)
    expect(vals).toEqual(['TEXT', 'LONGTEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATE', 'ENUM'])
    expect(vals).not.toContain('DATETIME')
  })
  it('isValidFieldType', () => {
    expect(isValidFieldType('TEXT')).toBe(true)
    expect(isValidFieldType('DATETIME')).toBe(false)
  })
  it('label 为业务白话、不暴露裸英文类型名；布尔称「是否」（md §4.2.2 逐字）', () => {
    const byVal = DATA_FIELD_TYPES.reduce((m, t) => ((m[t.value] = t), m), {})
    expect(byVal.TEXT.label).toBe('短文本')
    expect(byVal.LONGTEXT.label).toBe('长文本')
    expect(byVal.INTEGER.label).toBe('整数')
    expect(byVal.DECIMAL.label).toBe('小数')
    expect(byVal.BOOLEAN.label).toBe('是否')
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
    expect(fieldTypeLabel('BOOLEAN')).toBe('是否')
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

  // 2026-09-12 测试审计补缺口（F6）：slotRole 三条报错文案零用例（dataTableTypes.js:206-217）。
  describe('slotRole 用途标记（工作档案卡位，设计 §13）', () => {
    it('未登记的 role 值 → 该行 slotRole 报「用途标记非法」', () => {
      const r = validateFields([{ ...good, slotRole: 'NOT_A_ROLE' }])
      expect(r.ok).toBe(false)
      expect(r.errors.rows[0].slotRole).toBe('用途标记非法')
    })
    it('两行都标「对象名」→ 第二行报「「对象名」只能有一个卡位」，第一行不报', () => {
      const r = validateFields([
        { ...good, fieldCode: 'name_a', slotRole: 'IDENTITY' },
        { ...good, fieldCode: 'name_b', slotRole: 'IDENTITY' }
      ])
      expect(r.ok).toBe(false)
      expect(r.errors.rows[0]?.slotRole).toBeUndefined()
      expect(r.errors.rows[1].slotRole).toBe('「对象名」只能有一个卡位')
    })
    it('role 与字段类型不相容（短文本标「关键日期」）→ 报「「关键日期」用途只适用于：日期」', () => {
      const r = validateFields([{ ...good, fieldType: 'TEXT', slotRole: 'KEY_DATE' }])
      expect(r.errors.rows[0].slotRole).toBe('「关键日期」用途只适用于：日期')
      // 多类型的用途把可选类型用「 / 」连起来（统计数值：整数 / 小数）
      const r2 = validateFields([{ ...good, fieldType: 'TEXT', slotRole: 'AMOUNT' }])
      expect(r2.errors.rows[0].slotRole).toBe('「统计数值」用途只适用于：整数 / 小数')
    })
    it('相容的 role（日期字段标「关键日期」、单个「对象名」）→ 通过，不报 slotRole', () => {
      const r = validateFields([
        { ...good, fieldCode: 'n', slotRole: 'IDENTITY' },
        { ...good, fieldCode: 'd', fieldType: 'DATE', slotRole: 'KEY_DATE' }
      ])
      expect(r.ok).toBe(true)
    })
    it('提交归一：slotRole 空串 → null，非空原样保留', () => {
      expect(normalizeFieldForSubmit({ ...good, slotRole: '' }).slotRole).toBeNull()
      expect(normalizeFieldForSubmit({ ...good, slotRole: 'OWNER' }).slotRole).toBe('OWNER')
    })
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
