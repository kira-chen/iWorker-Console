/**
 * 服务提供系统的共用口径（产品优化需求-202611 修改点 14（R9）：服务提供系统由 API 与 MCP 共用）。
 *
 * 删除系统的拦截文案原先只看 API（prd-API.md §二.5「该系统下有 N 个 API，需先迁移或删除后才能删除系统」），
 * R9 起「除 API 外也要检查其下是否还有 MCP」。同一句话要在两处说：
 *   - API 列表分组头【删除系统】置灰时的悬浮提示（AdminApis.vue）；
 *   - mock 层 deleteProviderSystem 兜底拒绝时的错误信息（apiConnectorMock.js）。
 * 收在这里一处生成，避免两边各写一份、改一处漏一处。
 */

/** 文案里最多点名几个 MCP，超出用「等」收尾（MCP 在另一个页签，点名是为了让管理员知道去哪儿找） */
const MCP_NAME_LIMIT = 3

/**
 * 删除服务提供系统的拦截原因；系统下既无 API 也无 MCP（可删）时返回空串。
 *
 * 只有 API 时与 R9 之前的文案逐字一致；有 MCP 时追加「M 个 MCP（名称…）」。
 *
 * @param {Object} usage
 * @param {number} [usage.apiCount=0] 系统下 API 数
 * @param {string[]} [usage.mcpNames=[]] 系统下 MCP 名称
 * @returns {string} 例：「该系统下有 2 个 API、1 个 MCP（报销系统 MCP），需先迁移或删除后才能删除系统」
 */
export function providerSystemDeleteBlockReason({ apiCount = 0, mcpNames = [] } = {}) {
  const parts = []
  if (apiCount > 0) parts.push(`${apiCount} 个 API`)
  if (mcpNames.length > 0) {
    const shown = mcpNames.slice(0, MCP_NAME_LIMIT).join('、')
    const more = mcpNames.length > MCP_NAME_LIMIT ? '等' : ''
    parts.push(`${mcpNames.length} 个 MCP（${shown}${more}）`)
  }
  if (!parts.length) return ''
  return `该系统下有 ${parts.join('、')}，需先迁移或删除后才能删除系统`
}
