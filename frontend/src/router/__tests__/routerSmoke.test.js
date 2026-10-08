// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * 路由冒烟 + 旧链接重定向 —— 2026-10-08 对齐 src/router/index.js 现状（/test-audit 共享层补缺口）。
 *
 * 覆盖点：
 *   1. 全局前置守卫接线：任意导航后 user store 带上内置演示管理员身份（roles 含 ADMIN、token = demo-token）。
 *      router/index.js 注释原话「免登录直达管理后台就靠这一步（务必保留）」——这条守卫被删，整站菜单与按角色分支全灭。
 *      ensureDemoIdentity 自身的单元用例归组织组（utils/__tests__/demoIdentity.test.js），本文件只测「路由有没有接上它」。
 *   2. 全局后置钩子：/admin 前缀路由给 <body> 挂 admin-scope 类（后台专属样式全靠它限定），离开 /admin 摘掉。
 *   3. 旧链接 / 收藏重定向：market、skills、platform-skills、system-skills、skill-reviews、mcp / apis / biz-systems、
 *      用户技能审核查看深链、兜底 catch-all —— 逐条断落点 name 与 query。
 *
 * 写法：加载真实路由表，只把 createWebHistory 换成内存 history（不碰地址栏）；页面组件全部替换为空组件
 * （本文件只测路由，不渲染页面）。每条用例 resetModules 后重新导入，拿一份全新的 router 与 pinia，互不串味。
 */

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, createWebHistory: () => actual.createMemoryHistory() }
})

// 页面组件一律换成空组件：路由导航会解析懒加载组件，真页面会拉起整套 mock 与 Element Plus，与本文件无关
const stub = { default: { name: 'StubPage', render: () => null } }
vi.mock('@/layouts/AdminLayout.vue', () => stub)
vi.mock('@/views/admin/AdminCockpit.vue', () => stub)
vi.mock('@/views/admin/AdminComingSoonPlaceholder.vue', () => stub)
vi.mock('@/views/admin/AdminConnector.vue', () => stub)
vi.mock('@/views/admin/AdminExperts.vue', () => stub)
vi.mock('@/views/admin/AdminFeedback.vue', () => stub)
vi.mock('@/views/admin/AdminInstances.vue', () => stub)
vi.mock('@/views/admin/AdminKnowledgeBase.vue', () => stub)
vi.mock('@/views/admin/AdminLoginLogs.vue', () => stub)
vi.mock('@/views/admin/AdminModels.vue', () => stub)
vi.mock('@/views/admin/AdminPositionAssignments.vue', () => stub)
vi.mock('@/views/admin/AdminPositions.vue', () => stub)
vi.mock('@/views/admin/AdminRoles.vue', () => stub)
vi.mock('@/views/admin/AdminRuntimeSpecs.vue', () => stub)
vi.mock('@/views/admin/AdminSkillEditPage.vue', () => stub)
vi.mock('@/views/admin/AdminSkillsUnified.vue', () => stub)
vi.mock('@/views/admin/AdminToolCallAudit.vue', () => stub)
vi.mock('@/views/admin/AdminUsers.vue', () => stub)
vi.mock('@/views/admin/AdminVersions.vue', () => stub)
vi.mock('@/views/admin/FieldManagement.vue', () => stub)
vi.mock('@/views/admin/MyApplications.vue', () => stub)
vi.mock('@/views/admin/PositionDetailTabs.vue', () => stub)
vi.mock('@/views/admin/UnifiedReview.vue', () => stub)
vi.mock('@/views/admin/UserSkillReviews.vue', () => stub)
vi.mock('@/views/dev/DevReActSimulated.vue', () => stub)
vi.mock('@/views/dev/DevSkillEditor.vue', () => stub)

// 本仓 jsdom 下 globalThis.localStorage 可能为 undefined（jsdom 29 交给 Node 原生实现，本机 Node 26 默认关闭），
// 写法同 utils/__tests__/demoIdentity.test.js：仅在缺失时补桩、已有实现只清空，不在 afterEach 还原
const makeStorage = () => {
  const map = new Map()
  return {
    get length() { return map.size },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear()
  }
}

let router, userStore
beforeEach(async () => {
  if (!globalThis.localStorage || typeof globalThis.localStorage.getItem !== 'function') {
    Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), writable: true, configurable: true })
  }
  globalThis.localStorage.clear()
  document.body.classList.remove('admin-scope')
  vi.resetModules()
  setActivePinia(createPinia())
  router = (await import('@/router/index.js')).default
  const { useUserStore } = await import('@/stores/user')
  userStore = useUserStore()
})

const landed = () => ({ name: router.currentRoute.value.name, query: { ...router.currentRoute.value.query } })

