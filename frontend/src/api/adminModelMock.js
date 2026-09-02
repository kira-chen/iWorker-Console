/**
 * 模型配置页内存 mock（demo 数据层，模式同 apiConnectorMock.js；开关见 adminModel.js 头注释）。
 *
 * 模型与状态机对齐 PRD-20260828 交互原型 v2（renderModels L203 / openModelDrawer L235）：
 * - 三态：未发布 DRAFT / 审核中 PENDING_REVIEW / 已发布 PUBLISHED；
 *   pendingAction 区分待审类型（PUBLISH 发布审核 / DELIST 停用审核），撤回按其恢复：
 *   待审发布撤回 → 未发布；待审停用撤回 → 已发布。待审停用期间 status 仍是 PUBLISHED
 *   （客户端仍可用），展示态由 pendingAction 优先判定为「审核中」。
 * - 连通性验证：UNVERIFIED（未验证）/ SUCCESS / FAILED；成功回填能力标签
 *   （流式/工具/JSON/推理），失败带分类原因（explainVerifyError 可解析的技术前缀）。
 * - 连接字段（baseUrl/model/authType/appId/新密钥/extraBody）变更 → 回未发布 + 清验证态。
 * - 排序：默认模型恒在前，两区内按最近更新时间排（默认由近到远）；
 *   重新验证 / 发布 / 撤回 / 停用 / 设默认均不改 updatedAt（只有保存改）。
 * - 名称平台内唯一（≤64 字）；「设为默认」每类别唯一（同类别原默认自动取消）。
 * - 密钥掩码（2026-09-01 全站口径，见 utils/secretMask）：mock 内部存明文（demo 数据层，
 *   供生成掩码），出参只带 apiKeyMasked / appSecretMasked 掩码串、绝不带明文；编辑留空=保留。
 *
 * 种子照原型 modelRows（L190-196，5 行覆盖 已发布默认 / 已发布 / 审核中 / 未发布验证失败 / 未发布未验证）。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'
import { maskSecret } from '@/utils/secretMask'

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const nowIso = () => new Date().toISOString()
const err = (message, field = null, code = 40000) => new ApiError({ code, message, field })

let modelSeq = 106

export const MODEL_NAME_MAX = 64

// 能力四件套（ModelCapabilityTags 消费口径）：true=支持 / false=不支持 / null=未探测
const CAPS_UNPROBED = {
  supportsStreaming: null,
  supportsTools: null,
  supportsJsonMode: null,
  isReasoning: null
}

const mkModel = (over) => ({
  id: over.id,
  name: '',
  providerName: 'other',
  category: 'TEXT',
  baseUrl: '',
  model: '',
  description: '',
  contextWindow: null,
  maxOutputTokens: null,
  defaultTemperature: null,
  extraBody: '',
  authType: 'API_KEY',
  // 凭据（内部明文，仅用于生成首尾掩码；出参经 toRow 脱敏）
  apiKey: '',
  appId: '',
  appSecret: '',
  status: 'DRAFT', // DRAFT / PENDING_REVIEW / PUBLISHED
  pendingAction: null, // null / 'PUBLISH' / 'DELIST'
  isDefault: false,
  verifyStatus: 'UNVERIFIED', // UNVERIFIED / SUCCESS / FAILED
  verifiedAt: null,
  verifyLatencyMs: null,
  verifyError: null,
  ...CAPS_UNPROBED,
  createdAt: null,
  updatedAt: null,
  publishedAt: null, // 最近发布审核通过时间；从未发布为 null
  ...over
})

let models = [
  // 原型 L191：DeepSeek R1 —— 已发布 + 默认，能力四项全亮
  mkModel({
    id: 'md_101',
    name: 'DeepSeek R1',
    providerName: 'deepseek',
    category: 'TEXT',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-reasoner',
    contextWindow: 64000,
    defaultTemperature: 0.6,
    authType: 'API_KEY',
    apiKey: 'sk-demo-deepseek-9f27c1d8e4b8',
    status: 'PUBLISHED',
    isDefault: true,
    verifyStatus: 'SUCCESS',
    verifiedAt: '2026-08-24T09:46:00+08:00',
    verifyLatencyMs: 112,
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    isReasoning: true,
    createdAt: '2026-08-10T10:20:00+08:00',
    updatedAt: '2026-08-24T09:48:00+08:00',
    publishedAt: '2026-08-18T14:10:00+08:00'
  }),
  // 原型 L192：通义千问 Max —— 已发布
  mkModel({
    id: 'md_102',
    name: '通义千问 Max',
    providerName: 'qwen-oauth',
    category: 'TEXT',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-max',
    contextWindow: 32768,
    defaultTemperature: 0.7,
    authType: 'API_KEY',
    apiKey: 'sk-demo-dashscope-a1c95370e6d2',
    status: 'PUBLISHED',
    verifyStatus: 'SUCCESS',
    verifiedAt: '2026-08-23T18:31:00+08:00',
    verifyLatencyMs: 96,
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    isReasoning: false,
    createdAt: '2026-08-12T09:14:00+08:00',
    updatedAt: '2026-08-23T18:32:00+08:00',
    publishedAt: '2026-08-15T16:22:00+08:00'
  }),
  // 原型 L193：企业视觉理解模型 —— 审核中（待审发布），三元组鉴权
  mkModel({
    id: 'md_103',
    name: '企业视觉理解模型',
    providerName: 'other',
    category: 'VISION',
    baseUrl: 'https://model-gateway.intra/v1',
    model: 'vision-pro-2026',
    contextWindow: 16384,
    defaultTemperature: 0.4,
    authType: 'APP_ID_SECRET',
    appId: 'iw-vision',
    apiKey: 'vk-demo-vision-73c0f1a9',
    appSecret: 'vs-demo-secret-58d2b6e4',
    status: 'PENDING_REVIEW',
    pendingAction: 'PUBLISH',
    verifyStatus: 'SUCCESS',
    verifiedAt: '2026-08-22T16:08:00+08:00',
    verifyLatencyMs: 204,
    supportsStreaming: true,
    supportsTools: false,
    supportsJsonMode: true,
    isReasoning: false,
    createdAt: '2026-08-20T11:30:00+08:00',
    updatedAt: '2026-08-22T16:12:00+08:00'
  }),
  // 原型 L194：Kimi K2 —— 未发布、验证失败（改过连接配置后重验才会恢复正常）
  mkModel({
    id: 'md_104',
    name: 'Kimi K2',
    providerName: 'moonshot',
    category: 'TEXT',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2-0711-preview',
    contextWindow: 131072,
    defaultTemperature: 0.6,
    authType: 'API_KEY',
    apiKey: 'sk-demo-moonshot-04f7c2d1',
    status: 'DRAFT',
    verifyStatus: 'FAILED',
    verifiedAt: '2026-08-21T11:02:00+08:00',
    verifyError: 'AUTH_FAILED: 鉴权失败（HTTP 401），请检查密钥',
    createdAt: '2026-08-21T10:40:00+08:00',
    updatedAt: '2026-08-21T11:05:00+08:00',
    // mock 专用：该行验证恒失败，改过连接配置后恢复正常（模拟换对了密钥）
    _mockFail: true
  }),
  // 原型 L195：营销文生图 —— 未发布、尚未验证
  mkModel({
    id: 'md_105',
    name: '营销文生图',
    providerName: 'other',
    category: 'IMAGE_GEN',
    baseUrl: 'https://image-gateway.intra/v1',
    model: 'image-create-v3',
    contextWindow: 4096,
    defaultTemperature: 1,
    authType: 'API_KEY',
    apiKey: 'ik-demo-image-66a1d0f3',
    status: 'DRAFT',
    verifyStatus: 'UNVERIFIED',
    createdAt: '2026-08-20T15:20:00+08:00',
    updatedAt: '2026-08-20T15:20:00+08:00'
  })
]

// 【持久化】（2026-09-02）状态镜像到 localStorage；写点=新建/编辑/删除、验证、
// 发布/停用/撤回/审核通过/驳回、设默认。restore 做最小形状校验，快照不合法即抛错 → 兜底回种子。
// 注：凭据为 demo 假密钥（sk-demo-*），随行落本地存储不触安全红线。
const persist = attachPersist('adminModel', {
  version: 1,
  snapshot: () => ({ modelSeq, models }),
  restore: (d) => {
    if (!d || !Number.isFinite(d.modelSeq) || !Array.isArray(d.models)) {
      throw new Error('adminModel 快照形状不合法')
    }
    modelSeq = d.modelSeq
    models = d.models
  }
})

const findModel = (id) => models.find((m) => m.id === id)

// 展示态（列表筛选口径）：待审停用 status 仍 PUBLISHED，展示按 pendingAction 优先为审核中；
// 历史遗留态（DELISTED/REJECTED）归一为未发布。
function displayKey(m) {
  if (m.pendingAction) return 'PENDING_REVIEW'
  if (m.status === 'PUBLISHED') return 'PUBLISHED'
  if (m.status === 'PENDING_REVIEW') return 'PENDING_REVIEW'
  return 'DRAFT'
}

// 出参视图：凭据明文收敛为首尾掩码，明文绝不出 mock
function toRow(m) {
  const { apiKey, appSecret, _mockFail, ...rest } = m
  return {
    ...rest,
    apiKeyMasked: apiKey ? maskSecret(apiKey) : null,
    hasAppSecret: !!appSecret,
    appSecretMasked: appSecret ? maskSecret(appSecret) : null
  }
}

/* ================= 列表 / 详情 ================= */
export async function listModels(params = {}) {
  await delay(200)
  const kw = (params.keyword || '').trim().toLowerCase()
  let list = models
  if (kw) {
    // 原型 L203：按名称 / 模型标识 / 提供商模糊搜索
    list = list.filter((m) =>
      [m.name, m.model, m.providerName].some((v) => String(v || '').toLowerCase().includes(kw))
    )
  }
  if (params.status) list = list.filter((m) => displayKey(m) === params.status)
  if (params.category) list = list.filter((m) => m.category === params.category)
  // 默认模型在前；两区内按最近更新时间排（默认 desc 由近到远）
  const dir = params.sort === 'asc' ? 1 : -1
  list = [...list].sort((a, b) => {
    if (!!a.isDefault !== !!b.isDefault) return a.isDefault ? -1 : 1
    return dir * String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''))
  })
  return { list: list.map(toRow), total: list.length }
}

