import request from './request'
import * as mock from './skillReviewMock'

/**
 * 用户技能审核 API 层（系统配置员侧，V94）。
 *
 * 前缀 /api/fde/user-skill-reviews（归 SYS_CONFIG 模块）+ 字段管理 /api/fde/field-management。
 * 原「用户上传待确认」（platform-skill-uploads 确认制）下线替代。
 *
 * 【demo mock（2026-09-02 补齐）】页面所调三接口默认走内存 mock（skillReviewMock.js；
 * `VITE_GOV_MOCK=0` 可关闭走真实接口路径，开关同 reviews.js / feedback.js 治理段口径）。
 * 下方字段管理·风险类型/风险等级 CRUD 无页面调用方（字段字典页走 fieldDict.js），不 mock，
 * demo 下调用会 404，属已知限制。
 *
 * 错误处理沿用范式：读接口走全局拦截器（失败弹 toast）；写接口加 skipGlobalError → 失败抛 ApiError 交页面自处理。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_GOV_MOCK !== '0'
const W = { skipGlobalError: true }

/* ==================== 用户技能审核 ==================== */

/** 审核列表（分页 + status/purpose/keyword 可选）。 */
export function listReviewApplications(params) {
  if (USE_MOCK) return mock.listReviewApplications(params)
  return request.get('/fde/user-skill-reviews', { params })
}

/** 审核详情（含风险项、申请信息、审核结果）。 */
export function getReviewApplication(reviewId) {
  if (USE_MOCK) return mock.getReviewApplication(reviewId)
  return request.get(`/fde/user-skill-reviews/${reviewId}`)
}

/** 审核（通过/不通过）。body: { approved: boolean, comment?: string }。 */
export function reviewApplication(reviewId, payload) {
  if (USE_MOCK) return mock.reviewApplication(reviewId, payload)
  return request.post(`/fde/user-skill-reviews/${reviewId}/review`, payload, W)
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