describe('全局守卫接线：免登录直达管理后台', () => {
  it('前提：导航之前 user store 是空身份（无 token、无角色）', () => {
    expect(userStore.token).toBe('')
    expect(userStore.roles).toEqual([])
  })

  it('打开 /admin/users → 自动带上演示管理员身份：角色含 ADMIN、token 为 demo-token', async () => {
    await router.push('/admin/users')
    expect(router.currentRoute.value.name).toBe('AdminUsers')
    expect(userStore.roles).toContain('ADMIN')
    expect(userStore.token).toBe('demo-token')
  })

  it('身份被清掉（如登出）后再导航 → 守卫立即补回管理员身份', async () => {
    await router.push('/admin/users')
    userStore.logout()
    expect(userStore.token).toBe('')
    await router.push('/admin/roles')
    expect(userStore.token).toBe('demo-token')
    expect(userStore.roles).toContain('ADMIN')
  })
})

describe('后置钩子：后台作用域类 admin-scope', () => {
  it('进入 /admin 下的页面 → <body> 带 admin-scope 类', async () => {
    await router.push('/admin/users')
    expect(document.body.classList.contains('admin-scope')).toBe(true)
  })

  it('沉浸式整页（岗位配置台，同在 /admin 下）也带 admin-scope', async () => {
    await router.push('/admin/positions/401/workbench')
    expect(router.currentRoute.value.name).toBe('PositionWorkbench')
    expect(document.body.classList.contains('admin-scope')).toBe(true)
  })

  it('离开 /admin（开发隔离页 /dev/skill-editor）→ admin-scope 被摘掉', async () => {
    await router.push('/admin/users')
    expect(document.body.classList.contains('admin-scope')).toBe(true)
    await router.push('/dev/skill-editor')
    expect(router.currentRoute.value.name).toBe('DevSkillEditor')
    expect(document.body.classList.contains('admin-scope')).toBe(false)
  })
})

describe('旧链接 / 收藏重定向落点', () => {
  it('/admin/market?tab=review（旧审核 tab）→ 审核中心 UnifiedReview', async () => {
    await router.push('/admin/market?tab=review')
    expect(landed()).toEqual({ name: 'UnifiedReview', query: { tab: 'review' } })
  })

  it('/admin/market?tab=publish（旧发布 tab）→ 连接器 AdminConnector', async () => {
    await router.push('/admin/market?tab=publish')
    expect(landed().name).toBe('AdminConnector')
  })

  it('/admin/market 不带 tab → 连接器 AdminConnector', async () => {
    await router.push('/admin/market')
    expect(landed()).toEqual({ name: 'AdminConnector', query: {} })
  })

  it('/admin/skills（旧岗位技能页）→ 技能页 AdminSkillsUnified，原 query 原样透传', async () => {
    await router.push('/admin/skills?keyword=报销&type=POSITION')
    expect(landed()).toEqual({ name: 'AdminSkillsUnified', query: { keyword: '报销', type: 'POSITION' } })
  })

  it('/admin/platform-skills → 技能页并预筛 type=PLATFORM', async () => {
    await router.push('/admin/platform-skills')
    expect(landed()).toEqual({ name: 'AdminSkillsUnified', query: { type: 'PLATFORM' } })
  })

  it('/admin/system-skills → 技能页并预筛 type=SYSTEM_DEFAULT', async () => {
    await router.push('/admin/system-skills')
    expect(landed()).toEqual({ name: 'AdminSkillsUnified', query: { type: 'SYSTEM_DEFAULT' } })
  })

  it('/admin/skill-reviews（旧技能审核台）→ 审核中心 UnifiedReview', async () => {
    await router.push('/admin/skill-reviews')
    expect(landed()).toEqual({ name: 'UnifiedReview', query: {} })
  })

  it('/admin/mcp → 连接器 MCP 页签（?tab=mcp）', async () => {
    await router.push('/admin/mcp')
    expect(landed()).toEqual({ name: 'AdminConnector', query: { tab: 'mcp' } })
  })

  it('/admin/apis → 连接器 API 页签（?tab=api）', async () => {
    await router.push('/admin/apis')
    expect(landed()).toEqual({ name: 'AdminConnector', query: { tab: 'api' } })
  })

  it('/admin/biz-systems → 连接器业务系统页签（?tab=bizsystem）', async () => {
    await router.push('/admin/biz-systems')
    expect(landed()).toEqual({ name: 'AdminConnector', query: { tab: 'bizsystem' } })
  })

  it('/admin/user-skill-reviews/88/view（旧查看技能整页）→ 用户技能审核列表 ?view=88 自动开抽屉', async () => {
    await router.push('/admin/user-skill-reviews/88/view')
    expect(landed()).toEqual({ name: 'SysConfigUserSkillReviews', query: { view: '88' } })
  })

  it('敲错的地址 /no/such/page → 兜底回岗位管理 AdminPositions', async () => {
    await router.push('/no/such/page')
    expect(landed().name).toBe('AdminPositions')
  })

  it('根路径 / 与 /admin → 都落岗位管理 AdminPositions', async () => {
    await router.push('/')
    expect(landed().name).toBe('AdminPositions')
    await router.push('/admin/users')
    await router.push('/admin')
    expect(landed().name).toBe('AdminPositions')
  })
})
