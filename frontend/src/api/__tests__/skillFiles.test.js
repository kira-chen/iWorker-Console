import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock request（其链路含 router 需 window）。仅验证 method/path/body + source 前缀分支 + skipGlobalError。
vi.mock('@/api/request', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }
}))
// skillFiles.js 顶部 import useUserStore（exportSkillZip 用），其模块链含 window；node 环境 mock 掉避免 ReferenceError。
vi.mock('@/stores/user', () => ({
  useUserStore: () => ({ token: 'jwt', logout: vi.fn() })
}))

// 2026-09-01 PRD 对齐改造取代旧口径：skillFiles.js 已加 demo mock 分流（VITE_SKILL_MOCK），
// 测试环境 DEV=true 会短路真实端点。本文件验证的是真实接口路径分支，故显式关掉 mock。
vi.stubEnv('VITE_SKILL_MOCK', '0')

const request = (await import('@/api/request')).default
const {
  importSkillZip,
  listSkillFiles,
  getSkillFile,
  saveSkillFile,
  deleteSkillFile,
  renameSkillFile
} = await import('@/api/skillFiles')

const W = { skipGlobalError: true }

describe('skillFiles API · source 前缀分支（F4）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('listSkillFiles fde → GET /fde/skills/{id}/files', () => {
    listSkillFiles(7, 'fde')
    expect(request.get).toHaveBeenCalledWith('/fde/skills/7/files')
  })
  it('listSkillFiles platform → GET /fde/platform-skills/{id}/files', () => {
    listSkillFiles(7, 'platform')
    expect(request.get).toHaveBeenCalledWith('/fde/platform-skills/7/files')
  })

  it('getSkillFile → GET .../files/content?path=（path 走 params）', () => {
    getSkillFile(7, 'references/a.md', 'fde')
    expect(request.get).toHaveBeenCalledWith('/fde/skills/7/files/content', {
      params: { path: 'references/a.md' }
    })
  })

  it('saveSkillFile → PUT .../files/content {path,content}，带 skipGlobalError', () => {
    saveSkillFile(7, { path: 'a.md', content: 'x' }, 'fde')
    expect(request.put).toHaveBeenCalledWith(
      '/fde/skills/7/files/content',
      { path: 'a.md', content: 'x' },
      W
    )
  })

  it('deleteSkillFile → DELETE .../files?path=，带 skipGlobalError', () => {
    deleteSkillFile(7, 'a.md', 'platform')
    expect(request.delete).toHaveBeenCalledWith('/fde/platform-skills/7/files', {
      ...W,
      params: { path: 'a.md' }
    })
  })

  it('renameSkillFile → POST .../files/rename {fromPath,toPath}，带 skipGlobalError', () => {
    renameSkillFile(7, { fromPath: 'a.md', toPath: 'b.md' }, 'fde')
    expect(request.post).toHaveBeenCalledWith(
      '/fde/skills/7/files/rename',
      { fromPath: 'a.md', toPath: 'b.md' },
      W
    )
  })

  it('importSkillZip：FormData multipart + skipGlobalError，平台不带 agentId', () => {
    const file = new Blob(['zip'], { type: 'application/zip' })
    importSkillZip(file, { source: 'platform', agentId: 9 })
    const [url, fd, cfg] = request.post.mock.calls[0]
    expect(url).toBe('/fde/platform-skills/import-zip')
    expect(fd).toBeInstanceOf(FormData)
    expect(fd.get('file')).toBeTruthy()
    expect(fd.get('agentId')).toBeNull() // 平台不带 agentId
    expect(cfg.skipGlobalError).toBe(true)
    expect(cfg.headers['Content-Type']).toBe('multipart/form-data')
  })

  it('importSkillZip：FDE 带 agentId 时塞进 FormData', () => {
    const file = new Blob(['zip'], { type: 'application/zip' })
    importSkillZip(file, { source: 'fde', agentId: 9 })
    const [url, fd] = request.post.mock.calls[0]
    expect(url).toBe('/fde/skills/import-zip')
    expect(fd.get('agentId')).toBe('9')
  })
})
