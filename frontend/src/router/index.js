import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ensureDemoIdentity } from '@/utils/demoIdentity'
import { FRONT_RUNTIME_ENABLED } from '@/utils/featureFlags'

// 员工端运行时页面封存（2026-07-17 校准处置）：执行链路不在本仓，路由 name 恒保留
// （守卫 landing/具名跳转依赖），封存期仅把组件换成占位页；开关改回 true 即恢复。
const runtimeView = (loader) =>
  FRONT_RUNTIME_ENABLED ? loader : () => import('@/views/FrontRuntimePlaceholder.vue')

// 前台布局下的页面（员工端）
const frontChildren = [
  {
    path: 'chat',
    name: 'Chat',
    component: runtimeView(() => import('@/views/Chat.vue')),
    meta: { title: '对话' }
  },
  {
    path: 'tasks',
    name: 'Tasks',
    component: runtimeView(() => import('@/views/Tasks.vue')),
    meta: { title: '定时任务' }
  },
  {
    path: 'tasks/new',
    name: 'TaskNew',
    component: runtimeView(() => import('@/views/TaskEditor.vue')),
    meta: { title: '新建任务', activeMenu: 'Tasks' }
  },
  {
    path: 'tasks/:id/edit',
    name: 'TaskEdit',
    component: runtimeView(() => import('@/views/TaskEditor.vue')),
    meta: { title: '编辑任务', activeMenu: 'Tasks' }
  },
  {
    path: 'tasks/:id',
    name: 'TaskDetail',
    component: runtimeView(() => import('@/views/TaskDetail.vue')),
    meta: { title: '任务详情', activeMenu: 'Tasks' }
  },
  {
    path: 'space',
    name: 'Space',
    component: runtimeView(() => import('@/views/Space.vue')),
    meta: { title: '个人空间' }
  },
  {
    path: 'other-experts',
    name: 'OtherPositions',
    component: () => import('@/views/OtherPositions.vue'),
    meta: { title: '搭子' }
  },
  {
    path: 'settings',
    name: 'Settings',
    component: () => import('@/views/Settings.vue'),
    meta: { title: '设置' }
  },
  {
    path: 'memory',
    name: 'MemoryManage',
    component: runtimeView(() => import('@/views/MemoryManage.vue')),
    meta: { title: '个人记忆', activeMenu: 'Settings' }
  },
  {
    path: 'my-experts/:positionId',
    name: 'Personalize',
    component: () => import('@/views/Personalize.vue'),
    meta: { title: '我的岗位' }
  }
]

