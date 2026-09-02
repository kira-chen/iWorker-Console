// @vitest-environment jsdom
// （adminUserMock → request.js → router 链路触达 window，故用 jsdom；同 positionMock.test）
import { describe, it, expect, beforeEach } from 'vitest'
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

  it('新建用户：初始 active + 从未登录；用户名长度/重名校验按 field 报错', async () => {
    const u = await createUser({ username: 'newuser', displayName: '新人', roleCodes: ['普通用户'] })
    expect(u).toMatchObject({ status: 'active', lastLogin: null })
    await expect(createUser({ username: 'ab', displayName: 'x', roleCodes: ['普通用户'] }))
      .rejects.toMatchObject({ field: 'username' })
    await expect(createUser({ username: 'zhangwei', displayName: 'x', roleCodes: ['普通用户'] }))
      .rejects.toMatchObject({ field: 'username' })
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
