import { describe, it, expect, vi, beforeEach } from 'vitest'

// 【历史后端契约（市场 listing 端点，6/7 函数零调用方），demo 不可达，仅留档；去留待裁决（审计 J3）】
// 2026-09-12 测试审计：listMarketListings / createMarketListing / delistMarketListing / relistMarketListing /
// withdrawMarketListing / getAvailableTools 六个函数已无任何调用方；reviewMarketListing 仅在 api/reviews.js
// 的非 mock 分支（VITE_GOV_MOCK=0，demo 永不走）被引用。现行 md 无「市场」模块条款，本文件断的是已退役后端
// HTTP 契约（method/path/body + 写接口 skipGlobalError），不对应任何页面可见行为。
// market.js 依赖 ./request（其链路含 router 需 window），故 mock 掉 axios 实例。
vi.mock('@/api/request', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }
}))

const request = (await import('@/api/request')).default
const {
  listMarketListings,
  createMarketListing,
  reviewMarketListing,
  delistMarketListing,
  relistMarketListing,
  withdrawMarketListing,
  getAvailableTools
} = await import('@/api/market')

const W = { skipGlobalError: true }

describe('market API · 技术方案 §5.1/§5.4', () => {
  beforeEach(() => vi.clearAllMocks())

  it('listMarketListings → GET /fde/market/listings，透传 status/toolType/keyword', () => {
    listMarketListings({ status: 'PUBLISHED', toolType: 'MCP', keyword: 'x' })
    expect(request.get).toHaveBeenCalledWith('/fde/market/listings', {
      params: { status: 'PUBLISHED', toolType: 'MCP', keyword: 'x' }
    })
  })

  it('createMarketListing → POST /listings，带 skipGlobalError', () => {
    createMarketListing({ toolType: 'API', toolCode: 'foo' })
    expect(request.post).toHaveBeenCalledWith(
      '/fde/market/listings',
      { toolType: 'API', toolCode: 'foo' },
      W
    )
  })

  it('reviewMarketListing → POST /{id}/review，带 skipGlobalError', () => {
    reviewMarketListing(7, { approve: true, writeClass: 'READ', requiresConfirmation: false })
    expect(request.post).toHaveBeenCalledWith(
      '/fde/market/listings/7/review',
      { approve: true, writeClass: 'READ', requiresConfirmation: false },
      W
    )
  })

  it('delistMarketListing → POST /{id}/delist，空 body + skipGlobalError', () => {
    delistMarketListing(7)
    expect(request.post).toHaveBeenCalledWith('/fde/market/listings/7/delist', {}, W)
  })

  it('relistMarketListing → POST /{id}/relist，空 body + skipGlobalError', () => {
    relistMarketListing(7)
    expect(request.post).toHaveBeenCalledWith('/fde/market/listings/7/relist', {}, W)
  })

  it('withdrawMarketListing → DELETE /{id}，带 skipGlobalError', () => {
    withdrawMarketListing(7)
    expect(request.delete).toHaveBeenCalledWith('/fde/market/listings/7', W)
  })

  it('getAvailableTools → GET /fde/tools/available（复用现有发布选择数据源）', () => {
    getAvailableTools()
    expect(request.get).toHaveBeenCalledWith('/fde/tools/available')
  })
})
