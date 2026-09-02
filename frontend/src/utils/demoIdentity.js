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
