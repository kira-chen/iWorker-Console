// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

/**
 * AdminUsers.vue 真实挂载冒烟（2026-09-12 测试审计 T47，对齐 docs/PRD/数字员工管理端PRD/06组织/用户/prd-用户.md §一.1 / §二.1）。
 *
 * adminUsers.test.js 把 el-table / el-dropdown 等全部桩掉，拦不住组件 setup 期错误（2026-09-11 分页条 TDZ 白屏教训）。
 * 本文件只 mock api 层，其余用真 Element Plus（同 main.js：use(ElementPlus) + 全局注册图标）挂载整页，断言：
 *  - mount 不抛、console.error 零调用；
 *  - 页头标题「用户」+ 说明「管理平台账号、角色分配与密码重置」（md §一.1）；
 *  - 工具栏搜索占位「搜索用户名、显示名或邮箱」+【＋ 新建用户】；
 *  - 表格行含种子用户名 / 显示名；分页条（站内统一 .list-pager，非 el-pagination）在。
 */
const listUsers = vi.fn()
const listRoles = vi.fn()
vi.mock('@/api/adminUser', () => ({
  listUsers: (...a) => listUsers(...a),
  deleteUser: vi.fn(),
  resetUserPassword: vi.fn(),
  listRoles: (...a) => listRoles(...a),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  setUserRoles: vi.fn()
}))

const AdminUsers = (await import('@/views/admin/AdminUsers.vue')).default

const ROWS = [
  { id: 1, username: 'chenyu', displayName: '陈宇', email: 'c@x.com', roles: ['普通用户'], status: 'active', lastLogin: '2026-08-23T17:46:00+08:00' },
  { id: 2, username: 'zhouming', displayName: '周明', email: '', roles: ['普通用户'], status: 'disabled', lastLogin: null }
]

// jsdom 没有 ResizeObserver（el-table 布局用），补一个空实现
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let app, container, errorSpy
const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

beforeEach(() => {
  globalThis.ResizeObserver = globalThis.ResizeObserver || ResizeObserverStub
  listUsers.mockReset().mockResolvedValue({ list: ROWS, total: ROWS.length })
  listRoles.mockReset().mockResolvedValue([{ code: '普通用户', name: '普通用户' }])
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  app?.unmount()
  container?.remove()
  errorSpy.mockRestore()
})

function mountReal() {
  app = createApp(AdminUsers).use(ElementPlus)
  for (const [key, component] of Object.entries(ElementPlusIconsVue)) app.component(key, component)
  app.mount(container)
}

describe('AdminUsers · 真实 Element Plus 挂载冒烟', () => {
  it('整页真挂载不抛、console.error 零调用；页头 / 工具栏 / 行文案 / 分页条齐全（md §一.1、§二.1）', async () => {
    expect(() => mountReal()).not.toThrow()
    await flush()
    expect(errorSpy).not.toHaveBeenCalled()

    const text = container.textContent
    expect(text).toContain('用户')
    expect(text).toContain('管理平台账号、角色分配与密码重置')
    expect(container.querySelector('input[placeholder="搜索用户名、显示名或邮箱"]')).toBeTruthy()
    expect(text).toContain('＋ 新建用户')

    // 行数据真的进了 el-table
    expect(container.querySelector('.el-table')).toBeTruthy()
    expect(text).toContain('chenyu')
    expect(text).toContain('陈宇')
    expect(text).toContain('从未登录')
    expect(listUsers).toHaveBeenCalledWith(expect.objectContaining({ page: 1, sort: 'desc' }))

    // 分页条（站内统一 ListPagination → .list-pager；total>0 恒显）
    expect(container.querySelector('.list-pager')).toBeTruthy()
    expect(container.querySelector('.list-pager').textContent).toContain('共 2 条')
  })
})
