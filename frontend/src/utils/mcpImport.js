/**
 * MCP 服务配置「一键导入」解析器（前端便捷录入）。
 *
 * 目的：FDE 常拿到形如 Claude Desktop / 各家 MCP server README 的整段配置——
 *   { "mcpServers": { "<name>": { "command": "npx", "args": [...], "env": { ... } } } }
 * 直接粘贴即可解析成 McpEditor 表单字段（transport / command / args / env / endpoint），
 * 免去逐行手填。纯形态转换 + 轻推断，不做鉴权映射、不落库、不改任何接口契约；
 * 合法性仍由 defValidate + 后端把关（本函数只负责「把粘贴的东西认出来」）。
 *
 * 兼容输入：
 *  - 标准包裹：{ "mcpServers": { name: cfg, ... } }（多服务时取第一个，其余记入 extraKeys 告警）
 *  - 变体包裹：{ "servers": { ... } }（部分工具用 servers）
 *  - 裸单服务对象：{ "command": ..., "args": ..., "env": ... } 或 { "url": ... }
 *
 * transport 推断优先级：显式 type/transport 字段 → 有 command 判 stdio → 有 url 判 http。
 * http 归一：http / streamable-http / streamablehttp / sse 一律落到 'streamable-http'（后端合法值）。
 */

const HTTP_TYPES = new Set(['http', 'streamable-http', 'streamablehttp', 'sse'])

/**
 * 把服务别名规整成候选 MCP code（小写字母/数字/下划线；非法字符→下划线，去首尾下划线）。
 * 仅作「新建时 code 为空」的便捷预填，用户可再改；规整不出合法值则返回 ''。
 * @param {string} key 服务别名
 * @returns {string}
 */
export function suggestCodeFromKey(key) {
  return (key || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * 解析粘贴的 MCP 配置文本。
 * @param {string} text 粘贴的 JSON 文本
 * @returns {{
 *   ok: boolean, error?: string,
 *   key?: string, transport?: 'stdio'|'streamable-http',
 *   command?: string, args?: string[], env?: Array<{key:string,value:string}>,
 *   endpoint?: string, extraKeys?: string[], warnings?: string[]
 * }}
 */
export function parseMcpConfig(text) {
  const raw = (text || '').trim()
  if (!raw) return { ok: false, error: '请先粘贴 MCP 服务配置（JSON）' }

  let obj
  try {
    obj = JSON.parse(raw)
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${e?.message || '格式不正确'}` }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: '配置应为一个 JSON 对象' }
  }

  // 定位服务 map / 裸单服务
  let key = ''
  let cfg = null
  const extraKeys = []
  const serversMap =
    obj.mcpServers && typeof obj.mcpServers === 'object' && !Array.isArray(obj.mcpServers)
      ? obj.mcpServers
      : obj.servers && typeof obj.servers === 'object' && !Array.isArray(obj.servers)
        ? obj.servers
        : null

  if (serversMap) {
    const keys = Object.keys(serversMap)
    if (!keys.length) return { ok: false, error: 'mcpServers 为空，未找到任何服务' }
    key = keys[0]
    cfg = serversMap[key]
    if (keys.length > 1) extraKeys.push(...keys.slice(1))
  } else if (obj.command || obj.url || obj.args || obj.env || obj.endpoint) {
    cfg = obj // 裸单服务对象（无 mcpServers 包裹）
  } else {
    return { ok: false, error: '未找到 mcpServers 节点，也不像单个服务配置对象' }
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return { ok: false, error: '服务配置内容无效（应为对象）' }
  }

  const warnings = []

  // —— transport 推断 ——
  let transport = ''
  const rawType = (cfg.type || cfg.transport || '').toString().trim().toLowerCase()
  if (rawType === 'stdio') transport = 'stdio'
  else if (HTTP_TYPES.has(rawType)) transport = 'streamable-http'
  if (!transport) {
    if (cfg.command) transport = 'stdio'
    else if (cfg.url || cfg.endpoint) transport = 'streamable-http'
  }
  if (!transport) {
    return { ok: false, error: '无法识别接入方式：既无 command（stdio）也无 url（http）' }
  }

  const result = {
    ok: true,
    key,
    transport,
    command: '',
    args: [],
    env: [],
    endpoint: '',
    extraKeys,
    warnings
  }

  if (transport === 'stdio') {
    result.command = typeof cfg.command === 'string' ? cfg.command.trim() : ''
    if (Array.isArray(cfg.args)) {
      result.args = cfg.args.map((a) => String(a)) // 逐项字符串化（保留原样，提交时再 trim/滤空）
    } else if (cfg.args != null) {
      warnings.push('args 不是数组，已忽略')
    }
    if (cfg.env && typeof cfg.env === 'object' && !Array.isArray(cfg.env)) {
      result.env = Object.entries(cfg.env).map(([k, v]) => ({
        key: k,
        value: v == null ? '' : String(v)
      }))
      const emptyCount = result.env.filter((e) => e.value === '').length
      if (emptyCount) {
        warnings.push(`env 有 ${emptyCount} 个变量的值为空，请填入真实值/密钥后再保存`)
      }
    } else if (cfg.env != null) {
      warnings.push('env 不是对象，已忽略')
    }
    if (cfg.url) warnings.push('接入方式判定为 stdio，配置里的 url 已忽略')
  } else {
    const url = typeof cfg.url === 'string' ? cfg.url : cfg.endpoint
    result.endpoint = typeof url === 'string' ? url.trim() : ''
    if (cfg.headers && typeof cfg.headers === 'object') {
      warnings.push('检测到 headers，请在下方「鉴权配置」手动填写（导入不自动映射鉴权）')
    }
    if (cfg.command) warnings.push('接入方式判定为 http，配置里的 command/args/env 已忽略')
  }

  if (extraKeys.length) {
    warnings.push(`检测到多个服务，仅导入「${key}」，其余已忽略：${extraKeys.join('、')}`)
  }

  return result
}
