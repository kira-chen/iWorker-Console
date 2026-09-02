// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp, h } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import AdminRail from '@/components/admin/AdminRail.vue'
import { useUserStore } from '@/stores/user'

/**
 * AdminRail 共享窄轨（六段分组带序号，2026-08-21 导航改版）渲染/高亮回归保护：
 *
 * 菜单六段（分组标题带序号，仅作类别归属、无真实页面）：
 *   01 总览：驾驶舱（规划中占位）——三后台角色（isBackstage）均见。
 *   02 岗位：岗位 / 岗位分配——随 canFde 显隐。（原「岗位技能」已随三页合一并入 03 能力段的「技能」）
 *   03 能力：专家 / 技能 / 知识库(占位) / 连接器 / 模型——整段随 canSysConfig 显隐，「模型」仅 ADMIN 逐项收窄。
 *   「技能」（三页合一，2026-08-23）取代原「岗位技能 / 平台技能 / 系统内置技能」三项，显隐由页面权限 CAPABILITY_SKILL_CONSOLE 治理。
 *   04 运行：实例与会话 / 运行规格 / 配额与限流（均占位）——整段仅 ADMIN。
 *   05 治理：审核中心 / 用户技能审核 / 访问审计 / 用户反馈 / 字段字典——整段仅 ADMIN。
 *   06 组织：用户 / 角色与权限——整段仅 ADMIN。
 *
 * 显隐一律基于 roles 派生 isBackstage / canFde / canSysConfig / isAdmin（禁单值 role 判权）：
 *   仅 FDE → 见 01 总览 + 02 岗位；仅 SYS_CONFIG → 见 01 总览 + 03 能力（无模型，无 04/05/06）；admin → 六段全见。
 * 高亮沿用 route.meta.activeMenu || route.name：工作台 / 技能编辑沉浸页归并到对应一级项。
 * 部分菜单仅文案改版、路由 name 不变（审核中心=UnifiedReview、访问审计=AdminLoginLogs、字段字典=SysConfigFieldManagement、角色与权限=AdminRoles）。
 * 「报表」（FdeReports）本次改版从菜单移除（路由保留、菜单不列）。
 *
 * 不引 @vue/test-utils：createApp 挂 jsdom 容器，配真实 memory router 与最小 EP/图标存根。
 */

function makeRouter() {
  const blank = { template: '<div />' }
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      // 01 总览
      { path: '/admin/cockpit', name: 'AdminCockpit', component: blank },
      // 02 岗位
      { path: '/admin/positions', name: 'AdminPositions', component: blank },
      { path: '/admin/position-assignments', name: 'AdminPositionAssignments', component: blank },
      { path: '/admin/skills-all', name: 'AdminSkillsUnified', component: blank },
      // 03 能力
      { path: '/admin/experts', name: 'AdminExperts', component: blank },
      { path: '/admin/knowledge-base', name: 'AdminKnowledgeBase', component: blank },
      { path: '/admin/connector', name: 'AdminConnector', component: blank },
      { path: '/admin/models', name: 'AdminModels', component: blank },
      // 04 运行（占位）
      { path: '/admin/instances', name: 'AdminInstances', component: blank },
      { path: '/admin/runtime-specs', name: 'AdminRuntimeSpecs', component: blank },
      { path: '/admin/quota-throttle', name: 'AdminQuotaThrottle', component: blank },
      // 05 治理
      // 2026-09-01 PRD 对齐改造：新增「我的申请」（列于审核中心之前）
      { path: '/admin/my-applications', name: 'AdminMyApplications', component: blank },
      { path: '/admin/review', name: 'UnifiedReview', component: blank },
      { path: '/admin/user-skill-reviews', name: 'SysConfigUserSkillReviews', component: blank },
      { path: '/admin/login-logs', name: 'AdminLoginLogs', component: blank },
      { path: '/admin/feedbacks', name: 'AdminFeedback', component: blank },
      { path: '/admin/field-management', name: 'SysConfigFieldManagement', component: blank },
      // 06 组织
      { path: '/admin/users', name: 'AdminUsers', component: blank },
      { path: '/admin/roles', name: 'AdminRoles', component: blank },
      // 沉浸页（activeMenu 归并）
      {
        path: '/admin/platform-skills/:id/edit',
        name: 'SysConfigSkillEdit',
        component: blank,
        meta: { activeMenu: 'AdminSkillsUnified' }
      },
      { path: '/admin/reports/fde', name: 'FdeReports', component: blank },
      {
        path: '/admin/positions/:id/workbench',
        name: 'PositionWorkbench',
        component: blank,
        meta: { activeMenu: 'AdminPositions' }
      },
      {
        path: '/admin/skills/:id/edit',
        name: 'AdminSkillEdit',
        component: blank,
        meta: { activeMenu: 'AdminSkillsUnified' }
      },
      { path: '/login', name: 'Login', component: blank }
    ]
  })
}

