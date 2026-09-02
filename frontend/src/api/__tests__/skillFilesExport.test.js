// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// mock request（exportSkillZip 不走 request，但 skillFiles.js 顶部 import 它需 mock 掉其 router 链路）。
vi.mock('@/api/request', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }
}))
// mock user store：提供 token + logout（401 路径）。
const logoutSpy = vi.fn()
vi.mock('@/stores/user', () => ({
  useUserStore: () => ({ token: 'jwt-abc', logout: logoutSpy })
}))

const { exportSkillZip } = await import('@/api/skillFiles')

// 工具：构造 fetch Response 桩。
function makeResp({ status = 200, headers = {}, blobType = 'application/zip', body = 'PK', text } = {}) {
  const hmap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => hmap.get(String(k).toLowerCase()) ?? null },
    blob: async () => ({ type: blobType, text: async () => (typeof body === 'string' ? body : '') }),
    text: async () => (text != null ? text : '')
  }
}

let clickSpy, createSpy, revokeSpy, lastAnchor
beforeEach(() => {
  vi.clearAllMocks()
  logoutSpy.mockClear()
  // DOM / URL 桩
  createSpy = vi.fn(() => 'blob:fake-url')
  revokeSpy = vi.fn()
  global.URL.createObjectURL = createSpy
  global.URL.revokeObjectURL = revokeSpy
  clickSpy = vi.fn()
  lastAnchor = null
  const realCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    const el = realCreate(tag)
    if (tag === 'a') {
      lastAnchor = el
      el.click = clickSpy
    }
    return el
  })
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('exportSkillZip · 端点 + source 前缀', () => {
  it('fde → GET /api/fde/skills/{id}/export-zip，带 JWT', async () => {
    global.fetch = vi.fn(async () =>
      makeResp({ headers: { 'Content-Disposition': 'attachment; filename="s.zip"' } })
    )
    await exportSkillZip(7, 'fde')
    const [url, opt] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/fde/skills/7/export-zip')
    expect(opt.headers.Authorization).toBe('Bearer jwt-abc')
  })

  it('platform → GET /api/fde/platform-skills/{id}/export-zip', async () => {
    global.fetch = vi.fn(async () =>
      makeResp({ headers: { 'Content-Disposition': 'attachment; filename="s.zip"' } })
    )
    await exportSkillZip(7, 'platform')
    expect(global.fetch.mock.calls[0][0]).toBe('/api/fde/platform-skills/7/export-zip')
  })
})

describe('exportSkillZip · blob 下载 + 文件名解析', () => {
  it('成功 → 解析 RFC5987 中文文件名 + a[download] 触发 + 返回文件名', async () => {
    const encoded = encodeURIComponent('客户回访技能.zip')
    global.fetch = vi.fn(async () =>
      makeResp({
        headers: { 'Content-Disposition': `attachment; filename="skill.zip"; filename*=UTF-8''${encoded}` }
      })
    )
    const name = await exportSkillZip(9, 'fde')
    expect(name).toBe('客户回访技能.zip')
    expect(createSpy).toHaveBeenCalled() // createObjectURL
    expect(clickSpy).toHaveBeenCalled() // a.click 触发下载
    expect(lastAnchor.download).toBe('客户回访技能.zip')
    expect(revokeSpy).toHaveBeenCalled() // 释放 objectURL
  })

  it('无 Content-Disposition → 回落默认名 skill-{id}.zip', async () => {
    global.fetch = vi.fn(async () => makeResp({ headers: {} }))
    const name = await exportSkillZip(42, 'fde')
    expect(name).toBe('skill-42.zip')
  })
})

describe('exportSkillZip · 错误处理', () => {
  it('非 2xx + JSON 错误体 → 抛后端 message', async () => {
    global.fetch = vi.fn(async () =>
      makeResp({ status: 404, text: JSON.stringify({ code: 404, message: '技能不存在' }) })
    )
    await expect(exportSkillZip(1, 'fde')).rejects.toThrow('技能不存在')
    expect(clickSpy).not.toHaveBeenCalled() // 失败不触发下载
  })

  it('401 → logout + 抛登录失效', async () => {
    global.fetch = vi.fn(async () => makeResp({ status: 401 }))
    await expect(exportSkillZip(1, 'fde')).rejects.toThrow(/登录已失效/)
    expect(logoutSpy).toHaveBeenCalled()
  })

  it('200 但回 JSON blob（兜底）→ 抛 message、不下载', async () => {
    global.fetch = vi.fn(async () =>
      makeResp({ blobType: 'application/json', body: JSON.stringify({ message: '导出异常' }) })
    )
    await expect(exportSkillZip(1, 'fde')).rejects.toThrow('导出异常')
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('非 2xx + 非 JSON 文本体 → 抛该文本', async () => {
    global.fetch = vi.fn(async () => makeResp({ status: 500, text: 'boom' }))
    await expect(exportSkillZip(1, 'fde')).rejects.toThrow('boom')
  })
})
