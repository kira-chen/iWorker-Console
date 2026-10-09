import request from './request'
import * as mock from './storageSpaceMock'

/**
 * 存储空间 API 层（04运行 › 存储空间）。
 * 纯前端 demo 默认走 storageSpaceMock；保留真实接口分支作为研发接入示例。
 * 写接口 skipGlobalError：校验错误（范围、已被处理）由页面按 message 就地提示。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_RUN_MOCK !== '0'
const W = { skipGlobalError: true }

export function getStorageOverview() {
  if (USE_MOCK) return mock.getStorageOverview()
  return request.get('/fde/storage-space/overview')
}

export function listStorageMembers(params = {}) {
  if (USE_MOCK) return mock.listStorageMembers(params)
  return request.get('/fde/storage-space/members', { params })
}

export function adjustStorageQuota(userId, quotaGb, options = {}) {
  if (USE_MOCK) return mock.adjustStorageQuota(userId, quotaGb, options)
  return request.put(`/fde/storage-space/members/${userId}/quota`, { quotaGb, restoreDefault: !!options.restoreDefault }, W)
}

export function batchAdjustStorageQuota(userIds, quotaGb) {
  if (USE_MOCK) return mock.batchAdjustStorageQuota(userIds, quotaGb)
  return request.post('/fde/storage-space/members/batch-quota', { userIds, quotaGb }, W)
}

export function listExpansionRequests(params = {}) {
  if (USE_MOCK) return mock.listExpansionRequests(params)
  return request.get('/fde/storage-space/expansion-requests', { params })
}

export function getExpansionRequest(id) {
  if (USE_MOCK) return mock.getExpansionRequest(id)
  return request.get(`/fde/storage-space/expansion-requests/${encodeURIComponent(id)}`)
}

export function approveExpansionRequest(id, newTotalGb) {
  if (USE_MOCK) return mock.approveExpansionRequest(id, newTotalGb)
  return request.post(`/fde/storage-space/expansion-requests/${encodeURIComponent(id)}/approve`, { newTotalGb }, W)
}

export function rejectExpansionRequest(id, reason) {
  if (USE_MOCK) return mock.rejectExpansionRequest(id, reason)
  return request.post(`/fde/storage-space/expansion-requests/${encodeURIComponent(id)}/reject`, { reason }, W)
}
