import request from './request'
import * as mock from './versionMock'

/**
 * 版本管理（客户端版本）API 层（系统管理员 ADMIN 专属，05 治理）。
 *
 * 纯前端 demo：默认走 versionMock 内存 mock（`VITE_GOV_MOCK=0` 可关闭走真实接口路径，
 * 仅供未来接回后端时切换，开关与其余治理页共用）。下方真实路径是给研发的接口草案，
 * 非既有后端契约；业务规则（发布顺序、唯一性等）见 versionMock.js 头注释。
 */
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_GOV_MOCK !== '0'

// 列表：返回 { list, total }；params: { keyword, terminal, status, sortDir, page, size }
export function listVersions(params = {}) {
  if (USE_MOCK) return mock.listVersions(params)
  return request.get('/admin/versions', { params })
}

// 概览条：各终端当前下发版本，返回 { WINDOWS: row|null, MAC: row|null }
export function getVersionOverview() {
  if (USE_MOCK) return mock.getVersionOverview()
  return request.get('/admin/versions/overview')
}

// 上传版本包（multipart）。返回 { packageId, fileName, fileSize, sha256 }，保存版本时随表单提交。
// opts.onProgress(0–100) 回调进度，opts.signal 可中止。
export function uploadVersionPackage(file, opts = {}) {
  if (USE_MOCK) return mock.uploadVersionPackage(file, opts)
  const form = new FormData()
  form.append('file', file)
  return request.post('/admin/versions/packages', form, {
    signal: opts.signal,
    onUploadProgress: (e) => opts.onProgress?.(Math.round((e.loaded / (e.total || file.size || 1)) * 100))
  })
}

export function createVersion(payload) {
  if (USE_MOCK) return mock.createVersion(payload)
  return request.post('/admin/versions', payload)
}

export function updateVersion(id, payload) {
  if (USE_MOCK) return mock.updateVersion(id, payload)
  return request.put(`/admin/versions/${id}`, payload)
}

export function publishVersion(id) {
  if (USE_MOCK) return mock.publishVersion(id)
  return request.post(`/admin/versions/${id}/publish`)
}

export function stopVersion(id) {
  if (USE_MOCK) return mock.stopVersion(id)
  return request.post(`/admin/versions/${id}/stop`)
}

export function deleteVersion(id) {
  if (USE_MOCK) return mock.deleteVersion(id)
  return request.delete(`/admin/versions/${id}`)
}
