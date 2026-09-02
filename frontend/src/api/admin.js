import request from './request'
import * as mcpMock from './mcpConnectorMock'
import * as bizMock from './bizSystemMock'

/**
 * FDE 配置后台 API 层（Sprint2 契约 v1.1）。
 *
 * 错误处理约定（契约 §0.3.1 / 设计 §8）：
 * - 读接口走全局拦截器（失败弹 toast 即可）。
 * - 写接口加 `skipGlobalError: true`——绕过全局 toast，失败抛 ApiError（带 code/message/field），
 *   由编辑器自处理：有 field 做字段级红框回显，无 field 展示 message；403 提示无权限。
 * - 列表过滤一律走后端 query 参数（keyword/status），前端不本地二次过滤。
 */

// 写接口统一配置：绕过全局错误提示，交编辑器自处理
const W = { skipGlobalError: true }

// 【demo mock】MCP 连接器数据默认走内存 mock（同 apiConnector.js 开关口径，VITE_CONN_MOCK=0 关闭）
const MCP_MOCK = import.meta.env.DEV && import.meta.env.VITE_CONN_MOCK !== '0'

/* ============================ MCP 定义管理（契约 §2） ============================ */

// 2.1 MCP 列表（keyword/status 走后端过滤）
export function listMcp(params = {}) {
  if (MCP_MOCK) return mcpMock.listMcp(params)
  return request.get('/fde/connectors/mcp', { params })
}
// 2.2 MCP 详情（含 tools[] / referencedBySkills / authConfigMasked）
export function getMcp(id) {
  if (MCP_MOCK) return mcpMock.getMcp(id)
  return request.get(`/fde/connectors/mcp/${id}`)
}
// 2.3 新建 MCP
export function createMcp(payload) {
  if (MCP_MOCK) return mcpMock.createMcp(payload)
  return request.post('/fde/connectors/mcp', payload, W)
}
// 2.3 编辑 MCP（code 创建后只读）
export function updateMcp(id, payload) {
  if (MCP_MOCK) return mcpMock.updateMcp(id, payload)
  return request.put(`/fde/connectors/mcp/${id}`, payload, W)
}
// 2.4 删除 MCP（逻辑删 + 引用保护，被 Skill 引用阻断 403）
export function deleteMcp(id) {
  if (MCP_MOCK) return mcpMock.deleteMcp(id)
  return request.delete(`/fde/connectors/mcp/${id}`, W)
}

/* ---- MCP 真实运行时（真实运行时契约 §5；数秒外呼，编辑器自处理错误） ---- */
// 测试连接（草稿/已存）：仅做 initialize 握手，不返工具列表（契约 §2）
export function testMcpConn(payload) {
  if (MCP_MOCK) return mcpMock.testMcpConn(payload)
  return request.post('/fde/connectors/mcp/test-connection', payload, W)
}
// 已存 MCP 真实拉取并回填 tools_cache（契约 §3）
export function fetchMcpTools(id) {
  if (MCP_MOCK) return mcpMock.fetchMcpTools(id)
  return request.post(`/fde/connectors/mcp/${id}/fetch-tools`, {}, W)
}
// 草稿拉取（新建未保存，仅返回不写库，供录入区预览灌入）（契约 §4）
export function fetchMcpToolsDraft(payload) {
  if (MCP_MOCK) return mcpMock.fetchMcpToolsDraft(payload)
  return request.post('/fde/connectors/mcp/fetch-tools', payload, W)
}

/* 注：API 定义与服务提供系统的数据层已迁至 ./apiConnector.js（demo mock，2026-09-01），本文件不再承载。 */

/* ============================ 业务系统连接定义管理（切片3b，FDE 配置侧） ============================ */
// 前缀 /api/fde/connectors/biz-systems（角色门限 ADMIN/FDE）。绝不回显任何用户凭据。

// 【demo mock】业务系统数据默认走内存 mock（同 apiConnector.js 开关口径，VITE_CONN_MOCK=0 关闭）。
// 三态 + pendingAction 状态机 / 软引用删除 / 示例问题等语义见 bizSystemMock.js 头注释。
const BIZ_MOCK = import.meta.env.DEV && import.meta.env.VITE_CONN_MOCK !== '0'

