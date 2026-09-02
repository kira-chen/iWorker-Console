import request from './request'
import * as mock from './adminModelMock'

/**
 * 模型配置 API 层（ADMIN 专属，前缀 /fde/models，V76）。
 *
 * OpenAI 协议第三方模型接入：配置鉴权 → 连通性验证 → 发布/停用（V98 双向过审）。
 *
 * 【demo mock】项目已降级为纯前端 demo（2026-09-01），本页数据默认走内存 mock
 * （开关同连接器口径：`VITE_CONN_MOCK=0` 关闭走真实接口路径，仅供未来接回后端时切换）。
 * 三态 + pendingAction 状态机 / 验证 / 密钥掩码语义见 adminModelMock.js 头注释。
 *
 * 错误处理约定（同 admin.js §0.3.1）：读接口走全局 toast；写接口加 skipGlobalError（W），
 * 失败抛 ApiError（带 code/message/field），由编辑弹窗/列表页自处理（有 field 则红框定位）。
 */

const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_CONN_MOCK !== '0'

// 写接口统一配置：绕过全局错误提示，交调用方自处理
const W = { skipGlobalError: true }

// 模型列表（keyword/status/category/sort 走后端过滤与排序）
export function listModels(params = {}) {
  if (USE_MOCK) return mock.listModels(params)
  return request.get('/fde/models', { params })
}
// 模型详情
export function getModel(id) {
  if (USE_MOCK) return mock.getModel(id)
  return request.get(`/fde/models/${id}`)
}
// 新建模型（body: name/baseUrl/model/description/authType/apiKey/appId/appSecret）
export function createModel(payload) {
  if (USE_MOCK) return mock.createModel(payload)
  return request.post('/fde/models', payload, W)
}
// 编辑模型（凭据字段留空=不修改）
// 连接字段变更会清空验证态并回未发布——改完须重新验证、重新发布才生效。
export function updateModel(id, payload) {
  if (USE_MOCK) return mock.updateModel(id, payload)
  return request.put(`/fde/models/${id}`, payload, W)
}
// 删除模型（仅未发布可删）
export function deleteModel(id) {
  if (USE_MOCK) return mock.deleteModel(id)
  return request.delete(`/fde/models/${id}`, W)
}
// 连通性验证（同步探测，可能等待数秒；任意状态可测）
// opts 可带 { signal }：AbortController 信号，供列表页「取消等待」用
// （仅中止前端等待，后端仍会跑完并落库——这一点必须在 UI 上讲清楚）。
export function verifyModel(id, opts = {}) {
  if (USE_MOCK) return mock.verifyModel(id)
  return request.post(`/fde/models/${id}/verify`, {}, { ...W, ...opts })
}
// 提交发布：DRAFT → 审核中（V98 起须过审，审核通过才对客户端开放）
export function publishModel(id) {
  if (USE_MOCK) return mock.publishModel(id)
  return request.post(`/fde/models/${id}/publish`, {}, W)
}
// 提交停用：PUBLISHED → 审核中（审核期间客户端仍可用，通过后才下线）
export function delistModel(id) {
  if (USE_MOCK) return mock.delistModel(id)
  return request.post(`/fde/models/${id}/delist`, {}, W)
}
// 设为默认模型（V78 起每类别唯一，自动摘掉同类别原默认；仅 PUBLISHED 可设）
export function setDefaultModel(id) {
  if (USE_MOCK) return mock.setDefaultModel(id)
  return request.post(`/fde/models/${id}/set-default`, {}, W)
}

// 撤回待审提交：退回操作前的原状（待审发布→未发布，待审停用→已发布）
export function withdrawModel(id) {
  if (USE_MOCK) return mock.withdrawModel(id)
  return request.post(`/fde/models/${id}/withdraw`, {}, W)
}
// 审核通过（comment 可空）：按待审动作继续执行
export function approveModel(id, comment) {
  if (USE_MOCK) return mock.approveModel(id)
  return request.post(`/fde/models/${id}/approve`, { comment }, W)
}
// 审核驳回（comment 必填）：退回操作前的原状
export function rejectModel(id, comment) {
  if (USE_MOCK) return mock.rejectModel(id)
  return request.post(`/fde/models/${id}/reject`, { comment }, W)
}
