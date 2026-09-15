import { describe, it, expect } from 'vitest'
import {
  MODEL_PROVIDER_OPTIONS,
  MODEL_PROVIDER_LABELS,
  CONTEXT_WINDOW_OPTIONS,
  MODEL_CATEGORY_OPTIONS,
  MODEL_CATEGORY_LABELS,
  FIELD_TIPS
} from '@/utils/modelPresets'

/**
 * modelPresets（模型接入·厂商预设与枚举）一致性守卫（批量补测，2026-08-08）。
 * 2026-09-12 对齐 docs/PRD/数字员工管理端PRD/03能力/模型/prd-模型.md §三.2 基本信息
 * （提供商 8 项、上下文窗口 10 档、类别 4 项）；MODEL_PRESETS 及其三条用例已随 J13 死码清理删除（2026-09-12）。
 *
 * 这些枚举同时被表单下拉、列表回填标签、后端契约三处消费，改一处漏一处即产生
 * 「下拉能选但列表显示空白」「选了后端拒收」这类问题。纯数据模块，用结构断言守：
 *  1. 枚举形状完整（value/label 非空、value 唯一）；
 *  2. LABELS 派生表与 OPTIONS 严格同步（新增厂商/类别漏改派生表 → 列表显示 undefined）；
 *  3. MODEL_CATEGORY 的 value 必须是后端约定的 4 个枚举（改动即契约变更，须先走确认流程）；
 *  4. FIELD_TIPS 覆盖全部表单字段（缺 tip = 界面上 ? 悬浮空白）。
 */

const uniq = (arr) => new Set(arr).size === arr.length

describe('modelPresets · 枚举一致性', () => {
  it('厂商下拉：value/label 非空且 value 唯一', () => {
    expect(MODEL_PROVIDER_OPTIONS.length).toBeGreaterThan(0)
    for (const o of MODEL_PROVIDER_OPTIONS) {
      expect(String(o.value || '').trim()).not.toBe('')
      expect(String(o.label || '').trim()).not.toBe('')
    }
    expect(uniq(MODEL_PROVIDER_OPTIONS.map((o) => o.value))).toBe(true)
  })

  it('厂商 LABELS 派生表与 OPTIONS 严格同步（防列表显示 undefined）', () => {
    expect(Object.keys(MODEL_PROVIDER_LABELS).sort()).toEqual(
      MODEL_PROVIDER_OPTIONS.map((o) => o.value).sort()
    )
    for (const o of MODEL_PROVIDER_OPTIONS) {
      expect(MODEL_PROVIDER_LABELS[o.value]).toBe(o.label)
    }
  })

  it('模型类别：固定 4 个后端枚举值（改动=契约变更，须先走确认流程）', () => {
    expect(MODEL_CATEGORY_OPTIONS.map((o) => o.value).sort()).toEqual(
      ['IMAGE_GEN', 'MULTIMODAL', 'TEXT', 'VISION'].sort()
    )
  })

  it('类别 LABELS 派生表与 OPTIONS 严格同步', () => {
    expect(Object.keys(MODEL_CATEGORY_LABELS).sort()).toEqual(
      MODEL_CATEGORY_OPTIONS.map((o) => o.value).sort()
    )
  })

  it('上下文窗口档位：正整数且严格递增（下拉顺序即大小顺序）', () => {
    const vals = CONTEXT_WINDOW_OPTIONS.map((o) => o.value)
    expect(vals.every((v) => Number.isInteger(v) && v > 0)).toBe(true)
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i], `第 ${i} 档应大于前一档`).toBeGreaterThan(vals[i - 1])
    }
  })

  // 2026-09-12 测试审计 T43：md §三.2「可选择 8K、16K、32K、64K、128K、192K、198K、200K、256K、1M」逐一相等
  it('上下文窗口档位 label 与 md §三.2 十档逐一相等（8K…1M）', () => {
    expect(CONTEXT_WINDOW_OPTIONS.map((o) => o.label)).toEqual(
      ['8K', '16K', '32K', '64K', '128K', '192K', '198K', '200K', '256K', '1M']
    )
    // 档位值 = label 换算（K=1024）；1M = 1048576
    expect(CONTEXT_WINDOW_OPTIONS.find((o) => o.label === '64K').value).toBe(65536)
    expect(CONTEXT_WINDOW_OPTIONS.find((o) => o.label === '1M').value).toBe(1048576)
  })

  // md §三.2「模型提供商：可选择 DeepSeek、智谱 GLM、月之暗面 Kimi、阿里 Qwen、MiniMax、阶跃星辰、小米 MiMo、其他」
  // 2026-09-12 K24 闭环：label 含空格逐字比对（原「智谱GLM」缺空格已修）
  it('提供商下拉 8 项 label 与 md §三.2 逐字相等（含中英文间空格，审计 K24）', () => {
    expect(MODEL_PROVIDER_OPTIONS.map((o) => o.label)).toEqual(
      ['DeepSeek', '智谱 GLM', '月之暗面 Kimi', '阿里 Qwen', 'MiniMax', '阶跃星辰', '小米 MiMo', '其他']
    )
  })

  it('类别下拉四项 label 与 md §三.2「文本生成、图像理解、多模态、文生图」逐一相等', () => {
    expect(MODEL_CATEGORY_OPTIONS.map((o) => o.label)).toEqual(['文本生成', '图像理解', '多模态', '文生图'])
  })

  it('FIELD_TIPS 覆盖全部表单字段（缺 tip = 界面 ? 悬浮空白）', () => {
    const required = [
      'provider', 'name', 'category', 'baseUrl', 'model',
      'contextWindow', 'maxOutputTokens', 'defaultTemperature', 'extraBody',
      'authType', 'apiKey', 'appId', 'appIdApiKey', 'appSecret', 'capabilities'
    ]
    for (const k of required) {
      expect(String(FIELD_TIPS[k] || '').trim(), `缺 FIELD_TIPS.${k}`).not.toBe('')
    }
  })
})
