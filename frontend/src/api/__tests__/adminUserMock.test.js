// @vitest-environment jsdom
// （adminUserMock → request.js → router 链路触达 window，故用 jsdom；同 positionMock.test）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  setUserRoles,
  resetUserPassword,
  listRoles,
  getPermissionTree,
  createRole,
  updateRole,
  setRolePermissions,
  deleteRole,
  __resetOrgMock
} from '../adminUserMock'

beforeEach(() => __resetOrgMock())

describe('adminUserMock —— 用户/角色 mock（2026-09-01 PRD 对齐轮）', () => {
  it('用户列表：13 条种子，默认每页 10、按最近登录时间倒序，「从未登录」恒排最后', async () => {
    const p1 = await listUsers()
    expect(p1.total).toBe(13)
    expect(p1.list).toHaveLength(10)
    expect(p1.list[0].username).toBe('zhangwei') // 2026-08-24 09:32 最新
    const p2 = await listUsers({ page: 2 })
    // 尾页末两条 = 两个从未登录（lastLogin=null）
    const tail = p2.list.slice(-2)
    expect(tail.every((u) => u.lastLogin === null)).toBe(true)
    // 升序时「从未登录」同样排最后（原型比较器口径）
    const asc = await listUsers({ sort: 'asc', page: 2 })
    expect(asc.list.slice(-2).every((u) => u.lastLogin === null)).toBe(true)
    expect(asc.list[0].lastLogin).not.toBeNull()
  })

  it('用户筛选：keyword 覆盖用户名/显示名/邮箱；roleCode / status 精确', async () => {
    expect((await listUsers({ keyword: '李娜' })).list.map((u) => u.username)).toEqual(['li.na'])
    expect((await listUsers({ roleCode: 'FDE 工程师' })).total).toBe(2)
    expect((await listUsers({ status: 'disabled' })).total).toBe(2)
  })

  it('新建用户：初始 active + 从未登录；用户名过短 →「请输入 3–32 个字符」（md §三.3 L157，K15）/ 重名 →「用户名已存在」，均按 field 报错', async () => {
    const u = await createUser({ username: 'newuser', displayName: '新人', roleCodes: ['普通用户'] })
    expect(u).toMatchObject({ status: 'active', lastLogin: null })
    await expect(createUser({ username: 'ab', displayName: 'x', roleCodes: ['普通用户'] }))
      .rejects.toMatchObject({ field: 'username', message: '请输入 3–32 个字符' })
    await expect(createUser({ username: 'a'.repeat(33), displayName: 'x', roleCodes: ['普通用户'] }))
      .rejects.toMatchObject({ field: 'username', message: '请输入 3–32 个字符' })
    await expect(createUser({ username: 'zhangwei', displayName: 'x', roleCodes: ['普通用户'] }))
      .rejects.toMatchObject({ field: 'username', message: '用户名已存在' })
  })

  it('编辑/设置角色/重置密码：状态启停、roleCodes 全量替换、重置走成功链路', async () => {
    const u = await updateUser(203, { displayName: '陈宇宇', status: 'disabled' })
    expect(u).toMatchObject({ displayName: '陈宇宇', status: 'disabled' })
    const r = await setUserRoles(203, ['审计观察员'])
    expect(r.roles).toEqual(['审计观察员'])
    await expect(setUserRoles(203, [])).rejects.toMatchObject({ message: '请至少选择一个角色' })
    await expect(resetUserPassword(203)).resolves.toEqual({})
  })

  it('删除用户：可删普通账号；最后一个系统管理员拒删（护栏）', async () => {
    await deleteUser(203)
    expect((await listUsers()).total).toBe(12)
    // 张伟是唯一「系统管理员」
    await expect(deleteUser(201)).rejects.toMatchObject({ message: '不能删除最后一个系统管理员' })
  })

  it('角色列表：5 条种子含 userCount，按最近更新时间倒序；权限=页面名数组', async () => {
    const roles = await listRoles()
    expect(roles.map((r) => r.name)).toEqual(['系统管理员', '系统配置员', 'FDE 工程师', '普通用户', '审计观察员'])
    expect(roles[0].userCount).toBe(2)
    expect(roles.find((r) => r.name === '普通用户').modules).toEqual(['对话', '定时任务', '个人空间', '设置'])
  })

  it('权限树：原型 permissionGroups 形态（用户端 1 组 4 页 + 管理端 01-06 六组 19 页，共 23 页）', async () => {
    const tree = await getPermissionTree()
    expect(tree.map((s) => s.scope)).toEqual(['用户端', '管理端'])
    expect(tree[1].groups.map((g) => g.name)).toEqual(['01 总览', '02 岗位', '03 能力', '04 运行', '05 治理', '06 组织'])
    const pages = tree.flatMap((s) => s.groups.flatMap((g) => g.pages))
    expect(pages).toHaveLength(23)
    expect(pages).toContain('专家')
    expect(pages).toContain('实例管理')
    expect(pages).not.toContain('实例与会话')
    expect(pages).toContain('角色与权限')
  })

  it('角色 CRUD：新建校验名称/权限必填；改名与改权限分别落库并刷新更新时间', async () => {
    await expect(createRole({ name: '', modules: ['驾驶舱'] })).rejects.toMatchObject({ field: 'name' })
    await expect(createRole({ name: '内容运营', modules: [] })).rejects.toMatchObject({ field: 'modules' })
    const r = await createRole({ name: '内容运营', modules: ['驾驶舱', '专家'] })
    expect(r).toMatchObject({ userCount: 0 })
    const renamed = await updateRole(r.id, { name: '内容运营组' })
    expect(renamed.name).toBe('内容运营组')
    const reperm = await setRolePermissions(r.id, ['驾驶舱'])
    expect(reperm.modules).toEqual(['驾驶舱'])
    await expect(setRolePermissions(r.id, [])).rejects.toMatchObject({ message: '请至少开通 1 个页面' })
  })

  it('删角色分流：绑定用户 >0 拒删（带改绑指引）；userCount=0 可删', async () => {
    const roles = await listRoles()
    const bound = roles.find((r) => r.name === '普通用户')
    await expect(deleteRole(bound.id)).rejects.toMatchObject({
      message: expect.stringContaining('请先在用户页完成角色改绑')
    })
    const free = roles.find((r) => r.name === '审计观察员')
    await expect(deleteRole(free.id)).resolves.toEqual({})
    expect((await listRoles()).some((r) => r.name === '审计观察员')).toBe(false)
  })
})

