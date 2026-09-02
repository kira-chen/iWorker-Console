/**
 * 知识库开发期内存 mock（仅 DEV 生效，见 knowledgeBase.js 头注释）。后端落地后整文件删除。
 *
 * 模型（负责人 2026-08-31 定，对齐「连接器」范式）：
 * - 数据源是独立一等对象（上传 / API / MCP 三类），在「数据源管理」子页建 / 配 / 删；
 *   上传类各自持有文档；API / MCP 持有连通验证态；有 status 启停位（同 MCP / API 页）。
 * - 知识库只**引用**数据源（kb.sourceIds，每类上限 5）；删除被引用的数据源被阻断。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'
import { MAX_SOURCES_PER_TYPE, SOURCE_LABELS } from '@/utils/knowledgeBaseMeta'

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms))
let seq = 100
const nid = (p) => `${p}_${(seq++).toString(36).padStart(11, 'x')}`

const EXPERTS = [
  { id: 'ex_1', name: '方案专家' },
  { id: 'ex_2', name: '售后专家' }
]
const POSITIONS = [
  { id: 'ps_1', name: '销售顾问' },
  { id: 'ps_2', name: 'HR 专员' }
]
const MCPS = [
  { id: 'mcp_1', name: '法规知识库 MCP', tools: [{ name: 'search_regulations', description: '检索法规条文' }, { name: 'list_sources', description: '列出来源' }] },
  { id: 'mcp_2', name: '内部 Wiki MCP', tools: [{ name: 'wiki_search', description: '检索 Wiki 页面' }] }
]
const EMBEDDING_MODELS = [
  { id: 'md_emb_1', name: 'text-embedding-v3' },
  { id: 'md_emb_2', name: 'bge-m3' }
]

/* ---------------- 数据源（全局独立对象） ---------------- */
const mkSrc = (id, sourceType, name, config = {}, verifyStatus = 'UNVERIFIED', status = 'ENABLED') => ({
  id,
  sourceType,
  name,
  status, // ENABLED | DISABLED（同 MCP / API 页的启停位）
  config,
  verifyStatus,
  verifiedAt: verifyStatus === 'SUCCESS' ? '2026-08-28T10:00:00Z' : null,
  verifyError: null,
  createdAt: '2026-08-28T09:00:00Z'
})
const upl = (id, name, over = {}) =>
  mkSrc(id, 'UPLOAD', name, { docKind: 'DOC', simCheck: false, extractLinks: true, plainTextOnly: false, imageUnderstand: false, embeddingModelId: 'md_emb_1', retrieval: 'HYBRID', topK: 5, threshold: 0.35, ...over })
const apiSrc = (id, name, over = {}) =>
  mkSrc(id, 'API', name, { url: 'https://rag.example.com/api/v1/search', method: 'POST', authType: 'API_KEY', authName: 'X-Api-Key', authIn: 'HEADER', authValueMasked: 'sk-***9f2', queryField: 'query', topKField: 'top_k', itemsPath: '$.data[*]', contentField: 'content', sourceField: 'source', scoreField: 'score', timeoutMs: 8000, ...over }, 'SUCCESS')
const mcpSrc = (id, name, over = {}) =>
  mkSrc(id, 'MCP', name, { mode: 'EXISTING', mcpId: 'mcp_1', toolName: 'search_regulations', queryParam: 'query', topKParam: 'limit', contentField: 'text', sourceField: 'title', scoreField: 'score', ...over }, 'SUCCESS')

let sources = [
  upl('ks_1a', '产品资料'),
  upl('ks_1b', '解决方案案例'),
  upl('ks_2a', '报价政策文档'),
  upl('ks_4a', '话术手册'),
  upl('ks_5a', '竞品资料'),
  upl('ks_6a', '白皮书'),
  apiSrc('ks_3a', '国标检索接口'),
  apiSrc('ks_3b', '行标检索接口'),
  apiSrc('ks_5b', '情报平台接口'),
  mcpSrc('ks_1c', '法规库检索'),
  mcpSrc('ks_3c', '法规库 MCP')
]

