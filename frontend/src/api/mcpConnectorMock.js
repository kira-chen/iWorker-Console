/**
 * MCP 连接器页内存 mock（demo 数据层，模式同 apiConnectorMock.js；开关见 admin.js / market.js 接线处）。
 *
 * 覆盖 AdminMcp 列表页与 McpEditor 弹窗的全部交互：
 * - 列表 / 详情 / 新建 / 编辑 / 删除；
 * - 测试连接（仅 initialize 握手回显版本与延迟）与拉取工具（tools/list 全集回填，writeClass 启发式）；
 * - 工具检活（healthCheckTool type=MCP）；
 * - 服务级发布状态机（market.js /fde/market/mcp-services/*）：
 *   NOT_PUBLISHED --publish--> PENDING_REVIEW --review(approve)--> PUBLISHED --delist--> DELISTED --relist--> PUBLISHED；
 *   PENDING_REVIEW --withdraw--> NOT_PUBLISHED；review(reject) --> REJECTED。
 * - 密钥展示统一首尾掩码（2026-09-01 拍板推广模型页口径，见 utils/secretMask）：
 *   凭证/Env 平台值 mock 内部存明文（authSecret / env[].value），出参经 toRow 脱敏为
 *   authInfo.valueMasked / env[].valueMasked 掩码串，明文绝不出 mock；编辑留空=保留。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'
import { maskSecret } from '@/utils/secretMask'

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const nowIso = () => new Date().toISOString()
const err = (message, field = null, code = 40000) => new ApiError({ code, message, field })

let mcpSeq = 12

/* ---------------- 工具全集（server 端权威；拉取工具返回本表） ---------------- */
// 2026-09-04 PRD-20260903 对齐：工具种子补 server 显示名 title（编辑器工具卡「中文名 + 灰色代码名」双层）
const SPARK_TOOLS = [
  {
    name: 'spark_agent_chat',
    title: '智能体对话',
    description: '调用星火平台已发布的智能体进行对话，返回助手回复文本（多轮传 sessionId 续聊）',
    writeClass: 'READ',
    writeClassSource: 'HEURISTIC',
    inputSchema: {
      type: 'object',
      properties: {
        bodyId: { type: 'string', description: '智能体编码' },
        message: { type: 'string', description: '用户消息' },
        sessionId: { type: 'string', description: '会话 id（多轮对话时传上一轮返回值）' }
      },
      required: ['bodyId', 'message']
    }
  },
  {
    name: 'spark_scene_run',
    title: '任务链执行',
    description: '触发星火任务链编排执行并返回节点输出',
    writeClass: 'WRITE',
    writeClassSource: 'HEURISTIC',
    inputSchema: {
      type: 'object',
      properties: {
        bodyId: { type: 'string', description: '任务链编码' },
        input: { type: 'object', description: '节点输入参数（节点 ID → 参数对象）' }
      },
      required: ['bodyId', 'input']
    }
  },
  {
    name: 'spark_knowledge_qa',
    title: '知识库问答',
    description: '基于星火平台知识库进行检索问答',
    writeClass: 'READ',
    writeClassSource: 'HEURISTIC',
    inputSchema: {
      type: 'object',
      properties: {
        bodyId: { type: 'string', description: '知识库编码' },
        question: { type: 'string', description: '用户问题' },
        sessionId: { type: 'string', description: '会话 id（多轮对话时传上一轮返回值）' }
      },
      required: ['bodyId', 'question']
    }
  }
]

