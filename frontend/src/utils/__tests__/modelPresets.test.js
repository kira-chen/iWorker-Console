import { describe, it, expect } from 'vitest'
import {
  MODEL_PRESETS,
  MODEL_PROVIDER_OPTIONS,
  MODEL_PROVIDER_LABELS,
  CONTEXT_WINDOW_OPTIONS,
  MODEL_CATEGORY_OPTIONS,
  MODEL_CATEGORY_LABELS,
  FIELD_TIPS
} from '@/utils/modelPresets'

/**
 * modelPresets（模型接入·厂商预设与枚举）一致性守卫（批量补测，2026-08-08）。
 *
 * 这些枚举同时被表单下拉、列表回填标签、后端契约三处消费，改一处漏一处即产生
 * 「下拉能选但列表显示空白」「选了后端拒收」这类问题。纯数据模块，用结构断言守：
 *  1. 枚举形状完整（value/label 非空、value 唯一）；
 *  2. LABELS 派生表与 OPTIONS 严格同步（新增厂商/类别漏改派生表 → 列表显示 undefined）；
 *  3. MODEL_CATEGORY 的 value 必须是后端约定的 4 个枚举（改动即契约变更，须先走确认流程）；
 *  4. 预设模板字段自洽（baseUrl 形态、authType 合法、数值为正）；
 *  5. FIELD_TIPS 覆盖全部表单字段（缺 tip = 界面上 ? 悬浮空白）。
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

  it('预设模板：key 唯一、authType 合法、数值字段为正或空', () => {
    expect(uniq(MODEL_PRESETS.map((p) => p.key))).toBe(true)
    for (const p of MODEL_PRESETS) {
      expect(String(p.label || '').trim(), `${p.key} 需有展示名`).not.toBe('')
      expect(['API_KEY', 'APP_ID_SECRET']).toContain(p.authType)
      expect(Array.isArray(p.models)).toBe(true)
      for (const field of ['contextWindow', 'maxOutputTokens']) {
        const v = p[field]
        if (v != null) expect(v, `${p.key}.${field} 应为正数`).toBeGreaterThan(0)
      }
      if (p.defaultTemperature != null) {
        expect(p.defaultTemperature).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('预设模板：非自定义项须给出 https 接口地址与至少 1 个模型代号', () => {
    for (const p of MODEL_PRESETS.filter((x) => x.key !== 'custom')) {
      expect(p.baseUrl, `${p.key} 应有 baseUrl`).toMatch(/^https:\/\//)
      expect(p.models.length, `${p.key} 应预填模型代号`).toBeGreaterThan(0)
    }
  })

  it('custom 预设：留空模板（不预填地址/模型），供私有网关自填', () => {
    const custom = MODEL_PRESETS.find((p) => p.key === 'custom')
    expect(custom).toBeTruthy()
    expect(custom.baseUrl).toBe('')
    expect(custom.models).toEqual([])
  })

  it('FIELD_TIPS 覆盖全部表单字段（缺 tip = 界面 ? 悬浮空白）', () => {
    const required = [
      'preset', 'provider', 'name', 'category', 'baseUrl', 'model',
      'contextWindow', 'maxOutputTokens', 'defaultTemperature', 'extraBody',
      'authType', 'apiKey', 'appId', 'appIdApiKey', 'appSecret', 'capabilities'
    ]
    for (const k of required) {
      expect(String(FIELD_TIPS[k] || '').trim(), `缺 FIELD_TIPS.${k}`).not.toBe('')
    }
  })
})