let rows = [
  { id: 'kb_1', name: '产品与解决方案库', kbType: 'ENTERPRISE', scopeRefId: null, description: '公司全线产品的规格书、解决方案与典型案例，供售前与销售顾问检索。', status: 'PUBLISHED', pendingAction: null, sourceIds: ['ks_1a', 'ks_1b', 'ks_1c'] },
  { id: 'kb_2', name: '报价政策与折扣权限', kbType: 'ENTERPRISE', scopeRefId: null, description: '', status: 'PUBLISHED', pendingAction: null, sourceIds: ['ks_2a'] },
  { id: 'kb_3', name: '法规与标准库', kbType: 'ENTERPRISE', scopeRefId: null, description: '', status: 'DRAFT', pendingAction: 'PUBLISH', sourceIds: ['ks_3a', 'ks_3b', 'ks_3c'] },
  { id: 'kb_4', name: '销售话术与异议处理', kbType: 'POSITION', scopeRefId: 'ps_1', description: '', status: 'PUBLISHED', pendingAction: null, sourceIds: ['ks_4a'] },
  { id: 'kb_5', name: '竞品资料库', kbType: 'POSITION', scopeRefId: 'ps_1', description: '', status: 'PUBLISHED', pendingAction: null, sourceIds: ['ks_5a', 'ks_5b'] },
  { id: 'kb_6', name: '2026 产品白皮书库', kbType: 'EXPERT', scopeRefId: 'ex_1', description: '', status: 'DRAFT', pendingAction: null, sourceIds: ['ks_6a'] },
  { id: 'kb_7', name: '薪酬与绩效制度', kbType: 'ENTERPRISE', scopeRefId: null, description: '', status: 'DRAFT', pendingAction: null, sourceIds: [] }
]
// 文档按上传类数据源 id 归属
const docsBySource = {
  ks_1a: [
    { id: 'doc_1', fileName: '产品总目录-2026H2.pdf', size: 8.4 * 1024 * 1024, chunkCount: 412, parseStatus: 'PARSED', errorReason: null },
    { id: 'doc_3', fileName: '典型案例集-制造业.pdf', size: 12.7 * 1024 * 1024, chunkCount: 0, parseStatus: 'PARSING', errorReason: null },
    { id: 'doc_4', fileName: '报价单模板.xlsx', size: 340 * 1024, chunkCount: 0, parseStatus: 'FAILED', errorReason: '不支持的格式' }
  ],
  ks_1b: [{ id: 'doc_2', fileName: '智慧园区解决方案.docx', size: 2.1 * 1024 * 1024, chunkCount: 96, parseStatus: 'PARSED', errorReason: null }]
}
const seedDocCount = { ks_2a: 46, ks_4a: 312, ks_5a: 168, ks_6a: 52 }

// 【持久化 2026-09-02】状态镜像到 localStorage；写点=下方各 persist() 调用处。
// docsBySource / seedDocCount 为 const 对象 → restore 就地覆写（不换引用）；
// 恢复回来的 PARSING 文档无需归一化——listDocs 读路径本就把 PARSING 转 PARSED，不会卡死。
const persist = attachPersist('knowledgeBase', {
  version: 1,
  snapshot: () => ({ seq, sources, rows, docsBySource, seedDocCount }),
  restore: (d) => {
    if (
      !d || !Number.isFinite(d.seq) || !Array.isArray(d.sources) || !Array.isArray(d.rows) ||
      typeof d.docsBySource !== 'object' || d.docsBySource === null ||
      typeof d.seedDocCount !== 'object' || d.seedDocCount === null
    ) {
      throw new Error('knowledgeBase 快照形状不合法')
    }
    seq = d.seq
    sources = d.sources
    rows = d.rows
    Object.keys(docsBySource).forEach((k) => delete docsBySource[k])
    Object.assign(docsBySource, d.docsBySource)
    Object.keys(seedDocCount).forEach((k) => delete seedDocCount[k])
    Object.assign(seedDocCount, d.seedDocCount)
  }
})

