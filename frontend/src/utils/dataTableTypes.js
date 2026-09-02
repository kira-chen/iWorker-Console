/**
 * 对象类型（原数据表）「结构化卡位」类型常量 + 前端校验 + 默认值控件映射（岗位 → 工作档案）。
 *
 * 2026-08-27 按《iWorker 工作档案实现设计 V2.1》升级：
 *   - 数据表 = 对象类型；字段 = 结构化卡位（≤ MAX_SLOTS 个，只留系统要拿来算账的字段）；
 *   - 新增 ENUM（用于「标签」卡位，如阶段标签：无顺序、无流转、只是取值范围）；
 *   - 新增卡位「用途标记」SLOT_ROLES（唯一标识 / 负责人 / 关键日期 / 统计数值 / 标签）。
 *
 * 注意：卡位类型与 Skill 入参/出参的 FIELD_TYPES（utils/schema.js）语义不同，独立维护，勿混用。
 *
 * 易用性约定（面向小白配置者）：下拉只展示业务白话 label + 一句例子（hint），
 * 不暴露底层英文类型名；布尔统一称「是/否」。底层 value（给后端）保持不变。
 *
 * defaultValue 统一以字符串形态在前后端传输（如 "false" / "2026-06-01"）；空默认值用 null。
 */

export const MAX_SLOTS = 8

export const DATA_FIELD_TYPES = [
  { value: 'TEXT', label: '短文本', hint: '一行字，如对象名 / 负责人', control: 'text' },
  { value: 'LONGTEXT', label: '长文本', hint: '大段文字，如备注 / 纪要', control: 'textarea' },
  { value: 'INTEGER', label: '整数', hint: '个数，如数量', control: 'integer' },
  { value: 'DECIMAL', label: '小数', hint: '带小数，如金额 / 百分比', control: 'decimal' },
  { value: 'BOOLEAN', label: '是/否', hint: '开关，如是否关键客户', control: 'boolean' },
  { value: 'DATE', label: '日期', hint: '某一天，如招标日期', control: 'date' },
  { value: 'ENUM', label: '标签（枚举）', hint: '固定几个取值，如阶段标签：需求 / 方案 / 商务', control: 'enum' }
]

/** 唯一 ID（主键）可用类型：与后端 isPrimaryTypeAllowed 一致。 */
export const PRIMARY_TYPES = ['TEXT', 'INTEGER']

/**
 * 卡位用途标记（设计 §13）。value 与后端 SlotRole 枚举一致；'' = 普通卡位。
 * 提示文案说明客户端运行时拿它做什么，帮助配置者判断该不该标。
 */
export const SLOT_ROLES = [
  { value: '', label: '普通', hint: '不参与系统计算，只在档案页显示' },
  { value: 'IDENTITY', label: '对象名', hint: '档案的显示名（如客户名）；每份档案只能有一个', types: ['TEXT'] },
  { value: 'OWNER', label: '负责人', hint: '值须为用户；看板按它分列', types: ['TEXT'] },
  { value: 'KEY_DATE', label: '关键日期', hint: '临近时提醒（如招标日期）', types: ['DATE'] },
  { value: 'AMOUNT', label: '统计数值', hint: '报表合计（如预算金额）', types: ['INTEGER', 'DECIMAL'] },
  { value: 'LABEL', label: '标签', hint: '阶段标签等；无顺序、不阻塞任何操作', types: ['ENUM', 'TEXT'] }
]

const TYPE_VALUES = DATA_FIELD_TYPES.map((t) => t.value)
const TYPE_MAP = DATA_FIELD_TYPES.reduce((m, t) => {
  m[t.value] = t
  return m
}, {})
const ROLE_MAP = SLOT_ROLES.reduce((m, r) => {
  m[r.value] = r
  return m
}, {})

export function isValidFieldType(type) {
  return TYPE_VALUES.includes(type)
}

/** 字段类型 → 业务白话展示文案。未知类型原样回显。 */
export function fieldTypeLabel(type) {
  return TYPE_MAP[type]?.label || String(type || '')
}

/** 用途标记 → 展示文案；'' / null → 「普通」。 */
export function slotRoleLabel(role) {
  return ROLE_MAP[role || '']?.label || String(role || '')
}

