import { describe, it, expect, vi } from 'vitest'

/**
 * 合并技能页写操作分流器 apiFor()。
 *
 * 核心不变式：按 row.type 选命名空间，**绝不静默回落**——回落会让 A 类 id 打到 B 类前缀，
 * 后端跨通道守卫虽会 404（安全），但用户只看到莫名其妙的「技能不存在」，难以定位。
 */

const positionFns = {
  listSkills: vi.fn(),
  createStandaloneSkill: vi.fn(),
  updateSkill: vi.fn(),
  deleteSkill: vi.fn(),
  setSkillStatus: vi.fn()
}
vi.mock('@/api/position', () => positionFns)

const platformSkillApi = { list: vi.fn(), create: vi.fn(), remove: vi.fn(), delist: vi.fn(), relist: vi.fn() }
const systemSkillApi = { list: vi.fn(), create: vi.fn(), remove: vi.fn(), delist: vi.fn(), relist: vi.fn() }
vi.mock('@/api/platformSkill', () => ({ platformSkillApi, systemSkillApi }))

const getSpy = vi.fn(() => Promise.resolve({ list: [], total: 0 }))
vi.mock('@/api/request', () => ({ default: { get: (...a) => getSpy(...a) } }))

// 2026-09-01 PRD 对齐改造取代旧口径：unifiedSkill.js 已加 demo mock 分流（VITE_SKILL_MOCK），
// 测试环境 DEV=true 会短路真实端点。本文件验证分流器与真实读端点，故显式关掉 mock。
vi.stubEnv('VITE_SKILL_MOCK', '0')

const {
  apiFor,
  isPlatformFamily,
  typeLabel,
  listUnifiedSkills,
  SKILL_TYPE,
  SKILL_TYPE_LABEL,
  SKILL_EDIT_ROUTE
} = await import('@/api/unifiedSkill')

describe('apiFor 写操作分流', () => {
  it('平台共享 → platformSkillApi（/fde/platform-skills）', () => {
    expect(apiFor({ type: SKILL_TYPE.PLATFORM })).toBe(platformSkillApi)
  })

  it('系统内置 → systemSkillApi（/fde/system-skills），绝不落到平台命名空间', () => {
    const api = apiFor({ type: SKILL_TYPE.SYSTEM_DEFAULT })
    expect(api).toBe(systemSkillApi)
    expect(api).not.toBe(platformSkillApi)
  })

  // 2026-09-01 PRD 对齐改造取代旧口径：岗位私有技能已接入统一审核状态机，
  // 适配器补齐同构 publish/delist/relist（demo 仅 mock 路径可用；mock 关闭时调用抛错 fail-fast）。
  it('岗位私有 → position 适配器：有 setStatus，publish/上下架为 mock-only（关 mock 时抛错不静默）', () => {
    const api = apiFor({ type: SKILL_TYPE.POSITION })
    expect(api.remove).toBe(positionFns.deleteSkill)
    expect(api.setStatus).toBe(positionFns.setSkillStatus)
    expect(typeof api.publish).toBe('function')
    expect(typeof api.delist).toBe('function')
    expect(typeof api.relist).toBe('function')
    // VITE_SKILL_MOCK=0（本文件已关 mock）→ 调用抛「仅 demo mock 路径可用」，绝不打到不存在的端点
    expect(() => api.publish('sk_1', {})).toThrow(/仅 demo mock 路径可用/)
  })

  it('未知 / 缺失 type 一律抛错，不静默回落到任何一类', () => {
    expect(() => apiFor({ type: 'BUSINESS_SYSTEM' })).toThrow(/未知技能类型/)
    expect(() => apiFor({})).toThrow(/未知技能类型/)
    expect(() => apiFor(null)).toThrow(/未知技能类型/)
  })
})

describe('类型派生工具', () => {
  it('isPlatformFamily：平台共享与系统内置为真，岗位私有为假', () => {
    expect(isPlatformFamily({ type: SKILL_TYPE.PLATFORM })).toBe(true)
    expect(isPlatformFamily({ type: SKILL_TYPE.SYSTEM_DEFAULT })).toBe(true)
    expect(isPlatformFamily({ type: SKILL_TYPE.POSITION })).toBe(false)
    expect(isPlatformFamily(null)).toBe(false)
  })

  // 2026-09-01 PRD 对齐改造取代旧口径：类型文案对齐交互原型 v2 最终覆写态 typeLabels
  //（系统内置→通用技能、平台共享→市场技能）
  it('三类文案与用户口径一致', () => {
    expect(SKILL_TYPE_LABEL[SKILL_TYPE.SYSTEM_DEFAULT]).toBe('通用技能')
    expect(SKILL_TYPE_LABEL[SKILL_TYPE.POSITION]).toBe('岗位私有')
    expect(SKILL_TYPE_LABEL[SKILL_TYPE.PLATFORM]).toBe('市场技能')
    // 展示路径对脏数据兜底为空串，不抛（不该因脏数据白屏）
    expect(typeLabel('NOPE')).toBe('')
  })

  it('三类编辑路由各不相同，指向各自既有编辑器', () => {
    const routes = Object.values(SKILL_EDIT_ROUTE)
    expect(new Set(routes).size).toBe(3)
    expect(SKILL_EDIT_ROUTE[SKILL_TYPE.POSITION]).toBe('AdminSkillEdit')
    expect(SKILL_EDIT_ROUTE[SKILL_TYPE.PLATFORM]).toBe('SysConfigSkillEdit')
    expect(SKILL_EDIT_ROUTE[SKILL_TYPE.SYSTEM_DEFAULT]).toBe('SysConfigSystemSkillEdit')
  })
})

describe('读端点', () => {
  it('走聚合端点 /fde/admin-skills，不碰任何原列表端点', async () => {
    await listUnifiedSkills({ type: 'PLATFORM', page: 1, size: 10 })
    expect(getSpy).toHaveBeenCalledWith('/fde/admin-skills', {
      params: { type: 'PLATFORM', page: 1, size: 10 }
    })
    expect(positionFns.listSkills).not.toHaveBeenCalled()
    expect(platformSkillApi.list).not.toHaveBeenCalled()
    expect(systemSkillApi.list).not.toHaveBeenCalled()
  })
})