// 业务系统列表（keyword/state 走后端过滤，sort 排序）
// 行内直接带 display 字段（2026-09-01 PRD 对齐）：status/pendingAction/refs/icon/时间三项，
// 免去旧版每行再拉 publication 的双请求编排。
export function listBizSystems(params = {}) {
  if (BIZ_MOCK) return bizMock.listBizSystems(params)
  return request.get('/fde/connectors/biz-systems', { params })
}
// 业务系统详情（含 description/loginUrl/bizPages[]/exampleQuestions[]/referencedBySkills；不含 code、不含凭据）
export function getBizSystem(id) {
  if (BIZ_MOCK) return bizMock.getBizSystem(id)
  return request.get(`/fde/connectors/biz-systems/${id}`)
}
// 新建业务系统（payload：name/icon/description/loginUrl/bizPages[]/exampleQuestions[]；code 后端自动生成，前端不传）
export function createBizSystem(payload) {
  if (BIZ_MOCK) return bizMock.createBizSystem(payload)
  return request.post('/fde/connectors/biz-systems', payload, W)
}
// 编辑业务系统（部分更新；code 由后端管理、不可改、前端不传）
export function updateBizSystem(id, payload) {
  if (BIZ_MOCK) return bizMock.updateBizSystem(id, payload)
  return request.put(`/fde/connectors/biz-systems/${id}`, payload, W)
}
// 删除业务系统（软引用，2026-09-01 拍板：被 Skill 引用亦可删，确认影响后继续）
export function deleteBizSystem(id) {
  if (BIZ_MOCK) return bizMock.deleteBizSystem(id)
  return request.delete(`/fde/connectors/biz-systems/${id}`, W)
}
// 示例问题 AI 生成（BQ4：一次生成 3 条；demo 本地模板随机填充）
export function aiGenerateBizExampleQuestions(payload) {
  if (BIZ_MOCK) return bizMock.aiGenerateBizExampleQuestions(payload)
  return request.post('/fde/connectors/biz-systems/ai-example-questions', payload, W)
}

// ===== 业务系统连接器发布/审核/上下架（V93；双目标端 2026-08-11）=====
// 发布态查询：返回两个目标（FDE_WORKBENCH/USER_END）各自的发布态数组，status=null 表示该目标未发布。
export function getBizSystemPublication(id) {
  return request.get(`/fde/connectors/biz-systems/${id}/publication`)
}
// 提交发布到多目标（FDE，targets ∈ FDE_WORKBENCH/USER_END）。逐 target 独立，返回逐 target 结果。
// mock 收敛为单发布单元：未发布 → 审核中（pendingAction=PUBLISH），忽略 targets。
export function submitBizSystemPublish(id, targets) {
  if (BIZ_MOCK) return bizMock.publishBizSystem(id)
  return request.post(`/fde/connectors/biz-systems/${id}/submit-publish`, { targets }, W)
}
// 审核通过（ADMIN）。mock：按待审类型继续执行（发布→已发布；停用→未发布）。
export function approveBizSystemPublish(id, target) {
  if (BIZ_MOCK) return bizMock.approveBizSystem(id)
  return request.post(`/fde/connectors/biz-systems/${id}/approve`, { target }, W)
}
// 审核驳回（ADMIN，comment 必填）。mock：退回操作前原状。
export function rejectBizSystemPublish(id, target, comment) {
  if (BIZ_MOCK) return bizMock.rejectBizSystem(id)
  return request.post(`/fde/connectors/biz-systems/${id}/reject`, { target, comment }, W)
}
// 撤回（审核中 → 按待审类型恢复：待审发布→未发布，待审停用→已发布）。
export function withdrawBizSystem(id, target) {
  if (BIZ_MOCK) return bizMock.withdrawBizSystem(id)
  return request.post(`/fde/connectors/biz-systems/${id}/withdraw`, { target }, W)
}
// 停用（2026-09-01 PRD 对齐改停用审核流：已发布 → 审核中 pendingAction=DEACTIVATE，
// 审核通过 → 未发布，被拒/撤回 → 已发布）。
export function delistBizSystem(id, target) {
  if (BIZ_MOCK) return bizMock.deactivateBizSystem(id)
  return request.post(`/fde/connectors/biz-systems/${id}/delist`, { target }, W)
}
// 重新上架（FDE，某目标 DELISTED→PUBLISHED）。
export function relistBizSystem(id, target) {
  return request.post(`/fde/connectors/biz-systems/${id}/relist`, { target }, W)
}