function docCountOf(sourceId) {
  const docs = docsBySource[sourceId]
  return docs ? docs.length : seedDocCount[sourceId] || 0
}
function findSource(id) {
  const s = sources.find((x) => x.id === id)
  if (!s) throw new ApiError({ message: '数据源不存在', code: 404 })
  return s
}
function referencedBy(sourceId) {
  return rows.filter((r) => r.sourceIds.includes(sourceId)).map((r) => ({ id: r.id, name: r.name }))
}
function sourceVO(s) {
  return {
    ...s,
    config: { ...s.config },
    docCount: s.sourceType === 'UPLOAD' ? docCountOf(s.id) : undefined,
    referencedBy: referencedBy(s.id)
  }
}
function scopeName(r) {
  if (r.kbType === 'EXPERT') return EXPERTS.find((e) => e.id === r.scopeRefId)?.name || ''
  if (r.kbType === 'POSITION') return POSITIONS.find((p) => p.id === r.scopeRefId)?.name || ''
  return ''
}
function vo(r) {
  const resolved = r.sourceIds.map((id) => sources.find((s) => s.id === id)).filter(Boolean).map(sourceVO)
  const docCount = resolved.filter((s) => s.sourceType === 'UPLOAD' && s.status === 'ENABLED').reduce((n, s) => n + (s.docCount || 0), 0)
  return { ...r, sourceIds: [...r.sourceIds], scopeRefName: scopeName(r), sources: resolved, docCount }
}
function find(id) {
  const r = rows.find((x) => x.id === id)
  if (!r) throw new ApiError({ message: '知识库不存在', code: 404 })
  return r
}
function conflict(msg) {
  throw new ApiError({ message: msg, code: 409 })
}

/* ================= 知识库 ================= */
export async function list(params = {}) {
  await delay()
  let out = rows
  if (params.keyword) out = out.filter((r) => r.name.includes(params.keyword))
  if (params.kbType) out = out.filter((r) => r.kbType === params.kbType)
  if (params.status) {
    out = out.filter((r) => (params.status === 'PENDING_REVIEW' ? !!r.pendingAction : !r.pendingAction && r.status === params.status))
  }
  const page = Number(params.page) || 1
  const size = Number(params.size) || 20
  return { list: out.slice((page - 1) * size, page * size).map(vo), total: out.length }
}
export async function get(id) {
  await delay()
  return vo(find(id))
}
function validate(payload, selfId) {
  if (!payload.name?.trim()) throw new ApiError({ message: '知识库名称不能为空', code: 400, field: 'name' })
  const dup = rows.find((r) => r.id !== selfId && r.kbType === payload.kbType && r.name.trim().toLowerCase() === payload.name.trim().toLowerCase())
  if (dup) throw new ApiError({ message: '同类型下已存在同名知识库', code: 409, field: 'name' })
  if (payload.kbType !== 'ENTERPRISE' && !payload.scopeRefId) throw new ApiError({ message: '请选择可见范围', code: 400, field: 'scopeRefId' })
  const ids = payload.sourceIds || []
  if (new Set(ids).size !== ids.length) throw new ApiError({ message: '数据源引用重复', code: 400 })
  for (const t of ['UPLOAD', 'API', 'MCP']) {
    const n = ids.filter((id) => sources.find((s) => s.id === id)?.sourceType === t).length
    if (n > MAX_SOURCES_PER_TYPE) throw new ApiError({ message: `${SOURCE_LABELS[t]} 数据源最多引用 ${MAX_SOURCES_PER_TYPE} 个`, code: 400 })
  }
  for (const id of ids) findSource(id)
}
export async function create(payload) {
  await delay()
  validate(payload)
  const r = { id: nid('kb'), name: payload.name.trim(), kbType: payload.kbType, scopeRefId: payload.scopeRefId || null, description: payload.description || '', status: 'DRAFT', pendingAction: null, sourceIds: [...(payload.sourceIds || [])] }
  rows = [r, ...rows]
  persist()
  return vo(r)
}
export async function update(id, payload) {
  await delay()
  const r = find(id)
  if (r.pendingAction) conflict('审核中不可编辑，如需修改请先撤回')
  validate(payload, id)
  const refsChanged = JSON.stringify([...r.sourceIds].sort()) !== JSON.stringify([...(payload.sourceIds || [])].sort())
  Object.assign(r, { name: payload.name.trim(), description: payload.description || '', sourceIds: [...(payload.sourceIds || [])] })
  if (refsChanged && r.status === 'PUBLISHED') r.status = 'DRAFT'
  persist()
  return vo(r)
}
export async function remove(id) {
  await delay()
  const r = find(id)
  if (r.status === 'PUBLISHED' || r.pendingAction) conflict('仅未发布且无待审的知识库可删除')
  rows = rows.filter((x) => x.id !== id)
  persist()
  return null
}
export async function transition(id, action) {
  await delay()
  const r = find(id)
  if (action === 'publish') {
    if (r.status !== 'DRAFT' || r.pendingAction) conflict('提交发布仅允许在未发布状态下执行')
    r.pendingAction = 'PUBLISH'
  } else if (action === 'delist') {
    if (r.status !== 'PUBLISHED' || r.pendingAction) conflict('提交停用仅允许在已发布状态下执行')
    r.pendingAction = 'DELIST'
  } else if (action === 'withdraw') {
    if (!r.pendingAction) conflict('当前没有待审的提交')
    r.pendingAction = null
  }
  persist()
  return vo(r)
}
export async function search(id, params) {
  await delay(500)
  const r = find(id)
  const q = params?.query || ''
  const enabled = r.sourceIds.map((sid) => sources.find((s) => s.id === sid)).filter((s) => s && s.status === 'ENABLED')
  const want = params?.sourceId ? enabled.filter((s) => s.id === params.sourceId) : enabled
  const items = []
  const errors = []
  for (const s of want) {
    if (s.sourceType === 'UPLOAD') {
      items.push({ score: 0.87 - items.length * 0.01, sourceType: 'UPLOAD', sourceId: s.id, sourceName: s.name, source: '售后服务手册-2026.pdf', page: 12, content: `整机质保期自客户签收之日起 24 个月；易损件质保 6 个月。质保期内非人为损坏免费维修或更换。（命中：${q}）` })
      items.push({ score: 0.74 - items.length * 0.01, sourceType: 'UPLOAD', sourceId: s.id, sourceName: s.name, source: '产品总目录-2026H2.pdf', page: 88, content: 'X200 系列：标准质保 24 个月，可选延保；X300 系列：标准质保 36 个月……' })
    } else if (s.sourceType === 'API') {
      items.push({ score: 0.81, sourceType: 'API', sourceId: s.id, sourceName: s.name, source: 'rag.example.com · 售后条款 FAQ', page: null, content: '延保服务可在质保期结束前 30 天内购买，最长延至 5 年；延保期内服务标准与原厂质保一致，但不含耗材。' })
    } else {
      errors.push({ sourceType: 'MCP', sourceId: s.id, sourceName: s.name, message: `${s.name} 检索失败：TIMEOUT（8000 ms）` })
    }
  }
  items.sort((a, b) => b.score - a.score)
  return { items: items.slice(0, params?.topK || 5).map((it, i) => ({ ...it, rank: i + 1 })), errors, elapsedMs: 342 }
}

