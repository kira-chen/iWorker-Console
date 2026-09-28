/**
 * 路由 query 取值归一。
 *
 * vue-router 的 query 值类型是 `string | string[] | null`：同名参数重复（`?keyword=a&keyword=b`）即为数组。
 * 手改地址栏 / 旧书签 / 外部拼链都可能造出来，此前列表页直接把 `route.query.keyword` 塞进 keyword 再 `.trim()`，
 * 数组上没有 trim → TypeError，onMounted 首拉即抛整页白屏（2026-09-23 待办 yuepu#22）。
 * 重复参数取第一个，其余忽略。
 * @param {string | string[] | null | undefined} v
 * @returns {string} 恒为字符串，缺省为空串
 */
export function queryString(v) {
  const first = Array.isArray(v) ? v[0] : v
  return first == null ? '' : String(first)
}
