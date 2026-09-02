// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * skillFiles.js base() 第三 source 'platform-candidate' → /fde/platform-skill-candidates 前缀（设计 FB2）。
 * 只读取数走此前缀，绝不落到 SYS_CONFIG 的 /fde/platform-skills 写端点。
 */
const getSpy = vi.fn(() => Promise.resolve({}))
vi.mock('@/api/request', () => ({ default: { get: (...a) => getSpy(...a), put: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ token: null }) }))
vi.mock('@/utils/skillFileTree', () => ({ parseContentDispositionFilename: () => 'x.zip' }))

// 2026-09-01 PRD 对齐改造取代旧口径：skillFiles.js 已加 demo mock 分流（VITE_SKILL_MOCK），
// 测试环境 DEV=true 会短路真实端点。本文件验证的是真实前缀分支，故显式关掉 mock。
vi.stubEnv('VITE_SKILL_MOCK', '0')

const { listSkillFiles, getSkillFile } = await import('@/api/skillFiles')

beforeEach(() => vi.clearAllMocks())

describe("skillFiles base('platform-candidate')", () => {
  it('listSkillFiles 走 /fde/platform-skill-candidates 前缀', () => {
    listSkillFiles(7, 'platform-candidate')
    expect(getSpy).toHaveBeenCalledWith('/fde/platform-skill-candidates/7/files')
  })
  it('getSkillFile 走 /fde/platform-skill-candidates 前缀（不走 /fde/platform-skills）', () => {
    getSkillFile(7, 'a.md', 'platform-candidate')
    const url = getSpy.mock.calls[0][0]
    expect(url).toBe('/fde/platform-skill-candidates/7/files/content')
    expect(url).not.toContain('/fde/platform-skills/')
  })
  it("默认/平台 source 不受影响（fde→/fde/skills, platform→/fde/platform-skills）", () => {
    listSkillFiles(1, 'fde')
    expect(getSpy).toHaveBeenLastCalledWith('/fde/skills/1/files')
    listSkillFiles(2, 'platform')
    expect(getSpy).toHaveBeenLastCalledWith('/fde/platform-skills/2/files')
  })
})