/* ================= 数据源管理 ================= */
export async function listSources(params = {}) {
  await delay()
  let out = sources
  if (params.keyword) out = out.filter((s) => s.name.includes(params.keyword))
  if (params.sourceType) out = out.filter((s) => s.sourceType === params.sourceType)
  const page = Number(params.page) || 1
  const size = Number(params.size) || 20
  return { list: out.slice((page - 1) * size, page * size).map(sourceVO), total: out.length }
}
export async function getSource(id) {
  await delay()
  return sourceVO(findSource(id))
}
function validateSource(payload, selfId) {
  if (!payload.name?.trim()) throw new ApiError({ message: '数据源名称不能为空', code: 400, field: 'name' })
  const dup = sources.find((s) => s.id !== selfId && s.sourceType === payload.sourceType && s.name.trim().toLowerCase() === payload.name.trim().toLowerCase())
  if (dup) throw new ApiError({ message: '同类型下已存在同名数据源', code: 409, field: 'name' })
}
function mergeConfig(prev, payload) {
  const cfg = { ...(payload.config || {}) }
  if (payload.authValue) cfg.authValueMasked = `${payload.authValue.slice(0, 3)}***${payload.authValue.slice(-3)}`
  else if (prev?.config?.authValueMasked) cfg.authValueMasked = prev.config.authValueMasked
  return cfg
}
export async function createSource(payload) {
  await delay()
  validateSource(payload)
  const s = mkSrc(nid('ks'), payload.sourceType, payload.name.trim(), mergeConfig(null, payload), 'UNVERIFIED', payload.status || 'ENABLED')
  sources = [s, ...sources]
  persist()
  return sourceVO(s)
}
export async function updateSource(id, payload) {
  await delay()
  const s = findSource(id)
  validateSource(payload, id)
  const cfg = mergeConfig(s, payload)
  const connChanged = JSON.stringify({ ...s.config, authValueMasked: 0 }) !== JSON.stringify({ ...cfg, authValueMasked: 0 })
  Object.assign(s, { name: payload.name.trim(), status: payload.status || s.status, config: cfg })
  if (connChanged && s.sourceType !== 'UPLOAD') Object.assign(s, { verifyStatus: 'UNVERIFIED', verifiedAt: null, verifyError: null })
  persist()
  return sourceVO(s)
}
export async function removeSource(id) {
  await delay()
  const s = findSource(id)
  const refs = referencedBy(id)
  if (refs.length) conflict(`该数据源正被 ${refs.length} 个知识库引用（${refs.map((r) => r.name).join('、')}），先在知识库里移除引用`)
  sources = sources.filter((x) => x.id !== id)
  delete docsBySource[id]
  persist()
  return null
}
export async function testSource(sourceType, payload) {
  await delay(900)
  const cfg = payload?.config || {}
  const target = sourceType === 'API' ? cfg.url : cfg.mode === 'INLINE' ? cfg.endpoint : cfg.mcpId
  if (!target) throw new ApiError({ message: sourceType === 'API' ? '请先填写检索地址' : '请先选择或填写 MCP', code: 400 })
  const failed = /fail|timeout/i.test(String(target))
  const result = failed
    ? { verifyStatus: 'FAILED', verifiedAt: new Date().toISOString(), verifyError: 'TIMEOUT: 连接超时（8000 ms）', latencyMs: 8000 }
    : { verifyStatus: 'SUCCESS', verifiedAt: new Date().toISOString(), verifyError: null, latencyMs: 320, toolCount: sourceType === 'MCP' ? 5 : undefined }
  if (payload?.sourceId) {
    const s = sources.find((x) => x.id === payload.sourceId)
    if (s) {
      Object.assign(s, { verifyStatus: result.verifyStatus, verifiedAt: result.verifiedAt, verifyError: result.verifyError })
      persist()
    }
  }
  return result
}
export async function mcpTools(mcpId) {
  await delay(200)
  return MCPS.find((m) => m.id === mcpId)?.tools || []
}

