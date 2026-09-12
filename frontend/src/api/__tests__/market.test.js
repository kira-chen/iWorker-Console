import { describe, it, expect, vi, beforeEach } from 'vitest'

// 2026-09-12 负责人决策 4（审计 J3）：真实接口分支作为「以后接后端」的示例代码保留，但只验「走不到的路」的
// 契约用例删除。原 7 条里 6 个函数（listMarketListings / createMarketListing / delistMarketListing /
// relistMarketListing / withdrawMarketListing / getAvailableTools）零调用方，已随本决策删；只留
// reviewMarketListing —— 它经 api/reviews.js 被审核中心调用，是本文件唯一仍有活引用的函数。
// market.js 依赖 ./request（其链路含 router 需 window），故 mock 掉 axios 实例。
vi.mock('@/api/request', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }
}))

const request = (await import('@/api/request')).default
const { reviewMarketListing } = await import('@/api/market')

const W = { skipGlobalError: true }

describe('market API · reviewMarketListing（审核中心经 api/reviews.js 调用）', () => {
  beforeEach(() => vi.clearAllMocks())



  it('reviewMarketListing → POST /{id}/review，带 skipGlobalError', () => {
    reviewMarketListing(7, { approve: true, writeClass: 'READ', requiresConfirmation: false })
    expect(request.post).toHaveBeenCalledWith(
      '/fde/market/listings/7/review',
      { approve: true, writeClass: 'READ', requiresConfirmation: false },
      W
    )
  })




})