/** 某类型可选的用途标记列表（普通恒可选；其余按 types 匹配）。 */
export function slotRolesForType(type) {
  return SLOT_ROLES.filter((r) => !r.types || r.types.includes(type))
}

/**
 * 按字段类型返回默认值输入控件标识：
 *   'text' | 'textarea' | 'integer' | 'decimal' | 'boolean' | 'date' | 'enum'
 * 未知类型退化为文本控件（安全）。
 */
export function defaultValueControl(type) {
  return TYPE_MAP[type]?.control || 'text'
}

const FIELD_CODE_RE = /^[a-z][a-z0-9_]{0,62}$/
// 保留字 / 系统字段：禁止用户用作 fieldCode（与后端口径对齐，前端先拦一道）
const RESERVED_FIELD_CODES = ['uid', 'id', 'deleted', 'created_at', 'updated_at', 'table_def_id']
const TABLE_CODE_RE = /^[a-z][a-z0-9_]{0,62}$/

/**
 * 校验单个默认值是否与字段类型相容。
 * 空（null/undefined/''）一律视为「不设默认值」，合法返回 null。
 * 返回错误文案（string）或 null（通过）。
 */
export function validateDefaultValue(type, value, options) {
  if (value === null || value === undefined || value === '') return null
  const str = String(value).trim()
  if (str === '') return null
  switch (type) {
    case 'INTEGER':
      if (!/^-?\d+$/.test(str)) return '默认值需为整数'
      return null
    case 'DECIMAL':
      if (!/^-?\d+(\.\d+)?$/.test(str)) return '默认值需为数字'
      return null
    case 'BOOLEAN':
      if (str !== 'true' && str !== 'false') return '默认值需为 true / false'
      return null
    case 'DATE':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return '默认值需为日期（YYYY-MM-DD）'
      if (Number.isNaN(Date.parse(str))) return '默认值不是合法日期'
      return null
    case 'ENUM':
      if (Array.isArray(options) && options.length && !options.includes(str)) return '默认值须是取值范围里的一个'
      return null
    case 'TEXT':
    case 'LONGTEXT':
      return null
    default:
      return null
  }
}

/** 归一化枚举取值：去空白、去重、去空。 */
export function normalizeOptions(options) {
  if (!Array.isArray(options)) return []
  const out = []
  options.forEach((o) => {
    const v = String(o ?? '').trim()
    if (v && !out.includes(v)) out.push(v)
  })
  return out
}

/**
 * 校验整个对象类型的卡位行（前端轻校验，红框在组件内据 errorCode/field 定位）。
 * rows: [{ fieldCode, label, fieldType, required, defaultValue, options, fieldDesc, slotRole, isSystem }]
 * 返回 { ok, errors: { __global?: string, rows: { [idx]: { [key]: msg } } } }
 *
 * 规则：
 * - 至少 1 个业务卡位（非系统字段）；至多 MAX_SLOTS 个；
 * - fieldCode 非空 / 正则 / 表内唯一 / 非保留字（留空放行，交后端生成）；
 * - label 非空；fieldType 合法；ENUM 至少 1 个取值；
 * - defaultValue 与类型相容；
 * - slotRole 与类型相容；「唯一标识」至多一个。
 * 系统字段（isSystem=true，如 uid）只读，不参与业务校验。
 */