/* ---- 文档（上传类数据源持有） ---- */
export async function listDocs(sourceId) {
  await delay(150)
  findSource(sourceId)
  let changed = false // 持久化 2026-09-02：惰性造种 / 解析态流转 都是写点，变了才落盘
  if (!docsBySource[sourceId] && seedDocCount[sourceId]) {
    docsBySource[sourceId] = Array.from({ length: 3 }, (_, i) => ({ id: nid('doc'), fileName: `示例文档-${i + 1}.pdf`, size: (i + 1) * 1.3 * 1024 * 1024, chunkCount: 60 + i * 17, parseStatus: 'PARSED', errorReason: null }))
    seedDocCount[sourceId] = 0
    changed = true
  }
  const docs = docsBySource[sourceId] || []
  docs.forEach((d) => {
    if (d.parseStatus === 'PARSING') {
      Object.assign(d, { parseStatus: 'PARSED', chunkCount: Math.max(12, Math.round(d.size / 20000)) })
      changed = true
    }
  })
  if (changed) persist()
  return docs.map((d) => ({ ...d }))
}
export async function uploadDoc(sourceId, file) {
  await delay(600)
  findSource(sourceId)
  const d = { id: nid('doc'), fileName: file.name, size: file.size, chunkCount: 0, parseStatus: 'PARSING', errorReason: null }
  docsBySource[sourceId] = [...(docsBySource[sourceId] || []), d]
  persist()
  return { ...d }
}
export async function deleteDoc(sourceId, docId) {
  await delay(200)
  findSource(sourceId)
  docsBySource[sourceId] = (docsBySource[sourceId] || []).filter((d) => d.id !== docId)
  persist()
  return null
}

/* ---- 选择器 ---- */
export async function experts() {
  await delay(100)
  return EXPERTS.map((e) => ({ ...e }))
}
export async function positions() {
  await delay(100)
  return POSITIONS.map((p) => ({ ...p }))
}
export async function mcps() {
  await delay(100)
  return MCPS.map((m) => ({ id: m.id, name: m.name }))
}
export async function embeddingModels() {
  await delay(100)
  return EMBEDDING_MODELS.map((m) => ({ ...m }))
}
