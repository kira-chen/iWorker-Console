/**
 * 「目标岗位是否为当前绑定岗位」判定（单一真相源）。
 *
 * 用于两处（PRD-06 §4.2 前端判定口径）：
 *  - 个性化页守卫：仅当前绑定岗位可个性化；非当前绑定岗位一律拦截、引导走换绑。
 *  - 更换流程：选回当前岗位识别为「无变化」，不触发强确认、不清个性化。
 *
 * 全线 ID 改造 方案B/B2：岗位（专家）id 已字符串化（ps_*），不可再 Number() 归一
 * （字符串 id Number() 得 NaN，NaN!==NaN 永远不等）。改为字符串比较：两侧统一 String()
 * 后全等——既适配新字符串 id，对历史纯数字 id 也等价（同源值字符串化后仍相等）。
 * boundPositionId 为空时一律返回 false（无绑定 = 任何岗位都不是「当前绑定」）。
 */
export function isCurrentBoundPosition(targetPositionId, boundPositionId) {
  if (boundPositionId == null || targetPositionId == null) return false
  return String(targetPositionId) === String(boundPositionId)
}

/**
 * 「其他岗位」列表过滤：从岗位列表中排除当前绑定岗位。
 *
 * 绑定 id 取值优先级：内存态 currentPositionId → 登录态持久化 boundPositionId 兜底。
 * currentPosition 仅在进过 Chat/绑定/换绑后才有值；用户登录后直接进本页或刷新停在本页时
 * currentPosition 为 null，必须用已持久化的 boundPositionId 兜底，否则会把绑定岗位一并列出。
 * 两者皆空（未绑定）则原样返回全部。比较走 isCurrentBoundPosition 做 number 归一。
 *
 * @param {Array} positions 岗位列表（每项含 id）
 * @param {number|string|null|undefined} currentPositionId 内存态当前岗位 id
 * @param {number|string|null|undefined} boundPositionId 登录态持久化绑定 id（兜底）
 * @returns {Array} 排除绑定岗位后的列表
 */
export function excludeBoundPosition(positions, currentPositionId, boundPositionId) {
  const boundId = currentPositionId ?? boundPositionId
  return (positions || []).filter((e) => !isCurrentBoundPosition(e?.id, boundId))
}
