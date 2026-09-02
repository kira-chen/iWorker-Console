import request from './request'
import * as mock from './domainExpertMock'

/**
 * 「专家」模块 API 层（系统配置员 SYS_CONFIG）。落 /api/fde/experts。
 *
 * 专家 = 把多个「市场技能」归类整合成一个可交付单元。整体机制与岗位一致（发布 + 版本号 + 下架/重上），
 * 但只引用市场技能，与 FDE 技能数据隔离——引用非市场技能后端一律 404。
 *
 * 【demo mock（2026-09-01 PRD 对齐改造）】项目已降级为纯前端 demo，本模块数据默认走内存 mock
 * （domainExpertMock.js；`VITE_EXPERT_MOCK=0` 可关闭走真实接口路径，模式同 apiConnector.js / position.js）。
 * 市场技能候选（编辑抽屉内嵌选择器）由 mock 自带种子，不依赖 platformSkill.js。
 *
 * 注意与「岗位」无关：岗位走 /api/fde/positions（api/position.js）。两者仅因历史承接而在物理表名上同源
 * （岗位物理表名就叫 expert），业务上完全独立，不要混用两套 API。
 *
 * 错误处理约定（沿用 position.js / skillCategory.js 范式）：
 * - 读接口走全局拦截器，失败弹 toast；
 * - 写接口加 skipGlobalError（W）→ 抛 ApiError（带 code/message/field），由页面做字段级红框/就地提示。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_EXPERT_MOCK !== '0'
const W = { skipGlobalError: true }

/* ---------- 专家 CRUD ---------- */

// 列表（服务端分页）。params: { keyword?, category?, status?(''|draft|review|published), sort?, page, size }。
// 返回 { list, total }。
export function listExperts(params) {
  if (USE_MOCK) return mock.listExperts(params)
  return request.get('/fde/experts', { params })
}

// 详情（含引用的市场技能清单 skills[] + 示例问题 exampleQuestions[3]）。
export function getExpert(expertId) {
  if (USE_MOCK) return mock.getExpert(expertId)
  return request.get(`/fde/experts/${expertId}`)
}

// 新建（body: { name, category, avatar, intro, roleDesc, exampleQuestions[3], skillIds[] }）。初始 draft。
export function createExpert(payload) {
  if (USE_MOCK) return mock.createExpert(payload)
  return request.post('/fde/experts', payload, W)
}

// 编辑基本信息 / 示例问题 / 技能引用（部分更新：只传的字段才改）。
export function updateExpert(expertId, payload) {
  if (USE_MOCK) return mock.updateExpert(expertId, payload)
  return request.put(`/fde/experts/${expertId}`, payload, W)
}

// 删除前影响面：{ name, skillRefCount, publicationCount, published }。
// 【接口保留（Z7 拍板）】2026-09-01 起删除确认的引用数 N 直接取列表行 skillCount，不再前置调用本接口。
export function getExpertDeleteImpact(expertId) {
  if (USE_MOCK) return mock.getExpertDeleteImpact(expertId)
  return request.get(`/fde/experts/${expertId}/delete-impact`)
}

// 删除（软删 + 清理技能引用）。返回被解除的引用数。
// confirmName 为旧「回填专家名强确认」参数，2026-09-01 降级为普通二次确认后不再必传（真实接口兼容保留）。
export function deleteExpert(expertId, confirmName) {
  if (USE_MOCK) return mock.deleteExpert(expertId, confirmName)
  return request.delete(`/fde/experts/${expertId}`, { params: { confirmName }, ...W })
}

/* ---------- 市场技能候选 / 引用 ---------- */

// 市场技能候选（编辑抽屉内嵌选择器）。params: { keyword?（按名称/描述/分类） }。返回数组。
export function listExpertSkillCandidates(params) {
  if (USE_MOCK) return mock.listExpertSkillCandidates(params)
  return request.get('/fde/experts/skill-candidates', { params })
}

// 引用一个市场技能（幂等）。返回更新后的详情。
export function addExpertSkill(expertId, skillId) {
  if (USE_MOCK) return mock.addExpertSkill(expertId, skillId)
  return request.post(`/fde/experts/${expertId}/skills`, { skillId }, W)
}

// 解除引用（幂等）。技能本体不动——同一市场技能可能还被别的专家引用着。
export function removeExpertSkill(expertId, skillId) {
  if (USE_MOCK) return mock.removeExpertSkill(expertId, skillId)
  return request.delete(`/fde/experts/${expertId}/skills/${skillId}`, W)
}

// 批量重排专家内技能顺序（body: { skillIds: [...] }，按数组顺序落 sortOrder）。
// 【当前无调用方，勿当死代码删（Z7 拍板保留）】sortOrder 目前只影响后台显示顺序、无下游消费方，
// 真正让顺序有意义的是对客户端下发时的技能展示先后，而下发尚未定案。定案后前端直接接回来即可。
export function reorderExpertSkills(expertId, skillIds) {
  if (USE_MOCK) return mock.reorderExpertSkills(expertId, skillIds)
  return request.put(`/fde/experts/${expertId}/skills/order`, { skillIds }, W)
}

/* ---------- 发布 / 版本 ---------- */

// 提交发布（body: { bump, releaseNotes }）→ 进入审核。
export function publishExpert(expertId, payload) {
  if (USE_MOCK) return mock.publishExpert(expertId, payload)
  return request.post(`/fde/experts/${expertId}/publish`, payload, W)
}

// 下一个建议展示版本号（无历史 → v1.0.0）。
export function getExpertNextVersionLabel(expertId) {
  if (USE_MOCK) return mock.getExpertNextVersionLabel(expertId)
  return request.get(`/fde/experts/${expertId}/next-version-label`)
}

// 停用（整专家下架）→ 提交停用审核。历史版本记录不动。
export function unpublishExpert(expertId) {
  if (USE_MOCK) return mock.unpublishExpert(expertId)
  return request.post(`/fde/experts/${expertId}/unpublish`, {}, W)
}

// V104 审核（ADMIN）/ 撤回（提交人）。approve/reject 无页面调用方（审核在审核中心），不走 mock 分流。
export function approveExpert(expertId) {
  return request.post(`/fde/experts/${expertId}/approve`, {}, W)
}
export function rejectExpert(expertId, comment) {
  return request.post(`/fde/experts/${expertId}/reject`, { comment }, W)
}
export function withdrawExpert(expertId) {
  if (USE_MOCK) return mock.withdrawExpert(expertId)
  return request.post(`/fde/experts/${expertId}/withdraw`, {}, W)
}

// 版本历史（新→旧）。
export function listExpertPublications(expertId) {
  if (USE_MOCK) return mock.listExpertPublications(expertId)
  return request.get(`/fde/experts/${expertId}/publications`)
}

// 历史版本禁用（记录保留，仅改 status）。注意专家按 **publicationId** 定位（与岗位按 version 不同）。
export function delistExpertPublication(expertId, publicationId) {
  if (USE_MOCK) return mock.delistExpertPublication(expertId, publicationId)
  return request.post(`/fde/experts/${expertId}/publications/${publicationId}/delist`, {}, W)
}

// 历史版本重新启用（互斥：同一时间只能启用一个版本）。
export function relistExpertPublication(expertId, publicationId) {
  if (USE_MOCK) return mock.relistExpertPublication(expertId, publicationId)
  return request.post(`/fde/experts/${expertId}/publications/${publicationId}/relist`, {}, W)
}