/* ---------------- MCP 定义种子 ---------------- */
const mkMcp = (over) => ({
  id: over.code,
  code: over.code,
  name: '',
  icon: '',
  description: '',
  transport: 'streamable-http',
  endpoint: '',
  command: '',
  args: [],
  env: [],
  timeoutMs: null,
  status: 'active',
  // 鉴权：authType none|bearer|header + authHeaderName + authSecret（内部明文，出参掩码化为 authInfo）
  authType: 'none',
  authHeaderName: '',
  authSecret: '',
  tools: [],
  // 示例问题（2026-09-04 PRD-20260903 对齐：新原型 MCP 抽屉示例问题区，固定 3 条）
  exampleQuestions: ['', '', ''],
  referencedBySkills: [],
  // 连接元信息 + 使用统计。注意双口径：connStatus 供编辑器 connMeta（旧三态 ok/failed/unknown），
  // displayStatus 供列表 resolveDisplayStatus（四态 HEALTHY/UNHEALTHY/UNKNOWN/DISABLED）。
  connStatus: 'ok',
  displayStatus: 'HEALTHY',
  protocolVersion: '',
  serverVersion: '',
  serverName: '',
  lastCheckedAt: null,
  lastCheckError: null,
  callCount: 0,
  successCount: 0,
  avgExecMs: null,
  avgCallMs: null,
  successRate: null,
  createdAt: null,
  updatedAt: null,
  publishedAt: null, // 最近发布审核通过时间（PRD §三.9；从未发布为 null）
  ...over
})

/* ---------------- 原型 rows 种子（2026-09-08 批次 2C，原型 L147-L156） ---------------- */
// 生成 n 个占位工具（md §三.5 工具字段：name / title / description / writeClass / inputSchema）。
// 原型只给工具数，工具明细是本地补的通用只读工具，拉取工具后会被 SPARK_TOOLS 全集覆盖（mock 恒定行为）。
function mkTools(n, prefix, label) {
  return Array.from({ length: n }, (_, i) => ({
    name: `${prefix}_tool_${i + 1}`,
    title: `${label}工具 ${i + 1}`,
    description: `${label}相关操作 ${i + 1}`,
    writeClass: i % 3 === 2 ? 'WRITE' : 'READ',
    writeClassSource: 'HEURISTIC',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: '查询条件' } },
      required: ['query']
    }
  }))
}
const refs = (names) => names.map((skillName, i) => ({ skillId: `sk_ref_${i + 1}_${skillName}`, skillName }))
// 原型 updated「2026-08-23 11:02」→ ISO（+08:00）
const iso = (s) => `${s.replace(' ', 'T')}:00+08:00`

const PROTO_SEEDS = [
  { code: 'knowledge_hub', icon: '▤', name: '企业知识库 MCP', transport: 'streamable-http', desc: '连接企业知识库，提供文档检索与内容读取能力', tools: 6, refs: ['市场研究助手', '销售方案生成', '客户问题解答'], updated: '2026-08-23 11:02', agg: 'PUBLISHED', health: 'ok', endpoint: 'https://knowledge.intra/mcp' },
  { code: 'expense_mcp', icon: '¥', name: '报销系统 MCP', transport: 'streamable-http', desc: '查询和提交员工报销单', tools: 4, refs: ['报销单查询', '财务单据助手'], updated: '2026-08-23 09:48', agg: 'PUBLISHED', health: 'bad', error: '服务端返回错误', endpoint: 'https://expense.intra/mcp' },
  { code: 'local_files', icon: '▱', name: '本地文件 MCP', transport: 'stdio', desc: '读取工作区文件并执行受限文件操作', tools: 8, refs: [], updated: '2026-08-22 17:36', agg: 'PENDING_REVIEW', health: 'ok', command: 'npx' },
  { code: 'project_hub', icon: '✓', name: '项目管理 MCP', transport: 'streamable-http', desc: '同步项目、任务和负责人信息', tools: 5, refs: ['项目周报', '任务风险识别', '研发进度跟踪', '会议行动项'], updated: '2026-08-21 14:20', agg: 'NOT_PUBLISHED', health: 'unknown', endpoint: 'https://project.intra/mcp' },
  { code: 'data_lab', icon: '⌁', name: '数据分析 MCP', transport: 'stdio', desc: '运行数据查询并生成结构化分析结果', tools: 0, refs: [], updated: '2026-08-19 16:11', agg: 'NOT_PUBLISHED', health: 'ok', command: 'uvx' },
  { code: 'mail_center', icon: '✉', name: '邮件中心 MCP', transport: 'streamable-http', desc: '查询邮件并创建发送任务', tools: 3, refs: ['客户跟进助手'], updated: '2026-08-18 09:32', agg: 'NOT_PUBLISHED', health: 'ok', endpoint: 'https://mail.intra/mcp' },
  { code: 'calendar', icon: '▦', name: '日历 MCP', transport: 'streamable-http', desc: '查询团队日程并创建会议', tools: 4, refs: ['会议行动项'], updated: '2026-08-16 17:08', agg: 'PUBLISHED', health: 'ok', endpoint: 'https://calendar.intra/mcp' },
  { code: 'crm', icon: '♙', name: 'CRM MCP', transport: 'streamable-http', desc: '查询客户资料及商机状态', tools: 7, refs: ['销售方案生成'], updated: '2026-08-15 14:26', agg: 'PENDING_REVIEW', health: 'ok', endpoint: 'https://crm.intra/mcp' },
  { code: 'contract', icon: '▧', name: '合同系统 MCP', transport: 'stdio', desc: '检索合同并读取审批状态', tools: 2, refs: [], updated: '2026-08-13 10:05', agg: 'NOT_PUBLISHED', health: 'unknown', command: 'node' },
  { code: 'assets', icon: '⌂', name: '资产管理 MCP', transport: 'streamable-http', desc: '查询办公资产和领用记录', tools: 4, refs: [], updated: '2026-08-11 16:44', agg: 'NOT_PUBLISHED', health: 'bad', error: '连接超时', endpoint: 'https://assets.intra/mcp' }
]

