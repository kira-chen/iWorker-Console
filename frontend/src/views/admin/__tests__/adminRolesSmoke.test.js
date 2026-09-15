// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

/**
 * AdminRoles.vue 真实挂载冒烟（2026-09-12 测试审计 T47，对齐 docs/PRD/数字员工管理端PRD/06组织/角色/prd.角色.md §一.1 / §二.1）。
 *
 * adminRoles.test.js 把 el-table 等桩掉，拦不住组件 setup 期错误。本文件只 mock api 层，
 * 其余用真 Element Plus（同 main.js：use(ElementPlus) + 全局注册图标）挂载整页，断言：
 *  - mount 不抛、console.error 零调用；
 *  - 页头「角色与权限」+ 说明「角色与页面绑定：勾中哪些页面，持该角色的用户就能进入哪些页面」（md §一.1）；
 *  - 工具栏搜索占位「搜索角色名称」+【＋ 新建角色】；
 *  - 行含种子角色名、「N 个用户」、权限列「√ 管理端（岗位）」；分页条（站内统一 .list-pager）在。
 */
const listRoles = vi.fn()
const getPermissionTree = vi.fn()
vi.mock('@/api/adminUser', () => ({
  listRoles: (...a) => listRoles(...a),
  getPermissionTree: (...a) => getPermissionTree(...a),
  deleteRole: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  setRolePermissions: vi.fn()
}))

const AdminRoles = (await import('@/views/admin/AdminRoles.vue')).default

const ROWS = [
  { id: 301, name: '系统管理员', modules: ['岗位'], userCount: 2, updatedAt: '2026-08-24T15:02:00+08:00' },
  { id: 305, name: '审计观察员', modules: [], userCount: 0, updatedAt: '2026-08-20T14:08:00+08:00' }
]
const TREE = [
  { scope: '用户端', groups: [{ name: '工作台', pages: ['对话'] }] },
  { scope: '管理端', groups: [{ name: '02 岗位', pages: ['岗位', '岗位管理'] }] }
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
  listRoles.mockReset().mockResolvedValue(ROWS) // 真实 mock（adminUserMock.listRoles）返回裸数组
  getPermissionTree.mockReset().mockResolvedValue(TREE)
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
  app = createApp(AdminRoles).use(ElementPlus)
  for (const [key, component] of Object.entries(ElementPlusIconsVue)) app.component(key, component)
  app.mount(container)
}

describe('AdminRoles · 真实 Element Plus 挂载冒烟', () => {
  it('整页真挂载不抛、console.error 零调用；页头 / 工具栏 / 行文案 / 分页条齐全（md §一.1、§二.1）', async () => {
    expect(() => mountReal()).not.toThrow()
    await flush()
    expect(errorSpy).not.toHaveBeenCalled()

    const text = container.textContent
    expect(text).toContain('角色与权限')
    expect(text).toContain('角色与页面绑定：勾中哪些页面，持该角色的用户就能进入哪些页面')
    expect(container.querySelector('input[placeholder="搜索角色名称"]')).toBeTruthy()
    expect(text).toContain('＋ 新建角色')

    // 行数据真的进了 el-table：角色名、「N 个用户」、权限列聚合 / 空权限
    expect(container.querySelector('.el-table')).toBeTruthy()
    expect(text).toContain('系统管理员')
    expect(text).toContain('2 个用户')
    expect(text.replace(/\s+/g, '')).toContain('√管理端（岗位）')
    expect(text).toContain('未开通任何页面')

    // 分页条（站内统一 ListPagination → .list-pager；total>0 恒显）
    expect(container.querySelector('.list-pager')).toBeTruthy()
    expect(container.querySelector('.list-pager').textContent).toContain('共 2 条')
  })
})