// 后台布局下的页面（管理员 + FDE）。
// 连接器工具（MCP/API/业务系统）已收口为 AdminConnector 内的页内 Tab；
// 不再有独立子路由，旧路径以 redirect 兜底（见下方 adminLegacyRedirects）。
// 数据表已从连接器迁出，改在岗位白板内「数据底座」区块管理，无独立可直达 URL。
// meta.roles 按双模块细分（设计 §4.3）：FDE 工作台→['FDE','ADMIN']，系统配置→['SYS_CONFIG','ADMIN']。
// meta.module 标注所属模块（'FDE' | 'SYSCONFIG'），供导航/分流参考。
const adminChildren = [
  {
    path: 'positions',
    name: 'AdminPositions',
    component: () => import('@/views/admin/AdminPositions.vue'),
    meta: { title: '岗位管理', roles: ['FDE', 'ADMIN'], module: 'FDE' }
  },
  {
    // 岗位分配（提案 20260721-2）：以用户为核心管理「用户 ↔ 绑定岗位」，FDE 工作台。
    path: 'position-assignments',
    name: 'AdminPositionAssignments',
    component: () => import('@/views/admin/AdminPositionAssignments.vue'),
    meta: { title: '岗位分配', roles: ['FDE', 'ADMIN'], module: 'FDE' }
  },
  {
    path: 'connector',
    name: 'AdminConnector',
    component: () => import('@/views/admin/AdminConnector.vue'),
    meta: { title: '连接器', roles: ['SYS_CONFIG', 'ADMIN'], module: 'SYSCONFIG' }
  },
  {
    // 我的申请（2026-09-01 PRD 对齐新增，治理组）：查看和跟踪自己从各业务模块提交的审核申请。
    path: 'my-applications',
    name: 'AdminMyApplications',
    component: () => import('@/views/admin/MyApplications.vue'),
    meta: { title: '我的申请', roles: ['ADMIN'], module: 'SYSCONFIG' }
  },
  {
    // 统一发布审核台（V39 S4，仅 ADMIN）：合并旧工具审核 + 技能审核为单页单列表；
    // 发布能力已下沉连接器/技能页。meta.roles=['ADMIN']（菜单 visible + 路由门 + 后端方法级三层叠加）。
    path: 'review',
    name: 'UnifiedReview',
    component: () => import('@/views/admin/UnifiedReview.vue'),
    meta: { title: '审核中心', roles: ['ADMIN'], module: 'SYSCONFIG' }
  },
  {
    // 旧「发布审核」AdminMarket（/admin/market）重定向（V39 旧入口处置，设计 §4.3）：
    // 旧发布 tab（?tab=publish）→ 连接器（发布已下沉）；旧审核 tab（?tab=review）→ 统一审核台。
    path: 'market',
    redirect: (to) =>
      to.query?.tab === 'review' ? { name: 'UnifiedReview' } : { name: 'AdminConnector' }
  },
  {
    // 技能三页合一（2026-08-23）：岗位技能页已下线，重定向到「技能」页。
    // 保留 redirect 而非直删——外部书签、历史链接、以及 ?referenced=no 深链（合并页已支持）仍可用。
    path: 'skills',
    redirect: (to) => ({ name: 'AdminSkillsUnified', query: to.query })
  },
  {
    // 「技能」页（三页合一，2026-08-23）：岗位私有 / 平台共享 / 系统内置 三类混排 + 类型筛选，
    // 取代原「岗位技能 / 平台技能 / 系统内置技能」三个入口（那三条 path 已改 redirect 到此）。
    // 读走聚合端点 /api/fde/admin-skills；写按 row.type 分流回原三套端点（api/unifiedSkill.js 的 apiFor）——
    // 后端 origin 白名单与跨通道守卫零改动、原样生效；四个技能前缀的权限项已统一为 CAPABILITY_SKILL_CONSOLE（V107）。
    path: 'skills-all',
    name: 'AdminSkillsUnified',
    component: () => import('@/views/admin/AdminSkillsUnified.vue'),
    // roles 放开到三类后台角色：可见性由页面权限 CAPABILITY_SKILL_CONSOLE 治理（管理员在角色页授予），
    // 路由门只挡「非后台角色」。三页下线后若仍钉 ADMIN，非 ADMIN 角色将完全没有技能入口。
    meta: { title: '技能', roles: ['FDE', 'SYS_CONFIG', 'ADMIN'], module: 'SYSCONFIG' }
  },
  {
    // 技能三页合一（2026-08-23）：平台技能页已下线，重定向到「技能」页（带类型预筛）。
    path: 'platform-skills',
    redirect: () => ({ name: 'AdminSkillsUnified', query: { type: 'PLATFORM' } })
  },
  {
    // 用户技能审核（V94，原「用户上传待确认」升级）：客户端用户经 POST /api/market/skill-reviews 提交审核
    // （自用/平台共享），admin 在本页审核（通过/不通过 + 意见）。平台共享通过后进平台技能列表走既有发布流程。
    path: 'user-skill-reviews',
    name: 'SysConfigUserSkillReviews',
    component: () => import('@/views/admin/UserSkillReviews.vue'),
    meta: { title: '用户技能审核', roles: ['SYS_CONFIG', 'ADMIN'], module: 'SYSCONFIG' }
  },
  {
    // 字段管理（V94）：审核用字典维护（问题类型 / 风险等级）。同构 CRUD，Tab 切换。
    path: 'field-management',
    name: 'SysConfigFieldManagement',
    component: () => import('@/views/admin/FieldManagement.vue'),
    meta: { title: '字段字典', roles: ['SYS_CONFIG', 'ADMIN'], module: 'SYSCONFIG' }
  },
  {
    // 技能三页合一（2026-08-23）：系统内置技能页已下线，重定向到「技能」页（带类型预筛）。
    path: 'system-skills',
    redirect: () => ({ name: 'AdminSkillsUnified', query: { type: 'SYSTEM_DEFAULT' } })
  },
  {
    // 「专家」模块（V81）：把多个平台技能归类整合成可交付单元。只引用平台技能，与 FDE 技能隔离。
    // 与「岗位」（AdminPositions，FDE 模块）无关——两者仅物理表名同源于历史承接，业务与权限完全独立。
    path: 'experts',
    name: 'AdminExperts',
    component: () => import('@/views/admin/AdminExperts.vue'),
    meta: { title: '专家', roles: ['SYS_CONFIG', 'ADMIN'], module: 'SYSCONFIG' }
  },
  {
    // 旧技能审核台（/admin/skill-reviews）→ 重定向到统一审核台（V39 已并入 UnifiedReview，设计 §4.3）。
    path: 'skill-reviews',
    redirect: { name: 'UnifiedReview' }
  },
  // —— P2 双模块报表（真实数据 + ECharts），各落所属模块角色门（设计 §4.3/§6）——
  {
    path: 'reports/fde',
    name: 'FdeReports',
    component: () => import('@/views/admin/FdeReports.vue'),
    meta: { title: '工作台报表', roles: ['FDE', 'ADMIN'], module: 'FDE' }
  },
  {
    path: 'reports/sysconfig',
    name: 'SysConfigReports',
    component: () => import('@/views/admin/SysConfigReports.vue'),
    meta: { title: '配置报表', roles: ['SYS_CONFIG', 'ADMIN'], module: 'SYSCONFIG' }
  },
  {
    // 旧 reports 路由：重定向到 FDE 工作台报表（兼容书签，设计 §4.3/§6.2）。
    // 仅 path（无 name），避免与下方 name:'reports' 兜底重复；name 保留在 redirect 节点。
    path: 'reports',
    name: 'reports',
    redirect: { name: 'FdeReports' }
  },
  // —— P5 用户与权限（仅 ADMIN）：菜单 visible + 路由门 + 后端方法级三层叠加 ——
  {
    path: 'users',
    name: 'AdminUsers',
    component: () => import('@/views/admin/AdminUsers.vue'),
    meta: { title: '用户管理', roles: ['ADMIN'], module: 'SYSCONFIG' }
  },
  {
    path: 'roles',
    name: 'AdminRoles',
    component: () => import('@/views/admin/AdminRoles.vue'),
    meta: { title: '角色管理', roles: ['ADMIN'], module: 'SYSCONFIG' }
  },
  {
    // S4 用户登录明细（仅 ADMIN，客户端会谈 R2）：登录/登出记录只读分页表。
    path: 'login-logs',
    name: 'AdminLoginLogs',
    component: () => import('@/views/admin/AdminLoginLogs.vue'),
    meta: { title: '访问审计', roles: ['ADMIN'], module: 'SYSCONFIG' }
  },
  {
    // V76 模型配置（仅 ADMIN）：OpenAI 协议第三方模型接入/连通性验证/发布审核。
    path: 'models',
    name: 'AdminModels',
    component: () => import('@/views/admin/AdminModels.vue'),
    meta: { title: '模型配置', roles: ['ADMIN'], module: 'SYSCONFIG' }
  },
  {
    // V80 用户反馈（仅 ADMIN）：客户端用户意见反馈只读列表（文字 + 截图附件）。
    path: 'feedbacks',
    name: 'AdminFeedback',
    component: () => import('@/views/admin/AdminFeedback.vue'),
    meta: { title: '用户反馈', roles: ['ADMIN'], module: 'SYSCONFIG' }
  },
  // —— 导航改版（2026-08-21）新增规划中入口：统一挂「功能开发中」占位页 ——
  // 真实页面尚未建设，先给真实路由 + 导航项 + 高亮（点击可跳转、路径可直达/收藏）。
  // 就绪后把 component 换成真实页面即可，name/path 保留不动。
  {
    // 01 总览 → 驾驶舱：全局概览驾驶舱（规划中）。三后台角色均可见（与总览段定位一致）。
    path: 'cockpit',
    name: 'AdminCockpit',
    component: () => import('@/views/admin/AdminComingSoonPlaceholder.vue'),
    meta: { title: '驾驶舱', roles: ['ADMIN', 'FDE', 'SYS_CONFIG'], module: 'SYSCONFIG' }
  },
  {
    // 03 能力 → 知识库：与平台配置段同门槛（SYS_CONFIG/ADMIN）。
    path: 'knowledge-base',
    name: 'AdminKnowledgeBase',
    component: () => import('@/views/admin/AdminKnowledgeBase.vue'),
    meta: { title: '知识库', roles: ['SYS_CONFIG', 'ADMIN'], module: 'SYSCONFIG' }
  },
  {
    // 04 运行 → 实例与会话（规划中）：运行治理段，仅 ADMIN（与治理/组织门槛一致）。
    path: 'instances',
    name: 'AdminInstances',
    component: () => import('@/views/admin/AdminComingSoonPlaceholder.vue'),
    meta: { title: '实例与会话', roles: ['ADMIN'], module: 'SYSCONFIG' }
  },
  {
    // 04 运行 → 运行规格（2026-09-02 落地：k8s Pod 资源模板管理，列表 + 抽屉）。
    path: 'runtime-specs',
    name: 'AdminRuntimeSpecs',
    component: () => import('@/views/admin/AdminRuntimeSpecs.vue'),
    meta: { title: '运行规格', roles: ['ADMIN'], module: 'SYSCONFIG' }
  },
  {
    // 04 运行 → 配额与限流（规划中）。
    path: 'quota-throttle',
    name: 'AdminQuotaThrottle',
    component: () => import('@/views/admin/AdminComingSoonPlaceholder.vue'),
    meta: { title: '配额与限流', roles: ['ADMIN'], module: 'SYSCONFIG' }
  }
]

