// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

// downloadArtifact 用 document + URL.createObjectURL 触发隐藏 <a download>，故在 jsdom 环境。
// 顶层依赖：@/api/request（副作用）、@/stores/user（token/logout）。mock 掉避免拉起 axios。

vi.mock('@/api/request', () => ({ default: { post: vi.fn(), get: vi.fn() } }))

const userStore = { token: 'tk', logout: vi.fn() }
vi.mock('@/stores/user', () => ({ useUserStore: () => userStore }))
vi.mock('@/utils/positionNotBound', () => ({ handlePositionNotBound: vi.fn() }))

const { downloadArtifact } = await import('@/api/chat')

describe('downloadArtifact · 认证下载（带 JWT 取 blob 触发下载）', () => {
  beforeEach(() => {
    userStore.token = 'tk'
    userStore.logout.mockClear()
    URL.createObjectURL = vi.fn(() => 'blob:mock')
    URL.revokeObjectURL = vi.fn()
  })

  it('成功：携带 Authorization 取 blob → 触发 <a download> → 释放 objectURL', async () => {
    const blob = new Blob(['a,b\n1,2'], { type: 'text/csv' })
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(blob) })
    )
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await downloadArtifact('/api/artifacts/sales/x.csv', '拜访记录.csv')

    // 带 token 请求（不是 window.open，避免 401）
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/artifacts/sales/x.csv')
    expect(opts.headers.Authorization).toBe('Bearer tk')
    expect(clickSpy).toHaveBeenCalledOnce()
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock')
    clickSpy.mockRestore()
  })

  it('401 → 登出并抛错（不静默成功）', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 401 }))
    await expect(downloadArtifact('/api/artifacts/sales/x.csv', 'x.csv')).rejects.toThrow()
    expect(userStore.logout).toHaveBeenCalledOnce()
  })

  it('非 ok（如 404）→ 抛错供 UI 失败态', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404 }))
    await expect(downloadArtifact('/api/artifacts/sales/x.csv', 'x.csv')).rejects.toThrow()
  })
})
