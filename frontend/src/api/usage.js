import request from './request'
import * as mock from './usageMock'
import * as dislikeMock from './dislikeSampleMock'

/**
 * 驾驶舱「使用情况」页签 API 层（系统管理员 ADMIN 专属，01 总览）。
 *
 * 纯前端 demo：默认走 usageMock 内存 mock（`VITE_GOV_MOCK=0` 可关闭走真实接口路径，开关与其余治理页共用）。
 * 下方真实路径是给研发的接口草案，非既有后端契约；统计口径见 usageMock.js 头注释与 PRD 第五节。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_GOV_MOCK !== '0'

// 使用情况页签全部数据：返回 { claimedUsers, positionOptions, kpis, trend, feedback, users, positions, models, abilities }
// params: { range: 7|30|90, terminal: ''|'WINDOWS'|'MAC', position: ''|岗位名 }
export function getUsageSummary(params = {}) {
  if (USE_MOCK) return mock.getUsageSummary(params)
  return request.get('/admin/cockpit/usage', { params })
}

// 各终端版本升级进度：返回 { WINDOWS: { upgraded, behind }, MAC: { upgraded, behind } }
export function getVersionAdoption() {
  if (USE_MOCK) return mock.getVersionAdoption()
  return request.get('/admin/cockpit/version-adoption')
}

// 点踩明细（PRD 驾驶舱第八节）：返回 { list, total }，list 行 { id, time, position, user, snippet, fileCount }
// fileCount：被点踩回复里生成的文件数（产品优化需求-202611 修改点 20）
export function listDislikeSamples() {
  if (USE_MOCK) return dislikeMock.listDislikeSamples()
  return request.get('/admin/cockpit/dislikes')
}

// 对话明细（PRD 驾驶舱第九节）：返回 { id, turns }，turns 为被点踩的单轮（用户提问 + 被点踩回复）；
// 助手回复带 files[]：{ id, name, kind, kindLabel, sizeBytes, previewable, expired, url, previewText }（修改点 20）
export function getDislikeConversation(id) {
  if (USE_MOCK) return dislikeMock.getDislikeConversation(id)
  return request.get('/admin/cockpit/dislikes/' + encodeURIComponent(id))
}