// 旧连接器子路由 → 重定向到连接器容器对应 Tab（防旧链接 / 收藏失效）。
const adminLegacyRedirects = [
  { path: 'mcp', tab: 'mcp' },
  { path: 'apis', tab: 'api' },
  { path: 'biz-systems', tab: 'bizsystem' }
].map(({ path, tab }) => ({
  path,
  redirect: { name: 'AdminConnector', query: { tab } }
}))

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { public: true, title: '登录' }
  },
  {
    path: '/onboarding',
    name: 'Onboarding',
    component: () => import('@/views/Onboarding.vue'),
    // 需登录、无 admin 角色限制；首登未绑定的非管理员由 guard 引导至此。
    meta: { requiresAuth: true, title: '欢迎使用' }
  },
  {
    path: '/bind-expert',
    name: 'BindPosition',
    component: () => import('@/views/BindPosition.vue'),
    // 保留：供已绑定用户重新绑定 / 更换岗位
    meta: { requiresAuth: true, title: '选择岗位' }
  },
  {
    // 强制首改密码页（P5）：需登录、无角色限制、无绑定要求（守卫据 mustChangePassword 强跳至此，
    // 优先级高于绑定/落地分流）。改密成功后由页面放行跳回目标/首页。
    path: '/change-password',
    name: 'ChangePassword',
    component: () => import('@/views/ChangePassword.vue'),
    meta: { requiresAuth: true, title: '修改密码' }
  },
  {
    path: '/',
    component: () => import('@/layouts/FrontLayout.vue'),
    meta: { requiresAuth: true },
    // demo：根路径直接落管理后台（员工端页面仍可经具名路由/URL 直达）
    redirect: { name: 'AdminPositions' },
    children: frontChildren
  },
  {
    path: '/admin',
    component: () => import('@/layouts/AdminLayout.vue'),
    // 父路由放宽为三后台角色（进后台壳即可），细分由子路由 meta.roles + 后端门把关（设计 §4.3）
    meta: { requiresAuth: true, roles: ['ADMIN', 'FDE', 'SYS_CONFIG'] },
    redirect: { name: 'AdminPositions' },
    children: [...adminChildren, ...adminLegacyRedirects]
  },
  {
    // 岗位配置台：沉浸式整屏页（自带细栏），不挂 AdminLayout。
    // 2026-08-22：由白板范式改为 9-Tab 范式（PositionDetailTabs）；原 PositionWorkbench.vue 保留备查，路由不再指向。
    path: '/admin/positions/:id/workbench',
    name: 'PositionWorkbench',
    component: () => import('@/views/admin/PositionDetailTabs.vue'),
    // activeMenu: 工作台虽自挂窄轨（不走 AdminLayout），但归属「岗位」，让共享窄轨高亮岗位项
    meta: { requiresAuth: true, roles: ['FDE', 'ADMIN'], module: 'FDE', title: '岗位配置', activeMenu: 'AdminPositions' }
  },
  {
    // 技能整页编辑器：沉浸式整屏页（复用岗位 SkillFocusEditor），不挂 AdminLayout；归属「技能」菜单。
    path: '/admin/skills/:id/edit',
    name: 'AdminSkillEdit',
    component: () => import('@/views/admin/AdminSkillEditPage.vue'),
    // roles 随三页合一放宽到三类后台角色（2026-08-23）：列表页（AdminSkillsUnified）已是
    // ['FDE','SYS_CONFIG','ADMIN']，编辑器若仍守旧的三页角色划分，就会出现「列表里看得见该行、
    // 点编辑被前端守卫弹回」——这正是权限合并要消灭的「读得到、改不动」，只是从后端 403 变成前端拦截。
    // 真正的门是页面权限 CAPABILITY_SKILL_CONSOLE（后端 AdminRoleGuard）+ 编辑器自身的 origin/通道守卫。
    meta: { requiresAuth: true, roles: ['FDE', 'SYS_CONFIG', 'ADMIN'], module: 'FDE', title: '编辑技能', activeMenu: 'AdminSkillsUnified' }
  },
  {
    // 平台技能整页编辑器（系统配置模块）：复用 AdminSkillEditPage，meta.skillSource='platform' 切数据源；
    // activeMenu 归并到系统配置「技能」一级项 SysConfigSkills（窄轨高亮一致）。
    path: '/admin/platform-skills/:id/edit',
    name: 'SysConfigSkillEdit',
    component: () => import('@/views/admin/AdminSkillEditPage.vue'),
    // roles 同 AdminSkillEdit：三页合一后编辑器不再按原三页角色划分设门（详见 AdminSkillEdit 处注释）。
    meta: { requiresAuth: true, roles: ['FDE', 'SYS_CONFIG', 'ADMIN'], module: 'SYSCONFIG', title: '编辑平台技能', activeMenu: 'AdminSkillsUnified', skillSource: 'platform' }
  },
  {
    // 平台技能只读查看（V92）：复用 AdminSkillEditPage + platform 数据源，meta.readonly=true 整页降级只读。
    // 用于「用户上传待确认」页 admin 确认前预览技能内容；与编辑路由同组件、同端点，仅只读。
    path: '/admin/platform-skills/:id/view',
    name: 'SysConfigSkillView',
    component: () => import('@/views/admin/AdminSkillEditPage.vue'),
    meta: { requiresAuth: true, roles: ['SYS_CONFIG', 'ADMIN'], module: 'SYSCONFIG', title: '查看平台技能', activeMenu: 'AdminSkillsUnified', skillSource: 'platform', readonly: true }
  },
  {
    // 用户技能审核 · 技能详情页（V94，只读预览 + 审核）：独立数据源（审核申请，非 skill 行），
    // 复用 SkillFocusEditor（readonly + reviewMode：右栏安全检测结果手风琴 + 顶栏「审核」）。新标签打开。
    path: '/admin/user-skill-reviews/:id/view',
    name: 'SysConfigReviewSkillView',
    component: () => import('@/views/admin/ReviewSkillDetailPage.vue'),
    meta: { requiresAuth: true, roles: ['SYS_CONFIG', 'ADMIN'], module: 'SYSCONFIG', title: '技能审核详情', activeMenu: 'SysConfigUserSkillReviews' }
  },
  {
    // 系统默认技能整页编辑器（V89）：复用 AdminSkillEditPage + platform 数据源（同端点，通道建时已落定）；
    // meta.skillChannel='system' 隐藏市场用户面字段（默认安装/技能分类），返回路由指回系统默认技能列表。
    path: '/admin/system-skills/:id/edit',
    name: 'SysConfigSystemSkillEdit',
    component: () => import('@/views/admin/AdminSkillEditPage.vue'),
    // roles 同 AdminSkillEdit：三页合一后编辑器不再按原三页角色划分设门（详见 AdminSkillEdit 处注释）。
    meta: { requiresAuth: true, roles: ['FDE', 'SYS_CONFIG', 'ADMIN'], module: 'SYSCONFIG', title: '编辑系统内置技能', activeMenu: 'AdminSkillsUnified', skillSource: 'platform', skillChannel: 'system' }
  },
  {
    // N8：业务系统专属技能整页编辑器（系统配置模块）。复用 AdminSkillEditPage，
    // meta.skillSource='bizSystem' 切数据源到 /fde/connectors/biz-systems/{bizId}/skills；
    // bizId 由 query 携带（编辑器需它拼端点 + 返回业务系统配置）。归属「业务系统」入口，无独立列表页。
    path: '/admin/biz-systems/:bizId/skills/:id/edit',
    name: 'BizSystemSkillEdit',
    component: () => import('@/views/admin/AdminSkillEditPage.vue'),
    meta: { requiresAuth: true, roles: ['SYS_CONFIG', 'ADMIN'], module: 'SYSCONFIG', title: '编辑业务系统技能', activeMenu: 'AdminConnector', skillSource: 'bizSystem' }
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: { name: 'Chat' }
  }
]