const elStubs = {
  'el-dropdown': { template: '<div><slot /><slot name="dropdown" /></div>' },
  'el-dropdown-menu': { template: '<div><slot /></div>' },
  'el-dropdown-item': {
    props: ['command', 'divided'],
    template: '<div class="el-dropdown-item" :data-command="command"><slot /></div>'
  },
  'el-avatar': { template: '<span><slot /></span>' },
  'el-icon': { template: '<i><slot /></i>' },
  SwitchButton: { template: '<i class="icon-switch" />' },
  ThemeToggle: { template: '<button class="theme-toggle" />' }
}

let container
let app

// roles：设置当前账号角色集合（驱动分段显隐）
// pages：V102 页面权限集；给了就按页逐项显隐，不给则退回 roles 口径（向下兼容分支）
async function mount(routeTarget, roles = ['ADMIN'], pages = undefined) {
  const router = makeRouter()
  router.push(routeTarget)
  await router.isReady()

  container = document.createElement('div')
  document.body.appendChild(container)

  app = createApp({ render: () => h(AdminRail) })
  app.use(router)
  for (const [name, comp] of Object.entries(elStubs)) app.component(name, comp)
  app.mount(container)
  // pinia 已在 app.use 前由 setActivePinia 激活；这里设角色
  useUserStore().setUserInfo(pages ? { roles, pages } : { roles })
  await Promise.resolve()
  return container
}

function labelsOf(el) {
  return [...el.querySelectorAll('.rail-label')].map((n) => n.textContent.trim())
}
// 分组标题：名称部分（.rail-group-name）——不含序号，便于断言类别名。
function groupNamesOf(el) {
  return [...el.querySelectorAll('.rail-group-name')].map((n) => n.textContent.trim())
}
// 分组序号（.rail-group-no）。
function groupNosOf(el) {
  return [...el.querySelectorAll('.rail-group-no')].map((n) => n.textContent.trim())
}

