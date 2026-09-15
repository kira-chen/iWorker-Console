import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 端点契约测试（VITE_CONN_MOCK=0）：2026-09-12 负责人决策 4（审计 J3）——真实接口分支作为「以后接后端」的
 * 示例代码保留，本文件随之保留。与 market.test.js 不同，api/adminModel.js 的 12 个函数在 demo 里都有活
 * 调用方（AdminModels / ModelConfigEditDialog / GovObjectDetail 经 mock 分支），这里验的是另一侧分支的
 * method/path/body 契约。
 * 2026-09-12 测试审计：本文件断言的是 `/fde/models/*` 真实端点路径，纯前端 demo 默认走
 * adminModelMock（USE_MOCK 恒开），这条分支在 demo 里永远跑不到——留档供接回后端时对表。
 */

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

  it('publishModel / delistModel → POST /{id}/publish|delist（提交发布 / 提交停用审核，md §二.3.5 / §二.3.7）', () => {
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