// 【DEV ONLY】组件隔离验证路由（Playwright e2e 用），生产构建不注册；插在 catch-all 之前。
if (import.meta.env.DEV) {
  routes.splice(routes.length - 1, 0, {
    path: '/dev/skill-editor',
    name: 'DevSkillEditor',
    component: () => import('@/views/dev/DevSkillEditor.vue'),
    meta: { public: true }
  })
  routes.splice(routes.length - 1, 0, {
    path: '/dev/react-sim',
    name: 'DevReActSimulated',
    component: () => import('@/views/dev/DevReActSimulated.vue'),
    meta: { public: true }
  })
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

// 主题（浅/暗）由 useThemeStore 在 main.js 初始化并应用到 <html>，全站统一，
// 不再按路由前缀切主题（员工端/管理端共用同一 data-theme）。

// 全局守卫（demo 口径，2026-09-01 取消登录与权限控制）：
// 每次导航前兜底注入内置演示管理员身份（logout 等路径清了也立即补回），全路由放行；
// 登录页不再可达，重定向进管理后台首页。原 resolveGuard 决策函数已随登录功能退役
//（存于 docs/历史文档归档-20260901.zip 之 退役归档-20260901/frontend-dead-code/）。
router.beforeEach((to) => {
  ensureDemoIdentity(useUserStore())
  if (to.name === 'Login') {
    return { name: 'AdminPositions' }
  }
  return true
})

export default router
