import request from './request'
import * as mock from './myApplicationsMock'

/**
 * 「我的申请」数据层（2026-09-01 PRD 对齐新增模块：对齐交互原型 v2 renderMyApplications）。
 *
 * 【demo mock】项目已降级为纯前端 demo（2026-09-01），默认走内存 mock
 * （`VITE_GOV_MOCK=0` 可关闭走真实接口路径，仅供未来接回后端时切换；开关与
 *  审核中心 / 用户反馈共用）。非 mock 端点 /fde/my-applications 为预留契约，
 * 后端尚不存在——demo 不接后端（项目约束），仅保持与其它 api 层同构的双轨形状。
 *
 * 口径（原型）：keyword 过滤域 [objectName, description]；businessType / applicationType /
 * result 三个筛选；submittedAt 排序默认 desc；写动作 withdraw（撤回）/ resubmit（重新提交）。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_GOV_MOCK !== '0'
const W = { skipGlobalError: true }
const BASE = '/fde/my-applications'

/**
 * 列表。params: { keyword?, businessType?, applicationType?, result?, sortDir?, page?, size? }
 * → { list, total }
 */
export function listMyApplications(params = {}) {
  if (USE_MOCK) return mock.listMyApplications(params)
  return request.get(BASE, { params })
}

/** 详情。 */
export function getMyApplication(id) {
  if (USE_MOCK) return mock.getMyApplication(id)
  return request.get(`${BASE}/${id}`)
}

/** 撤回申请（仅 PENDING 可撤）。 */
export function withdrawMyApplication(id) {
  if (USE_MOCK) return mock.withdrawMyApplication(id)
  return request.post(`${BASE}/${id}/withdraw`, {}, W)
}

/** 重新提交（仅 REJECTED / WITHDRAWN 可重提）。 */
export function resubmitMyApplication(id) {
  if (USE_MOCK) return mock.resubmitMyApplication(id)
  return request.post(`${BASE}/${id}/resubmit`, {}, W)
}
