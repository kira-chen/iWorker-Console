/**
 * 服务提供系统的共用口径。
 *
 * 2026-11-16 起 API 与 MCP 各有一套服务提供系统、互不影响（prd-API.md §二.5、prd-连接器-MCP.md §二.7），
 * 删除规则相同：系统下还有连接器时不可删。同一句拦截文案要在四处说——
 *   - API / MCP 列表分组头【删除系统】置灰时的悬浮提示（AdminApis.vue / AdminMcp.vue）；
 *   - mock 层删除系统兜底拒绝时的错误信息（apiConnectorMock.js / mcpConnectorMock.js）。
 * 收在这里一处生成，避免各写一份、改一处漏一处。
 */

/**
 * 删除服务提供系统的拦截原因；系统下没有连接器（可删）时返回空串。
 *
 * @param {number} count 系统下的连接器数（API 页签数 API，MCP 页签数 MCP，互不相加）
 * @param {'API'|'MCP'} unit 连接器名称
 * @returns {string} 例：「该系统下有 2 个 API，需先迁移或删除后才能删除系统」
 */
export function providerSystemDeleteBlockReason(count, unit) {
  if (!count) return ''
  return `该系统下有 ${count} 个 ${unit}，需先迁移或删除后才能删除系统`
}
