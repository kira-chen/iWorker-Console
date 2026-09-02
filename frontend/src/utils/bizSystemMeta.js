/**
 * 业务系统对接 —— 纯逻辑工具（无 Vue / 无 DOM，便于单测）。切片3b。
 *
 * 覆盖：连接方式中文映射、员工侧登录态托管三态（NOT_HOSTED/VALID/EXPIRED）的
 * 友好文案 / 标签类型 / 主操作按钮文案映射。
 *
 * 安全约定：本模块只处理「状态」与「文案」，绝不接触任何凭据明文。
 */

// 连接方式中文映射（后端默认 login_session）
const CONN_TYPE_LABELS = {
  login_session: '登录态托管'
}

export function connTypeLabel(connType) {
  return CONN_TYPE_LABELS[connType] || connType || '登录态托管'
}

/* ============================ 员工侧登录态托管三态 ============================ */

export const CRED_STATE = {
  NOT_HOSTED: 'NOT_HOSTED',
  VALID: 'VALID',
  EXPIRED: 'EXPIRED'
}

// 三态 → 员工可理解的友好文案
const STATE_LABELS = {
  NOT_HOSTED: '未连接',
  VALID: '已连接',
  EXPIRED: '已过期，请重新登录'
}

export function credStateLabel(state) {
  return STATE_LABELS[state] || '未连接'
}

// 三态 → StatusTag 语义色（success/warning/info）
export function credStateTagType(state) {
  if (state === CRED_STATE.VALID) return 'success'
  if (state === CRED_STATE.EXPIRED) return 'warning'
  return 'info'
}

// 三态 → 主操作按钮文案（未连接=连接；已过期=重新登录；已连接=重新登录以刷新）
export function credActionLabel(state) {
  if (state === CRED_STATE.EXPIRED) return '重新登录'
  if (state === CRED_STATE.VALID) return '重新登录'
  return '连接'
}

// 是否已托管（VALID 或 EXPIRED）——决定是否展示「解除托管」入口
export function isHosted(state) {
  return state === CRED_STATE.VALID || state === CRED_STATE.EXPIRED
}

/*
 * 注：工具坞「业务系统」Tab 已统一改走 GET /api/fde/skills/tool-picker?type=BIZ_SYSTEM
 * （后端 ToolPickerService.listBiz 返回带正确 biz__<code> 的工具项，与 SkillToolRefSyncService 解析口径一致）。
 * 原 bizSystemsToTools / BIZ_TOOL_PREFIX 依赖列表 VO 的 b.code，在列表 VO 去 code（契约 §4.5.3）后
 * 会产生 biz__undefined 回归，故删除（已无其它生产调用点）。
 */
