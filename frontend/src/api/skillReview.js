import request from './request'
import * as mock from './skillReviewMock'

/**
 * 用户技能审核 API 层（05 治理 / 用户技能审核；2026-09-08 PRD-20260908 对齐整页重做）。
 *
 * 前缀 /api/fde/user-skill-reviews + 风险设置 /api/fde/user-skill-reviews/risk-config
 * + 字段管理 /api/fde/field-management（无页面调用方，仅保留接口壳）。
 *
 * 【demo mock】页面所调接口默认走内存 mock（skillReviewMock.js；`VITE_GOV_MOCK=0` 可关闭走真实接口路径，
 * 开关同 reviews.js / feedback.js 治理段口径）。字段管理·风险类型/风险等级 CRUD 无页面调用方
 * （字段字典页走 fieldDict.js），不 mock，demo 下调用会 404，属已知限制。
 *
 * 错误处理沿用范式：读接口走全局拦截器（失败弹 toast）；写接口加 skipGlobalError → 失败抛 ApiError 交页面自处理。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_GOV_MOCK !== '0'
const W = { skipGlobalError: true }

/* ==================== 审核记录 ==================== */

/** 审核列表（分页 + keyword/scale/status/sort 可选）。 */
export function listReviewApplications(params) {
  if (USE_MOCK) return mock.listReviewApplications(params)
  return request.get('/fde/user-skill-reviews', { params })
}

/** 审核记录详情（只读快照：基本信息 + SKILL.MD + 检测明细 + 审核结果）。 */
export function getReviewApplication(reviewId) {
  if (USE_MOCK) return mock.getReviewApplication(reviewId)
  return request.get(`/fde/user-skill-reviews/${reviewId}`)
}

/** 通过。body: { reviewer }。 */
export function approveReviewApplication(reviewId, payload) {
  if (USE_MOCK) return mock.approveReviewApplication(reviewId, payload)
  return request.post(`/fde/user-skill-reviews/${reviewId}/approve`, payload, W)
}

/** 驳回。body: { reviewer, reason }（原因必填 ≤500 字）。 */
export function rejectReviewApplication(reviewId, payload) {
  if (USE_MOCK) return mock.rejectReviewApplication(reviewId, payload)
  return request.post(`/fde/user-skill-reviews/${reviewId}/reject`, payload, W)
}

/** 旧签名兼容（{ approved, comment }），新代码请用 approve/reject 两接口。 */
export function reviewApplication(reviewId, payload) {
  if (USE_MOCK) return mock.reviewApplication(reviewId, payload)
  return request.post(`/fde/user-skill-reviews/${reviewId}/review`, payload, W)
}

/* ==================== 风险设置 ==================== */

/** 读风险设置：{ currentScale, templates: { 宽松/通用/严格: { [检测项]: 等级 } } }。 */
export function getRiskConfig() {
  if (USE_MOCK) return mock.getRiskConfig()
  return request.get('/fde/user-skill-reviews/risk-config')
}

/** 当前审查尺度（选择即时生效）。 */
export function setCurrentScale(scale) {
  if (USE_MOCK) return mock.setCurrentScale(scale)
  return request.put('/fde/user-skill-reviews/risk-config/current-scale', { scale }, W)
}

/** 保存某一尺度模板。 */
export function saveRiskTemplate(scale, template) {
  if (USE_MOCK) return mock.saveRiskTemplate(scale, template)
  return request.put(`/fde/user-skill-reviews/risk-config/templates/${encodeURIComponent(scale)}`, template, W)
}

/* ==================== 字段管理 · 问题类型 ==================== */

export function listRiskTypes() {
  return request.get('/fde/field-management/risk-types')
}
export function createRiskType(payload) {
  return request.post('/fde/field-management/risk-types', payload, W)
}
export function updateRiskType(id, payload) {
  return request.put(`/fde/field-management/risk-types/${id}`, payload, W)
}
export function deleteRiskType(id) {
  return request.delete(`/fde/field-management/risk-types/${id}`, W)
}

/* ==================== 字段管理 · 风险等级 ==================== */

export function listRiskLevels() {
  return request.get('/fde/field-management/risk-levels')
}
export function createRiskLevel(payload) {
  return request.post('/fde/field-management/risk-levels', payload, W)
}
export function updateRiskLevel(id, payload) {
  return request.put(`/fde/field-management/risk-levels/${id}`, payload, W)
}
export function deleteRiskLevel(id) {
  return request.delete(`/fde/field-management/risk-levels/${id}`, W)
}
