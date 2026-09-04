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

let mcpSeq = 2

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
  })
]

// 服务级发布聚合态（单目标端 USER_END）
const pubAgg = { spark_bridge_mcp: 'PUBLISHED' }

// 【持久化 2026-09-02】状态镜像到 localStorage；写点=下方各 persist() 调用处。
// pubAgg 为 const 对象 → restore 就地覆写（不换引用）。种子里 tools 与 SPARK_TOOLS 同引用，
// 但全部写路径只读或整体替换 tools，不依赖对象同一性，JSON 往返断开别名无影响。
const persist = attachPersist('mcpConnector', {
  // v2（2026-09-04 PRD-20260903 对齐）：种子结构新增工具 title 与 exampleQuestions，旧快照丢弃重播种
  version: 2,
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
  return { list: list.map(toRow), total: list.length }
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
