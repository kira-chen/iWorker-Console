import request from './request'
import * as mock from './instanceMock'

/**
 * 实例管理 API 层（04运行 › 实例管理）。
 * 纯前端 demo 默认走 instanceMock；保留真实接口分支作为研发接入示例。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_RUN_MOCK !== '0'
const W = { skipGlobalError: true }

export function listInstances(params = {}) {
  if (USE_MOCK) return mock.listInstances(params)
  return request.get('/fde/instances', { params })
}

export function getInstance(id) {
  if (USE_MOCK) return mock.getInstance(id)
  return request.get(`/fde/instances/${encodeURIComponent(id)}`)
}

export function operateInstance(id, operation) {
  if (USE_MOCK) return mock.operateInstance(id, operation)
  return request.post(`/fde/instances/${encodeURIComponent(id)}/operations`, { operation }, W)
}