function seedToMcp(s) {
  const HEALTH = { ok: ['HEALTHY', 'ok'], bad: ['UNHEALTHY', 'failed'], unknown: ['UNKNOWN', 'unknown'] }
  const [displayStatus, connStatus] = HEALTH[s.health]
  const updatedAt = iso(s.updated)
  return mkMcp({
    code: s.code,
    name: s.name,
    icon: s.icon,
    description: s.desc,
    transport: s.transport,
    endpoint: s.endpoint || '',
    command: s.command || '',
    args: s.command ? ['-y', `@modelcontextprotocol/server-${s.code.replace(/_/g, '-')}`] : [],
    timeoutMs: 10000,
    tools: mkTools(s.tools, s.code, s.name.replace(/ MCP$/, '')),
    exampleQuestions: [`帮我查一下${s.name.replace(/ MCP$/, '')}里的最新记录`, '帮我查询当前可用的工具', '帮我执行一次常用业务操作'],
    referencedBySkills: refs(s.refs),
    connStatus,
    displayStatus,
    protocolVersion: s.health === 'unknown' ? '' : '2025-06-18',
    serverVersion: s.health === 'unknown' ? '' : '1.4.2',
    serverName: s.health === 'unknown' ? '' : s.code,
    // 原型「未探测」行 check 为空 → 从未验证；其余最近验证时间 = 最近更新时间
    lastCheckedAt: s.health === 'unknown' ? null : updatedAt,
    lastCheckError: s.health === 'bad' ? s.error : null,
    createdAt: updatedAt,
    updatedAt,
    publishedAt: s.agg === 'PUBLISHED' ? updatedAt : null
  })
}

let mcps = [
  mkMcp({
    code: 'spark_bridge_mcp',
    name: '星火智能体桥接 MCP',
    icon: '🔥',
    description:
      '将星火智能体平台 v3 会话能力（智能体 / 任务链 / 知识库）封装为 MCP 工具供技能引用；由外部桥接服务承载，按 OpenAI 协议转发星火端点',
    transport: 'streamable-http',
    endpoint: 'https://bridge.example.com/spark/mcp',
    timeoutMs: 15000,
    authType: 'bearer',
    authSecret: '9a7f3c21:e4b8d6f2a1c95370',
    tools: SPARK_TOOLS,
    // 示例问题种子（照新原型 MCP rows 兜底种子逐字）
    exampleQuestions: [
      '帮我发起一个明天下午的请假审批',
      '帮我查询当前可用的工具',
      '帮我执行一次常用业务操作'
    ],
    referencedBySkills: [{ skillId: 'sk_6', skillName: '产品知识问答' }],
    protocolVersion: '2025-06-18',
    serverVersion: '1.4.2',
    serverName: 'spark-bridge',
    lastCheckedAt: '2026-09-01T11:05:00+08:00',
    callCount: 326,
    successCount: 318,
    avgExecMs: 2140,
    avgCallMs: 2290,
    successRate: 0.9755,
    createdAt: '2026-09-01T10:20:00+08:00',
    updatedAt: '2026-09-01T11:05:00+08:00',
    publishedAt: '2026-09-01T11:05:00+08:00'
  }),
  // ---- 2026-09-08 原型复刻批次 2C：种子补齐到 11 条（原型 L147-L157 rows #1–#10，逐字段照搬；
  // 星火桥接行保留为第 1 条，供审核中心 / 我的申请 mock 引用）。字段按 md：
  // 工具数 → tools[] 条数；引用情况 → referencedBySkills；验证 → displayStatus/lastCheckedAt
  // （原型 check = updated 的 MM-DD HH:mm，故 lastCheckedAt = updatedAt）；异常原因取代码检活错误目录
  // （utils/mcpVerify MCP_ERROR_CATALOG）而非原型自造码 AUTH_401 / CONNECT_TIMEOUT（原型缺陷不搬）。
  ...PROTO_SEEDS.map(seedToMcp)
]

