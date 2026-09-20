/**
 * Demo 内置身份（2026-09-01 取消登录与权限控制）。
 *
 * 项目为纯前端 demo：打开即以内置「演示管理员」身份进入管理后台，不再走登录流程。
 * 身份仍写入 user store（isAdmin=true → hasPage 恒真、canFde/canSysConfig 恒真），
 * 这样菜单显隐、页面内按角色的分支逻辑零改动即全部放开——权限模型代码保留，仅判定源固定为超管。
 *
 * 注入时机：main.js 启动时 + 路由每次导航前兜底（logout 等路径清了身份也会被立即补回）。
 */
export const DEMO_ADMIN = {
  id: 1,
  username: 'demo',
  name: '演示管理员',
  role: 'ADMIN',
  roles: ['ADMIN'],
  mustChangePassword: false
}

export const DEMO_TOKEN = 'demo-token'

/** 确保 user store 持有演示管理员身份；已是管理员登录态则不动（幂等）。 */
export function ensureDemoIdentity(userStore) {
  if (!userStore.isLoggedIn || !userStore.isAdmin) {
    userStore.setToken(DEMO_TOKEN)
    userStore.setUserInfo({ ...DEMO_ADMIN })
  }
}

// user store 的身份持久化键（stores/user.js USER_KEY，同一串）。mock 层不在 setup 上下文里，
// 拿不到 pinia 实例，只能读 store 落在 localStorage 的那份；与页面侧
// `userStore.userInfo?.name`（UserSkillReviews.vue:77）同源同口径。
const USER_KEY = 'ai_assistant_user'

/**
 * 当前 demo 身份的展示名（2026-09-12 负责人决策 5（审计 J12）新增）。
 *
 * 用途：mock 层记「审核人」。取值序：user store 落盘身份的 name → username → 内置演示管理员的 name。
 * 不硬编码任何人名——localStorage 不可用（node 环境测试）时也能回到 DEMO_ADMIN 单一真相。
 */
export function currentDemoUserName() {
  try {
    const raw = globalThis.localStorage?.getItem(USER_KEY)
    if (raw) {
      const info = JSON.parse(raw)
      const name = String(info?.name || info?.username || '').trim()
      if (name) return name
    }
  } catch (e) {
    // 解析失败按「无身份」处理，落到内置演示管理员
  }
  return DEMO_ADMIN.name
}

/**
 * 当前 demo 身份的登录用户名（2026-09-20 版本管理新增）。
 *
 * 用途：mock 层记「操作人 / 发布人」这类要展示用户名（如 xiaomei）而非姓名的字段——
 * 版本管理的发布人、访问审计「管理端操作」的操作人。取值序：user store 落盘身份的 username → 内置演示管理员的 username。
 * 与 currentDemoUserName（姓名口径，审核人用）区分，勿混用。
 */
export function currentDemoUsername() {
  try {
    const raw = globalThis.localStorage?.getItem(USER_KEY)
    if (raw) {
      const username = String(JSON.parse(raw)?.username || '').trim()
      if (username) return username
    }
  } catch (e) {
    // 解析失败按「无身份」处理，落到内置演示管理员
  }
  return DEMO_ADMIN.username
}
