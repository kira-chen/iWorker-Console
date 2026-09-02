/**
 * 入参/出参「字段行 ↔ 多级嵌套 JSON Schema」互转（契约 §0.6 / 设计 §3.5，N10 起支持多级）。
 *
 * 字段行：{ name, type, required, description, children? }
 *   type ∈ string | number | boolean | object | array（object/array 时可含 children 子字段行，任意层级）。
 *   —— 类型枚举对齐 PRD-20260828（文本/数字/布尔/对象/数组）；历史「日期 date」类型回显时归一为 string。
 * JSON Schema（多级嵌套）：
 *   { type: 'object', properties: { <name>: { type, description?, properties?, required? } }, required: [<name>...] }
 *   —— type=object 的字段递归展开 properties/required；
 *   —— type=array 的字段以 items 描述元素结构（有子字段 → items 为 object schema；无 → 仅 { type: 'array' }）；
 *   —— 标量字段仅 { type, description? }。
 *
 * 约束：根始终为 type=object；空字段集 → 提交 null（契约二者均可选）。
 */

export const FIELD_TYPES = [
  { value: 'string', label: '文本 string' },
  { value: 'number', label: '数字 number' },
  { value: 'integer', label: '整数 integer' },
  { value: 'boolean', label: '布尔 boolean' },
  { value: 'object', label: '对象 object（可套子字段）' },
  { value: 'array', label: '数组 array（可套子字段）' }
]

// 请求参数「请求方法」（参数位置）枚举：默认 QUERY（2026-09-01 拍板）
export const PARAM_IN_OPTIONS = [
  { value: 'QUERY', label: 'Query' },
  { value: 'HEADER', label: 'Header' },
  { value: 'BODY', label: 'Body' },
  { value: 'PATH', label: 'Path' }
]

const ALLOWED_TYPES = FIELD_TYPES.map((t) => t.value)

// 归一 type：命中白名单原样保留，否则兜底 string（含历史 date 类型）
function normType(type) {
  return ALLOWED_TYPES.includes(type) ? type : 'string'
}

// 类型是否可挂子字段（对象 / 数组）
export function typeHasChildren(type) {
  return normType(type) === 'object' || normType(type) === 'array'
}

// 一组字段行 → { properties, required }；无有效字段 → { properties: {}, required: [] }
function rowsToProps(rows) {
  const valid = (rows || []).filter((r) => r.name && r.name.trim())
  const properties = {}
  const required = []
  valid.forEach((r) => {
    const name = r.name.trim()
    const type = normType(r.type)
    const prop = { type }
    if (r.description && r.description.trim()) prop.description = r.description.trim()
    // 请求参数扩展（2026-09-01 拍板）：请求方法 in（HEADER/QUERY/BODY/PATH，自定义关键字）
    // 与默认值 default（JSON Schema 标准关键字，demo 统一按输入串存取）。均按需写入，响应字段行无此二键。
    if (r.in) prop.in = r.in
    if (r.defaultValue != null && String(r.defaultValue).trim()) {
      prop.default = String(r.defaultValue).trim()
    }
    // object 字段递归展开子字段（任意层级）；子字段全空则 properties 为空对象，仍保留 type=object
    if (type === 'object') {
      const child = rowsToProps(r.children)
      prop.properties = child.properties
      if (child.required.length) prop.required = child.required
    }
    // array 字段：子字段描述数组元素结构（items 为 object schema）；无子字段则仅声明 type=array
    if (type === 'array') {
      const child = rowsToProps(r.children)
      if (Object.keys(child.properties).length) {
        prop.items = { type: 'object', properties: child.properties }
        if (child.required.length) prop.items.required = child.required
      }
    }
    properties[name] = prop
    if (r.required) required.push(name)
  })
  return { properties, required }
}

// 字段行 → 多级 JSON Schema；无有效字段返回 null（不提交空 schema）
export function rowsToSchema(rows) {
  const valid = (rows || []).filter((r) => r.name && r.name.trim())
  if (valid.length === 0) return null
  const { properties, required } = rowsToProps(rows)
  const schema = { type: 'object', properties }
  if (required.length) schema.required = required
  return schema
}

// { properties, required } → 字段行数组（递归回显反解析）
function propsToRows(properties, required) {
  const req = Array.isArray(required) ? required : []
  return Object.entries(properties || {}).map(([name, prop]) => {
    const type = normType(prop?.type)
    const row = {
      name,
      type,
      required: req.includes(name),
      description: prop?.description || ''
    }
    // 请求参数扩展键按需回显（缺省不加键，保持既有行形状与往返一致性）
    if (prop?.in) row.in = prop.in
    if (prop && prop.default != null && String(prop.default).trim()) {
      row.defaultValue = String(prop.default)
    }
    // object 字段递归反解析子字段（任意层级）
    if (type === 'object') {
      row.children = propsToRows(prop?.properties, prop?.required)
    }
    // array 字段：从 items（object schema）反解析元素字段
    if (type === 'array') {
      row.children = propsToRows(prop?.items?.properties, prop?.items?.required)
    }
    return row
  })
}

// 多级 JSON Schema → 字段行（回显反解析）；非法/空 → 空数组
export function schemaToRows(schema) {
  if (!schema || typeof schema !== 'object' || !schema.properties) return []
  return propsToRows(schema.properties, schema.required)
}

// 前端轻校验：递归校验各层字段名非空、同级唯一、合法标识符样式；返回错误信息（null 表示通过）
export function validateRows(rows) {
  // PRD §7：新增字段行后字段名不能为空（对象/数组的子字段按相同规则校验）
  const unnamed = (rows || []).find((r) => !(r.name && r.name.trim()))
  if (unnamed) return '新增字段后，字段名不能为空'
  const valid = rows || []
  const names = valid.map((r) => r.name.trim())
  const dup = names.find((n, i) => names.indexOf(n) !== i)
  if (dup) return `字段名重复：${dup}`
  const bad = names.find((n) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n))
  if (bad) return `字段名不合法（仅字母/数字/下划线，且不以数字开头）：${bad}`
  // 递归校验 object / array 子字段
  for (const r of valid) {
    if (typeHasChildren(r.type) && Array.isArray(r.children) && r.children.length) {
      const childErr = validateRows(r.children)
      if (childErr) return childErr
    }
  }
  return null
}
