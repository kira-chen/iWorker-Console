/**
 * 用户端「领用采集表单」纯逻辑工具（无 Vue / 无 DOM，便于单测）。
 *
 * 与 FDE 配置侧（positionModel.js / IntakeFieldEditor）共享 6 类型枚举，但本文件聚焦
 * **渲染填写侧**：默认值初始化、前端字段级校验、提交前 intakeValues 归一。
 *
 * 6 类型：text | textarea | single_select | multi_select | number | date
 *  - text/textarea → 字符串
 *  - single_select → 字符串（须命中 options）
 *  - multi_select  → 字符串数组（每项须命中 options）
 *  - number        → 数字（提交为 number，空为未填）
 *  - date          → 'YYYY-MM-DD' 字符串
 */
import { isSelectType, isValidIntakeType } from './positionModel'

/**
 * 由 intakeSchema 生成表单初值 model：{ [key]: value }。
 * - 已有 existing 值（改采集值场景）优先回填；
 * - 否则用字段 defaultValue 预填；
 * - multi_select 初值为数组，其余为 '' / null。
 *
 * @param {Array} schema intakeSchema（每项 {key,type,defaultValue,...}）
 * @param {Object} [existing] 已填采集值（改采集值时传入）
 * @returns {Object} model
 */
export function buildIntakeModel(schema, existing = null) {
  const model = {}
  const ex = existing || {}
  for (const f of schema || []) {
    if (!f || !f.key) continue
    const has = Object.prototype.hasOwnProperty.call(ex, f.key) && ex[f.key] != null
    if (f.type === 'multi_select') {
      if (has) {
        model[f.key] = Array.isArray(ex[f.key]) ? [...ex[f.key]] : [ex[f.key]]
      } else if (Array.isArray(f.defaultValue) && f.defaultValue.length) {
        model[f.key] = [...f.defaultValue]
      } else {
        model[f.key] = []
      }
    } else if (has) {
      model[f.key] = ex[f.key]
    } else if (f.defaultValue !== null && f.defaultValue !== undefined && f.defaultValue !== '') {
      model[f.key] = f.type === 'number' ? Number(f.defaultValue) : f.defaultValue
    } else {
      model[f.key] = f.type === 'number' ? null : ''
    }
  }
  return model
}

// 单字段是否“空”（未填）。多选空数组 / 字符串空串 / number 为 null|''|NaN 视为空。
export function isEmptyValue(type, value) {
  if (type === 'multi_select') return !Array.isArray(value) || value.length === 0
  if (type === 'number') return value === null || value === undefined || value === '' || Number.isNaN(Number(value))
  return value === null || value === undefined || String(value).trim() === ''
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 单字段前端校验。返回错误文案 or ''（无错）。
 * - 必填未填 → 拦截；
 * - 单/多选值须在 options 内；
 * - number 须为合法数字；date 须为 YYYY-MM-DD。
 */
export function validateIntakeField(field, value) {
  const f = field || {}
  const empty = isEmptyValue(f.type, value)
  if (f.required && empty) return '此项为必填'
  if (empty) return '' // 非必填且空：放行
  if (!isValidIntakeType(f.type)) return ''

  if (f.type === 'single_select') {
    const opts = Array.isArray(f.options) ? f.options : []
    if (!opts.includes(value)) return '请选择有效选项'
  } else if (f.type === 'multi_select') {
    const opts = Array.isArray(f.options) ? f.options : []
    const vals = Array.isArray(value) ? value : [value]
    if (vals.some((v) => !opts.includes(v))) return '存在无效选项'
  } else if (f.type === 'number') {
    if (Number.isNaN(Number(value))) return '请输入数字'
  } else if (f.type === 'date') {
    if (!DATE_RE.test(String(value))) return '请选择有效日期'
  }
  return ''
}

/**
 * 整表校验。返回 { ok, errors:{ [key]: msg } }。
 */
export function validateIntakeValues(schema, model) {
  const errors = {}
  let ok = true
  for (const f of schema || []) {
    if (!f || !f.key) continue
    const msg = validateIntakeField(f, model?.[f.key])
    if (msg) {
      errors[f.key] = msg
      ok = false
    }
  }
  return { ok, errors }
}

/**
 * 提交前归一 intakeValues：剔除空值，number 转 number，select 保留命中值。
 * 仅保留 schema 内定义的 key（防脏字段）。
 *
 * @returns {Object} intakeValues
 */
export function normalizeIntakeValues(schema, model) {
  const out = {}
  for (const f of schema || []) {
    if (!f || !f.key) continue
    const v = model?.[f.key]
    if (isEmptyValue(f.type, v)) continue
    if (f.type === 'number') {
      out[f.key] = Number(v)
    } else if (f.type === 'multi_select') {
      out[f.key] = Array.isArray(v) ? [...v] : [v]
    } else {
      out[f.key] = v
    }
  }
  return out
}

// 是否存在采集定义（无定义 → 领用跳过表单）
export function hasIntakeSchema(schema) {
  return Array.isArray(schema) && schema.length > 0
}

export { isSelectType }
