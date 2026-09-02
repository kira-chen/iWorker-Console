import request from './request'
import * as mock from './runtimeSpecMock'

/**
 * 运行规格 API 层（04运行 › 运行规格，2026-09-02 启动）。
 *
 * 纯前端 demo：默认走 runtimeSpecMock 内存 mock（`VITE_RUN_MOCK=0` 可关闭走真实接口路径，
 * 仅供未来接回后端时切换；届时端点按此文件签名补契约——后端预期落 k8s：规格 = Pod 资源模板
 * requests/limits + NetworkPolicy + 运行策略，见 runtimeSpecMock.js 头注释的字段映射）。
 *
 * 写接口 skipGlobalError：护栏错误（重名/默认唯一/删除拦截）由页面按 message/field 就地处理。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_RUN_MOCK !== '0'
const W = { skipGlobalError: true }

export function listRuntimeSpecs(params = {}) {
  if (USE_MOCK) return mock.listRuntimeSpecs(params)
  return request.get('/fde/runtime-specs', { params })
}

export function getRuntimeSpec(id) {
  if (USE_MOCK) return mock.getRuntimeSpec(id)
  return request.get(`/fde/runtime-specs/${id}`)
}

export function createRuntimeSpec(payload) {
  if (USE_MOCK) return mock.createRuntimeSpec(payload)
  return request.post('/fde/runtime-specs', payload, W)
}

export function updateRuntimeSpec(id, payload) {
  if (USE_MOCK) return mock.updateRuntimeSpec(id, payload)
  return request.put(`/fde/runtime-specs/${id}`, payload, W)
}

export function deleteRuntimeSpec(id) {
  if (USE_MOCK) return mock.deleteRuntimeSpec(id)
  return request.delete(`/fde/runtime-specs/${id}`, W)
}
