/**
 * 工具 (type, code) 联合键工具（Sprint 2.1 契约 §4.1/§4.2 B3）。
 *
 * 背景：同一 code 跨 mock/mcp/api 三来源不保证唯一（MCP 用限定名
 * `mcp__{mcpCode}__{toolName}`，但语义上一律以 type+code 为准）。
 * 故 Skill 编辑器右区工具勾选状态、回显匹配、tools[] 去重一律用
 * (type, code) 联合键，不可只用 code。
 *
 * type ∈ { MOCK, MCP, API }（大写，与契约 §4.1 出参 type 字段一致）。
 */

export const TOOL_TYPES = ['MOCK', 'MCP', 'API']

// 归一化 type：大写、缺省按 MOCK 兜底（契约：tools[] type 默认 MOCK 向后兼容）
export function normType(type) {
  const t = String(type || 'MOCK').toUpperCase()
  return TOOL_TYPES.includes(t) ? t : 'MOCK'
}

// (type, code) → 联合键字符串
export function toolKey(type, code) {
  return `${normType(type)}::${code}`
}

// 某工具项是否在已选集合中（按 type+code 联合键匹配）
export function isToolSelected(selected, type, code) {
  const key = toolKey(type, code)
  return (selected || []).some((s) => toolKey(s.type, s.code) === key)
}

// 切换选中：勾选则追加（保持顺序、去重），取消则按联合键移除。
// tool 至少含 { type, code, requiresConfirmation }，勾选时以工具自带默认 requiresConfirmation 初始化。
// 勾选时若 tool 自带 bizName 则一并透传写入 selected：使下游（如定时任务 buildToolRefs）
// 不再强依赖 available 清单的 bizNameMap（清单加载失败时仍能携 bizName 提交）。
// bizName 仅在有值时写入，避免给不带 bizName 的已选项添加 undefined 字段（对 Skill 编辑器零影响）。
export function toggleTool(selected, tool, checked) {
  const list = selected || []
  if (checked) {
    if (isToolSelected(list, tool.type, tool.code)) return list
    const item = {
      type: normType(tool.type),
      code: tool.code,
      requiresConfirmation: !!tool.requiresConfirmation
    }
    if (tool.bizName) item.bizName = tool.bizName
    return [...list, item]
  }
  const key = toolKey(tool.type, tool.code)
  return list.filter((s) => toolKey(s.type, s.code) !== key)
}

// 修改某已选工具的 requiresConfirmation（按 type+code 定位）
export function setToolConfirm(selected, type, code, val) {
  const key = toolKey(type, code)
  return (selected || []).map((s) =>
    toolKey(s.type, s.code) === key ? { ...s, requiresConfirmation: !!val } : s
  )
}

// 已选序号（从 1 起，按 type+code 在已选数组中的位置）；未选返回 0
export function selectedOrder(selected, type, code) {
  const key = toolKey(type, code)
  const idx = (selected || []).findIndex((s) => toolKey(s.type, s.code) === key)
  return idx + 1
}