// 服务级发布聚合态（单目标端 USER_END）：原型 status 已发布 / 审核中 / 未发布 → 三态聚合键
const pubAgg = {
  spark_bridge_mcp: 'PUBLISHED',
  ...Object.fromEntries(PROTO_SEEDS.map((s) => [s.code, s.agg]))
}

// 【持久化 2026-09-02】状态镜像到 localStorage；写点=下方各 persist() 调用处。
// pubAgg 为 const 对象 → restore 就地覆写（不换引用）。种子里 tools 与 SPARK_TOOLS 同引用，
// 但全部写路径只读或整体替换 tools，不依赖对象同一性，JSON 往返断开别名无影响。
const persist = attachPersist('mcpConnector', {
  // v2（2026-09-04 PRD-20260903 对齐）：种子结构新增工具 title 与 exampleQuestions，旧快照丢弃重播种
  // v3（2026-09-08 原型复刻批次 2C）：种子由 1 条补齐到 11 条（原型 rows），旧快照丢弃重播种
  version: 3,
  snapshot: () => ({ mcpSeq, mcps, pubAgg }),
  restore: (d) => {
    if (!d || !Number.isFinite(d.mcpSeq) || !Array.isArray(d.mcps) || typeof d.pubAgg !== 'object' || d.pubAgg === null) {
      throw new Error('mcpConnector 快照形状不合法')
    }
    mcpSeq = d.mcpSeq
    mcps = d.mcps
    Object.keys(pubAgg).forEach((k) => delete pubAgg[k])
    Object.assign(pubAgg, d.pubAgg)
  }
})

const findMcp = (id) => mcps.find((m) => m.id === id || m.code === id)

// 列表行视图：补 toolCount / referencedBySkillCount；鉴权与 Env 脱敏为掩码出参（明文绝不出 mock）
function toRow(m) {
  const { authSecret, authHeaderName, authType, env, ...rest } = m
  return {
    ...rest,
    // 鉴权脱敏 VO：authInfo = { type, headerName?, valueMasked 掩码串 }（编辑器消费口径）
    authConfigMasked: !!authSecret,
    authInfo:
      authType && authType !== 'none'
        ? {
            type: authType,
            ...(authType === 'header' ? { headerName: authHeaderName } : {}),
            valueMasked: maskSecret(authSecret)
          }
        : null,
    // Env 脱敏：平台值 → 掩码串；clientFill 行无值
    env: (env || []).map((e) => ({
      key: e.key,
      description: e.description || '',
      clientFill: !!e.clientFill,
      valueMasked: e.clientFill ? false : e.value ? maskSecret(e.value) : false
    })),
    toolCount: (m.tools || []).length,
    referencedBySkillCount: (m.referencedBySkills || []).length
  }
}

/* ================= 列表 / 详情 / 增删改 ================= */
// 聚合六态 → 列表三态键（DELISTED / REJECTED / PARTIAL 均归未发布；与 AdminMcp.stateKey 同口径）
function aggStateKey(id) {
  const a = pubAgg[id] || 'NOT_PUBLISHED'
  if (a === 'PUBLISHED') return 'PUBLISHED'
  if (a === 'PENDING_REVIEW') return 'PENDING_REVIEW'
  return 'NOT_PUBLISHED'
}

