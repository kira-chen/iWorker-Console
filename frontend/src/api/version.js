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

// 新建版本时按终端自动生成的下一个版本号（该终端已有最大版本号的次版本位 +1，没有版本则 v1.0.0）。
// 只是预填，用户可改；返回形如 'v1.4.0' 的字符串。
export function getNextVersion(terminal) {
  if (USE_MOCK) return mock.getNextVersion(terminal)
  return request.get('/admin/versions/next-version', { params: { terminal } })
}

// 按 id 取单条（审核中心 / 我的申请查看详情）。返回版本行，附 name（终端 + 版本号）。
export function getVersion(id) {
  if (USE_MOCK) return mock.getVersion(id)
  return request.get(`/admin/versions/${id}`)
}

// 发布 = 提交发布审核（不会直接生效）：版本进入「审核中」，审核中心与我的申请各生成一条申请，
// 审核通过后才变「已发布」。返回更新后的版本行。
export function publishVersion(id) {
  if (USE_MOCK) return mock.publishVersion(id)
  return request.post(`/admin/versions/${id}/publish`)
}

// 撤回审核中的申请（发布申请或停用申请）：版本回到提交前的状态（未发布 / 已发布）。
export function withdrawVersion(id) {
  if (USE_MOCK) return mock.withdrawVersion(id)
  return request.post(`/admin/versions/${id}/withdraw`)
}

// 停用 = 提交停用审核（同样不会直接生效）：仅已发布的版本可提交，审核期间继续下发，
// 审核通过后回到「未发布」、该终端暂无下发版本；不自动回退到上一个版本。
export function stopVersion(id) {
  if (USE_MOCK) return mock.stopVersion(id)
  return request.post(`/admin/versions/${id}/stop`)
}
