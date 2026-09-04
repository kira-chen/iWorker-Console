/**
 * MCP / API 定义表单前端轻校验（Sprint 2.1 契约 §2.3 / §3.3）。
 * 返回 { ok, errors }，errors 以字段名为 key（与后端 data.field 对齐，供红框回显）。
 * 后端校验仍是唯一权威，前端仅做必填/格式提前拦截。
 */

export const MCP_TRANSPORTS = ['stdio', 'streamable-http']
// stdio Command 纯下拉枚举（拍板 2026-08-31）：覆盖主流分发形态。
// 存量非枚举值（如绝对路径）由编辑器动态追加为选项回显，后端不收紧校验（兼容存量）。
export const MCP_COMMAND_OPTIONS = ['npx', 'uvx', 'node', 'python3', 'docker']
export const API_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
// env 变量描述长度上限（与后端 EnvItem @Size(max=200) 对齐）
export const MCP_ENV_DESC_MAX = 200

// 环境变量名规范（设计 §6.2）：字母/下划线起头，后续字母/数字/下划线
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * 参数行通用校验核（V110 Env 拍板语义泛化，2026-08-31 API KEY 鉴权改造 B.3）。
 * 共用规则：KEY 非空（可配格式）；按（位置+）KEY 去重；描述 ≤200；
 * 互斥：勾选客户端填写 → 不可填平台值；未勾选 → 必须有值（新填或已配置留空=保留）。
 * 完全空白行（没填任何内容）跳过——提交组装时同口径丢弃。
 * @param {Array} rows 行 [{ in?, key, description?, clientFill?, value?, configured? }]
 * @param {Object} opts { noun 名词前缀, keyRe 可选格式, keyReText, withIn 计入位置维度, inValues 合法位置集,
 *                        inLabel(v) 位置显示名 }
 * @returns {string} 错误文案；无错 ''
 */
function validateParamRows(rows, opts) {
  const { noun, keyRe, keyReText, withIn = false, inValues, inLabel = (v) => v } = opts
  const list = Array.isArray(rows) ? rows : []
  const seen = new Set()
  for (const it of list) {
    const k = (it?.key || '').trim()
    const desc = (it?.description || '').trim()
    const val = it?.value || ''
    if (!k && !desc && !val.trim()) continue // 完全空白行：提交时丢弃，不报错
    if (!k) return `${noun}名称必填`
    if (k.length > 128) return `${noun}名不超过 128 字`
    if (keyRe && !keyRe.test(k)) return `${noun}名不合法：${k}${keyReText}`
    if (withIn && !inValues.includes(it?.in)) return `${noun} ${k} 请选择参数位置`
    const dedupeKey = withIn ? `${it.in}|${k}` : k
    if (seen.has(dedupeKey)) {
      return withIn ? `${noun}重复：${inLabel(it.in)} 位置已有 ${k}` : `${noun}名重复：${k}`
    }
    seen.add(dedupeKey)
    if (desc.length > MCP_ENV_DESC_MAX) return `${noun} ${k} 的描述不超过 ${MCP_ENV_DESC_MAX} 字`
    if (it?.clientFill) {
      if (val.trim()) return `${noun} ${k} 已勾选客户端填写，不可再填平台值`
    } else if (!val.trim() && !it?.configured) {
      return `${noun} ${k} 未勾选客户端填写时必须填写${noun === '环境变量' ? '平台值' : '参数值'}`
    }
  }
  return ''
}

/**
 * 校验 MCP stdio Env 声明式行（V110；对齐后端 validateTransportFields/applyEnv）。
 * 返回错误文案（落 fieldErrors.env），无错 ''。
 */
export function validateMcpEnv(rows) {
  return validateParamRows(rows, {
    noun: '环境变量',
    keyRe: ENV_KEY_RE,
    keyReText: '（仅允许字母/数字/下划线，且不以数字开头）'
  })
}

/**
 * 校验 API KEY 鉴权参数行（2026-08-31 多参数改造 B.2；语义对齐 validateMcpEnv + 位置维度）。
 * - 位置必选且合法；按「位置+参数名」组合去重；至少一条有效行（API_KEY 却零参数 = 未配置）。
 * - BODY×GET/DELETE 不再硬拦（2026-09-01 拍板放开）：改行级软提示告知风险，不拦保存。
 * 返回错误文案（落 fieldErrors.authConfig），无错 ''。
 */
export function validateApiAuthParams(rows) {
  const err = validateParamRows(rows, {
    noun: '鉴权参数',
    withIn: true,
    inValues: API_AUTH_IN_OPTIONS.map((o) => o.value),
    inLabel: (v) => API_AUTH_IN_OPTIONS.find((o) => o.value === v)?.label || v
  })
  if (err) return err
  const hasRow = (Array.isArray(rows) ? rows : []).some(
    (r) => (r?.key || '').trim() || (r?.description || '').trim() || (r?.value || '').trim()
  )
  return hasRow ? '' : '已选 API KEY 鉴权，至少配置一条参数'
}