/* ---------- N8：业务系统 ↔ 专属技能 绑定管理（业务系统配置侧「配该系统专属 skill」） ---------- */
// 列该业务系统当前绑定的专属技能（返 [{ skillId, name }]）。读接口走全局错误提示。
export function listBizSystemSkills(id) {
  if (BIZ_MOCK) return bizMock.listBizSystemSkills(id)
  return request.get(`/fde/connectors/biz-systems/${id}/skills`)
}
// 从业务系统方向绑定一个专属技能（幂等）。
export function bindBizSystemSkill(id, skillId) {
  return request.put(`/fde/connectors/biz-systems/${id}/skills/${skillId}`, {}, W)
}
// 从业务系统方向解绑一个专属技能（幂等）。
export function unbindBizSystemSkill(id, skillId) {
  return request.delete(`/fde/connectors/biz-systems/${id}/skills/${skillId}`, W)
}

/* ---------- N8（第三类，V72）：业务系统「专属技能」从零新建 / 编辑 / 删除本体 ---------- */
// 与上面 bind/unbind（绑定/解绑「已有技能」）是**两条独立通道**，勿混用：
// - bind/unbind：把一个已存在的技能挂到/取下业务系统（非业务系统专属技能，本体不动）。
// - 下面四个：业务系统「专属技能」（独立第三类）的本体新建/详情/编辑/删除。
// 端点契约见《管理后台-对外服务调用指南》§1.5.1；请求体/返回体沿用技能 SkillUpsertRequest / SkillDetailVO。

// 新建一条业务系统专属技能（从零，不 copy）。payload 至少含 name；返回 SkillDetailVO（含新 skillId）。
export function createBizSystemOwnedSkill(bizId, payload) {
  if (BIZ_MOCK) return bizMock.createBizSystemOwnedSkill(bizId, payload)
  return request.post(`/fde/connectors/biz-systems/${bizId}/skills`, payload, W)
}
// 业务系统专属技能详情（归属校验：须属本业务系统，否则 404）。读接口——但编辑器自处理错误态，故绕过全局提示。
export function getBizSystemOwnedSkillDetail(bizId, skillId) {
  return request.get(`/fde/connectors/biz-systems/${bizId}/skills/${skillId}`, W)
}
// 编辑业务系统专属技能本体（部分更新，body=SkillUpsertRequest）。后端按 origin 分派到「编辑本体」分支。
export function updateBizSystemOwnedSkill(bizId, skillId, payload) {
  return request.put(`/fde/connectors/biz-systems/${bizId}/skills/${skillId}`, payload, W)
}
// 删除业务系统专属技能（后端按 origin 分派：业务系统技能 → 软删本体 + 删绑定）。
export function deleteBizSystemOwnedSkill(bizId, skillId) {
  if (BIZ_MOCK) return bizMock.deleteBizSystemOwnedSkill(bizId, skillId)
  return request.delete(`/fde/connectors/biz-systems/${bizId}/skills/${skillId}`, W)
}

/* ============================ 工具检活（切片3a，契约 §4.4） ============================ */

// 4.4.1 立即检活（同步返回）：type ∈ MCP|API|TABLE|BIZ_SYSTEM
// 回 data: { displayStatus, checkedAt, errorBrief }（errorBrief 仅 kind，脱敏）
export function healthCheckTool(type, toolId) {
  if (MCP_MOCK && String(type).toUpperCase() === 'MCP') return mcpMock.healthCheckMcpTool(toolId)
  return request.post(`/fde/connectors/tools/${type}/${toolId}/health-check`, {}, W)
}