describe('AdminRail 六段分组窄轨（带序号）', () => {
  beforeEach(() => {
    const pinia = createPinia()
    setActivePinia(pinia)
    if (!('localStorage' in globalThis) || typeof globalThis.localStorage?.getItem !== 'function') {
      const mem = new Map()
      globalThis.localStorage = {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => mem.set(k, String(v)),
        removeItem: (k) => mem.delete(k),
        clear: () => mem.clear()
      }
    }
  })
  afterEach(() => {
    app?.unmount()
    container?.remove()
  })

  it('admin：六段全见，序号 01–06，各项按新结构与文案排列，报表已移除', async () => {
    const el = await mount({ name: 'AdminPositions' }, ['ADMIN'])
    expect(groupNamesOf(el)).toEqual(['总览', '岗位', '能力', '运行', '治理', '组织'])
    expect(groupNosOf(el)).toEqual(['01', '02', '03', '04', '05', '06'])
    expect(labelsOf(el)).toEqual([
      '驾驶舱',
      '岗位', '岗位分配',
      // 「技能」= 三页合一（2026-08-23），取代原 岗位技能/平台技能/系统内置技能 三项
      '专家', '技能', '知识库', '连接器', '模型',
      '实例与会话', '运行规格', '配额与限流',
      // 2026-09-01 PRD 对齐改造取代旧口径：治理组新增「我的申请」，列于「审核中心」之前
      '我的申请', '审核中心', '用户技能审核', '访问审计', '用户反馈', '字段字典',
      '用户', '角色与权限'
    ])
    // 改版后旧文案 / 已移除项不应再出现
    expect(labelsOf(el)).not.toContain('报表')
    // 三页合一后这三项不该再出现
    expect(labelsOf(el)).not.toContain('岗位技能')
    expect(labelsOf(el)).not.toContain('平台技能')
    expect(labelsOf(el)).not.toContain('系统内置技能')
    expect(labelsOf(el)).not.toContain('发布审核') // 已改「审核中心」
    expect(labelsOf(el)).not.toContain('登录明细') // 已改「访问审计」
    expect(labelsOf(el)).not.toContain('字段管理') // 已改「字段字典」
    expect(labelsOf(el)).not.toContain('角色') // 已改「角色与权限」
  })

  // 注：纯 roles 口径（无 pages）下 FDE 看不到「技能」——该页属 03 能力段（canSysConfig）。
  // 三页合一后 FDE 要访问技能须由管理员授予 CAPABILITY_SKILL_CONSOLE 页面权限（见下方 pages 用例）。
  it('仅 FDE：见 01 总览 + 02 岗位两段，不见能力/运行/治理/组织段', async () => {
    const el = await mount({ name: 'AdminPositions' }, ['FDE'])
    expect(groupNamesOf(el)).toEqual(['总览', '岗位'])
    expect(labelsOf(el)).toEqual(['驾驶舱', '岗位', '岗位分配'])
  })

  it('仅 SYS_CONFIG：见 01 总览 + 03 能力（无模型），无运行/治理/组织段', async () => {
    const el = await mount({ name: 'AdminConnector' }, ['SYS_CONFIG'])
    expect(groupNamesOf(el)).toEqual(['总览', '能力'])
    // 纯 sysconfig 非 admin → 运行/治理/组织段（isAdmin）整段隐藏；能力段「模型」项（仅 admin）逐项隐藏
    expect(labelsOf(el)).toEqual([
      '驾驶舱',
      '专家', '技能', '知识库', '连接器'
    ])
    expect(labelsOf(el)).not.toContain('模型')
    expect(labelsOf(el)).not.toContain('审核中心')
  })

  it('兼任（FDE+SYS_CONFIG，非 admin）：见总览+岗位+能力三段，无模型项(仅 admin)、无运行/治理/组织段', async () => {
    const el = await mount({ name: 'AdminPositions' }, ['FDE', 'SYS_CONFIG'])
    expect(groupNamesOf(el)).toEqual(['总览', '岗位', '能力'])
    expect(labelsOf(el)).toEqual([
      '驾驶舱',
      '岗位', '岗位分配',
      '专家', '技能', '知识库', '连接器'
    ])
    expect(labelsOf(el)).not.toContain('模型')
    expect(labelsOf(el)).not.toContain('审核中心')
  })

  it('当前路由项高亮（is-active）：技能', async () => {
    const el = await mount({ name: 'AdminSkillsUnified' }, ['ADMIN'])
    const active = el.querySelector('.rail-item.is-active .rail-label')
    expect(active.textContent.trim()).toBe('技能')
  })

  it('工作台沉浸页（meta.activeMenu=AdminPositions）高亮「岗位」', async () => {
    const el = await mount({ name: 'PositionWorkbench', params: { id: '1' } }, ['FDE'])
    const active = el.querySelector('.rail-item.is-active .rail-label')
    expect(active.textContent.trim()).toBe('岗位')
  })

  // 三类编辑沉浸页的 activeMenu 均已改指「技能」（三页合一）。用 SYS_CONFIG 挂载——
  // 「技能」在 03 能力段（canSysConfig），纯 roles 口径下 FDE 看不到该项（故也无从高亮）。
  it('FDE 技能编辑沉浸页 → 高亮「技能」', async () => {
    const el = await mount({ name: 'AdminSkillEdit', params: { id: '1' } }, ['SYS_CONFIG'])
    const active = el.querySelector('.rail-item.is-active .rail-label')
    expect(active.textContent.trim()).toBe('技能')
  })

  it('平台技能编辑沉浸页 → 同样高亮「技能」（不再有独立的「平台技能」项）', async () => {
    const el = await mount({ name: 'SysConfigSkillEdit', params: { id: '1' } }, ['SYS_CONFIG'])
    const active = el.querySelector('.rail-item.is-active .rail-label')
    expect(active.textContent.trim()).toBe('技能')
  })

  it('页面权限口径：授予 CAPABILITY_SKILL_CONSOLE 的 FDE 角色也能看到「技能」', async () => {
    // 三页合一的关键保证——技能页虽在 03 能力段，但页面权限优先于段级角色门，
    // 管理员把该页授予 FDE 后，FDE 必须看得到（否则删页后 FDE 完全没有技能入口）。
    const el = await mount({ name: 'AdminSkillsUnified' }, ['FDE'], [
      'POSITION_LIST',
      'CAPABILITY_SKILL_CONSOLE'
    ])
    expect(labelsOf(el)).toContain('技能')
  })

  it('驾驶舱（占位项 AdminCockpit）三后台角色均可见并可高亮', async () => {
    const el = await mount({ name: 'AdminCockpit' }, ['SYS_CONFIG'])
    expect(labelsOf(el)).toContain('驾驶舱')
    const active = el.querySelector('.rail-item.is-active .rail-label')
    expect(active.textContent.trim()).toBe('驾驶舱')
  })

  it('审核中心（UnifiedReview）仅 admin 可见：admin 见、纯 SYS_CONFIG 不见', async () => {
    const adminEl = await mount({ name: 'AdminPositions' }, ['ADMIN'])
    expect(labelsOf(adminEl)).toContain('审核中心')
    app?.unmount()
    container?.remove()
    const sysEl = await mount({ name: 'AdminConnector' }, ['SYS_CONFIG'])
    expect(labelsOf(sysEl)).not.toContain('审核中心')
  })

  it('审核中心项高亮：admin 路由 UnifiedReview → 治理段「审核中心」激活', async () => {
    const el = await mount({ name: 'UnifiedReview' }, ['ADMIN'])
    const active = el.querySelector('.rail-item.is-active .rail-label')
    expect(active.textContent.trim()).toBe('审核中心')
  })

  it('头像二级菜单：无「返回前台」，保留退出登录 + 外观切换', async () => {
    const el = await mount({ name: 'AdminPositions' }, ['ADMIN'])
    const commands = [...el.querySelectorAll('.el-dropdown-item')].map((n) =>
      n.getAttribute('data-command')
    )
    expect(commands).not.toContain('front')
    expect(commands).toContain('logout')
    expect(el.querySelector('.theme-toggle')).toBeTruthy()
  })

  // ---------------- V102 页面级权限显隐 ----------------

  /**
   * 后端下发 pages 后，菜单按「开没开这一页」逐项显示——与角色无关。
   * 这里刻意用一个非 ADMIN 角色 + 跨段页面集，证明显隐真的由 pages 驱动而非角色。
   */
  it('下发 pages 后逐页显隐：只显已授权页，跨段亦然', async () => {
    const el = await mount(
      { name: 'AdminPositions' },
      ['FDE'],
      ['POSITION_LIST', 'CAPABILITY_MODEL', 'ORGANIZATION_ROLE']
    )
    expect(labelsOf(el)).toEqual(['岗位', '模型', '角色与权限'])
    // 段随之只剩三段（空段整体隐藏，不留空壳标题）
    expect(groupNamesOf(el)).toEqual(['岗位', '能力', '组织'])
  })

  /** 空段不留空壳：某段一页都没授权时，段标题也不渲染。 */
  it('未授权的整段不渲染段标题', async () => {
    const el = await mount({ name: 'AdminPositions' }, ['FDE'], ['POSITION_LIST'])
    expect(groupNamesOf(el)).toEqual(['岗位'])
    expect(labelsOf(el)).toEqual(['岗位'])
  })

  /** ADMIN 超管短路：即便 pages 只给一页，仍全显（与后端 AdminRoleGuard 同口径）。 */
  it('ADMIN 超管短路：pages 再少也全显', async () => {
    const el = await mount({ name: 'AdminPositions' }, ['ADMIN'], ['POSITION_LIST'])
    expect(labelsOf(el)).toContain('模型')
    expect(labelsOf(el)).toContain('角色与权限')
    expect(labelsOf(el)).toContain('驾驶舱')
  })

  /**
   * 向下兼容关键分支：后端没下发 pages（旧 token / 旧响应）时退回原角色口径。
   * 断言与本文件既有「FDE 只见岗位段」用例同结果，证明老会话行为零变化。
   */
  it('无 pages 字段时退回角色判定（老会话不被锁在门外）', async () => {
    const el = await mount({ name: 'AdminPositions' }, ['FDE'])
    expect(groupNamesOf(el)).toEqual(['总览', '岗位'])
    expect(labelsOf(el)).toEqual(['驾驶舱', '岗位', '岗位分配'])
  })
})