/**
 * 2026-09-12 测试审计补缺口（T52 · F2）：adminUserMock 持久化零用例（当前mockPersist v3，写点：用户 CRUD / 设角色 /
 * 角色 CRUD / 改权限 / __resetOrgMock）。与 dataTableMock.test 同款：注入内存版存储 + vi.resetModules 动态 import，
 * 模拟「写入 → 刷新 → 重载」；坏形状 / 旧版本快照须回种子（13 用户 / 5 角色）不白屏。
 * K15（createUser 文案「用户名 3–32 位」≠ md「请输入 3–32 个字符」）为代码缺陷，不写对应用例。
 */
describe('adminUserMock · 持久化（mockPersist v3，key iworker-demo-mock:adminUser）', () => {
  const KEY = 'iworker-demo-mock:adminUser'
  const makeStorage = () => {
    const map = new Map()
    return {
      get length() { return map.size },
      key: (i) => [...map.keys()][i] ?? null,
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: vi.fn((k, v) => map.set(k, String(v))),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear()
    }
  }
  const snap = () => JSON.parse(globalThis.localStorage.getItem(KEY))
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), writable: true, configurable: true })
    vi.resetModules()
  })
  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true, configurable: true })
    vi.resetModules()
  })

  it('写点各落盘一次（createUser / updateUser / setUserRoles / deleteUser / createRole / updateRole / setRolePermissions / deleteRole），只读接口不落盘', async () => {
    const m = await import('../adminUserMock')
    const writes = () => globalThis.localStorage.setItem.mock.calls.filter(([k]) => k === KEY).length
    const base = writes()
    await m.listUsers()
    await m.getUser(201)
    await m.listRoles()
    await m.getPermissionTree()
    await m.resetUserPassword(201)
    expect(writes()).toBe(base)
    const u = await m.createUser({ username: 'newuser', displayName: '新人', roleCodes: ['普通用户'] })
    expect(writes()).toBe(base + 1)
    await m.updateUser(u.id, { displayName: '新人二' })
    expect(writes()).toBe(base + 2)
    await m.setUserRoles(u.id, ['审计观察员'])
    expect(writes()).toBe(base + 3)
    await m.deleteUser(u.id)
    expect(writes()).toBe(base + 4)
    const r = await m.createRole({ name: '内容运营', modules: ['驾驶舱'] })
    expect(writes()).toBe(base + 5)
    await m.updateRole(r.id, { name: '内容运营组' })
    expect(writes()).toBe(base + 6)
    await m.setRolePermissions(r.id, ['驾驶舱', '专家'])
    expect(writes()).toBe(base + 7)
    await m.deleteRole(r.id)
    expect(writes()).toBe(base + 8)
    m.__resetOrgMock()
    expect(writes()).toBe(base + 9)
  })

  it('createUser 后快照 v=3、形状 { userSeq, roleSeq, roles, users }，新用户在首位且 userSeq 递增', async () => {
    const m = await import('../adminUserMock')
    await m.createUser({ username: 'newuser', displayName: '新人', roleCodes: ['普通用户'] })
    const s = snap()
    expect(s.v).toBe(3)
    expect(Object.keys(s.data).sort()).toEqual(['roleSeq', 'roles', 'userSeq', 'users'])
    expect(s.data.users).toHaveLength(14)
    expect(s.data.users[0]).toMatchObject({ id: 214, username: 'newuser', status: 'active', lastLogin: null })
    expect(s.data.userSeq).toBe(215)
  })

  it('createUser + deleteRole 落盘 → 重新 import（模拟刷新）→ 新用户仍在、被删角色不在、新建不撞号', async () => {
    const first = await import('../adminUserMock')
    const u = await first.createUser({ username: 'newuser', displayName: '新人', roleCodes: ['普通用户'] })
    const free = (await first.listRoles()).find((r) => r.name === '审计观察员')
    await first.deleteRole(free.id)
    vi.resetModules()
    const fresh = await import('../adminUserMock')
    const users = await fresh.listUsers({ keyword: 'newuser' })
    expect(users.total).toBe(1)
    expect(users.list[0]).toMatchObject({ id: u.id, username: 'newuser' })
    expect((await fresh.listUsers()).total).toBe(14)
    const roles = await fresh.listRoles()
    expect(roles).toHaveLength(4)
    expect(roles.some((r) => r.name === '审计观察员')).toBe(false)
    const again = await fresh.createUser({ username: 'another', displayName: '又一位', roleCodes: ['普通用户'] })
    expect(again.id).toBe(u.id + 1)
  })

  it('存量快照形状不合法（users 不是数组）→ restore 抛错被兜底：清 key、回种子 13 用户 / 5 角色，不白屏', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    globalThis.localStorage.setItem(KEY, JSON.stringify({ v: 3, data: { userSeq: 214, roleSeq: 306, roles: [], users: 'oops' } }))
    const m = await import('../adminUserMock')
    expect((await m.listUsers()).total).toBe(13)
    expect(await m.listRoles()).toHaveLength(5)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('存量快照版本不符（v=1 旧种子）→ 丢弃并回种子：不会读到旧快照里的用户', async () => {
    globalThis.localStorage.setItem(
      KEY,
      JSON.stringify({ v: 1, data: { userSeq: 300, roleSeq: 400, roles: [], users: [{ id: 1, username: 'ghost', displayName: '旧', roles: [], status: 'active', lastLogin: null }] } })
    )
    const m = await import('../adminUserMock')
    expect((await m.listUsers({ keyword: 'ghost' })).total).toBe(0)
    expect((await m.listUsers()).total).toBe(13)
    expect(await m.listRoles()).toHaveLength(5)
  })
})
