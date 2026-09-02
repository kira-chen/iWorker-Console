/**
 * MCP 连通性验证：错误分类与提示文案（2026-08-21）。
 *
 * 【为什么要这层映射】MCP 的检活错误在后端已被「压平」成中文简述再落库
 * （`ToolHealthService#failReason` / `McpProvisionService#failReason` 把 `ErrorKind` 枚举
 * 映射成「连接超时」「连接失败」等中文，`last_check_error` 存的就是这个），
 * **错误码本身没有随数据保留**。而模型侧存的是 `AUTH_FAILED: …` 这种「码 + 原文」格式，
 * 前端可以直接切前缀取码。
 *
 * 两种做法：①改后端落库格式带上码；②前端按中文简述反查码。
 * 这里选 ②——①要动检活写入路径并订正存量数据，而错误简述是**后端两处 switch 穷举出来的
 * 封闭集合**（五种 ErrorKind + 三条前置校验），反查是确定的、不会漏。
 *
 * 【维护约束】下方 `MCP_ERROR_CATALOG` 的 key 必须与后端 failReason 的返回值**逐字一致**。
 * 后端新增 ErrorKind 时须同步在此登记，否则该错误会落到 UNKNOWN 兜底（不会崩，但码显示为「未知」）。
 */

/**
 * 中文错误简述 → { code, reason }。
 *
 * - `code`：给排障用的技术分类（对应后端 `McpTransportException.ErrorKind` 或前置校验场景）；
 * - `reason`：给人看的原因说明，比原始简述更具体（原始简述只有 4 个字，说不清发生了什么）。
 */
export const MCP_ERROR_CATALOG = {
  连接超时: {
    code: 'TIMEOUT',
    reason: '在超时时间内没有收到响应'
  },
  连接失败: {
    code: 'CONN_FAILED',
    reason: '无法建立连接（地址不可达、端口未开放或被拒绝）'
  },
  服务端无对应方法: {
    code: 'TOOL_NOT_FOUND',
    reason: '服务端未实现 MCP 协议要求的方法'
  },
  服务端返回错误: {
    code: 'RPC_ERROR',
    reason: '服务端返回了 JSON-RPC 错误'
  },
  响应解析失败: {
    code: 'PROTOCOL_ERROR',
    reason: '返回内容不符合 MCP 协议格式'
  },
  工具清单响应异常: {
    code: 'PROTOCOL_ERROR',
    reason: 'tools/list 未返回合法的工具数组'
  },
  该接入方式暂未支持: {
    code: 'TRANSPORT_UNSUPPORTED',
    reason: '当前传输方式没有可用的探测实现'
  },
  'endpoint 未配置': {
    code: 'CONFIG_MISSING',
    reason: 'streamable-http 缺少接口地址'
  },
  'command 未配置': {
    code: 'CONFIG_MISSING',
    reason: 'stdio 缺少启动命令'
  },
  探测异常: {
    code: 'PROBE_ERROR',
    reason: '探测过程中发生未预期的异常'
  }
}

/** 分类无法识别时的兜底：不猜、不编造，如实说「未知」并把原文透出去。 */
const FALLBACK_CODE = 'UNKNOWN'

/**
 * 解析 MCP 检活错误简述。
 *
 * @param {string|null|undefined} raw `mcp_def.last_check_error` 原文（中文简述）
 * @returns {{code: string, reason: string}} 恒返回对象；raw 为空时 reason 为空串
 */
export function explainMcpError(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) {
    return { code: FALLBACK_CODE, reason: '' }
  }
  const hit = MCP_ERROR_CATALOG[text]
  if (hit) {
    return { code: hit.code, reason: hit.reason }
  }
  // 未登记的简述：原文即最贴近事实的说明，直接透出，不编造分类。
  return { code: FALLBACK_CODE, reason: text }
}
