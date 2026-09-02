/**
 * 用户与角色管理内存 mock（demo 数据层，模式同 apiConnectorMock.js / positionMock.js；
 * 开关见 adminUser.js —— `VITE_ORG_MOCK=0` 关闭走真实接口路径）。
 *
 * 【覆盖范围（2026-09-01 PRD 对齐改造）】AdminUsers.vue（用户列表 + UserEditor + UserRoleDialog）与
 * AdminRoles.vue（角色列表 + RoleEditor）所调接口：用户 CRUD / 设置角色 / 重置密码、
 * 角色 CRUD / 页面权限、权限树（页面清单）。
 *
 * 种子数据照交互原型 v2（rawUsers L198 / roleRows L294-299 / permissionGroups L283-292）：
 * 用户 13 条（含 2 条「从未登录」、2 条停用）、角色 5 条（含 userCount）、权限树 用户端+管理端 01-06 分组。
 *
 * 【口径说明】
 * - 权限模型 2026-09-01 起对齐原型：角色直接与**页面名**绑定（如「驾驶舱」「专家」），
 *   不再用后端 Module 枚举 code——demo 纯前端，页面名即权限标识。
 * - 角色 code 在 demo 中即角色名（原「系统标识自动生成」语义由后端承担，mock 简化为同名）。
 * - 原型内部不一致（已发现，待 PRD-review 裁决）：用户页种子的角色名（平台管理员/配置管理员/审核员）
 *   与角色页 roleRows（系统管理员/系统配置员/审计观察员）对不上。mock 以 roleRows 为角色单一真相源，
 *   用户种子的角色按语义就近映射（平台管理员→系统管理员、配置管理员→系统配置员、审核员→审计观察员），
 *   保证用户页角色筛选/标签与角色页同源。roleRows 的 userCount 沿用原型种子示意值，不与用户行数强一致。
 * - 「从未登录」排序恒排最后（升/降序均如此，原型 renderUsers 比较器口径）。
 */
import { ApiError } from './request'
import { attachPersist } from './mockPersist'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const err = (message, field = null, code = 40000) => new ApiError({ code, message, field })

let userSeq = 214
let roleSeq = 306

