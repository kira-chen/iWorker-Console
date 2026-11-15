// 2026-09-12 测试审计 T35：自 positionModel.test.js 拆出「采集字段」主题（对齐 md 岗位 §3 采集字段页签：
// 类型常量 / key 生成与校验 / {{intake.key}} 占位符 / 提交归一 / 行校验）。条目原样迁移，断言不改。
// key 生成一组 2026-11-10 按产品优化需求-202611 修改点 5（R10）重写，见该 describe 头注。
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

// 2026-11-10 产品优化需求-202611 修改点 5（R10）：key 改按完整拼音生成，一条用例守一条生成规则。
// 原「负责行业→fuzehangye」靠旧 80 字小表把 行 写死成 hang；R10 规则是按字取常用读音（行→xing），改为 fuzexingye。
describe('genKeyFromLabel（字段名 → 字段 key 建议值，R10）', () => {
  it('PRD 示例四条：分管专业 / 客户公司名称 / Region / user name', () => {
    expect(genKeyFromLabel('分管专业')).toBe('fenguanzhuanye')
    expect(genKeyFromLabel('客户公司名称')).toBe('kehugongsimingcheng')
    expect(genKeyFromLabel('Region')).toBe('region')
    expect(genKeyFromLabel('user name')).toBe('user_name')
  })
  it('规则 1：汉字转不带声调的全拼直接连写（不限旧小表里的字），ü 写作 v', () => {
    expect(genKeyFromLabel('负责区域')).toBe('fuzequyu')
    expect(genKeyFromLabel('邮箱地址')).toBe('youxiangdizhi')
    expect(genKeyFromLabel('绿色通道')).toBe('lvsetongdao')
  })
  it('规则 1：多音字按字取常用读音（不识别词组）', () => {
    expect(genKeyFromLabel('负责行业')).toBe('fuzexingye')
    expect(genKeyFromLabel('重要程度')).toBe('zhongyaochengdu')
    expect(genKeyFromLabel('长期合同')).toBe('changqihetong')
  })
  it('规则 2：英文字母转小写、数字原样保留，与汉字直接连写', () => {
    expect(genKeyFromLabel('ABC123')).toBe('abc123')
    expect(genKeyFromLabel('客户ID')).toBe('kehuid')
    expect(genKeyFromLabel('第2联系人')).toBe('di2lianxiren')
  })
  it('规则 3：空格、连字符转下划线（连续的合并），其他符号去掉', () => {
    expect(genKeyFromLabel('合同-编号')).toBe('hetong_bianhao')
    expect(genKeyFromLabel('客户 - 名称')).toBe('kehu_mingcheng')
    expect(genKeyFromLabel('备注（选填）')).toBe('beizhuxuantian')
    expect(genKeyFromLabel('金额/元')).toBe('jineyuan')
  })
  it('规则 4：结果以数字开头加前缀 f_', () => {
    expect(genKeyFromLabel('123')).toBe('f_123')
    expect(genKeyFromLabel('2024年度预算')).toBe('f_2024nianduyusuan')
  })
  it('规则 4：结果为空（全是符号）用 field；字段名本身为空返回空串（抽屉占位回落 auto）', () => {
    expect(genKeyFromLabel('！@#')).toBe('field')
    expect(genKeyFromLabel('')).toBe('')
    expect(genKeyFromLabel('   ')).toBe('')
  })
  it('全角字母 / 数字按半角处理', () => {
    expect(genKeyFromLabel('ＩＤ１')).toBe('id1')
  })
  it('生成结果都符合 key 格式（小写字母开头，仅小写字母 / 数字 / 下划线）', () => {
    for (const l of ['分管专业', 'Region', '123', '！@#', '客户 - 名称', '2024年度预算']) {
      expect(isValidKey(genKeyFromLabel(l))).toBe(true)
    }
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
