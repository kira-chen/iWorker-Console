import { describe, it, expect, vi, beforeEach } from 'vitest'

// adminModel.js 依赖 ./request（其链路含 router 需 window）。mock 掉 axios 实例，
// 仅验证各 API 的 method/path/body 与 /api/fde/models 端点契约一致 + 写接口带 skipGlobalError。
vi.mock('@/api/request', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  // adminModelMock（2026-09-01 demo mock 层）从 ./request 具名导入 ApiError——桩里补齐，防导入期报错
  ApiError: class ApiError extends Error {}
}))

// 2026-09-01 demo mock 化：adminModel.js 默认走内存 mock（VITE_CONN_MOCK !== '0'）。
// 本文件验证的是「真实接口路径」的端点契约，故显式关掉 mock 开关再导入。
vi.stubEnv('VITE_CONN_MOCK', '0')

const request = (await import('@/api/request')).default
const {
  listModels,
  getModel,
  createModel,
  updateModel,
  deleteModel,
  verifyModel,
  publishModel,
  delistModel,
  withdrawModel,
  approveModel,
  rejectModel,
  setDefaultModel
} = await import('@/api/adminModel')

const W = { skipGlobalError: true }

describe('adminModel API · /fde/models（V76）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('listModels → GET /fde/models，透传 keyword/status', () => {
    listModels({ keyword: 'deepseek', status: 'PUBLISHED' })
    expect(request.get).toHaveBeenCalledWith('/fde/models', {
      params: { keyword: 'deepseek', status: 'PUBLISHED' }
    })
  })

  it('getModel → GET /fde/models/{id}', () => {
    getModel('md_x')
    expect(request.get).toHaveBeenCalledWith('/fde/models/md_x')
  })

  it('createModel → POST /fde/models，带 skipGlobalError', () => {
    const payload = { name: 'DeepSeek', baseUrl: 'https://a/v1', model: 'deepseek-chat' }
    createModel(payload)
    expect(request.post).toHaveBeenCalledWith('/fde/models', payload, W)
  })

  it('updateModel → PUT /fde/models/{id}，带 skipGlobalError', () => {
    updateModel('md_x', { name: 'n' })
    expect(request.put).toHaveBeenCalledWith('/fde/models/md_x', { name: 'n' }, W)
  })

  it('deleteModel → DELETE /fde/models/{id}，带 skipGlobalError', () => {
    deleteModel('md_x')
    expect(request.delete).toHaveBeenCalledWith('/fde/models/md_x', W)
  })

  it('verifyModel → POST /{id}/verify，空 body + skipGlobalError', () => {
    verifyModel('md_x')
    expect(request.post).toHaveBeenCalledWith('/fde/models/md_x/verify', {}, W)
  })

  it('publishModel / delistModel → POST /{id}/publish|delist（V96：模型只有上架/下架）', () => {
    publishModel('md_x')
    delistModel('md_x')
    expect(request.post).toHaveBeenCalledWith('/fde/models/md_x/publish', {}, W)
    expect(request.post).toHaveBeenCalledWith('/fde/models/md_x/delist', {}, W)
  })

  it('setDefaultModel → POST /{id}/set-default，空 body + skipGlobalError（V78）', () => {
    setDefaultModel('md_x')
    expect(request.post).toHaveBeenCalledWith('/fde/models/md_x/set-default', {}, W)
  })

  // ---- V98 审核流程：发布/停用两条都要过审 ----

  it('withdrawModel → POST /fde/models/{id}/withdraw', () => {
    withdrawModel('md_x')
    expect(request.post).toHaveBeenCalledWith('/fde/models/md_x/withdraw', {}, W)
  })

  it('approveModel → POST /fde/models/{id}/approve，comment 可空', () => {
    approveModel('md_x')
    expect(request.post).toHaveBeenCalledWith(
      '/fde/models/md_x/approve',
      { comment: undefined },
      W
    )
  })

  it('rejectModel → POST /fde/models/{id}/reject，带驳回意见', () => {
    rejectModel('md_x', '地址不在白名单')
    expect(request.post).toHaveBeenCalledWith(
      '/fde/models/md_x/reject',
      { comment: '地址不在白名单' },
      W
    )
  })

  it('verifyModel 支持透传 signal（列表页取消等待用）', () => {
    const ctrl = new AbortController()
    verifyModel('md_x', { signal: ctrl.signal })
    expect(request.post).toHaveBeenCalledWith(
      '/fde/models/md_x/verify',
      {},
      expect.objectContaining({ skipGlobalError: true, signal: ctrl.signal })
    )
  })
})
