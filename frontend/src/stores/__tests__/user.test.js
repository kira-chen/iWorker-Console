import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// node 环境无 localStorage / 无 DOM：注入最小内存版 localStorage，
// 让 store 初始化（读取 token / user）与 set/remove 正常工作。
class MemoryStorage {
  constructor() {
    this.map = new Map()
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null
  }
  setItem(k, v) {
    this.map.set(k, String(v))
  }
  removeItem(k) {
    this.map.delete(k)
  }
  clear() {
    this.map.clear()
  }
}
globalThis.localStorage = new MemoryStorage()

// 切断 auth(axios→element-plus) 与兄弟 store 的真实依赖链，仅验证本 store 纯逻辑
const getCurrentUser = vi.fn()
vi.mock('@/api/auth', () => ({ login: vi.fn(), getCurrentUser }))
const positionReset = vi.fn()
const chatReset = vi.fn()
vi.mock('@/stores/userPosition', () => ({
  useUserPositionStore: () => ({ reset: positionReset })
}))
vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({ reset: chatReset })
}))
const sessionReset = vi.fn()
vi.mock('@/stores/session', () => ({
  useSessionStore: () => ({ reset: sessionReset })
}))

const { useUserStore } = await import('@/stores/user')

describe('user store getters', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    positionReset.mockClear()
    chatReset.mockClear()
    sessionReset.mockClear()
    getCurrentUser.mockReset()
  })

  it('未登录默认态：role 空、roles 空、非 admin、不可进任一模块、未绑定、未登录', () => {
    const s = useUserStore()
    expect(s.role).toBe('')
    expect(s.roles).toEqual([])
    expect(s.isAdmin).toBe(false)
    expect(s.canFde).toBe(false)
    expect(s.canSysConfig).toBe(false)
    expect(s.isBackstage).toBe(false)
    expect(s.hasBoundPosition).toBe(false)
    expect(s.isLoggedIn).toBe(false)
  })

  // isAdmin 已收窄为「仅 ADMIN」：FDE/SYS_CONFIG 不再算 isAdmin（设计 §4.1）
  it('isAdmin：仅 ADMIN 为 true，FDE / SYS_CONFIG / EMPLOYEE 均为 false', () => {
    const s = useUserStore()
    s.setUserInfo({ roles: ['ADMIN'] })
    expect(s.isAdmin).toBe(true)
    s.setUserInfo({ roles: ['FDE'] })
    expect(s.isAdmin).toBe(false)
    s.setUserInfo({ roles: ['SYS_CONFIG'] })
    expect(s.isAdmin).toBe(false)
    s.setUserInfo({ roles: ['EMPLOYEE'] })
    expect(s.isAdmin).toBe(false)
  })

  it('canFde：FDE 或 ADMIN 为 true；纯 SYS_CONFIG / EMPLOYEE 为 false', () => {
    const s = useUserStore()
    s.setUserInfo({ roles: ['FDE'] })
    expect(s.canFde).toBe(true)
    s.setUserInfo({ roles: ['ADMIN'] })
    expect(s.canFde).toBe(true)
    s.setUserInfo({ roles: ['SYS_CONFIG'] })
    expect(s.canFde).toBe(false)
    s.setUserInfo({ roles: ['EMPLOYEE'] })
    expect(s.canFde).toBe(false)
  })

  it('canSysConfig：SYS_CONFIG 或 ADMIN 为 true；纯 FDE / EMPLOYEE 为 false', () => {
    const s = useUserStore()
    s.setUserInfo({ roles: ['SYS_CONFIG'] })
    expect(s.canSysConfig).toBe(true)
    s.setUserInfo({ roles: ['ADMIN'] })
    expect(s.canSysConfig).toBe(true)
    s.setUserInfo({ roles: ['FDE'] })
    expect(s.canSysConfig).toBe(false)
    s.setUserInfo({ roles: ['EMPLOYEE'] })
    expect(s.canSysConfig).toBe(false)
  })

  it('isBackstage：admin / FDE / SYS_CONFIG / 兼任 均可进后台；纯 EMPLOYEE 不可', () => {
    const s = useUserStore()
    s.setUserInfo({ roles: ['ADMIN'] })
    expect(s.isBackstage).toBe(true)
    s.setUserInfo({ roles: ['FDE'] })
    expect(s.isBackstage).toBe(true)
    s.setUserInfo({ roles: ['SYS_CONFIG'] })
    expect(s.isBackstage).toBe(true)
    s.setUserInfo({ roles: ['FDE', 'SYS_CONFIG'] })
    expect(s.isBackstage).toBe(true)
    expect(s.canFde).toBe(true)
    expect(s.canSysConfig).toBe(true)
    s.setUserInfo({ roles: ['EMPLOYEE'] })
    expect(s.isBackstage).toBe(false)
  })

  it('roles：优先取 userInfo.roles 数组；无 roles 字段时兜底为单值 [role]（旧响应兼容）', () => {
    const s = useUserStore()
    // 新响应：roles 数组权威
    s.setUserInfo({ role: 'EMPLOYEE', roles: ['SYS_CONFIG'] })
    expect(s.roles).toEqual(['SYS_CONFIG'])
    expect(s.canSysConfig).toBe(true)
    // 旧响应：仅单值 role，兜底 [role]，权限判定仍正确
    s.setUserInfo({ role: 'FDE' })
    expect(s.roles).toEqual(['FDE'])
    expect(s.canFde).toBe(true)
    expect(s.isAdmin).toBe(false)
  })

  it('role：从 userInfo.role 取，缺省空串', () => {
    const s = useUserStore()
    expect(s.role).toBe('')
    s.setUserInfo({ role: 'EMPLOYEE' })
    expect(s.role).toBe('EMPLOYEE')
  })

  it('hasBoundPosition：boundPositionId 存在为 true，否则 false', () => {
    const s = useUserStore()
    s.setUserInfo({ role: 'EMPLOYEE' })
    expect(s.hasBoundPosition).toBe(false)
    s.setUserInfo({ role: 'EMPLOYEE', boundPositionId: 42 })
    expect(s.hasBoundPosition).toBe(true)
  })

  it('isLoggedIn 跟随 token', () => {
    const s = useUserStore()
    expect(s.isLoggedIn).toBe(false)
    s.setToken('jwt')
    expect(s.isLoggedIn).toBe(true)
    s.setToken('')
    expect(s.isLoggedIn).toBe(false)
  })

  it('setToken 持久化/清除 localStorage', () => {
    const s = useUserStore()
    s.setToken('abc')
    expect(localStorage.getItem('ai_assistant_token')).toBe('abc')
    s.setToken('')
    expect(localStorage.getItem('ai_assistant_token')).toBeNull()
  })

  it('setUserInfo 持久化为 JSON / 清除', () => {
    const s = useUserStore()
    s.setUserInfo({ role: 'ADMIN', id: 1 })
    expect(JSON.parse(localStorage.getItem('ai_assistant_user'))).toEqual({
      role: 'ADMIN',
      id: 1
    })
    s.setUserInfo(null)
    expect(localStorage.getItem('ai_assistant_user')).toBeNull()
  })

  it('markBoundPosition 在已有 userInfo 时写入 boundPositionId', () => {
    const s = useUserStore()
    s.setUserInfo({ role: 'EMPLOYEE' })
    s.markBoundPosition(7)
    expect(s.hasBoundPosition).toBe(true)
    expect(s.userInfo.boundPositionId).toBe(7)
  })

  it('markBoundPosition 在无 userInfo 时不创建脏数据', () => {
    const s = useUserStore()
    s.markBoundPosition(7)
    expect(s.userInfo).toBeNull()
  })

  // 注：refreshProfile 的 4 个用例已随该函数退役删除（取消登录后无 /auth/me 可刷，
  // demo 身份由 utils/demoIdentity.js 注入）。

  it('logout 清登录态并重置兄弟 store', () => {
    const s = useUserStore()
    s.setToken('jwt')
    s.setUserInfo({ role: 'EMPLOYEE', boundPositionId: 1 })
    s.logout()
    expect(s.isLoggedIn).toBe(false)
    expect(s.userInfo).toBeNull()
    expect(localStorage.getItem('ai_assistant_token')).toBeNull()
    expect(positionReset).toHaveBeenCalledOnce()
    expect(chatReset).toHaveBeenCalledOnce()
    expect(sessionReset).toHaveBeenCalledOnce()
  })
})

describe('readStoredUser（启动读盘容错）', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('脏 JSON 不抛错：回退 null 且清除脏数据', async () => {
    localStorage.setItem('ai_assistant_user', '{bad json')
    setActivePinia(createPinia())
    const mod = await import('@/stores/user')
    const s = mod.useUserStore()
    expect(s.userInfo).toBeNull()
    expect(localStorage.getItem('ai_assistant_user')).toBeNull()
  })

  it('合法 JSON 正常恢复 userInfo', async () => {
    localStorage.setItem('ai_assistant_user', JSON.stringify({ role: 'ADMIN' }))
    setActivePinia(createPinia())
    const mod = await import('@/stores/user')
    const s = mod.useUserStore()
    expect(s.role).toBe('ADMIN')
    expect(s.isAdmin).toBe(true)
  })
})