/**
 * 列表（2026-09-08 原型复刻批次 2C：种子 11 条后补齐服务端语义）：
 * params = { keyword（名称/描述模糊）, state（三态聚合键 PUBLISHED/PENDING_REVIEW/NOT_PUBLISHED）,
 *            status（启用/停用，另一维度）, sort（asc|desc，按 updatedAt；md §二.5 默认由近到远）, page, size }
 * 返回当页 list + 过滤后全量 total（AdminMcp 走 useAdminList 默认服务端分页模式）。
 */
export async function listMcp(params = {}) {
  await delay(200)
  const kw = (params.keyword || '').trim().toLowerCase()
  let list = mcps
  if (kw) {
    list = list.filter(
      (m) => m.name.toLowerCase().includes(kw) || (m.description || '').toLowerCase().includes(kw)
    )
  }
  if (params.status) list = list.filter((m) => m.status === params.status)
  if (params.state) list = list.filter((m) => aggStateKey(m.id) === params.state)
  const dir = params.sort === 'asc' ? 1 : -1
  list = [...list].sort((a, b) => dir * String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')))
  const total = list.length
  if (params.page && params.size) {
    const start = (Number(params.page) - 1) * Number(params.size)
    list = list.slice(start, start + Number(params.size))
  }
  return { list: list.map(toRow), total }
}

export async function getMcp(id) {
  await delay(150)
  const m = findMcp(id)
  if (!m) throw err('MCP 不存在')
  return toRow(m)
}

// 通用字段合并（新建/编辑共用）：鉴权入参 authConfig={type,headerName?,value?} → 脱敏形态落库
function applyMcpPayload(m, payload) {
  if (payload.name != null) m.name = String(payload.name).trim()
  if (payload.icon != null) m.icon = payload.icon
  if (payload.description != null) m.description = String(payload.description).trim()
  if (payload.transport) m.transport = payload.transport
  if (payload.endpoint != null) m.endpoint = String(payload.endpoint).trim()
  if (payload.command != null) m.command = String(payload.command).trim()
  if (Array.isArray(payload.args)) m.args = payload.args
  if ('timeoutMs' in payload) m.timeoutMs = payload.timeoutMs
  if (payload.status) m.status = payload.status
  // 示例问题（2026-09-04 PRD-20260903 对齐）：固定 3 行落库 + 回显（缺省补空串）
  if (Array.isArray(payload.exampleQuestions)) {
    m.exampleQuestions = [0, 1, 2].map((i) => String(payload.exampleQuestions[i] || '').trim())
  }
  // Env（stdio）：按 KEY merge，留空=保留旧明文；clientFill 行不存值
  if (Array.isArray(payload.env)) {
    const oldEnv = m.env || []
    m.env = payload.env
      .filter((e) => (e?.key || '').trim())
      .map((e) => {
        const key = e.key.trim()
        const prev = oldEnv.find((o) => o.key === key)
        return {
          key,
          description: (e.description || '').trim(),
          clientFill: !!e.clientFill,
          value: e.clientFill ? '' : (e.value || '') || prev?.value || ''
        }
      })
  }
  if (Array.isArray(payload.tools)) {
    // 工具全集只读（来自拉取）；保存仅落 writeClass 人工标注
    m.tools = payload.tools.map((t) => ({
      ...(m.tools.find((o) => o.name === t.name) || {}),
      ...t,
      writeClassSource: t.writeClassSource || 'MANUAL'
    }))
  }
  // 鉴权（编辑器 buildAuthConfig：bearer 带 token、header 带 value；留空=保留同类型旧密钥）
  const ac = payload.authConfig
  if (ac && ac.type) {
    if (ac.type === 'none') {
      m.authType = 'none'
      m.authHeaderName = ''
      m.authSecret = ''
    } else {
      const secret = (ac.token || ac.value || '').trim()
      const typeChanged = m.authType !== ac.type
      m.authType = ac.type
      m.authHeaderName = ac.type === 'header' ? (ac.headerName || '').trim() : ''
      m.authSecret = secret || (typeChanged ? '' : m.authSecret)
    }
  }
}

export async function createMcp(payload) {
  await delay(250)
  const code = (payload.code || '').trim() || `mcp_${mcpSeq}`
  if (findMcp(code)) throw err('code 已存在', 'code')
  mcpSeq += 1
  const m = mkMcp({
    code,
    displayStatus: 'UNKNOWN',
    connStatus: 'unknown',
    createdAt: nowIso(),
    updatedAt: nowIso()
  })
  applyMcpPayload(m, payload)
  mcps.push(m)
  pubAgg[m.id] = 'NOT_PUBLISHED'
  persist()
  return toRow(m)
}

export async function updateMcp(id, payload) {
  await delay(250)
  const m = findMcp(id)
  if (!m) throw err('MCP 不存在')
  applyMcpPayload(m, payload)
  m.updatedAt = nowIso()
  persist()
  return toRow(m)
}

export async function deleteMcp(id) {
  await delay(250)
  // 软引用（PRD §二.3.7）：被技能引用亦可删——列表侧已做「确认影响后继续删除」二次确认
  mcps = mcps.filter((m) => m.id !== id && m.code !== id)
  persist()
  return {}
}

/* ================= 真实运行时（demo 模拟） ================= */
export async function testMcpConn() {
  await delay(700) // 模拟握手耗时
  return { ok: true, protocolVersion: '2025-06-18', serverVersion: '1.4.2', latencyMs: 86 }
}

// 拉取工具：server 返回即全集（demo 固定星火桥接工具集），并就地刷新连接元信息
async function fetchToolsResult(m) {
  await delay(900)
  const meta = {
    connStatus: 'ok',
    protocolVersion: '2025-06-18',
    serverVersion: '1.4.2',
    serverName: 'spark-bridge'
  }
  if (m) {
    m.tools = SPARK_TOOLS.map((t) => ({ ...t }))
    Object.assign(m, meta, { lastCheckedAt: nowIso(), displayStatus: 'HEALTHY' })
    persist()
  }
  return { tools: SPARK_TOOLS.map((t) => ({ ...t })), ...meta }
}
export function fetchMcpTools(id) {
  return fetchToolsResult(findMcp(id))
}
export function fetchMcpToolsDraft() {
  return fetchToolsResult(null)
}

// 工具检活（healthCheckTool type=MCP）：demo 恒健康
export async function healthCheckMcpTool(id) {
  const m = findMcp(id)
  await delay(900)
  if (m) {
    m.displayStatus = 'HEALTHY'
    m.connStatus = 'ok'
    m.lastCheckedAt = nowIso()
    m.lastCheckError = null
    persist()
  }
  return { displayStatus: 'HEALTHY', checkedAt: nowIso(), errorBrief: null }
}

/* ================= 服务级发布（market.js 接线） ================= */
export async function getMcpServicePublishStatus(id) {
  await delay(120)
  const m = findMcp(id)
  return {
    mcpId: id,
    mcpCode: m?.code || id,
    toolTotal: (m?.tools || []).length,
    targets: [{ target: 'USER_END', aggregateStatus: pubAgg[id] || 'NOT_PUBLISHED' }]
  }
}

function setAgg(id, status) {
  pubAgg[id] = status
  // 2026-09-04 PRD-20260903 对齐：转入已发布时刷新最近发布时间（publishedAt 出参；从未发布保持 null → 界面显「—」）
  if (status === 'PUBLISHED') {
    const m = findMcp(id)
    if (m) m.publishedAt = nowIso()
  }
  persist()
  return { affected: (findMcp(id)?.tools || []).length, skipped: 0 }
}
export async function publishMcpService(id) {
  await delay(250)
  const m = findMcp(id)
  if (!m) throw err('MCP 不存在')
  pubAgg[id] = 'PENDING_REVIEW'
  persist()
  return { mcpId: id, mcpCode: m.code, toolTotal: m.tools.length, results: [] }
}
export async function withdrawMcpService(id) {
  await delay(250)
  return setAgg(id, 'NOT_PUBLISHED')
}
export async function delistMcpService(id) {
  await delay(250)
  return setAgg(id, 'DELISTED')
}
export async function relistMcpService(id) {
  await delay(250)
  return setAgg(id, 'PUBLISHED')
}
export async function reviewMcpService(id, payload = {}) {
  await delay(250)
  return setAgg(id, payload.approve ? 'PUBLISHED' : 'REJECTED')
}