// MCP 鉴权方式（仅 streamable-http；value 与后端 AUTH_TYPE_* 对齐，小写）。
// label 按 PRD §四.1：无鉴权 / Bearer Token / API Key（API Key = Header 名 + 访问凭证，即原自定义 Header）
export const MCP_AUTH_TYPES = [
  { value: 'none', label: '无鉴权' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'header', label: 'API Key' }
]
// 鉴权 Header 名：字母/数字/连字符 ≤128（与后端 HEADER_NAME_PATTERN 对齐）
const MCP_AUTH_HEADER_NAME_RE = /^[A-Za-z0-9-]{1,128}$/

// 业务系统连接方式（切片3b，后端默认 login_session；本期仅登录态托管一种）
export const BIZ_CONN_TYPES = [{ value: 'login_session', label: '登录态托管' }]
const BIZ_CONN_VALUES = BIZ_CONN_TYPES.map((t) => t.value)
const URL_RE = /^https?:\/\//i

// 业务系统字段上限（2026-09-01 PRD 对齐改造取代旧口径：名称 ≤64、描述必填 ≤2000）
export const BIZ_NAME_MAX = 64 // 名称 ≤64（与连接器名称同口径，B10）
export const BIZ_DESC_MAX = 2000 // 系统描述必填 ≤2000（BQ3 指示）
export const BIZ_URL_MAX = 1024 // URL ≤1024（§2.9）
export const BIZ_PAGE_NAME_MAX = 20 // 业务页名称 ≤20
export const BIZ_PAGE_DESC_MAX = 100 // 业务页描述 ≤100（行级描述沿用旧上限）
export const BIZ_PAGES_MAX = 20 // 业务页条目数 ≤20（选项类上限）
export const BIZ_QUESTION_MAX = 60 // 示例问题每条 ≤60（BQ4 指示）

// 校验业务系统连接定义表单（2026-09-01 PRD 对齐改造取代旧口径，原型 renderBizEditor 终态）。
// 变化：名称 ≤64；图标必填；描述必填 ≤2000；登录地址必填 + http(s)；
// 示例问题固定 3 条均必填（每条 ≤60）；连接方式只读展示、不再校验启用/停用状态。
// 后端为唯一权威（demo 为 mock），前端仅做必填/格式提前拦截。
export function validateBizSystemForm(form) {
  const errors = {}
  const name = (form.name || '').trim()
  if (!name) errors.name = '系统名称必填'
  else if (name.length > BIZ_NAME_MAX) errors.name = `系统名称不超过 ${BIZ_NAME_MAX} 字`

  // 图标必填（BQ5 指示：复用 McpEditor 图标选择范式）
  if (!form.icon) errors.icon = '请选择或上传图标'

  const description = (form.description || '').trim()
  if (!description) errors.description = '系统描述必填'
  else if (description.length > BIZ_DESC_MAX) errors.description = `系统描述不超过 ${BIZ_DESC_MAX} 字`

  // 登录地址必填（B10：标签去「（可选）」）
  const loginUrl = (form.loginUrl || '').trim()
  if (!loginUrl) errors.loginUrl = '登录地址必填'
  else if (loginUrl.length > BIZ_URL_MAX) errors.loginUrl = `登录地址不超过 ${BIZ_URL_MAX} 字`
  else if (!URL_RE.test(loginUrl)) errors.loginUrl = '登录地址需以 http:// 或 https:// 开头'

  if (form.connType && !BIZ_CONN_VALUES.includes(form.connType)) {
    errors.connType = '请选择连接方式'
  }

  // 业务页列表（整体选填，可 0 条）：逐项校验 url 必填且 http(s)://、name 必填≤20、description≤100；条目数 ≤20。
  const pages = Array.isArray(form.bizPages) ? form.bizPages : []
  if (pages.length > BIZ_PAGES_MAX) {
    errors.bizPages = `业务页最多 ${BIZ_PAGES_MAX} 条`
  }
  pages.forEach((p, i) => {
    const url = (p?.url || '').trim()
    if (!url) errors[`bizPages.${i}.url`] = '业务页 URL 必填'
    else if (url.length > BIZ_URL_MAX) errors[`bizPages.${i}.url`] = `业务页 URL 不超过 ${BIZ_URL_MAX} 字`
    else if (!URL_RE.test(url)) errors[`bizPages.${i}.url`] = '业务页 URL 需以 http:// 或 https:// 开头'

    const pname = (p?.name || '').trim()
    if (!pname) errors[`bizPages.${i}.name`] = '业务页名称必填'
    else if (pname.length > BIZ_PAGE_NAME_MAX)
      errors[`bizPages.${i}.name`] = `业务页名称不超过 ${BIZ_PAGE_NAME_MAX} 字`

    const pdesc = (p?.description || '').trim()
    if (pdesc.length > BIZ_PAGE_DESC_MAX)
      errors[`bizPages.${i}.description`] = `业务页描述不超过 ${BIZ_PAGE_DESC_MAX} 字`
  })

  // 示例问题（BQ4）：固定 3 条，保存时均须非空且每条 ≤60
  const qs = [0, 1, 2].map((i) => (form.exampleQuestions?.[i] || '').trim())
  if (qs.some((q) => !q)) errors.exampleQuestions = '示例问题固定 3 条，须全部填写'
  else if (qs.some((q) => q.length > BIZ_QUESTION_MAX))
    errors.exampleQuestions = `示例问题每条不超过 ${BIZ_QUESTION_MAX} 字`

  return { ok: Object.keys(errors).length === 0, errors }
}

