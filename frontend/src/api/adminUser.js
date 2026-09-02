import request from './request'
import * as mock from './adminUserMock'

/**
 * 用户与角色管理 API 层（ADMIN 专属，前缀 /fde/**，P5）。
 *
 * 【demo mock（2026-09-01 PRD 对齐改造）】项目已降级为纯前端 demo，本模块数据默认走内存 mock
 * （adminUserMock.js；`VITE_ORG_MOCK=0` 可关闭走真实接口路径，模式同 apiConnector.js / position.js）。
 * 覆盖用户 CRUD / 设置角色 / 重置密码、角色 CRUD / 页面权限、权限树。
 * 权限树 2026-09-01 起对齐原型 permissionGroups 形态（[{ scope, groups:[{ name, pages[] }] }]，
 * 权限项=页面名），消费方为 AdminRoles / RoleEditor。
 *
 * 错误处理约定（同 admin.js §0.3.1）：
 * - 读接口（列表/详情/枚举）走全局拦截器，失败弹 toast。
 * - 写接口加 skipGlobalError（W）——绕过全局 toast，失败抛 ApiError（带 code/message/field），
 *   由编辑器/弹窗自处理：护栏错误（如删最后一个管理员、用户名重复）按 message 就地提示，有 field 则红框定位。
 * - 列表过滤一律走 query 参数（keyword/roleCode/status/sort/page/size），前端不本地二次过滤
 *   （角色页不分页、量级恒小，属例外：搜索在页面本地过滤）。
 */

// 写接口统一配置：绕过全局错误提示，交调用方自处理
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_ORG_MOCK !== '0'
const W = { skipGlobalError: true }

/* ============================ 用户管理（ADMIN） ============================ */

// 用户列表（keyword/roleCode/status/sort/page/size 走后端过滤分页；sort 按最近登录时间，从未登录恒排最后）
export function listUsers(params = {}) {
  if (USE_MOCK) return mock.listUsers(params)
  return request.get('/fde/users', { params })
}
// 用户详情
export function getUser(id) {
  if (USE_MOCK) return mock.getUser(id)
  return request.get(`/fde/users/${id}`)
}
// 新建用户（body: username/displayName/email/roleCodes[]）——后端自动设默认密码 wemate123 + 强制首改
export function createUser(payload) {
  if (USE_MOCK) return mock.createUser(payload)
  return request.post('/fde/users', payload, W)
}
// 编辑用户（displayName/email/status 启停）
export function updateUser(id, payload) {
  if (USE_MOCK) return mock.updateUser(id, payload)
  return request.put(`/fde/users/${id}`, payload, W)
}
// 软删用户
export function deleteUser(id) {
  if (USE_MOCK) return mock.deleteUser(id)
  return request.delete(`/fde/users/${id}`, W)
}
// 多角色绑定（roleCodes[] 全量替换）
export function setUserRoles(id, roleCodes) {
  if (USE_MOCK) return mock.setUserRoles(id, roleCodes)
  return request.put(`/fde/users/${id}/roles`, { roleCodes }, W)
}
// 重置密码为 wemate123（+强制首改）
export function resetUserPassword(id) {
  if (USE_MOCK) return mock.resetUserPassword(id)
  return request.post(`/fde/users/${id}/reset-password`, {}, W)
}

/* ============================ 角色管理（ADMIN） ============================ */

// 角色列表（含已配页面权限 modules + userCount，按最近更新时间倒序）
export function listRoles() {
  if (USE_MOCK) return mock.listRoles()
  return request.get('/fde/roles')
}
// 全部可选权限项枚举（扁平列表，保留兼容）
export function listRoleModules() {
  if (USE_MOCK) return mock.listRoleModules()
  return request.get('/fde/roles/modules')
}
// 页面权限树（用户端整组 / 管理端·01–06 分组 / 页面叶子）——角色编辑勾选与列表权限列共用同一真相源
export function getPermissionTree() {
  if (USE_MOCK) return mock.getPermissionTree()
  return request.get('/fde/roles/permission-tree')
}
// 新建角色（name/modules[]；code 由系统派生，前端不填）
export function createRole(payload) {
  if (USE_MOCK) return mock.createRole(payload)
  return request.post('/fde/roles', payload, W)
}
// 改名（name）
export function updateRole(id, payload) {
  if (USE_MOCK) return mock.updateRole(id, payload)
  return request.put(`/fde/roles/${id}`, payload, W)
}
// 改页面权限（modules[] 全量替换）
export function setRolePermissions(id, modules) {
  if (USE_MOCK) return mock.setRolePermissions(id, modules)
  return request.put(`/fde/roles/${id}/permissions`, { modules }, W)
}
// 删角色（仍有用户绑定时拒删）
export function deleteRole(id) {
  if (USE_MOCK) return mock.deleteRole(id)
  return request.delete(`/fde/roles/${id}`, W)
}
