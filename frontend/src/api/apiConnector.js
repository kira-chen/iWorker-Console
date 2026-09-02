import request from './request'
import * as mock from './apiConnectorMock'

/**
 * API 连接器页数据层（PRD-20260828《03能力/连接器/API》）。
 *
 * 【demo mock】项目已降级为纯前端 demo（2026-09-01），本页数据默认走内存 mock
 * （`VITE_CONN_MOCK=0` 可关闭走真实接口路径，仅供未来接回后端时切换）。
 * 状态机（发布/停用双审核、软引用删除、验证失效）语义见 apiConnectorMock.js 头注释。
 *
 * 错误处理约定（同 knowledgeBase.js）：写操作失败抛 ApiError（带 code/message/field），
 * 由抽屉 / 列表页自处理字段级红框与提示。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_CONN_MOCK !== '0'
const W = { skipGlobalError: true }
const PS = '/fde/provider-systems'
const API = '/fde/api-defs'

/* ================= 服务提供系统 ================= */
export function listProviderSystems(params = {}) {
  if (USE_MOCK) return mock.listProviderSystems(params)
  return request.get(PS, { params })
}
export function getProviderSystem(id) {
  if (USE_MOCK) return mock.getProviderSystem(id)
  return request.get(`${PS}/${id}`)
}
export function createProviderSystem(payload) {
  if (USE_MOCK) return mock.createProviderSystem(payload)
  return request.post(PS, payload, W)
}
export function updateProviderSystem(id, payload) {
  if (USE_MOCK) return mock.updateProviderSystem(id, payload)
  return request.put(`${PS}/${id}`, payload, W)
}
export function deleteProviderSystem(id) {
  if (USE_MOCK) return mock.deleteProviderSystem(id)
  return request.delete(`${PS}/${id}`, W)
}

/* ================= API 定义 ================= */
export function listApis(params = {}) {
  if (USE_MOCK) return mock.listApis(params)
  return request.get(API, { params })
}
export function getApi(id) {
  if (USE_MOCK) return mock.getApi(id)
  return request.get(`${API}/${id}`)
}
export function createApi(payload) {
  if (USE_MOCK) return mock.createApi(payload)
  return request.post(API, payload, W)
}
export function updateApi(id, payload) {
  if (USE_MOCK) return mock.updateApi(id, payload)
  return request.put(`${API}/${id}`, payload, W)
}
export function deleteApi(id) {
  if (USE_MOCK) return mock.deleteApi(id)
  return request.delete(`${API}/${id}`, W)
}

/* ================= 连通性验证 / 发布流 ================= */
export function healthCheckApi(id) {
  if (USE_MOCK) return mock.healthCheckApi(id)
  return request.post(`${API}/${id}/health-check`, {}, W)
}
export function publishApi(id) {
  if (USE_MOCK) return mock.publishApi(id)
  return request.post(`${API}/${id}/publish`, {}, W)
}
export function withdrawApi(id) {
  if (USE_MOCK) return mock.withdrawApi(id)
  return request.post(`${API}/${id}/withdraw`, {}, W)
}
export function deactivateApi(id) {
  if (USE_MOCK) return mock.deactivateApi(id)
  return request.post(`${API}/${id}/deactivate`, {}, W)
}

/* ================= 示例问题 AI 生成 ================= */
export function aiGenerateExampleQuestion(payload) {
  if (USE_MOCK) return mock.aiGenerateExampleQuestion(payload)
  return request.post(`${API}/example-question`, payload, W)
}