export async function getModel(id) {
  await delay(150)
  const m = findModel(id)
  if (!m) throw err('模型不存在')
  return toRow(m)
}

/* ================= 新建 / 编辑 / 删除 ================= */
function validateModelPayload(payload, selfId = null) {
  const name = (payload.name || '').trim()
  if (!name) throw err('模型名称必填', 'name')
  if (name.length > MODEL_NAME_MAX) throw err(`模型名称不超过 ${MODEL_NAME_MAX} 字`, 'name')
  if (models.some((m) => m.name === name && m.id !== selfId)) {
    throw err('模型名称平台内不可重复', 'name')
  }
  if (!/^https?:\/\/[^?#\s]+$/.test((payload.baseUrl || '').trim())) {
    throw err('服务地址（Base URL）必须以 http:// 或 https:// 开头，且不含空格、? 或 #', 'baseUrl')
  }
  if (!(payload.model || '').trim()) throw err('模型标识必填', 'model')
  const cw = Number(payload.contextWindow)
  if (!Number.isInteger(cw) || cw < 1024) throw err('上下文窗口须为不小于 1024 的整数', 'contextWindow')
}

// 连接字段是否变更（口径同 ModelConfigEditDialog.connectionChanged）：
// baseUrl / model / authType / appId / extraBody 任一变化，或提交了新密钥。
function connChanged(m, payload) {
  return (
    (payload.baseUrl || '').trim() !== m.baseUrl ||
    (payload.model || '').trim() !== m.model ||
    (payload.authType || 'API_KEY') !== m.authType ||
    ((payload.appId || '').trim() || '') !== (m.appId || '') ||
    ((payload.extraBody || '').trim() || '') !== (m.extraBody || '') ||
    !!(payload.apiKey || '').trim() ||
    !!(payload.appSecret || '').trim()
  )
}

function applyModelPayload(m, payload) {
  m.providerName = payload.providerName || m.providerName || 'other'
  m.name = payload.name.trim()
  m.category = payload.category || m.category
  m.baseUrl = payload.baseUrl.trim()
  m.model = String(payload.model).trim()
  if ('description' in payload) m.description = payload.description || ''
  m.contextWindow = Number(payload.contextWindow) || null
  if ('maxOutputTokens' in payload) m.maxOutputTokens = payload.maxOutputTokens ?? null
  if ('defaultTemperature' in payload) m.defaultTemperature = payload.defaultTemperature ?? null
  m.extraBody = (payload.extraBody || '').trim()
  const authType = payload.authType === 'APP_ID_SECRET' ? 'APP_ID_SECRET' : 'API_KEY'
  const typeChanged = m.authType !== authType
  m.authType = authType
  m.appId = authType === 'APP_ID_SECRET' ? (payload.appId || '').trim() : ''
  // 凭据留空=保留原明文（换鉴权方式则旧密钥作废）
  m.apiKey = (payload.apiKey || '').trim() || (typeChanged ? '' : m.apiKey)
  m.appSecret =
    authType === 'APP_ID_SECRET'
      ? (payload.appSecret || '').trim() || (typeChanged ? '' : m.appSecret)
      : ''
}

export async function createModel(payload) {
  await delay(250)
  validateModelPayload(payload)
  if (!(payload.apiKey || '').trim()) throw err('api_key 必填', 'apiKey')
  const m = mkModel({ id: `md_${modelSeq++}`, createdAt: nowIso(), updatedAt: nowIso() })
  applyModelPayload(m, payload)
  models.push(m)
  persist()
  return toRow(m)
}

export async function updateModel(id, payload) {
  await delay(250)
  const m = findModel(id)
  if (!m) throw err('模型不存在')
  validateModelPayload(payload, m.id)
  const invalidate = connChanged(m, payload)
  // 默认模型改类别 → 不再作为原类别默认（每类别唯一默认；编辑器已弹确认）
  if (m.isDefault && payload.category && payload.category !== m.category) m.isDefault = false
  applyModelPayload(m, payload)
  if (invalidate) {
    // 连接字段变更：回未发布 + 清验证态（改完必须重验、重新发布才生效）
    m.status = 'DRAFT'
    m.pendingAction = null
    m.verifyStatus = 'UNVERIFIED'
    m.verifiedAt = null
    m.verifyLatencyMs = null
    m.verifyError = null
    Object.assign(m, CAPS_UNPROBED)
    delete m._mockFail // 改过连接配置后，验证重新按正常路径判定
  }
  m.updatedAt = nowIso()
  persist()
  return toRow(m)
}

export async function deleteModel(id) {
  await delay(250)
  const m = findModel(id)
  if (!m) throw err('模型不存在')
  if (displayKey(m) !== 'DRAFT') throw err('仅未发布状态可删除')
  models = models.filter((x) => x.id !== id)
  persist()
  return {}
}

/* ================= 连通性验证 ================= */
export async function verifyModel(id) {
  const m = findModel(id)
  if (!m) throw err('模型不存在')
  await delay(900) // 模拟探测耗时（行内刷新图标旋转可见）
  m.verifiedAt = nowIso()
  if (m._mockFail || (m.baseUrl || '').includes('bad')) {
    m.verifyStatus = 'FAILED'
    m.verifyError = 'AUTH_FAILED: 鉴权失败（HTTP 401），请检查密钥'
    m.verifyLatencyMs = null
    Object.assign(m, CAPS_UNPROBED)
  } else {
    m.verifyStatus = 'SUCCESS'
    m.verifyError = null
    m.verifyLatencyMs = 112
    // 能力自动识别：流式/工具/JSON 恒亮；推理按模型标识启发式
    m.supportsStreaming = true
    m.supportsTools = true
    m.supportsJsonMode = true
    m.isReasoning = /reason|r1\b/i.test(m.model)
  }
  // 注意：验证不改 updatedAt（排序依据是配置更新，不是验证动作）
  persist()
  return toRow(m)
}

/* ================= 发布 / 撤回 / 停用（三态 + pendingAction 状态机） ================= */
export async function publishModel(id) {
  await delay(250)
  const m = findModel(id)
  if (!m) throw err('模型不存在')
  if (displayKey(m) !== 'DRAFT') throw err('仅未发布状态可提交发布')
  if (m.verifyStatus !== 'SUCCESS') throw err('连通性验证通过后才可提交发布')
  m.status = 'PENDING_REVIEW'
  m.pendingAction = 'PUBLISH'
  persist()
  return toRow(m)
}

export async function delistModel(id) {
  await delay(250)
  const m = findModel(id)
  if (!m) throw err('模型不存在')
  if (displayKey(m) !== 'PUBLISHED') throw err('仅已发布状态可提交停用')
  // 停用走停用审核：status 保持 PUBLISHED（审核期间客户端仍可用），展示态转审核中
  m.pendingAction = 'DELIST'
  persist()
  return toRow(m)
}

export async function withdrawModel(id) {
  await delay(250)
  const m = findModel(id)
  if (!m) throw err('模型不存在')
  if (!m.pendingAction) throw err('仅审核中状态可撤回')
  // 按待审类型恢复：待审发布 → 未发布；待审停用 → 已发布
  m.status = m.pendingAction === 'DELIST' ? 'PUBLISHED' : 'DRAFT'
  m.pendingAction = null
  persist()
  return toRow(m)
}

export async function approveModel(id) {
  await delay(250)
  const m = findModel(id)
  if (!m) throw err('模型不存在')
  if (!m.pendingAction) throw err('该模型没有待审事项')
  if (m.pendingAction === 'DELIST') {
    m.status = 'DRAFT'
    m.isDefault = false // 停用生效同时摘掉默认标记
  } else {
    m.status = 'PUBLISHED'
    m.publishedAt = nowIso()
  }
  m.pendingAction = null
  persist()
  return toRow(m)
}

export async function rejectModel(id) {
  await delay(250)
  const m = findModel(id)
  if (!m) throw err('模型不存在')
  if (!m.pendingAction) throw err('该模型没有待审事项')
  // 驳回与撤回同向：退回操作前原状
  m.status = m.pendingAction === 'DELIST' ? 'PUBLISHED' : 'DRAFT'
  m.pendingAction = null
  persist()
  return toRow(m)
}

export async function setDefaultModel(id) {
  await delay(250)
  const m = findModel(id)
  if (!m) throw err('模型不存在')
  if (displayKey(m) !== 'PUBLISHED') throw err('仅已发布模型可设为默认')
  // 每类别唯一默认：同类别原默认自动取消，不影响其它类别
  models.forEach((x) => {
    if (x.category === m.category) x.isDefault = false
  })
  m.isDefault = true
  persist()
  return toRow(m)
}
