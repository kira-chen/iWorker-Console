import request from './request'
import * as mcpMock from './mcpConnectorMock'

// 【demo mock】MCP 服务级发布随 MCP 连接器一并走内存 mock（开关口径同 admin.js / apiConnector.js）
const MCP_MOCK = import.meta.env.DEV && import.meta.env.VITE_CONN_MOCK !== '0'

/**
 * 工具市场 M1 API 层（技术方案 §5.1 / §5.4）。
 *
 * 错误处理约定（与 admin.js 同口径，契约 §0.3.1）：
 * - 读接口走全局拦截器（失败弹 toast）。
 * - 写接口加 `skipGlobalError: true`——绕过全局 toast，失败抛 ApiError（带 code/message/field），
 *   由页面自处理（按 body.code/message 反馈）。后端写失败回 HTTP200 + ResultVO.code≠0。
 *
 * 发布工具选择数据源：复用现有 GET /fde/tools/available（三来源可选清单，
 * MCP 项 code 已是运行时限定名 mcp__{mcpCode}__{toolName}、API 项 code=api_def.code），
 * 见 getAvailableTools。契约充分，无需新增后端接口。
 */

// 写接口统一配置：绕过全局错误提示，交页面自处理
const W = { skipGlobalError: true }

/* ============================ 工具市场 listing（技术方案 §5.1） ============================ */

// listing 列表（status/toolType/keyword/target 走后端过滤）→ ListVO<ListingVO>
// V36：ListingVO 带 target 字段；可选 target 过滤（FDE_WORKBENCH/USER_END）。
export function listMarketListings(params = {}) {
  return request.get('/fde/market/listings', { params })
}

// 提交发布（对每个 target 各 upsert 一行 → PENDING_REVIEW）→ ListVO<PublishTargetResultVO>（逐 target 结果）
// payload: { toolType, toolCode, targets:[FDE_WORKBENCH|USER_END,...], displayName?, description? }
// V36：targets 多选（≥1）；返回逐 target 结果 [{ target, listingId?, outcome:CREATED|RESUBMITTED|CONFLICT, message? }]。
// V40：安全字段（writeClass/requiresConfirmation）已下沉工具定义层，由 MCP/API 工具定义配置，发布提交不再填——
//      后端 resolveTool 从工具定义（tools_cache / api_def）读取并落库。
export function createMarketListing(payload) {
  return request.post('/fde/market/listings', payload, W)
}

// 审核（通过/驳回）。
// V39（属性前移）：审核端点已删 writeClass/requiresConfirmation，仅剩 approve + reviewComment。
// payload: { approve, reviewComment? }
//   approve=true  → 通过（→PUBLISHED）
//   approve=false → 须带 reviewComment（→REJECTED）
export function reviewMarketListing(id, payload) {
  return request.post(`/fde/market/listings/${id}/review`, payload, W)
}

// 下架（仅 PUBLISHED → DELISTED）
export function delistMarketListing(id) {
  return request.post(`/fde/market/listings/${id}/delist`, {}, W)
}

// 重新上架（仅 DELISTED → PUBLISHED）
export function relistMarketListing(id) {
  return request.post(`/fde/market/listings/${id}/relist`, {}, W)
}

// 撤回（仅 PENDING_REVIEW，删行 §3.5③）
export function withdrawMarketListing(id) {
  return request.delete(`/fde/market/listings/${id}`, W)
}

/* ============================ MCP 服务级发布（连接器改造一，契约 §3） ============================ */
// 前缀 /fde/market/mcp-services/{mcpId}，与工具粒度 /fde/market/listings 并存。
// 发布动作/状态面向整个 MCP 服务：一键把服务下全部工具发布到多 target；服务级撤回/下架/重新上架；服务级聚合状态。

// 3.1 服务级发布：一键把该 MCP 服务下全部工具发布到指定 targets（≥1，∈ FDE_WORKBENCH/USER_END）。
// writeClass/requiresConfirmation 不再传——后端从工具定义层（tools_cache）读取。
// payload: { targets:[...] } → McpServicePublishResultVO { mcpId, mcpCode, toolTotal, results:[{toolName,toolCode,target,outcome,listingId,message?}] }
export function publishMcpService(mcpId, payload) {
  if (MCP_MOCK) return mcpMock.publishMcpService(mcpId, payload)
  return request.post(`/fde/market/mcp-services/${mcpId}/publish`, payload, W)
}

// 3.2 服务级下架：该服务下全部 PUBLISHED 工具 listing 批量下架（可按 target 过滤）。
// payload: { targets?:[...] }（空=全部 target）→ { affected, skipped }
export function delistMcpService(mcpId, payload = {}) {
  if (MCP_MOCK) return mcpMock.delistMcpService(mcpId, payload)
  return request.post(`/fde/market/mcp-services/${mcpId}/delist`, payload, W)
}

// 3.3 服务级重新上架：该服务下全部 DELISTED 工具 listing 批量上架。入参/响应同 §3.2。
export function relistMcpService(mcpId, payload = {}) {
  if (MCP_MOCK) return mcpMock.relistMcpService(mcpId, payload)
  return request.post(`/fde/market/mcp-services/${mcpId}/relist`, payload, W)
}

// 3.4 服务级撤回：该服务下全部 PENDING_REVIEW 工具 listing 批量删行（撤回）。入参/响应同 §3.2。
export function withdrawMcpService(mcpId, payload = {}) {
  if (MCP_MOCK) return mcpMock.withdrawMcpService(mcpId, payload)
  return request.post(`/fde/market/mcp-services/${mcpId}/withdraw`, payload, W)
}

// 3.6 服务级审核（2026-08-20）：把该 MCP 服务全部在审工具一次性通过/驳回。
// 审核台对 MCP 聚合为「一个服务一条待审记录」，审批走本端点批量放行——逐工具审批会造出
// 「部分已上架」，破坏服务级不变量并让客户端拿到残缺 tools 数组。
// payload: { approve: true } | { approve: false, reviewComment: '必填' } → { affected, skipped }
export function reviewMcpService(mcpId, payload) {
  if (MCP_MOCK) return mcpMock.reviewMcpService(mcpId, payload)
  return request.post(`/fde/market/mcp-services/${mcpId}/review`, payload, W)
}

// 3.5 服务级发布状态聚合查询（按每个 target 聚合）。
// → McpServicePublishStatusVO { mcpId, mcpCode, toolTotal, targets:[{ target, aggregateStatus, publishedCount, pendingCount, rejectedCount, delistedCount, missingCount }] }
// 读接口走全局拦截器（失败弹 toast）。
export function getMcpServicePublishStatus(mcpId) {
  if (MCP_MOCK) return mcpMock.getMcpServicePublishStatus(mcpId)
  return request.get(`/fde/market/mcp-services/${mcpId}/publish-status`)
}

/* ============================ 发布工具选择数据源（复用现有端点） ============================ */

// 三来源可选工具清单（Mock + MCP + API）。发布选择器只用 mcp[] / api[]：
//   mcp[].code   = 运行时限定名 mcp__{mcpCode}__{toolName}（即 listing.toolCode）
//   mcp[].toolName / mcp[].bizName / mcp[].mcpDefId / mcp[].mcpCode
//   api[].code   = api_def.code（即 listing.toolCode）
//   api[].bizName / api[].apiDefId
export function getAvailableTools() {
  return request.get('/fde/tools/available')
}
