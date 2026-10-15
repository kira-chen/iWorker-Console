import request from './request'
import * as mock from './userAccessMock'

/**
 * 用户访问权限 API 层（06组织 › 用户访问权限）。
 * 纯前端 demo 默认走 userAccessMock；保留真实接口分支作为研发接入示例。
 * 写接口 skipGlobalError：校验错误（已被处理、有待处理申请）由页面按 message 就地提示。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_RUN_MOCK !== '0'
const W = { skipGlobalError: true }

export function getUserAccessOverview() {
  if (USE_MOCK) return mock.getUserAccessOverview()
  return request.get('/fde/user-access/overview')
}

export function listAccessMembers(params = {}) {
  if (USE_MOCK) return mock.listAccessMembers(params)
  return request.get('/fde/user-access/members', { params })
}

/** 设置一位员工的授权：changes = { grant: 要新授权的环境[], revoke: 要收回的环境[] }，环境取 LOCAL / CLOUD */
export function updateAccess(userId, changes) {
  if (USE_MOCK) return mock.updateAccess(userId, changes)
  return request.put(`/fde/user-access/members/${userId}`, changes, W)
}

/** 批量授权：为所选员工授权所选的运行环境（envs 取 LOCAL / CLOUD，可两者都选） */
export function batchGrantAccess(userIds, envs) {
  if (USE_MOCK) return mock.batchGrantAccess(userIds, envs)
  return request.post('/fde/user-access/members/batch-grant', { userIds, envs }, W)
}

export function listAccessRequests(params = {}) {
  if (USE_MOCK) return mock.listAccessRequests(params)
  return request.get('/fde/user-access/requests', { params })
}

export const accessOperationRecords = mock.accessOperationRecords

export function listAccessOperations() {
  if (USE_MOCK) return mock.listAccessOperations()
  return request.get('/fde/user-access/operations')
}

export function approveAccessRequest(id) {
  if (USE_MOCK) return mock.approveAccessRequest(id)
  return request.post(`/fde/user-access/requests/${encodeURIComponent(id)}/approve`, null, W)
}

export function rejectAccessRequest(id, reason) {
  if (USE_MOCK) return mock.rejectAccessRequest(id, reason)
  return request.post(`/fde/user-access/requests/${encodeURIComponent(id)}/reject`, { reason }, W)
}