export function validateFields(rows) {
  const list = rows || []
  const errors = { rows: {} }
  let ok = true
  const setErr = (idx, key, msg) => {
    if (!errors.rows[idx]) errors.rows[idx] = {}
    errors.rows[idx][key] = msg
    ok = false
  }

  const business = list.filter((r) => !r.isSystem)
  if (business.length === 0) {
    errors.__global = '至少需要 1 个结构化卡位'
    ok = false
  } else if (business.length > MAX_SLOTS) {
    errors.__global = `结构化卡位最多 ${MAX_SLOTS} 个，其余维度用提取项即可（无需预先定义）`
    ok = false
  }

  // 唯一性：含系统字段一起算（避免与 uid 撞码）
  const codeCount = {}
  list.forEach((r) => {
    const c = (r.fieldCode || '').trim()
    if (c) codeCount[c] = (codeCount[c] || 0) + 1
  })
  let identityCount = 0
  let primaryCount = 0

  list.forEach((r, idx) => {
    if (r.isSystem) return
    const code = (r.fieldCode || '').trim()
    if (!code) {
      /* 留空放行 */
    } else if (RESERVED_FIELD_CODES.includes(code)) {
      setErr(idx, 'fieldCode', `「${code}」为系统保留字段，不可使用`)
    } else if (!FIELD_CODE_RE.test(code)) {
      setErr(idx, 'fieldCode', '小写字母开头，仅小写字母/数字/下划线，≤63 字符')
    } else if (codeCount[code] > 1) {
      setErr(idx, 'fieldCode', `字段编码重复：${code}`)
    }

    if (!(r.label || '').trim()) {
      setErr(idx, 'label', '卡位名称必填')
    }

    if (!isValidFieldType(r.fieldType)) {
      setErr(idx, 'fieldType', '请选择类型')
    } else {
      const opts = normalizeOptions(r.options)
      if (r.fieldType === 'ENUM' && opts.length === 0) {
        setErr(idx, 'options', '标签类型至少填 1 个取值')
      }
      const dvErr = validateDefaultValue(r.fieldType, r.defaultValue, opts)
      if (dvErr) setErr(idx, 'defaultValue', dvErr)
    }

    const role = r.slotRole || ''
    if (role) {
      const def = ROLE_MAP[role]
      if (!def) {
        setErr(idx, 'slotRole', '用途标记非法')
      } else if (def.types && isValidFieldType(r.fieldType) && !def.types.includes(r.fieldType)) {
        setErr(idx, 'slotRole', `「${def.label}」用途只适用于：${def.types.map(fieldTypeLabel).join(' / ')}`)
      }
      if (role === 'IDENTITY') {
        identityCount += 1
        if (identityCount > 1) setErr(idx, 'slotRole', '「对象名」只能有一个卡位')
      }
    }

    if (r.isPrimary) {
      primaryCount += 1
      if (primaryCount > 1) setErr(idx, 'isPrimary', '只能指定一个字段为唯一 ID')
      else if (isValidFieldType(r.fieldType) && !PRIMARY_TYPES.includes(r.fieldType)) setErr(idx, 'isPrimary', '唯一 ID 只能是短文本或整数')
    }
  })

  return { ok, errors }
}

/**
 * 校验建表/改表的表级输入（tableCode/label）。仅建表校验 tableCode（改表 tableCode 只读）。
 * 返回 { ok, errors: { tableCode?, label? } }
 */
export function validateTableMeta(meta, { isEdit = false } = {}) {
  const errors = {}
  const code = (meta.tableCode || '').trim()
  if (!isEdit && code) {
    if (!TABLE_CODE_RE.test(code)) {
      errors.tableCode = '小写字母开头，仅小写字母/数字/下划线，≤63 字符'
    } else if (RESERVED_FIELD_CODES.includes(code)) {
      errors.tableCode = `「${code}」为保留字，不可作为表编码`
    }
  }
  if (!(meta.label || '').trim()) {
    errors.label = '对象类型名称必填'
  }
  return { ok: Object.keys(errors).length === 0, errors }
}

/**
 * 把卡位行归一为提交 payload 的 field 项（默认值统一转字符串 / null；options 归一化；slotRole '' → null）。
 * 不含系统字段（系统字段由后端维护，建表/改表 payload 不传）。
 */
export function normalizeFieldForSubmit(row) {
  const dv = row.defaultValue
  let defaultValue = null
  if (dv !== null && dv !== undefined && String(dv).trim() !== '') {
    defaultValue = String(dv).trim()
  }
  const options = row.fieldType === 'ENUM' ? normalizeOptions(row.options) : null
  return {
    fieldCode: (row.fieldCode || '').trim() || null,
    label: (row.label || '').trim(),
    fieldType: row.fieldType,
    required: !!row.required || !!row.isPrimary, // 唯一 ID 强制必填
    defaultValue,
    options: options && options.length ? options : null,
    fieldDesc: (row.fieldDesc || '').trim() || null,
    slotRole: row.slotRole || null,
    isPrimary: !!row.isPrimary
  }
}