// 校验 MCP 定义表单（对齐 PRD-20260828《03能力/连接器/MCP》§三，2026-09-01 改造）。
// code 不再校验：PRD §三.3 拍板 code 系统生成、不展示不填写（demo mock 保存时自动生成）。
export function validateMcpForm(form) {
  const errors = {}
  const name = (form.name || '').trim()
  if (!name) errors.name = '名称必填'
  else if (name.length > 64) errors.name = '名称不超过 64 字'
  if (!(form.description || '').trim()) errors.description = '服务描述必填'
  else if (form.description.trim().length > 2000) errors.description = '服务描述不超过 2000 字'
  if (!form.icon) errors.icon = '请选择或上传图标'
  // 超时：必填，1000～120000 ms（PRD §三.4，默认 10000）
  const t = Number(form.timeoutMs)
  if (!Number.isFinite(t) || t < 1000 || t > 120000) {
    errors.timeoutMs = '请输入 1000-120000 之间的整数'
  }
  if (!MCP_TRANSPORTS.includes(form.transport)) errors.transport = '请选择传输方式'

  // 连接字段按 transport 分流（设计 §6.3）：
  // - streamable-http：endpoint 必填（须 http(s):// 开头）；不校验 command/args/env。
  // - stdio：command 必填；args 每项非空；env KEY 合法且不重复（env 仅 stdio）。
  if (form.transport === 'streamable-http') {
    const endpoint = (form.endpoint || '').trim()
    if (!endpoint) errors.endpoint = 'Endpoint 必填'
    else if (!URL_RE.test(endpoint)) errors.endpoint = 'Endpoint 需以 http:// 或 https:// 开头'
  } else if (form.transport === 'stdio') {
    // Command 必选下拉（2026-09-04 PRD-20260903 对齐：错误文案照新原型 connFields「请选择启动命令」）
    const command = (form.command || '').trim()
    if (!command) errors.command = '请选择启动命令'
    const args = Array.isArray(form.args) ? form.args : []
    if (args.some((a) => !(a || '').trim())) errors.args = '启动参数每项不能为空'
    const envErr = validateMcpEnv(form.env)
    if (envErr) errors.env = envErr
  }

  // 鉴权（仅 streamable-http；与后端 applyAuth 校验对齐，错误键 authConfig 对齐后端 data.field）：
  // - header：Header 名必填且合法；
  // - bearer/header：密钥新建必填；编辑态同类型已配置（authConfigured）可留空=保留原值。
  if (form.transport === 'streamable-http' && form.authType && form.authType !== 'none') {
    if (form.authType === 'header') {
      const hn = (form.authHeaderName || '').trim()
      if (!hn) errors.authConfig = '鉴权 Header 名必填'
      else if (!MCP_AUTH_HEADER_NAME_RE.test(hn))
        errors.authConfig = '鉴权 Header 名仅允许字母 / 数字 / 连字符（不超过 128 字符）'
    }
    if (!errors.authConfig) {
      const hasNew = !!(form.authValue || '').trim()
      if (!hasNew && !form.authConfigured)
        errors.authConfig = '鉴权密钥必填（已配置同类型密钥时留空表示保留原值）'
    }
  }

  // 工具清单只读化：工具由「拉取工具」从 MCP server 同步（name 合法性由 server 保证），
  // 允许保存无工具的 MCP（发布另有非空门禁），前端不再校验 tools。
  return { ok: Object.keys(errors).length === 0, errors }
}

// API 鉴权方式 / 参数位置枚举（设计 §4.1 / §4.2；与后端 NONE/API_KEY/BEARER、HEADER/QUERY/BODY/PATH 对齐）
// BEARER：单 Token，请求时以「Authorization: Bearer <token>」请求头静态附加，无参数名/位置概念
export const API_AUTH_TYPES = [
  { value: 'NONE', label: '不鉴权' },
  { value: 'API_KEY', label: 'API KEY' },
  { value: 'BEARER', label: 'Bearer Token' }
]
export const API_AUTH_IN_OPTIONS = [
  { value: 'HEADER', label: 'Header' },
  { value: 'QUERY', label: 'Query' },
  { value: 'BODY', label: 'Body' },
  { value: 'PATH', label: 'Path' }
]
// 有请求体的 method（BODY 位软提示用；原 §4.5 BODY×GET/DELETE 硬校验已于 2026-09-01 拍板放开——
// 不因技术推断拦配置，组合是否可行由第三方服务实际行为决定，编辑器行级软提示告知风险）
export const API_BODY_METHODS = ['POST', 'PUT', 'PATCH']

