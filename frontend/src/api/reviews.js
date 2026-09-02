import request from './request'
import { reviewMarketListing, reviewMcpService } from './market'
import { approveBizSystemPublish, rejectBizSystemPublish } from './admin'
import { approveModel, rejectModel } from './adminModel'
import { approvePosition, rejectPosition } from './position'
import { approveExpert, rejectExpert } from './domainExpert'
import * as mock from './reviewsMock'

/**
 * 审核中心数据层（2026-09-01 PRD 对齐改造：对齐交互原型 v2 renderReviews）。
 *
 * 【demo mock】项目已降级为纯前端 demo（2026-09-01），本页数据默认走内存 mock
 * （`VITE_GOV_MOCK=0` 可关闭走真实接口路径，仅供未来接回后端时切换；治理三页
 *  ——审核中心 / 我的申请 / 用户反馈——共用该开关）。
 *
 * 新口径（原型 renderReviews）：列表只出待审核；keyword 过滤域 [name, description,
 * submitterName]；业务类型七项 + 申请类型（requestAction）筛选；submittedAt 排序默认 desc。
 * 写动作统一为「通过 / 驳回」两个入口，非 mock 时按行 type 分流到既有各业务写端点
 * （原 V39 S4 分流逻辑自 UnifiedReview.vue 收拢至此，页面不再感知分流细节）。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_GOV_MOCK !== '0'
const W = { skipGlobalError: true }

/**
 * 待审核列表。
 * params: { keyword?, type?(POSITION|EXPERT|SKILL|CONNECTOR_MCP|CONNECTOR_API|CONNECTOR_BIZ|MODEL),
 *           requestAction?(FIRST_PUBLISH|VERSION_PUBLISH|DELIST), sortDir?('asc'|'desc'), page?, size? }
 * → { list, total }
 */
export function listReviews(params = {}) {
  if (USE_MOCK) return mock.listReviews(params)
  return request.get('/fde/reviews', { params })
}

/** 单条详情（技能整页只读的吸底操作栏取行用；非 mock 走列表端点的单条形态）。 */
export function getReview(id) {
  if (USE_MOCK) return mock.getReview(id)
  return request.get(`/fde/reviews/${id}`)
}

/** 通过审核（按行分流；mock 下按 id 直写内存态）。 */
export function approveReview(row) {
  if (USE_MOCK) return mock.approveReview(row.id)
  if (row.type === 'TOOL') {
    // subType 决定粒度：MCP=服务级批量（refId=mcpDefId），API=工具粒度（refId=listingId）
    return row.subType === 'MCP'
      ? reviewMcpService(row.refId, { approve: true })
      : reviewMarketListing(row.refId, { approve: true })
  }
  if (row.type === 'BIZ_SYSTEM') return approveBizSystemPublish(row.refId, row.target)
  if (row.type === 'MODEL') return approveModel(row.refId)
  if (row.type === 'POSITION') return approvePosition(row.refId)
  if (row.type === 'EXPERT') return approveExpert(row.refId)
  return approveSkillTargetReview(row.refId, row.target)
}

/** 驳回审核（驳回原因必填；分流口径同 approveReview）。 */
export function rejectReview(row, comment) {
  if (USE_MOCK) return mock.rejectReview(row.id, comment)
  if (row.type === 'TOOL') {
    return row.subType === 'MCP'
      ? reviewMcpService(row.refId, { approve: false, reviewComment: comment })
      : reviewMarketListing(row.refId, { approve: false, reviewComment: comment })
  }
  if (row.type === 'BIZ_SYSTEM') return rejectBizSystemPublish(row.refId, row.target, comment)
  if (row.type === 'MODEL') return rejectModel(row.refId, comment)
  if (row.type === 'POSITION') return rejectPosition(row.refId, comment)
  if (row.type === 'EXPERT') return rejectExpert(row.refId, comment)
  return rejectSkillTargetReview(row.refId, row.target, comment)
}

/* ---------------- 技能行按目标写端点（V39 S3 后端契约，非 mock 分流用） ---------------- */

// 技能通过：refId = skillId + target。
export function approveSkillTargetReview(skillId, target) {
  return request.post(`/fde/skill-reviews/${skillId}/targets/${target}/approve`, {}, W)
}

// 技能驳回：refId = skillId + target，comment 必填。
export function rejectSkillTargetReview(skillId, target, comment) {
  return request.post(`/fde/skill-reviews/${skillId}/targets/${target}/reject`, { comment }, W)
}
