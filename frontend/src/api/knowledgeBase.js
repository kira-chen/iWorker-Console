import request from './request'
import * as mock from './knowledgeBaseMock'

/**
 * 知识库 API 层（SYS_CONFIG / ADMIN）。设计见 docs/frontend/交互设计-知识库管理.md。
 * 管理端接口，不触碰客户端对外契约。
 *
 * 两组资源（2026-08-31 对齐「连接器」范式改为双子页）：
 * - /fde/knowledge-bases    知识库：基本信息 + 三态审核流 + 对数据源的引用（sourceIds，每类 ≤5）
 * - /fde/knowledge-sources  数据源：独立一等对象（上传 / API / MCP），上传类持有文档
 *
 * 错误处理约定（同 adminModel.js）：读接口走全局 toast；写接口加 skipGlobalError（W），
 * 失败抛 ApiError（带 code/message/field），由抽屉 / 列表页自处理。
 *
 * 【开发期 mock】后端尚未落地（前端先行供负责人调 UI）。开发态默认走内存 mock
 * （`VITE_KB_MOCK=0` 关闭），生产构建永远走真实接口。后端接通后删掉 knowledgeBaseMock.js 与本开关即可。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_KB_MOCK !== '0'
const W = { skipGlobalError: true }
const KB = '/fde/knowledge-bases'
const KS = '/fde/knowledge-sources'

/* ================= 知识库 ================= */
export function listKnowledgeBases(params = {}) {
  if (USE_MOCK) return mock.list(params)
  return request.get(KB, { params })
}
export function getKnowledgeBase(id) {
  if (USE_MOCK) return mock.get(id)
  return request.get(`${KB}/${id}`)
}
// body: { name, kbType, scopeRefId, description, sourceIds: [] }
// sourceIds 引用数据源管理里的数据源，每类（上传 / API / MCP）上限 MAX_SOURCES_PER_TYPE=5。
export function createKnowledgeBase(payload) {
  if (USE_MOCK) return mock.create(payload)
  return request.post(KB, payload, W)
}
export function updateKnowledgeBase(id, payload) {
  if (USE_MOCK) return mock.update(id, payload)
  return request.put(`${KB}/${id}`, payload, W)
}
// 仅未发布且无待审可删
export function deleteKnowledgeBase(id) {
  if (USE_MOCK) return mock.remove(id)
  return request.delete(`${KB}/${id}`, W)
}

/* ---- 发布审核流（对齐模型页 V98：发布与停用都过审，撤回退回原状） ---- */
export function publishKnowledgeBase(id) {
  if (USE_MOCK) return mock.transition(id, 'publish')
  return request.post(`${KB}/${id}/publish`, {}, W)
}
export function delistKnowledgeBase(id) {
  if (USE_MOCK) return mock.transition(id, 'delist')
  return request.post(`${KB}/${id}/delist`, {}, W)
}
export function withdrawKnowledgeBase(id) {
  if (USE_MOCK) return mock.transition(id, 'withdraw')
  return request.post(`${KB}/${id}/withdraw`, {}, W)
}

/* ---- 检索测试（不落库） ---- */
// params: { query, topK, sourceId? }  → { items:[{rank, score, sourceType, sourceId, sourceName, source, page, content}], errors:[…], elapsedMs }
export function searchKnowledgeBase(id, params) {
  if (USE_MOCK) return mock.search(id, params)
  return request.post(`${KB}/${id}/search`, params, W)
}

/* ================= 数据源管理 ================= */
export function listKnowledgeSources(params = {}) {
  if (USE_MOCK) return mock.listSources(params)
  return request.get(KS, { params })
}
export function getKnowledgeSource(id) {
  if (USE_MOCK) return mock.getSource(id)
  return request.get(`${KS}/${id}`)
}
// body: { sourceType(建后不可改), name, status(ENABLED|DISABLED), config, authValue? }
export function createKnowledgeSource(payload) {
  if (USE_MOCK) return mock.createSource(payload)
  return request.post(KS, payload, W)
}
export function updateKnowledgeSource(id, payload) {
  if (USE_MOCK) return mock.updateSource(id, payload)
  return request.put(`${KS}/${id}`, payload, W)
}
// 被知识库引用时阻断（409 带引用清单）
export function deleteKnowledgeSource(id) {
  if (USE_MOCK) return mock.removeSource(id)
  return request.delete(`${KS}/${id}`, W)
}
// 测试连接（API / MCP）：payload = { sourceId?, config, authValue? }，未保存的草稿也可测
export function testKnowledgeSource(sourceType, payload) {
  if (USE_MOCK) return mock.testSource(sourceType, payload)
  return request.post(`${KS}/test/${sourceType}`, payload, W)
}
// MCP 工具清单（选连接器里已有 MCP 时，列它的工具供选检索工具）
export function listMcpToolsForKb(mcpId) {
  if (USE_MOCK) return mock.mcpTools(mcpId)
  return request.get(`/fde/connectors/mcp/${mcpId}`).then((d) => d?.tools || [])
}

/* ---- 文档（上传类数据源持有） ---- */
export function listKnowledgeDocs(sourceId) {
  if (USE_MOCK) return mock.listDocs(sourceId)
  return request.get(`${KS}/${sourceId}/docs`)
}
export function uploadKnowledgeDoc(sourceId, file) {
  if (USE_MOCK) return mock.uploadDoc(sourceId, file)
  const fd = new FormData()
  fd.append('file', file)
  return request.post(`${KS}/${sourceId}/docs`, fd, { ...W, headers: { 'Content-Type': 'multipart/form-data' } })
}
export function deleteKnowledgeDoc(sourceId, docId) {
  if (USE_MOCK) return mock.deleteDoc(sourceId, docId)
  return request.delete(`${KS}/${sourceId}/docs/${docId}`, W)
}

/* ---- 抽屉里的选择器数据源（复用既有接口） ---- */
export function listExpertOptions() {
  if (USE_MOCK) return mock.experts()
  return request.get('/fde/experts', { params: { page: 1, size: 200 } }).then((d) => (Array.isArray(d) ? d : d?.list || []))
}
export function listPositionOptions() {
  if (USE_MOCK) return mock.positions()
  return request.get('/fde/positions', { params: { page: 1, size: 200 } }).then((d) => (Array.isArray(d) ? d : d?.list || []))
}
export function listMcpOptions() {
  if (USE_MOCK) return mock.mcps()
  return request.get('/fde/connectors/mcp', { params: { page: 1, size: 200 } }).then((d) => (Array.isArray(d) ? d : d?.list || []))
}
export function listEmbeddingModelOptions() {
  if (USE_MOCK) return mock.embeddingModels()
  // 待拍板 Q2：建议模型页新增「向量嵌入」类别；此处按该口径取 category=EMBEDDING
  return request.get('/fde/models', { params: { category: 'EMBEDDING' } }).then((d) => (Array.isArray(d) ? d : d?.list || []))
}

export const KB_USING_MOCK = USE_MOCK
