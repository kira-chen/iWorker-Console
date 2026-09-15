import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// 2026-09-12 负责人决策 3（审计 J2）：员工端整体退役，本 store 的兄弟 store
// （userPosition / chat / session）与 api/auth.js 一并删除，故不再 import；
// login() 与 logout() 里的相关调用同步移除（见下方各自注释）。

const TOKEN_KEY = 'ai_assistant_token'
const USER_KEY = 'ai_assistant_user'

// 安全读取并解析本地用户信息：解析失败回退 null 并清除脏数据，避免启动白屏
function readStoredUser() {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (e) {
    localStorage.removeItem(USER_KEY)
    return null
  }
}

// 用户登录态：token + 基本信息 + 是否已绑定专家
export const useUserStore = defineStore('user', () => {
  const token = ref(localStorage.getItem(TOKEN_KEY) || '')
  const userInfo = ref(readStoredUser())

  const isLoggedIn = computed(() => !!token.value)
  // 后端返回 user.boundPositionId 表示已绑定岗位专家
  const hasBoundPosition = computed(() => !!userInfo.value?.boundPositionId)

  // 强制首改标志（原后端 /auth/login、/auth/me 返回 user.mustChangePassword 布尔）：
  // 2026-09-12 负责人决策 3（审计 J2）——强制改密页与登录流程已随员工端整体退役，
  // 该标志不再有守卫消费方；字段与 getter 暂留（demoIdentity 恒置 false），供日后登录方案定型时复用。
  const mustChangePassword = computed(() => !!userInfo.value?.mustChangePassword)

  // 角色（单值）：后端 /auth/login、/auth/me 返回 user.role（统一大写）。
  // 仅供「显示兜底」用——所有权限判定/分流/菜单显隐一律走下方 roles 数组，禁止用单值 role 判权。
  const role = computed(() => userInfo.value?.role || '')

  // 角色集合（权威）：后端返回 user.roles 数组（如 ['ADMIN']/['FDE']/['SYS_CONFIG']/['EMPLOYEE']）。
  // 兼容旧响应：无 roles 字段时兜底为单值 [role]（旧 token / 旧后端不崩，见设计 §4.1/§7）。
  const roles = computed(() => {
    const arr = userInfo.value?.roles
    if (Array.isArray(arr) && arr.length) return arr
    return role.value ? [role.value] : []
  })

  // 双模块角色判定（设计 §4.1，硬约束：一律基于 roles 数组）：
  // - isAdmin 收窄为「仅 ADMIN」（超管，两模块全通）；FDE 不再算 isAdmin。
  // - canFde / canSysConfig：持对应角色或 admin 超管。
  // - isBackstage：可进后台壳（替换原「isAdmin 落地后台」语义）。
  const isAdmin = computed(() => roles.value.includes('ADMIN'))
  const canFde = computed(() => roles.value.includes('FDE') || isAdmin.value)
  const canSysConfig = computed(() => roles.value.includes('SYS_CONFIG') || isAdmin.value)
  const isBackstage = computed(() => canFde.value || canSysConfig.value)

  // 页面权限集（V102 角色与权限改造）：后端 /auth/login、/auth/me 返回 user.pages
  // （该用户所有角色的 role_permission 授权行并集；ADMIN 超管为全集）。
  // 菜单显隐与路由守卫改按「页面」判定，不再按 FDE / SYS_CONFIG 两个粗角色硬判。
  const pages = computed(() => {
    const arr = userInfo.value?.pages
    return Array.isArray(arr) ? arr : []
  })

  /**
   * 是否有某页面权限。
   *
   * 【兜底口径】pages 为空时**退回旧的粗角色判定**——旧 token / 旧后端响应没有该字段，
   * 直接按「无权限」处理会把老会话的用户全部锁在门外。故仅当后端确实下发了 pages 才逐页判定。
   */
  function hasPage(code) {
    if (isAdmin.value) return true
    if (!pages.value.length) return null   // null = 无页面数据，调用方退回角色判定
    return pages.value.includes(code)
  }

  function setToken(t) {
    token.value = t
    if (t) {
      localStorage.setItem(TOKEN_KEY, t)
    } else {
      localStorage.removeItem(TOKEN_KEY)
    }
  }

  // 字段口径：本地 userInfo 用 `name`（登录口径，来源 /auth/login、/auth/me），
  // 头像 initial 取自 userInfo.name；而个人资料体系用 `displayName`（GET/PUT /users/me）。
  // 两者须保持同步——Settings.saveProfile 保存资料时已同写 name + displayName。
  // 后续任何改资料的地方勿只写 displayName，否则头像 initial 会与资料失同步。
  function setUserInfo(info) {
    userInfo.value = info
    if (info) {
      localStorage.setItem(USER_KEY, JSON.stringify(info))
    } else {
      localStorage.removeItem(USER_KEY)
    }
  }

  // 标记已绑定专家（绑定成功后调用）
  function markBoundPosition(positionId) {
    if (userInfo.value) {
      setUserInfo({ ...userInfo.value, boundPositionId: positionId })
    }
  }

  // 注：原 refreshProfile（启动拉 /auth/me 静默回填）已随取消登录退役——demo 身份由
  // utils/demoIdentity.js 在启动与每次导航前注入，无服务端用户态可刷新。
  // 2026-09-12 负责人决策 3（审计 J2）：login()（走已删的 api/auth.js）与
  // clearMustChangePassword()（配套已删的强制改密页）一并退役。

  // 集中登出：清登录态（2026-09-12 负责人决策 3 / 审计 J2——原先一并 reset 的
  // userPosition / chat / session 三个员工端 store 已删除，故只剩清 token + 用户信息）
  function logout() {
    setToken('')
    setUserInfo(null)
  }

  return {
    token,
    userInfo,
    isLoggedIn,
    hasBoundPosition,
    mustChangePassword,
    role,
    roles,
    pages,
    hasPage,
    isAdmin,
    canFde,
    canSysConfig,
    isBackstage,
    setToken,
    setUserInfo,
    markBoundPosition,
    logout
  }
})
