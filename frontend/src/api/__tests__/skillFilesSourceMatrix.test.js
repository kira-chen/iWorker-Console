// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 接线守卫 · skillFiles source→前缀 穷举矩阵（质量闸 #1，2026-08-08）。
 *
 * 背景：V89 系统默认技能通道上线时，编辑页漏传 source='system'，编辑器内文件树全部操作
 * （导出/搜索/增删改名/移动）拿系统技能 id 打市场前缀被通道守卫 404（见 docs/update/2026-08-08.md §2）。
 * 单元测试各自 mock 组件边界，测不到「分流枢纽是否穷举了全部通道」这类接线问题。
 *
 * 本守卫把 base(source) 这一分流枢纽的**全部合法取值 × 代表性端点**钉成矩阵断言：
 * 新增通道若只改了页面没接 API 层（或反之），矩阵即红。新增合法 source 时必须同步扩这里的
 * SOURCE_PREFIX——这是有意的强制清单（漏接线的失败要发生在 CI，不是用户点导出的时候）。
 */

vi.mock('@/api/request', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({})),
    post: vi.fn(() => Promise.resolve({})),
    put: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({}))
  }
}))
vi.mock('@/stores/user', () => ({
  useUserStore: () => ({ token: 'jwt-abc', logout: vi.fn() })
}))

// 2026-09-01 PRD 对齐改造取代旧口径：skillFiles.js 已加 demo mock 分流（VITE_SKILL_MOCK），
// 测试环境 DEV=true 会短路真实端点。本矩阵守卫验证的是真实前缀接线，故显式关掉 mock。
vi.stubEnv('VITE_SKILL_MOCK', '0')

const request = (await import('@/api/request')).default
const {
  listSkillFiles,
  getSkillFile,
  saveSkillFile,
  deleteSkillFile,
  renameSkillFile,
  searchSkillFiles,
  moveSkillNode,
  exportSkillZip,
  importZipToSkill
} = await import('@/api/skillFiles')

/** 全部合法 source 及其唯一合法前缀（单一真相：与 skillFiles.js base() 一一对应）。 */
const SOURCE_PREFIX = {
  fde: '/fde/skills',
  platform: '/fde/platform-skills',
  system: '/fde/system-skills',
  'platform-candidate': '/fde/platform-skill-candidates',
  review: '/fde/user-skill-reviews'
}

/** 有写/搜索端点的 source（platform-candidate / review 只读预览，无写与 search 端点，调用方不渲染入口）。 */
const WRITABLE_SOURCES = ['fde', 'platform', 'system']

function lastUrlOf(mockFn) {
  const calls = mockFn.mock.calls
  return calls[calls.length - 1][0]
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('接线守卫 · source→前缀矩阵（全部合法取值穷举）', () => {
  it.each(Object.entries(SOURCE_PREFIX))('读端点：source=%s → %s', async (source, prefix) => {
    await listSkillFiles('sk_x', source)
    expect(lastUrlOf(request.get)).toBe(`${prefix}/sk_x/files`)
    await getSkillFile('sk_x', 'SKILL.md', source)
    expect(lastUrlOf(request.get)).toBe(`${prefix}/sk_x/files/content`)
  })

  it.each(WRITABLE_SOURCES)('写/搜索/导入端点：source=%s 全部走同一前缀', async (source) => {
    const prefix = SOURCE_PREFIX[source]
    await saveSkillFile('sk_x', { path: 'a.md', content: '' }, source)
    expect(lastUrlOf(request.put)).toBe(`${prefix}/sk_x/files/content`)
    await deleteSkillFile('sk_x', 'a.md', source)
    expect(lastUrlOf(request.delete)).toBe(`${prefix}/sk_x/files`)
    await renameSkillFile('sk_x', { fromPath: 'a.md', toPath: 'b.md' }, source)
    expect(lastUrlOf(request.post)).toBe(`${prefix}/sk_x/files/rename`)
    await searchSkillFiles('sk_x', 'q', 'all', source)
    expect(lastUrlOf(request.get)).toBe(`${prefix}/sk_x/files/search`)
    await moveSkillNode('sk_x', { fromPath: 'a.md', toParentDir: 'd', isDir: false }, source)
    expect(lastUrlOf(request.post)).toBe(`${prefix}/sk_x/move`)
    await importZipToSkill('sk_x', new Blob(['PK']), { source })
    expect(lastUrlOf(request.post)).toBe(`${prefix}/sk_x/import-zip`)
  })

  it.each(WRITABLE_SOURCES)('导出端点：source=%s → /api{前缀}/{id}/export-zip', async (source) => {
    global.URL.createObjectURL = vi.fn(() => 'blob:x')
    global.URL.revokeObjectURL = vi.fn()
    const realCreate = document.createElement.bind(document)
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreate(tag)
      if (tag === 'a') el.click = vi.fn()
      return el
    })
    global.fetch = vi.fn(async () => ({
      status: 200,
      ok: true,
      headers: { get: () => 'attachment; filename="s.zip"' },
      blob: async () => ({ type: 'application/zip' })
    }))
    await exportSkillZip('sk_x', source)
    expect(global.fetch.mock.calls[0][0]).toBe(`/api${SOURCE_PREFIX[source]}/sk_x/export-zip`)
    createSpy.mockRestore()
  })

  it('未知 source 回落 FDE 前缀（现约定的兜底行为——新增通道漏接线会静默走 FDE 门，本用例把该风险钉在明处）', async () => {
    await listSkillFiles('sk_x', 'not-a-source')
    expect(lastUrlOf(request.get)).toBe('/fde/skills/sk_x/files')
  })
})