// 北京时间「现在」→ ISO 串（mock 内时间统一带 +08:00，展示走 fmtTime 精确到分钟）
function nowIso() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}+08:00`
  )
}

/* ---------------- 权限树（照原型 permissionGroups：用户端整组 + 管理端 01-06 分组） ---------------- */
const PERMISSION_GROUPS = [
  { scope: '用户端', groups: [{ name: '工作台', pages: ['对话', '定时任务', '个人空间', '设置'] }] },
  {
    scope: '管理端',
    groups: [
      { name: '01 总览', pages: ['驾驶舱'] },
      { name: '02 岗位', pages: ['岗位', '岗位分配'] },
      { name: '03 能力', pages: ['专家', '技能', '知识库', '连接器', '模型'] },
      { name: '04 运行', pages: ['实例与会话', '运行规格', '配额与限流'] },
      { name: '05 治理', pages: ['我的申请', '审核中心', '用户技能审核', '访问审计', '用户反馈', '字段字典'] },
      { name: '06 组织', pages: ['用户', '角色与权限'] }
    ]
  }
]

const ALL_PAGES = PERMISSION_GROUPS.flatMap((s) => s.groups.flatMap((g) => g.pages))

/* ---------------- 角色种子（照原型 roleRows；modules=页面名数组） ---------------- */
function seedRoles() {
  return [
    { id: 301, code: '系统管理员', name: '系统管理员', modules: [...ALL_PAGES], userCount: 2, createdAt: '2026-06-18T09:30:00+08:00', updatedAt: '2026-08-24T15:02:00+08:00' },
    { id: 302, code: '系统配置员', name: '系统配置员', modules: ['驾驶舱', '专家', '技能', '知识库', '连接器', '用户技能审核', '字段字典'], userCount: 3, createdAt: '2026-06-18T09:32:00+08:00', updatedAt: '2026-08-23T18:20:00+08:00' },
    { id: 303, code: 'FDE 工程师', name: 'FDE 工程师', modules: ['驾驶舱', '岗位', '岗位分配', '技能'], userCount: 4, createdAt: '2026-06-18T09:34:00+08:00', updatedAt: '2026-08-22T11:06:00+08:00' },
    { id: 304, code: '普通用户', name: '普通用户', modules: ['对话', '定时任务', '个人空间', '设置'], userCount: 18, createdAt: '2026-06-18T09:35:00+08:00', updatedAt: '2026-08-21T16:40:00+08:00' },
    { id: 305, code: '审计观察员', name: '审计观察员', modules: ['驾驶舱', '审核中心', '访问审计', '用户反馈'], userCount: 0, createdAt: '2026-08-20T14:08:00+08:00', updatedAt: '2026-08-20T14:08:00+08:00' }
  ]
}

/* ---------------- 用户种子（照原型 rawUsers，角色名映射见头注释；lastLogin=null 即「从未登录」） ---------------- */
const RAW_USERS = [
  ['zhangwei', '张伟', 'zhangwei@iw.example.com', ['系统管理员'], 'active', '2026-08-24T09:32:00+08:00'],
  ['li.na', '李娜', 'lina@iw.example.com', ['系统配置员', '审计观察员'], 'active', '2026-08-24T08:51:00+08:00'],
  ['chenyu', '陈宇', 'chenyu@iw.example.com', ['普通用户'], 'active', '2026-08-23T17:46:00+08:00'],
  ['wangfang', '王芳', 'wangfang@iw.example.com', ['FDE 工程师'], 'active', '2026-08-23T16:10:00+08:00'],
  ['zhouming', '周明', '', ['普通用户'], 'disabled', '2026-08-18T10:22:00+08:00'],
  ['sun.xin', '孙欣', 'sunxin@iw.example.com', ['审计观察员'], 'active', '2026-08-22T15:20:00+08:00'],
  ['liuqiang', '刘强', 'liuqiang@iw.example.com', ['普通用户'], 'active', '2026-08-21T11:06:00+08:00'],
  ['zhaomin', '赵敏', 'zhaomin@iw.example.com', ['系统配置员'], 'active', '2026-08-20T14:55:00+08:00'],
  ['yangfan', '杨帆', '', ['普通用户'], 'active', null],
  ['hejing', '何静', 'hejing@iw.example.com', ['FDE 工程师', '普通用户'], 'active', '2026-08-19T09:18:00+08:00'],
  ['wujie', '吴杰', 'wujie@iw.example.com', ['普通用户'], 'disabled', '2026-08-08T13:26:00+08:00'],
  ['xulin', '徐琳', 'xulin@iw.example.com', ['审计观察员'], 'active', '2026-08-18T18:02:00+08:00'],
  ['ma.chao', '马超', 'machao@iw.example.com', ['普通用户'], 'active', null]
]

function seedUsers() {
  const pad = (n) => String(n).padStart(2, '0')
  return RAW_USERS.map((x, i) => ({
    id: 201 + i,
    username: x[0],
    displayName: x[1],
    email: x[2],
    roles: [...x[3]],
    status: x[4],
    lastLogin: x[5],
    createdAt: `2026-06-${pad(10 + i)}T10:20:00+08:00`,
    updatedAt: `2026-08-${pad(10 + i)}T14:08:00+08:00`
  }))
}

let roles = seedRoles()
let users = seedUsers()

// 【持久化】（2026-09-02）状态镜像到 localStorage；写点=用户/角色 CRUD、设角色、改权限与 __resetOrgMock。
// restore 做最小形状校验，快照不合法即抛错 → mockPersist 兜底回种子。
const persist = attachPersist('adminUser', {
  version: 1,
  snapshot: () => ({ userSeq, roleSeq, roles, users }),
  restore: (d) => {
    if (!d || !Number.isFinite(d.userSeq) || !Number.isFinite(d.roleSeq) || !Array.isArray(d.roles) || !Array.isArray(d.users)) {
      throw new Error('adminUser 快照形状不合法')
    }
    userSeq = d.userSeq
    roleSeq = d.roleSeq
    roles = d.roles
    users = d.users
  }
})

const findUser = (id) => users.find((u) => String(u.id) === String(id))
const findRole = (id) => roles.find((r) => String(r.id) === String(id))

const toUserRow = (u) => ({ ...u, roles: [...u.roles] })
const toRoleRow = (r) => ({ ...r, modules: [...r.modules] })

/* ============================ 用户管理 ============================ */

/**
 * 用户列表。params: { keyword, roleCode, status(active|disabled), sort(asc|desc，按 lastLogin), page, size }。
 * 「从未登录」（lastLogin=null）恒排最后（升/降序均如此，原型口径）。
 */
export async function listUsers(params = {}) {
  await delay()
  const kw = String(params.keyword || '').trim().toLowerCase()
  const roleCode = String(params.roleCode || '')
  const status = String(params.status || '')
  const sort = params.sort === 'asc' ? 'asc' : 'desc'
  let list = users.filter(
    (u) =>
      (!kw || [u.username, u.displayName, u.email].some((v) => String(v || '').toLowerCase().includes(kw))) &&
      (!roleCode || u.roles.includes(roleCode)) &&
      (!status || u.status === status)
  )
  list = [...list].sort((a, b) => {
    if (!a.lastLogin) return b.lastLogin ? 1 : 0
    if (!b.lastLogin) return -1
    return sort === 'desc' ? b.lastLogin.localeCompare(a.lastLogin) : a.lastLogin.localeCompare(b.lastLogin)
  })
  const total = list.length
  const page = Number(params.page) > 0 ? Number(params.page) : 1
  const size = Number(params.size) > 0 ? Number(params.size) : 10
  return { list: list.slice((page - 1) * size, page * size).map(toUserRow), total }
}

export async function getUser(id) {
  await delay()
  const u = findUser(id)
  if (!u) throw err('用户不存在', null, 404)
  return toUserRow(u)
}

// 新建（body: username/displayName/email/roleCodes[]）——默认密码 wemate123 + 强制首改（demo 不落密码）
export async function createUser(payload = {}) {
  await delay()
  const username = String(payload.username || '').trim()
  if (username.length < 3 || username.length > 32) throw err('用户名 3–32 位', 'username')
  if (users.some((u) => u.username === username)) throw err('用户名已存在', 'username', 1005)
  if (!String(payload.displayName || '').trim()) throw err('请输入显示名', 'displayName')
  const roleCodes = Array.isArray(payload.roleCodes) ? payload.roleCodes.filter(Boolean) : []
  if (!roleCodes.length) throw err('请至少选择一个角色', 'roleCodes')
  const now = nowIso()
  const u = {
    id: userSeq++,
    username,
    displayName: String(payload.displayName).trim(),
    email: String(payload.email || '').trim(),
    roles: roleCodes,
    status: 'active',
    lastLogin: null,
    createdAt: now,
    updatedAt: now
  }
  users.unshift(u)
  persist()
  return toUserRow(u)
}

// 编辑（displayName/email/status 启停）
export async function updateUser(id, payload = {}) {
  await delay()
  const u = findUser(id)
  if (!u) throw err('用户不存在', null, 404)
  if (payload.displayName !== undefined) {
    if (!String(payload.displayName || '').trim()) throw err('请输入显示名', 'displayName')
    u.displayName = String(payload.displayName).trim()
  }
  if (payload.email !== undefined) u.email = String(payload.email || '').trim()
  if (payload.status !== undefined) u.status = payload.status === 'disabled' ? 'disabled' : 'active'
  u.updatedAt = nowIso()
  persist()
  return toUserRow(u)
}

// 删除（护栏：不允许删掉最后一个系统管理员——demo 侧同后端语义兜一层）
export async function deleteUser(id) {
  await delay()
  const u = findUser(id)
  if (!u) throw err('用户不存在', null, 404)
  const ADMIN = '系统管理员'
  if (u.roles.includes(ADMIN) && users.filter((x) => x.roles.includes(ADMIN)).length <= 1) {
    throw err('不能删除最后一个系统管理员', null, 409)
  }
  users = users.filter((x) => x !== u)
  persist()
  return {}
}

// 多角色绑定（roleCodes[] 全量替换）
export async function setUserRoles(id, roleCodes) {
  await delay()
  const u = findUser(id)
  if (!u) throw err('用户不存在', null, 404)
  const codes = (Array.isArray(roleCodes) ? roleCodes : []).filter(Boolean)
  if (!codes.length) throw err('请至少选择一个角色', null, 40001)
  u.roles = codes
  u.updatedAt = nowIso()
  persist()
  return toUserRow(u)
}

// 重置密码为 wemate123（+强制首改）。demo 不落密码，仅走成功链路。
export async function resetUserPassword(id) {
  await delay()
  if (!findUser(id)) throw err('用户不存在', null, 404)
  return {}
}

/* ============================ 角色管理 ============================ */

// 角色列表（含页面权限 modules + userCount，按最近更新时间倒序）
export async function listRoles() {
  await delay()
  return [...roles]
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map(toRoleRow)
}

// 全部可选权限项枚举（扁平页面名列表，保留兼容）
export async function listRoleModules() {
  await delay(120)
  return [...ALL_PAGES]
}

// 页面权限树（照原型 permissionGroups 形态：[{ scope, groups:[{ name, pages[] }] }]）
export async function getPermissionTree() {
  await delay(120)
  return PERMISSION_GROUPS.map((s) => ({
    scope: s.scope,
    groups: s.groups.map((g) => ({ name: g.name, pages: [...g.pages] }))
  }))
}

// 新建角色（name/modules[]；code 由系统派生——demo 简化为同名）
export async function createRole(payload = {}) {
  await delay()
  const name = String(payload.name || '').trim()
  if (!name) throw err('请填写角色名称', 'name')
  if (roles.some((r) => r.name === name)) throw err('角色名称已存在', 'name', 1005)
  const modules = (Array.isArray(payload.modules) ? payload.modules : []).filter((p) => ALL_PAGES.includes(p))
  if (!modules.length) throw err('请至少开通 1 个页面', 'modules')
  const now = nowIso()
  const r = { id: roleSeq++, code: name, name, modules, userCount: 0, createdAt: now, updatedAt: now }
  roles.unshift(r)
  persist()
  return toRoleRow(r)
}

// 改名（name）
export async function updateRole(id, payload = {}) {
  await delay()
  const r = findRole(id)
  if (!r) throw err('角色不存在', null, 404)
  const name = String(payload.name || '').trim()
  if (!name) throw err('请填写角色名称', 'name')
  if (roles.some((x) => x !== r && x.name === name)) throw err('角色名称已存在', 'name', 1005)
  r.name = name
  r.updatedAt = nowIso()
  persist()
  return toRoleRow(r)
}

// 改页面权限（modules[] 全量替换）
export async function setRolePermissions(id, modules) {
  await delay()
  const r = findRole(id)
  if (!r) throw err('角色不存在', null, 404)
  const clean = (Array.isArray(modules) ? modules : []).filter((p) => ALL_PAGES.includes(p))
  if (!clean.length) throw err('请至少开通 1 个页面', null, 40001)
  r.modules = clean
  r.updatedAt = nowIso()
  persist()
  return toRoleRow(r)
}

// 删角色（仍有用户绑定时拒删——页面已前置分流提示窗，此处兜底同口径）
export async function deleteRole(id) {
  await delay()
  const r = findRole(id)
  if (!r) throw err('角色不存在', null, 404)
  if (r.userCount > 0) {
    throw err(`角色「${r.name}」仍绑定 ${r.userCount} 个用户。请先在用户页完成角色改绑。`, null, 409)
  }
  roles = roles.filter((x) => x !== r)
  persist()
  return {}
}

/** 测试辅助：重置种子（vitest 模块级单例，跨用例复位）。 */
export function __resetOrgMock() {
  userSeq = 214
  roleSeq = 306
  roles = seedRoles()
  users = seedUsers()
  persist()
}
